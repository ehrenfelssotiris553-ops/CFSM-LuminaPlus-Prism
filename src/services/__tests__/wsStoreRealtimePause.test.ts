// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsSample } from "@/services/cfsm/wsClient";
import { CfsmServerSchema, EMPTY_CARRIER_PING } from "@/types/cfsm";

/**
 * 实时连接的暂停与恢复：页面进后台（后端文档要求隐藏时断开）与站长设的连接时限
 * （`frontend_ws_timeout_minutes`）。两者都直接关系到站长的额度 —— 有前端 WebSocket 连着，
 * 后端就让全站探针 2 秒一报 —— 所以用假时钟把「什么时候断、什么时候才重连」钉住。
 * 同一套假时钟也钉着快照同步的失败退避与多站部分失败（文件末尾「快照同步」）。
 */

interface FakeConnection {
  ids: string[];
  /** `subscribe=<id>` 的单台连接；订阅全站时为 null。 */
  serverId: string | null;
  emitSamples(samples: WsSample[]): void;
  closed: boolean;
  close(): void;
  updateIds(ids: string[]): void;
}

const mocks = vi.hoisted(() => ({
  connections: [] as FakeConnection[],
  getServersSnapshot: vi.fn(),
  getServerSnapshot: vi.fn(),
  /** false 时新建的连接一直停在握手中，不回报可用。 */
  autoOpen: true,
}));

vi.mock("@/services/cfsm/wsClient", () => ({
  createWsConnection: (
    _base: string,
    ids: string[],
    handlers: { onAvailabilityChange(available: boolean): void; onBatch(samples: WsSample[]): void },
    options?: { serverId?: string },
  ) => {
    // 和真连接一样：只有连上过的，关掉时才回报一次「不可用」。
    let open = false;
    const connection: FakeConnection = {
      ids: options?.serverId ? [options.serverId] : [...ids],
      serverId: options?.serverId ?? null,
      emitSamples: (samples) => handlers.onBatch(samples),
      closed: false,
      close() {
        connection.closed = true;
        if (open) {
          open = false;
          handlers.onAvailabilityChange(false);
        }
      },
      updateIds(next) {
        if (connection.serverId) return;
        connection.ids = [...next];
      },
    };
    mocks.connections.push(connection);
    if (mocks.autoOpen) {
      queueMicrotask(() => {
        if (connection.closed) return;
        open = true;
        handlers.onAvailabilityChange(true);
      });
    }
    return connection;
  },
}));

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    getServersSnapshot: (...args: unknown[]) => mocks.getServersSnapshot(...args),
    getServerSnapshot: (...args: unknown[]) => mocks.getServerSnapshot(...args),
  };
});

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function snapshot(ids: string[] = ["node-a"], base = "https://backend.example") {
  return {
    servers: ids.map((id) => CfsmServerSchema.parse({ id, name: id, last_updated: Date.now() })),
    baseByServerId: new Map(ids.map((id) => [id, base] as const)),
    sysConfig: {},
    regionStats: {},
    stats: {},
    partial: false,
    failedBases: [] as string[],
  };
}

// store 有模块级状态，每条用例重新求值一份。
async function loadStore() {
  vi.resetModules();
  return import("@/services/wsStore");
}

const syncCount = () => mocks.getServersSnapshot.mock.calls.length;
const nodeIds = (store: Awaited<ReturnType<typeof loadStore>>) =>
  store.getAllNodeMetaSnapshot().map((node) => node.uuid);

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  mocks.autoOpen = true;
  mocks.connections.length = 0;
  mocks.getServersSnapshot.mockReset();
  mocks.getServersSnapshot.mockImplementation(async () => snapshot());
  mocks.getServerSnapshot.mockReset();
  mocks.getServerSnapshot.mockImplementation(async (id: string) => snapshot([id]));
  window.localStorage.clear();
  window.location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("页面进后台", () => {
  it("disconnects as soon as the page is hidden, and resyncs once on return", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connections).toHaveLength(1);
    expect(store.getStoreStatusSnapshot().realtimeConnected).toBe(true);

    // 后端主题规范：隐藏时立刻关 WS（原来留 30 秒缓冲）。
    setHidden(true);
    expect(mocks.connections[0]!.closed).toBe(true);
    expect(store.getStoreStatusSnapshot().realtimeConnected).toBe(false);

    // 后台期间既不重连也不请求。
    const syncsBeforeReturn = syncCount();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(syncCount()).toBe(syncsBeforeReturn);
    expect(mocks.connections).toHaveLength(1);

    // 切回前台：重建连接，并补一次快照。
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(syncsBeforeReturn + 1);
    expect(mocks.connections).toHaveLength(2);
    expect(mocks.connections[1]!.closed).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("reconnects on return without waiting for the snapshot", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);

    setHidden(true);
    expect(mocks.connections[0]!.closed).toBe(true);

    // 冷的 /api/servers 要好几秒（线上实测 2~8 秒），而探针要等订阅到了才从 60 秒一报提速：
    // 连接排在快照后面，切回来就一直是旧数据。
    let resolveSnapshot!: (value: ReturnType<typeof snapshot>) => void;
    mocks.getServersSnapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    setHidden(false);
    expect(mocks.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getStoreStatusSnapshot().realtimeConnected).toBe(true);

    // 快照回来多了一台节点：在同一条连接上改订阅，不再重连。
    resolveSnapshot(snapshot(["node-a", "node-b"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connections).toHaveLength(2);
    expect(mocks.connections[1]!.ids).toEqual(["node-a", "node-b"]);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("ignores the snapshot's stale rate while the new connection is still handshaking", async () => {
    const serverAt = (netInSpeed: number, lastUpdated: number) => ({
      ...snapshot(),
      servers: [
        CfsmServerSchema.parse({
          id: "node-a",
          name: "node-a",
          last_updated: lastUpdated,
          net_in_speed: netInSpeed,
        }),
      ],
    });
    mocks.getServersSnapshot.mockImplementation(async () => serverAt(100, Date.now()));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("node-a")?.netDown).toBe(100);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    // 切回前台时连接还没握上手，快照先回来：它的速率是 30 秒前的，不能当现在显示。
    mocks.autoOpen = false;
    mocks.getServersSnapshot.mockImplementation(async () => serverAt(9_999, Date.now() - 30_000));
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("node-a")?.netDown).toBe(100);

    // 这次打开页面连上过，重连慢只是后端冷启动：5 秒还不算连不上（原来 5 秒就采用，线上被顶到 5.93 MB/s）。
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.netDown).toBe(100);

    // 一直连不上也不会退回轮询去拿这份旧速率（v1.2.20 起成功加载后不再定时拉 /api/servers）。
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.netDown).toBe(100);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("never fetches /api/servers on a timer once loaded, connected or not", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const afterLoad = syncCount();

    // 连着的时候：原来每 60 秒全量对齐一次。
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(syncCount()).toBe(afterLoad);

    // 切回前台后一直连不上：原来 5 秒轮询兜底，现在只有切回来时补的那一次。
    setHidden(true);
    mocks.autoOpen = false;
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    const afterResume = syncCount();
    expect(afterResume).toBe(afterLoad + 1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(syncCount()).toBe(afterResume);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps polling only when the dev mock asks for it (no WebSocket there)", async () => {
    mocks.autoOpen = false;
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const afterLoad = syncCount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncCount()).toBe(afterLoad);

    store.setDevSnapshotPolling(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncCount()).toBeGreaterThan(afterLoad);
    store.setDevSnapshotPolling(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps the last online state while realtime is down instead of aging everyone offline", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("node-a")?.online).toBe(true);

    setHidden(true);
    mocks.autoOpen = false;
    setHidden(false);
    // 快照里的 last_updated 也跟着变旧：没有新帧不代表节点离线，只是我们自己没连上。
    mocks.getServersSnapshot.mockImplementation(async () => ({
      ...snapshot(),
      servers: [CfsmServerSchema.parse({ id: "node-a", name: "node-a", last_updated: Date.now() })],
    }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.online).toBe(true);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("实时连接时限（frontend_ws_timeout_minutes）", () => {
  it("disconnects at the limit and stays paused, even across a tab switch, until the user continues", async () => {
    const store = await loadStore();
    store.setRealtimeSessionLimitMinutes(1);
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connections).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.connections[0]!.closed).toBe(true);
    expect(store.getStoreStatusSnapshot().realtimeSessionExpired).toBe(true);

    // 到时限后：不轮询、不重连，切到后台再切回来也不会静默重连。
    const syncs = syncCount();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(1_000);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(mocks.connections).toHaveLength(1);
    expect(syncCount()).toBe(syncs);

    // 用户点「继续」：补一次快照、重连，并重新计时。
    store.resumeRealtimeSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getStoreStatusSnapshot().realtimeSessionExpired).toBe(false);
    expect(syncCount()).toBe(syncs + 1);
    expect(mocks.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.connections[1]!.closed).toBe(true);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("does nothing when the site sets no limit", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(mocks.connections[0]!.closed).toBe(false);
    expect(store.getStoreStatusSnapshot().realtimeSessionExpired).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("详情页只订阅正在看的这一台", () => {
  it("switches to a subscribe=<id> socket on the detail page and back to subscribe=all on leave", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connections[0]!.serverId).toBeNull();
    expect(mocks.connections[0]!.ids).toEqual(["node-a", "node-b"]);

    // 后端主题规范：独立详情页必须 subscribe=<id>，不能 subscribe=all 再过滤。
    const leave = store.focusRealtimeNode("node-b");
    expect(mocks.connections[0]!.closed).toBe(true);
    expect(mocks.connections).toHaveLength(2);
    expect(mocks.connections[1]!.serverId).toBe("node-b");
    // 没订阅的 node-a 一直没有新帧：不代表它离线，在详情页期间不改判。
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.online).toBe(true);

    leave();
    expect(mocks.connections[1]!.closed).toBe(true);
    expect(mocks.connections).toHaveLength(3);
    expect(mocks.connections[2]!.serverId).toBeNull();
    expect(mocks.connections[2]!.ids).toEqual(["node-a", "node-b"]);
    // 进详情页、回首页都没有多查 /api/servers（节点表早就有了）。
    expect(syncCount()).toBe(1);
    expect(mocks.getServerSnapshot).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps counting the connection time limit across detail-page socket switches", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    store.setRealtimeSessionLimitMinutes(1);
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);

    // 进出详情页换了连接，但「单次连接」从首次建连算起，不因换连接重新计时。
    await vi.advanceTimersByTimeAsync(40_000);
    const leave = store.focusRealtimeNode("node-b");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.getStoreStatusSnapshot().realtimeSessionExpired).toBe(true);
    expect(mocks.connections.every((connection) => connection.closed)).toBe(true);

    leave();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("refreshes only the viewed server when the detail page comes back to the foreground", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    mocks.getServerSnapshot.mockImplementation(async (id: string) => ({
      ...snapshot([id]),
      servers: [CfsmServerSchema.parse({ id, name: `${id} renamed`, last_updated: Date.now() })],
    }));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const leave = store.focusRealtimeNode("node-b");

    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);

    // 后端主题规范：切回前台按当前页面类型补 REST —— 详情页补 /api/server?id=，不是全站列表。
    expect(syncCount()).toBe(1);
    expect(mocks.getServerSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getServerSnapshot.mock.calls[0]![0]).toBe("node-b");
    // 只刷新这一台，别的节点留着给回首页时用。
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);
    expect(store.getNodeMetaSnapshot("node-b")?.name).toBe("node-b renamed");
    expect(store.getStoreStatusSnapshot().hydrated).toBe(true);

    leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps the detail page's single-server refresh when it was put off by scrolling", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const leave = store.focusRealtimeNode("node-b");

    // 切回前台时手指正在划屏：补数据推迟到停手后再发，推迟了也还是只补这一台。
    setHidden(true);
    window.dispatchEvent(new Event("scroll"));
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getServerSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(syncCount()).toBe(1);
    expect(mocks.getServerSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getServerSnapshot.mock.calls[0]![0]).toBe("node-b");
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);

    leave();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("loads only that one server when the detail page is opened directly, then the full list back on home", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    // 详情页的两个 effect 在同一次提交里先后跑：先订阅 store，再设焦点。
    const release = store.retainStore();
    const leave = store.focusRealtimeNode("node-b");
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.getServerSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getServerSnapshot.mock.calls[0]![0]).toBe("node-b");
    expect(syncCount()).toBe(0);
    expect(nodeIds(store)).toEqual(["node-b"]);
    expect(mocks.connections).toHaveLength(1);
    expect(mocks.connections[0]!.serverId).toBe("node-b");

    // 回首页：节点表只有一台，补那一次全量；补回来之前按没加载完处理。
    leave();
    expect(store.getStoreStatusSnapshot().hydrated).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(1);
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);
    expect(store.getStoreStatusSnapshot().hydrated).toBe(true);
    // 单台连接改不了范围：关掉，换成订阅全站的。
    expect(mocks.connections[0]!.closed).toBe(true);
    expect(mocks.connections.at(-1)!.serverId).toBeNull();
    expect(mocks.connections.at(-1)!.ids).toEqual(["node-a", "node-b"]);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps the socket open when the focused node is not in the snapshot", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);

    // 地址里的 ID 已经删掉 / 访客打开了后台隐藏的节点：按焦点过滤会一台不剩。
    const leave = store.focusRealtimeNode("node-gone");
    expect(mocks.connections[0]!.closed).toBe(false);
    expect(mocks.connections[0]!.ids).toEqual(["node-a", "node-b"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.connections[0]!.closed).toBe(false);

    leave();
    expect(mocks.connections).toHaveLength(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("直接打开详情页时外壳先订阅 store", () => {
  it("still loads only that server when the shell retains the store before the page sets its focus", async () => {
    window.location.hash = "#/server/node-b";
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    // 外壳（悬浮按钮、离线提醒）先订阅；详情页是按需加载的分包，焦点要等它加载完才设。
    const releaseShell = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(0);
    expect(mocks.getServerSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getServerSnapshot.mock.calls[0]![0]).toBe("node-b");

    // 详情页加载完、设上焦点：这一台已经有了，不再查。
    const leave = store.focusRealtimeNode("node-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getServerSnapshot).toHaveBeenCalledTimes(1);
    expect(syncCount()).toBe(0);

    // 回首页（地址先变、再卸载详情页）：补一次全量。
    window.location.hash = "#/";
    leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(1);
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);

    releaseShell();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("快照同步", () => {
  it("backs off once per failed sync, even when a poll tick joined it", async () => {
    const startedAt = Date.now();
    const callTimes: number[] = [];
    mocks.getServersSnapshot.mockImplementation(() => {
      callTimes.push(Date.now() - startedAt);
      // 冷的 /api/servers 拖到 8 秒超时才失败：比 5 秒一拍的轮询长，途中那一拍会接上同一个请求。
      return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8_000));
    });
    const store = await loadStore();
    const release = store.retainStore();

    await vi.advanceTimersByTimeAsync(19_000);
    // 第 8 秒失败 → 退避一拍（跳过第 10 秒）→ 第 15 秒重试。退避算了两次的话要拖到第 20 秒。
    expect(callTimes).toEqual([0, 15_000]);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("stops retrying after the attempt limit and resumes on retry or tab return", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => {
      throw new Error("backend down");
    });
    const store = await loadStore();
    const release = store.retainStore();

    // 退避重试到上限后停下：之后再等多久都不再请求（后端主题规范：重试要限次数）。
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(syncCount()).toBe(store.BOOTSTRAP_MAX_ATTEMPTS);
    expect(store.getStoreStatusSnapshot().syncRetryExhausted).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(syncCount()).toBe(store.BOOTSTRAP_MAX_ATTEMPTS);

    // 用户点「重试」：立刻试一次，失败后照常退避，直到再次到上限。
    store.retryNodeSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(store.BOOTSTRAP_MAX_ATTEMPTS + 1);
    expect(store.getStoreStatusSnapshot().syncRetryExhausted).toBe(false);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(syncCount()).toBe(store.BOOTSTRAP_MAX_ATTEMPTS * 2);

    // 切回前台也重新开始一轮；这次成功了，标记清掉。
    mocks.getServersSnapshot.mockImplementation(async () => snapshot());
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getStoreStatusSnapshot().hydrated).toBe(true);
    expect(store.getStoreStatusSnapshot().syncRetryExhausted).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps a site's nodes, socket and ping buffer when only that site misses a sync", async () => {
    const siteA = "https://a.example";
    const siteB = "https://b.example";
    const bothSites = () => {
      const a = snapshot(["node-a"], siteA);
      const b = snapshot(["node-b"], siteB);
      return {
        ...a,
        servers: [...a.servers, ...b.servers],
        baseByServerId: new Map([...a.baseByServerId, ...b.baseByServerId]),
      };
    };
    mocks.getServersSnapshot.mockImplementation(async () => bothSites());
    const store = await loadStore();
    const pingLive = await import("@/services/pingLiveStore");
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);
    expect(mocks.connections).toHaveLength(2);
    pingLive.recordPingSample("node-b", Date.now(), { ...EMPTY_CARRIER_PING, ct: 42 });

    // B 站这一轮超时：快照里只剩 A 站的节点。
    mocks.getServersSnapshot.mockImplementation(async () => ({
      ...snapshot(["node-a"], siteA),
      partial: true,
      failedBases: [siteB],
    }));
    // 切到后台再回来补的那一次快照撞上了 B 站超时（两条连接随隐藏关掉，回来各建一条新的）。
    const syncs = syncCount();
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCount()).toBe(syncs + 1);
    expect(nodeIds(store)).toEqual(["node-a", "node-b"]);
    expect(mocks.connections.map((connection) => connection.closed)).toEqual([true, true, false, false]);
    expect(pingLive.getPingHistorySnapshot("node-b")).toHaveLength(1);
    expect(store.getStoreStatusSnapshot().partial).toBe(true);

    // 有站点没返回时接着重试（不靠定时全量刷新）。B 站恢复响应、节点确实删了：这一次才去掉。
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a"], siteA));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncCount()).toBeGreaterThan(syncs + 1);
    expect(nodeIds(store)).toEqual(["node-a"]);
    expect(store.getStoreStatusSnapshot().partial).toBe(false);
    expect(mocks.connections.map((connection) => connection.closed)).toEqual([true, true, false, true]);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("设置页复用首页的节点表", () => {
  it("hands out the full list after the home page loaded it, even once the store stopped", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    expect(store.getCachedFullNodeList()).toBeNull();

    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);

    // 离开首页、store 已停：设置页拿这份就不必再查 /api/servers。
    expect(store.getCachedFullNodeList()?.map((node) => node.uuid)).toEqual(["node-a", "node-b"]);
    expect(syncCount()).toBe(1);
  });

  it("does not hand out a list fetched under a different login state", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => snapshot(["node-a", "node-b"]));
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getCachedFullNodeList()).not.toBeNull();

    // 在别的标签页登录了：访客看到的那份列表里没有隐藏节点，设置页得自己重查。
    window.localStorage.setItem("jwt_token", "admin-token");
    expect(store.getCachedFullNodeList()).toBeNull();
  });

  it("has no list to share when only the detail page's single server was loaded", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    const leave = store.focusRealtimeNode("node-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getCachedFullNodeList()).toBeNull();

    leave();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("后台「显示价格」「显示到期」开关", () => {
  const billed = (ids: string[], sysConfig: Record<string, unknown>) => ({
    ...snapshot(ids),
    servers: ids.map((id) =>
      CfsmServerSchema.parse({
        id,
        name: id,
        last_updated: Date.now(),
        price: "48",
        currency: "¥",
        billing_cycle: "monthly",
        expire_date: "2026-11-15",
        auto_renewal: "1",
      }),
    ),
    sysConfig,
  });

  it("关了的那一样在节点信息里就抹掉，开着的原样；引用稳定", async () => {
    mocks.getServersSnapshot.mockImplementation(async () =>
      billed(["node-a"], { show_price: false, show_expire: true }),
    );
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);

    const meta = store.getNodeMetaSnapshot("node-a")!;
    expect(Number.isNaN(meta.price)).toBe(true);
    expect(meta.currency).toBe("");
    expect(meta.expired_at).toBe("2026-11-15");
    expect(meta.auto_renewal).toBe(true);
    expect(store.getNodeMetaSnapshot("node-a")).toBe(meta);
    expect(store.getAllNodeMetaSnapshot()[0]).toBe(meta);
    expect(store.getSiteBillingVisibilitySnapshot()).toEqual({ known: true, price: false, expire: true });

    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("直接打开详情页：单台接口不带开关，先都当作不显示；回首页拿到全站列表后按开关来", async () => {
    mocks.getServerSnapshot.mockImplementation(async (id: string) =>
      billed([id], { long_history_points: 120 }),
    );
    mocks.getServersSnapshot.mockImplementation(async () =>
      billed(["node-a", "node-b"], { show_price: true, show_expire: true }),
    );
    const store = await loadStore();
    const release = store.retainStore();
    const leave = store.focusRealtimeNode("node-b");
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getSiteBillingVisibilitySnapshot()).toEqual({ known: false, price: false, expire: false });
    const detail = store.getNodeMetaSnapshot("node-b")!;
    expect(Number.isNaN(detail.price)).toBe(true);
    expect(detail.expired_at).toBe("");
    expect(store.getSysConfigSnapshot().long_history_points).toBe(120);

    const notified = vi.fn();
    const unsubscribe = store.subscribeToNodeMeta("node-b", notified);
    leave();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getSiteBillingVisibilitySnapshot()).toEqual({ known: true, price: true, expire: true });
    expect(notified).toHaveBeenCalled();
    expect(store.getNodeMetaSnapshot("node-b")!.price).toBe(48);
    expect(store.getNodeMetaSnapshot("node-b")!.expired_at).toBe("2026-11-15");

    unsubscribe();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("resolveRealtimeSessionLimitMs", () => {
  it("treats 0, negatives, fractions and junk as no limit", async () => {
    const { resolveRealtimeSessionLimitMs } = await loadStore();
    for (const value of [0, -5, 1.5, "abc", null, undefined]) {
      expect(resolveRealtimeSessionLimitMs(value)).toBe(0);
    }
  });

  it("converts minutes and caps at the backend's 1440", async () => {
    const { resolveRealtimeSessionLimitMs } = await loadStore();
    expect(resolveRealtimeSessionLimitMs(20)).toBe(20 * 60_000);
    expect(resolveRealtimeSessionLimitMs("30")).toBe(30 * 60_000);
    expect(resolveRealtimeSessionLimitMs(5000)).toBe(1440 * 60_000);
  });
});


describe("首页每秒合并提交一次", () => {
  it("commits at most once per second and keeps report fields from earlier frames in that second", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    let renders = 0;
    const unsubscribe = store.subscribeToNodeMetrics("node-a", () => {
      renders += 1;
    });

    const base = Date.now();
    const frame = (offset: number, data: Record<string, unknown>) => ({
      serverId: "node-a",
      ts: base + offset,
      reportTs: base + offset,
      data,
    });
    // 一秒内到了三帧：中间那帧是上报的最后一帧，带进程数；最后一帧只有 CPU。
    mocks.connections[0]!.emitSamples([frame(100, { cpu: 10 })]);
    await vi.advanceTimersByTimeAsync(300);
    mocks.connections[0]!.emitSamples([frame(400, { cpu: 20, processes: 321 })]);
    await vi.advanceTimersByTimeAsync(300);
    mocks.connections[0]!.emitSamples([frame(700, { cpu: 30 })]);
    expect(renders).toBe(0);

    await vi.advanceTimersByTimeAsync(400);
    expect(renders).toBe(1);
    const metrics = store.getNodeMetricsSnapshot("node-a");
    expect(metrics?.cpuPct).toBe(30);
    expect(metrics?.process).toBe(321);
    expect(metrics?.updatedAt).toBe(base + 700);

    // 晚到的旧帧不会把显示倒回去。
    mocks.connections[0]!.emitSamples([frame(200, { cpu: 99 })]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.cpuPct).toBe(30);

    unsubscribe();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("still plays frames one by one on the detail page for the live chart", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const leave = store.focusRealtimeNode("node-a");
    await vi.advanceTimersByTimeAsync(0);
    const detailSocket = mocks.connections.at(-1)!;
    expect(detailSocket.serverId).toBe("node-a");

    const now = Date.now();
    detailSocket.emitSamples([
      { serverId: "node-a", ts: now + 100, reportTs: now, data: { cpu: 11 } },
      { serverId: "node-a", ts: now + 200, reportTs: now, data: { cpu: 22 } },
    ]);
    // 第一帧马上放出，第二帧按节奏稍后放：实时曲线上是两个点，不是合成一个。
    await vi.advanceTimersByTimeAsync(150);
    expect(store.getNodeMetricsSnapshot("node-a")?.cpuPct).toBe(11);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(store.getNodeMetricsSnapshot("node-a")?.cpuPct).toBe(22);

    leave();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("drops the unsent second when the page goes to the background", async () => {
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const now = Date.now();
    mocks.connections[0]!.emitSamples([{ serverId: "node-a", ts: now + 100, reportTs: now, data: { cpu: 55 } }]);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.getNodeMetricsSnapshot("node-a")?.cpuPct).not.toBe(55);

    setHidden(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("clock correction playback", () => {
  it("accepts corrected-time samples after a future clock sample was shown", async () => {
    mocks.getServersSnapshot.mockImplementation(async () => {
      const value = snapshot();
      value.servers[0]!.last_updated = Date.now() + 1800000;
      return value;
    });
    const store = await loadStore();
    const release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("node-a")?.updatedAt).toBeGreaterThan(Date.now() + 60000);
    const corrected = Date.now();
    mocks.connections[0]!.emitSamples([{ serverId: "node-a", ts: corrected, reportTs: corrected, data: { cpu: 17 } }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getNodeMetricsSnapshot("node-a")?.cpuPct).toBe(17);
    expect(store.getNodeMetricsSnapshot("node-a")?.updatedAt).toBe(corrected);
    expect(store.getNodeMetricsSnapshot("node-a")?.online).toBe(true);
    release();
  });
});
