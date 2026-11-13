import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClockStore } from "@/hooks/useClock";

const MINUTE_MS = 60_000;

describe("createClockStore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask"] });
    vi.setSystemTime(new Date("2026-11-13T10:00:30Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("页面在后台停了很久、计时器一次没跑，回来后读到的是现在，不是进后台那一分钟", () => {
    const store = createClockStore(MINUTE_MS);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();

    // 后台：墙钟走了 30 分钟，定时器被冻住、一次都没跑（手机切走、电脑睡眠时就是这样）。
    vi.setSystemTime(Date.now() + 30 * MINUTE_MS);

    // 回到前台，新数据一到卡片就重画，重画时读到的时间要跟上。
    expect(store.getSnapshot() - before).toBeGreaterThanOrEqual(30 * MINUTE_MS);
    unsubscribe();
  });

  it("同一分钟里读几次都是同一个值（useSyncExternalStore 要求快照稳定）", () => {
    const store = createClockStore(MINUTE_MS);
    const unsubscribe = store.subscribe(() => undefined);
    const first = store.getSnapshot();
    vi.setSystemTime(Date.now() + 10_000);
    expect(store.getSnapshot()).toBe(first);
    unsubscribe();
  });

  it("读快照时发现跨了分钟，也通知别的订阅者重画", () => {
    const store = createClockStore(MINUTE_MS);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    vi.runAllTicks();
    listener.mockClear();

    vi.setSystemTime(Date.now() + 5 * MINUTE_MS);
    store.getSnapshot();
    vi.runAllTicks();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
