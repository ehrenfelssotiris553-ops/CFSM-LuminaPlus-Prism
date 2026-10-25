// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSiteThemeBackup,
  dismissSiteThemeBackup,
  getSiteThemeSyncStatus,
  hasUnsyncedLocalChanges,
  resetSiteThemeSyncForTest,
  restoreSiteThemeBackup,
  retrySiteThemeSync,
  resolveSiteThemeConflict,
  SITE_BACKUP_SETTLE_MS,
  SITE_SYNC_MARKER_KEY,
  SITE_THEME_SYNC_DEBOUNCE_MS,
  SYNC_CONFIG_MAX_AGE_MS,
  startSiteThemeAutoSync,
} from "@/hooks/useSiteThemeOptions";
import { ApiRequestError } from "@/services/cfsm/http";
import {
  clearPingLineOverrides,
  getAllPingLineOverrides,
  setPingLineOverrides,
} from "@/services/pingLineOverrideStore";
import { queryClient } from "@/services/queryClient";
import {
  getLocalThemeSettings,
  resetLocalThemeSettings,
  saveLocalThemeSettings,
} from "@/services/themeSettingsStore";
import type { PublicConfig } from "@/types/cfsm";
import { LOCAL_IP_STACK_EDITS_KEY } from "@/utils/ipStack";

const mocks = vi.hoisted(() => ({
  saveThemeOptions: vi.fn(),
  getPublic: vi.fn(),
}));

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    saveThemeOptions: (...args: unknown[]) => mocks.saveThemeOptions(...args),
    getPublic: (...args: unknown[]) => mocks.getPublic(...args),
  };
});

const PENDING_KEY = "cfsm-luminaplus:site-sync-pending";

function seedConfig(themeSettings: Record<string, unknown> = {}) {
  queryClient.setQueryData<PublicConfig>(["public"], {
    theme_settings: themeSettings,
    // 令牌后端认：登录态从这份配置推导（resolveMe）。
    authorization: true,
  } as PublicConfig);
}

function siteSettings() {
  return queryClient.getQueryData<PublicConfig>(["public"])?.theme_settings;
}

/** 后端照单全收，回的就是提交的那份。 */
function acceptWrites() {
  mocks.saveThemeOptions.mockImplementation((themeOptions: Record<string, unknown>) =>
    Promise.resolve({ success: true, theme_options: themeOptions, message: "" }),
  );
}

async function flushDebounce() {
  await vi.advanceTimersByTimeAsync(SITE_THEME_SYNC_DEBOUNCE_MS);
}

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  resetLocalThemeSettings();
  clearPingLineOverrides();
  resetSiteThemeSyncForTest();
  queryClient.clear();
  mocks.saveThemeOptions.mockReset();
  mocks.getPublic.mockReset();
  // 默认后端和缓存里的是同一份；要模拟「别的设备改过」的用例自己换掉。
  mocks.getPublic.mockImplementation(() =>
    Promise.resolve(queryClient.getQueryData<PublicConfig>(["public"])),
  );
  window.localStorage.setItem("jwt_token", "token");
  seedConfig();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  window.localStorage.clear();
  resetLocalThemeSettings();
  clearPingLineOverrides();
  resetSiteThemeSyncForTest();
  queryClient.clear();
});

describe("登录站长的改动自动同步到后端", () => {
  it("keeps undo-to-Auto while a badge save is in flight", async () => {
    let finishFirst: (() => void) | undefined;
    mocks.saveThemeOptions.mockImplementationOnce((options: Record<string, unknown>) => new Promise((resolve) => {
      finishFirst = () => resolve({ success: true, theme_options: options });
    }));
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ [LOCAL_IP_STACK_EDITS_KEY]: { a: { ipv4: true } } });
    await flushDebounce();
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    saveLocalThemeSettings({ [LOCAL_IP_STACK_EDITS_KEY]: { a: { ipv4: "auto" } } });
    await flushDebounce();
    acceptWrites();
    finishFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(2);
    expect(siteSettings()?.homepageIpStackOverrides).toEqual({});
    expect(siteSettings()).not.toHaveProperty(LOCAL_IP_STACK_EDITS_KEY);
    expect(getLocalThemeSettings()).toEqual({});
  });

  it("keeps another theme's settings when an edit here is saved", async () => {
    // 两个主题共用站点设置：这边改一项，原来整份替换会把别的主题的设置全删掉。
    acceptWrites();
    seedConfig({
      mikus: { enabled: false },
      saoBackground: "https://example.com/bg.png",
      showCostSummaryFloatingButton: true,
    });
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ surfaceOpacity: 60 });
    await flushDebounce();

    const sent = mocks.saveThemeOptions.mock.calls[0][0];
    expect(sent).toMatchObject({
      surfaceOpacity: 60,
      mikus: { enabled: false },
      saoBackground: "https://example.com/bg.png",
    });
    // 老的资产悬浮按钮开关读的时候已经并进 showCostSummary，不再原样留着。
    expect(sent).not.toHaveProperty("showCostSummaryFloatingButton");
    expect(sent.showCostSummary).toBe(true);
  });

  it("does not save just because the backend carries another theme's settings", async () => {
    acceptWrites();
    seedConfig({ mikus: { enabled: false }, surfaceOpacity: 60 });
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ surfaceOpacity: 60 });
    await flushDebounce();
    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
  });

  it("merges a node badge edit into the site snapshot per node and protocol", async () => {
    acceptWrites();
    seedConfig({ homepageIpStackOverrides: { a: { ipv4: true, ipv6: false }, b: { ipv4: false } } });
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ [LOCAL_IP_STACK_EDITS_KEY]: { a: { ipv4: false } } });
    await flushDebounce();
    expect(siteSettings()?.homepageIpStackOverrides).toEqual({ a: { ipv4: false, ipv6: false }, b: { ipv4: false } });
  });
  it("停手后只发一次，发完以后端为准、本机清空", async () => {
    acceptWrites();
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await vi.advanceTimersByTimeAsync(SITE_THEME_SYNC_DEBOUNCE_MS / 2);
    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    expect(getSiteThemeSyncStatus().phase).toBe("pending");
    await flushDebounce();

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions.mock.calls[0][0]).toMatchObject({ desktopNodeViewMode: "list" });
    expect(siteSettings()).toMatchObject({ desktopNodeViewMode: "list" });
    expect(getLocalThemeSettings()).toEqual({});
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });

  it("卡片上换线路也同步，换过的行并进站点配置", async () => {
    acceptWrites();
    seedConfig({ enableHomepageMultiPing: true, homepageMultiPingTaskIds: [1, 2, 3] });
    stop = startSiteThemeAutoSync();

    setPingLineOverrides("node-a", { "0": 4 });
    await flushDebounce();

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(siteSettings()).toMatchObject({ homepagePingLineOverrides: { "node-a": { "0": 4 } } });
    expect(getAllPingLineOverrides()).toEqual({});
  });

  it("页面刚打开就改：直接拿缓存的 config 当底，不多查", async () => {
    acceptWrites();
    // 后端主题规范：/api/config 整个页面只查一次。缓存不到 5 分钟，后端这边的变化（透明度 50）看不到也不去查。
    seedConfig({ surfaceOpacity: 100, enableHomepageMultiPing: true });
    mocks.getPublic.mockResolvedValue({
      theme_settings: { surfaceOpacity: 50, enableHomepageMultiPing: false },
    } as unknown as PublicConfig);
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();

    expect(mocks.getPublic).not.toHaveBeenCalled();
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions.mock.calls[0][0]).toMatchObject({
      surfaceOpacity: 100,
      enableHomepageMultiPing: true,
      desktopNodeViewMode: "list",
    });
  });

  it("页面开久了第一次保存先重拉 config，别的设备改过的项不被旧副本盖掉", async () => {
    acceptWrites();
    seedConfig({ surfaceOpacity: 100, enableHomepageMultiPing: true });
    stop = startSiteThemeAutoSync();
    // 站长在别的设备上把透明度改成了 50。
    mocks.getPublic.mockResolvedValue({
      theme_settings: { surfaceOpacity: 50, enableHomepageMultiPing: true },
      authorization: true,
    } as unknown as PublicConfig);
    vi.advanceTimersByTime(SYNC_CONFIG_MAX_AGE_MS + 1_000);

    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();

    expect(mocks.getPublic).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions.mock.calls[0][0]).toMatchObject({
      surfaceOpacity: 50,
      desktopNodeViewMode: "list",
    });

    // 刚保存过，缓存算新的：紧接着的改动不再查。
    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();
    expect(mocks.getPublic).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(2);
  });

  it("重拉 config 失败就不发，免得拿旧底盖掉后端", async () => {
    acceptWrites();
    stop = startSiteThemeAutoSync();
    mocks.getPublic.mockRejectedValue(new Error("network"));
    vi.advanceTimersByTime(SYNC_CONFIG_MAX_AGE_MS + 1_000);

    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();
    // queryClient 对网络错误自动重试一次，等它也失败。
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    expect(getSiteThemeSyncStatus().phase).toBe("error");
  });

  it("缓存里还没有 config 时才查一次（就是这个页面的首次查询）", async () => {
    acceptWrites();
    queryClient.clear();
    mocks.getPublic.mockResolvedValue({
      theme_settings: { surfaceOpacity: 80 },
      authorization: true,
    } as unknown as PublicConfig);
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();

    expect(mocks.getPublic).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions.mock.calls[0][0]).toMatchObject({
      surfaceOpacity: 80,
      desktopNodeViewMode: "list",
    });

    // 第二次改动直接用缓存。
    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();
    expect(mocks.getPublic).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(2);
  });

  it("未登录的访客只存本机，不发请求", async () => {
    window.localStorage.removeItem("jwt_token");
    queryClient.setQueryData<PublicConfig>(["public"], { theme_settings: {}, authorization: false } as unknown as PublicConfig);
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();

    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    expect(getLocalThemeSettings()).toEqual({ desktopNodeViewMode: "compact" });
  });

  it("本机令牌被浏览器清掉、只剩登录 Cookie 的站长照样同步", async () => {
    acceptWrites();
    window.localStorage.removeItem("jwt_token");
    // seedConfig 的 authorization: true 就是后端认了这个 Cookie。
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
  });

  it("令牌还在但登录校验判成未登录（过期），也不发", async () => {
    queryClient.setQueryData<PublicConfig>(["public"], {
      theme_settings: {},
      authorization: false,
    } as PublicConfig);
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();

    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
  });

  it("请求途中又改：不并发，改动留在本机，等回来再发一轮", async () => {
    let resolveFirst: (() => void) | undefined;
    mocks.saveThemeOptions.mockImplementationOnce(
      (themeOptions: Record<string, unknown>) =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ success: true, theme_options: themeOptions, message: "" });
        }),
    );
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);

    let localWhenSecondSent: Record<string, unknown> | undefined;
    mocks.saveThemeOptions.mockImplementation((themeOptions: Record<string, unknown>) => {
      localWhenSecondSent = { ...getLocalThemeSettings() };
      return Promise.resolve({ success: true, theme_options: themeOptions, message: "" });
    });
    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();
    // 第一次还没回来：第二次不能先发出去，否则旧快照晚到会盖掉新的。
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // 第一次发出去的是 compact，回来时本机已经是 list：不能清，要留给第二轮。
    expect(localWhenSecondSent).toEqual({ desktopNodeViewMode: "list" });

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(2);
    expect(mocks.saveThemeOptions.mock.calls[1][0]).toMatchObject({ desktopNodeViewMode: "list" });
    expect(getLocalThemeSettings()).toEqual({});
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });

  it("和站点现有的一样就不发，本机那份照样清掉", async () => {
    seedConfig({ desktopNodeViewMode: "list" });
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "list" });
    await flushDebounce();

    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    expect(getLocalThemeSettings()).toEqual({});
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });

  it("失败时改动留在本机、不自动重试，点重试再发", async () => {
    mocks.saveThemeOptions.mockRejectedValueOnce(
      new ApiRequestError("unauthorized", 401, "/api/theme_options"),
    );
    stop = startSiteThemeAutoSync();

    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    await flushDebounce();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(getSiteThemeSyncStatus().phase).toBe("error");
    expect(getLocalThemeSettings()).toEqual({ desktopNodeViewMode: "compact" });
    expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull();

    acceptWrites();
    retrySiteThemeSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(2);
    expect(getLocalThemeSettings()).toEqual({});
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });

  it("上次没同步上的改动，下次打开接着发", async () => {
    acceptWrites();
    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });
    window.localStorage.setItem(PENDING_KEY, "1");

    stop = startSiteThemeAutoSync();
    await flushDebounce();

    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(getLocalThemeSettings()).toEqual({});
  });

  it("本机只有自动同步上线前存的旧设置时，打开页面不往后端推", async () => {
    saveLocalThemeSettings({ desktopNodeViewMode: "compact" });

    stop = startSiteThemeAutoSync();
    await flushDebounce();

    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    expect(getLocalThemeSettings()).toEqual({ desktopNodeViewMode: "compact" });
  });
});

describe("hasUnsyncedLocalChanges（站长的「改用后端配置」什么时候出现）", () => {
  it("同步失败、改动留在本机时出现", () => {
    expect(hasUnsyncedLocalChanges({ hasLocalChanges: true, phase: "error", waiting: false })).toBe(true);
  });

  it("自动同步上线前存在本机的旧设置也算", () => {
    expect(hasUnsyncedLocalChanges({ hasLocalChanges: true, phase: "idle", waiting: false })).toBe(true);
  });

  it("正在同步时不出现，免得每改一次就闪一下", () => {
    for (const phase of ["pending", "saving"] as const) {
      expect(hasUnsyncedLocalChanges({ hasLocalChanges: true, phase, waiting: false })).toBe(false);
    }
    expect(hasUnsyncedLocalChanges({ hasLocalChanges: true, phase: "error", waiting: true })).toBe(false);
  });

  it("本机没有改动就不出现", () => {
    expect(hasUnsyncedLocalChanges({ hasLocalChanges: false, phase: "error", waiting: false })).toBe(false);
  });
});

describe("后端被别人整份改掉时从本机备份恢复", () => {
  /** 站长在这台设备上改一项并同步成功，返回后端现在那份。 */
  async function syncOnce(settings: Record<string, unknown>) {
    acceptWrites();
    stop ??= startSiteThemeAutoSync();
    saveLocalThemeSettings(settings);
    await flushDebounce();
    return siteSettings()!;
  }

  const later = () => Date.now() + SITE_BACKUP_SETTLE_MS + 1;

  it("同步时带上时间戳，本机留一份备份；后端还是这份就不算被改过", async () => {
    const saved = await syncOnce({ surfaceOpacity: 60 });

    expect(mocks.saveThemeOptions.mock.calls[0][0][SITE_SYNC_MARKER_KEY]).toBe(Date.now());
    const check = checkSiteThemeBackup(saved, undefined, later());
    expect(check.overwritten).toBe(false);
    expect(check.backupAt).toBe(saved[SITE_SYNC_MARKER_KEY]);
  });

  it("别的主题按自己的白名单整份替换（没有时间戳）：算被改过，但刚同步完 3 分钟内不算", async () => {
    await syncOnce({ surfaceOpacity: 60, homeRegionOrder: ["JP", "HK"] });
    // SAO 那样：认识的键写回去、不认识的（地区顺序、时间戳）丢掉，再加上自己的键。
    const foreign = { surfaceOpacity: 60, backgroundImage: "https://example.com/bg.png" };

    expect(checkSiteThemeBackup(foreign, undefined, Date.now()).overwritten).toBe(false);
    expect(checkSiteThemeBackup(foreign, undefined, later()).overwritten).toBe(true);
  });

  it("后台写回更早的副本（时间戳更旧）也算被改过", async () => {
    const first = await syncOnce({ surfaceOpacity: 60 });
    await vi.advanceTimersByTimeAsync(60_000);
    await syncOnce({ surfaceOpacity: 40 });

    expect(checkSiteThemeBackup(first, undefined, later()).overwritten).toBe(true);
  });

  it("只多了别的主题的键、本主题的设置没变：不算", async () => {
    const saved = await syncOnce({ surfaceOpacity: 60 });
    const { [SITE_SYNC_MARKER_KEY]: _marker, ...withoutMarker } = saved;
    void _marker;

    expect(
      checkSiteThemeBackup({ ...withoutMarker, mikus: { enabled: false } }, undefined, later())
        .overwritten,
    ).toBe(false);
  });

  it("别的设备上的本主题同步过（时间戳更新）：不算，备份换成那一份", async () => {
    const saved = await syncOnce({ surfaceOpacity: 60 });
    const otherDevice = { ...saved, surfaceOpacity: 30, [SITE_SYNC_MARKER_KEY]: later() };

    expect(checkSiteThemeBackup(otherDevice, undefined, later()).overwritten).toBe(false);
    // 之后再被别的主题改掉，恢复的是别的设备那份新的，不是这台设备更早的。
    expect(checkSiteThemeBackup({ surfaceOpacity: 100 }, undefined, later() + SITE_BACKUP_SETTLE_MS + 1))
      .toMatchObject({ overwritten: true, backupAt: otherDevice[SITE_SYNC_MARKER_KEY] });
  });

  it("忽略之后同一份不再问，后端再变就又问", async () => {
    await syncOnce({ surfaceOpacity: 60 });
    const foreign = { surfaceOpacity: 100 };
    const check = checkSiteThemeBackup(foreign, undefined, later());
    expect(check.overwritten).toBe(true);

    dismissSiteThemeBackup(check.fingerprint);
    expect(checkSiteThemeBackup(foreign, undefined, later()).overwritten).toBe(false);
    expect(checkSiteThemeBackup({ surfaceOpacity: 90 }, undefined, later()).overwritten).toBe(true);
  });

  it("恢复：备份整份写回后端、带新的时间戳，之后不再算被改过", async () => {
    const saved = await syncOnce({ surfaceOpacity: 60, homeRegionOrder: ["JP", "HK"] });
    seedConfig({ surfaceOpacity: 100 });
    await vi.advanceTimersByTimeAsync(SITE_BACKUP_SETTLE_MS + 1);

    await expect(restoreSiteThemeBackup()).resolves.toBe(true);

    const restored = siteSettings()!;
    expect(restored).toMatchObject({ surfaceOpacity: 60, homeRegionOrder: ["JP", "HK"] });
    expect(restored[SITE_SYNC_MARKER_KEY]).toBeGreaterThan(saved[SITE_SYNC_MARKER_KEY] as number);
    expect(checkSiteThemeBackup(restored, undefined, later()).overwritten).toBe(false);
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });

  it("恢复失败：状态退回原样，错误交给提示自己说", async () => {
    await syncOnce({ surfaceOpacity: 60 });
    mocks.saveThemeOptions.mockRejectedValueOnce(
      new ApiRequestError("unauthorized", 401, "/api/theme_options"),
    );

    await expect(restoreSiteThemeBackup()).rejects.toBeInstanceOf(ApiRequestError);
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });
});


describe("observed configuration conflicts", () => {
  it("pauses overlapping edits until the admin explicitly chooses to keep local edits", async () => {
    seedConfig({ costRateApiUrl: "https://old.example/rates" });
    acceptWrites();
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ costRateApiUrl: "https://local.example/rates" });
    // 改完之后缓存被刷新过（比如别的标签页登录触发重查），拿到了别的设备改过的那份。
    seedConfig({ costRateApiUrl: "https://remote.example/rates" });
    await flushDebounce();
    expect(getSiteThemeSyncStatus().phase).toBe("conflict");
    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    saveLocalThemeSettings({ costRateApiUrl: "https://local-2.example/rates" });
    await flushDebounce();
    expect(getSiteThemeSyncStatus().phase).toBe("conflict");
    retrySiteThemeSync();
    await flushDebounce();
    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
    resolveSiteThemeConflict(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.saveThemeOptions).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeOptions.mock.calls[0][0].costRateApiUrl).toBe("https://local-2.example/rates");
    expect(getSiteThemeSyncStatus().phase).toBe("synced");
  });
  it("can discard local conflicts without writing to the backend", async () => {
    seedConfig({ costRateApiUrl: "https://old.example/rates" });
    stop = startSiteThemeAutoSync();
    saveLocalThemeSettings({ costRateApiUrl: "https://local.example/rates" });
    seedConfig({ costRateApiUrl: "https://remote.example/rates" });
    await flushDebounce();
    expect(getSiteThemeSyncStatus().phase).toBe("conflict");
    resolveSiteThemeConflict(false);
    expect(getLocalThemeSettings()).toEqual({});
    expect(getSiteThemeSyncStatus().phase).toBe("idle");
    expect(mocks.saveThemeOptions).not.toHaveBeenCalled();
  });
});
