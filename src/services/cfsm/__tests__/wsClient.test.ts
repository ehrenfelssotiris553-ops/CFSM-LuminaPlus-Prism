// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWsUrl,
  createWsConnection,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_SLOW_ATTEMPTS,
  RECONNECT_SLOW_DELAY_MS,
  type WsSample,
} from "@/services/cfsm/wsClient";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
});

// 每条连接都在 window 上挂了 online 监听：用例结束统一关掉，免得上一条用例的连接响应下一条用例的 online。
const openConnections: { close(): void }[] = [];

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connect(ids: string[]) {
  const batches: WsSample[][] = [];
  const availability: boolean[] = [];
  const connection = createWsConnection("https://status.example.com", ids, {
    onBatch: (samples) => batches.push(samples),
    onAvailabilityChange: (available) => availability.push(available),
  });
  openConnections.push(connection);
  return { connection, batches, availability, socket: () => FakeSocket.instances.at(-1)! };
}

describe("createWsConnection", () => {
  it("connects to the wss endpoint and subscribes after open", () => {
    const { socket } = connect(["node-a", "node-b"]);

    expect(socket().url).toBe("wss://status.example.com/api/ws?subscribe=all");
    socket().open();

    expect(JSON.parse(socket().sent[0]!)).toEqual({
      type: "subscribe",
      scope: "all",
      ids: ["node-a", "node-b"],
    });
  });

  it("subscribes to one server through the URL for the detail page", () => {
    const connection = createWsConnection(
      "https://status.example.com",
      ["node-a", "node-b"],
      { onBatch: () => undefined, onAvailabilityChange: () => undefined },
      { serverId: "node-b" },
    );
    const socket = FakeSocket.instances.at(-1)!;

    expect(socket.url).toBe("wss://status.example.com/api/ws?subscribe=node-b");
    expect(connection.serverId).toBe("node-b");
    // 单台订阅不发 subscribe 消息，也不接受改 ids。
    socket.open();
    connection.updateIds(["node-a"]);
    expect(socket.sent).toEqual([]);
  });

  it("reports availability only once the socket is open", () => {
    const { availability, socket } = connect(["node-a"]);

    expect(availability).toEqual([]);
    socket().open();
    expect(availability).toEqual([true]);
  });

  it("extracts samples from data, payload and metrics alike", () => {
    const { batches, socket } = connect(["node-a"]);
    socket().open();

    socket().emit({
      type: "batchUpdate",
      ts: 900,
      updates: [
        { serverId: "node-a", samples: [{ ts: 1, data: { cpu: 10 } }] },
        { serverId: "node-b", samples: [{ ts: 2, payload: { cpu: 20 } }] },
        { serverId: "node-c", samples: [{ ts: 3, metrics: { cpu: 30 } }] },
      ],
    });

    expect(batches[0]).toEqual([
      { serverId: "node-a", ts: 1, reportTs: 900, data: { cpu: 10 } },
      { serverId: "node-b", ts: 2, reportTs: 900, data: { cpu: 20 } },
      { serverId: "node-c", ts: 3, reportTs: 900, data: { cpu: 30 } },
    ]);
  });

  it("carries the report time separately from the sample time", () => {
    // 样本 ts 是探针时钟打的，可能慢好几分钟；判在线要用后端收到上报的时刻。
    const { batches, socket } = connect(["node-a"]);
    socket().open();

    socket().emit({
      type: "batchUpdate",
      ts: 900,
      updates: [{ serverId: "node-a", reportTs: 950, samples: [{ ts: 1, data: { cpu: 10 } }] }],
    });
    expect(batches[0]?.[0]?.reportTs).toBe(950);

    // 消息和 update 都没带时间：用到达时刻。
    const before = Date.now();
    socket().emit({
      type: "batchUpdate",
      updates: [{ serverId: "node-a", samples: [{ ts: 2, data: { cpu: 11 } }] }],
    });
    expect(batches[1]?.[0]?.reportTs).toBeGreaterThanOrEqual(before);
  });

  it("ignores non-batchUpdate frames", () => {
    const { batches, socket } = connect(["node-a"]);
    socket().open();

    socket().emit({ type: "hello", ts: 1, subscribed: "all" });
    socket().emit({ type: "pong", ts: 2 });

    expect(batches).toEqual([]);
  });

  it("drops ids the backend would reject instead of sending them", () => {
    const { socket } = connect(["node-a", "bad id!", "x".repeat(65)]);
    socket().open();

    expect(JSON.parse(socket().sent[0]!).ids).toEqual(["node-a"]);
  });

  it("caps the subscription at 500 ids", () => {
    const ids = Array.from({ length: 600 }, (_, index) => `node-${index}`);
    const { socket } = connect(ids);
    socket().open();

    expect(JSON.parse(socket().sent[0]!).ids).toHaveLength(500);
  });

  it("resends the subscription when the node list changes", () => {
    const { connection, socket } = connect(["node-a"]);
    socket().open();

    connection.updateIds(["node-a", "node-b"]);
    expect(JSON.parse(socket().sent.at(-1)!).ids).toEqual(["node-a", "node-b"]);

    // 内容相同则不重复发送。
    connection.updateIds(["node-a", "node-b"]);
    expect(socket().sent).toHaveLength(2);
  });

  it("sends a keepalive ping on the interval", () => {
    const { socket } = connect(["node-a"]);
    socket().open();
    socket().sent.length = 0;

    vi.advanceTimersByTime(30_000);

    expect(JSON.parse(socket().sent[0]!).type).toBe("ping");
  });

  it("reconnects with backoff after an unexpected close", () => {
    const { socket } = connect(["node-a"]);
    socket().open();
    socket().onclose?.({ code: 1006 });

    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("after the fast retries run out, tries every 5 minutes a few more times, then stops", () => {
    const { socket } = connect(["a"]);
    socket().open();
    socket().onclose?.({ code: 1006 });
    // 快速重连：指数退避到 30 秒封顶，满 10 次。
    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt += 1) {
      vi.advanceTimersByTime(30_000);
      socket().onclose?.({ code: 1006 });
    }
    expect(FakeSocket.instances).toHaveLength(1 + RECONNECT_MAX_ATTEMPTS);
    // 之后不再 30 秒一次，而是 5 分钟一次。
    vi.advanceTimersByTime(RECONNECT_SLOW_DELAY_MS - 1);
    expect(FakeSocket.instances).toHaveLength(1 + RECONNECT_MAX_ATTEMPTS);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2 + RECONNECT_MAX_ATTEMPTS);
    socket().onclose?.({ code: 1006 });
    for (let attempt = 1; attempt < RECONNECT_SLOW_ATTEMPTS; attempt += 1) {
      vi.advanceTimersByTime(RECONNECT_SLOW_DELAY_MS);
      socket().onclose?.({ code: 1006 });
    }
    // 次数有上限（后端主题规范）：用完就停，不再定时试。
    const afterGiveUp = FakeSocket.instances.length;
    expect(afterGiveUp).toBe(1 + RECONNECT_MAX_ATTEMPTS + RECONNECT_SLOW_ATTEMPTS);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(FakeSocket.instances).toHaveLength(afterGiveUp);
  });

  it("reconnects at once when the browser comes back online, even after giving up", () => {
    const { socket } = connect(["a"]);
    socket().open();
    socket().onclose?.({ code: 1006 });
    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS + RECONNECT_SLOW_ATTEMPTS; attempt += 1) {
      vi.advanceTimersByTime(RECONNECT_SLOW_DELAY_MS);
      socket().onclose?.({ code: 1006 });
    }
    const afterGiveUp = FakeSocket.instances.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(FakeSocket.instances).toHaveLength(afterGiveUp);

    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.instances).toHaveLength(afterGiveUp + 1);

    // 重新计数：这次又断了，照快速重连的节奏来（1 秒后）。
    socket().onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(afterGiveUp + 2);
  });

  it("does not open a second socket on online while one is already there", () => {
    const { socket } = connect(["a"]);
    socket().open();
    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("ignores online after the caller closed it or the server rejected the subscription", () => {
    const closedByCaller = connect(["a"]);
    closedByCaller.socket().open();
    closedByCaller.connection.close();
    const rejected = connect(["b"]);
    rejected.socket().open();
    rejected.socket().onclose?.({ code: 1008 });
    const before = FakeSocket.instances.length;

    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(60 * 60_000);

    expect(FakeSocket.instances).toHaveLength(before);
  });

  it("resets the attempt count after a successful reconnect", () => {
    const { socket } = connect(["a"]);
    socket().open();
    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS - 1; attempt += 1) {
      socket().onclose?.({ code: 1006 });
      vi.advanceTimersByTime(30_000);
    }
    // 这一次连上了：之后再断，仍然会接着重连。
    socket().open();
    const before = FakeSocket.instances.length;
    socket().onclose?.({ code: 1006 });
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(before + 1);
  });

  it("stops retrying when the server rejects the subscription (1008)", () => {
    const { availability, socket } = connect(["node-a"]);
    socket().open();
    socket().onclose?.({ code: 1008 });

    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(availability.at(-1)).toBe(false);
  });

  it("does not reconnect after an explicit close", () => {
    const { connection, socket } = connect(["node-a"]);
    socket().open();
    connection.close();

    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("buildWsUrl", () => {
  it("adds the JWT only for a cross-origin wss connection (private static deployments)", () => {
    expect(buildWsUrl("https://status.example.com", "jwt", "theme.github.io")).toBe(
      "wss://status.example.com/api/ws?subscribe=all&token=jwt",
    );
  });

  it("leaves it out on the same host, over plain ws, or without a token", () => {
    // 同域靠 cfsm_auth Cookie；明文 ws 上带 token 会把登录凭证暴露在链路和日志里。
    expect(buildWsUrl("https://status.example.com", "jwt", "status.example.com")).toBe(
      "wss://status.example.com/api/ws?subscribe=all",
    );
    expect(buildWsUrl("http://127.0.0.1:8787", "jwt", "localhost:5173")).toBe(
      "ws://127.0.0.1:8787/api/ws?subscribe=all",
    );
    expect(buildWsUrl("https://status.example.com", "", "theme.github.io")).toBe(
      "wss://status.example.com/api/ws?subscribe=all",
    );
  });
});
