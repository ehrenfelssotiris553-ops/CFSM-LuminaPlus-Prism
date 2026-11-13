import { useCallback, useSyncExternalStore } from "react";

interface ClockStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

export function createClockStore(intervalMs: number): ClockStore {
  const listeners = new Set<() => void>();
  let snapshot = Date.now();
  let bucket = Math.floor(snapshot / intervalMs);
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const refresh = () => {
    const now = Date.now();
    const nextBucket = Math.floor(now / intervalMs);
    if (nextBucket === bucket) return false;
    bucket = nextBucket;
    snapshot = now;
    return true;
  };

  const schedule = () => {
    if (timer != null || listeners.size === 0) return;
    const delay = intervalMs - (Date.now() % intervalMs) + 25;
    timer = globalThis.setTimeout(() => {
      timer = null;
      if (refresh()) {
        for (const listener of listeners) listener();
      }
      schedule();
    }, delay);
  };

  return {
    subscribe(listener) {
      const changed = refresh();
      listeners.add(listener);
      if (changed) {
        queueMicrotask(() => {
          for (const current of listeners) current();
        });
      }
      schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer != null) {
          globalThis.clearTimeout(timer);
          timer = null;
        }
      };
    },
    // 读的时候也看一眼跨没跨分钟：页面在后台（手机切走、电脑睡眠、浏览器冻结标签页）时定时器不跑，
    // 回到前台实时数据马上就到、卡片跟着重画，这时还拿进后台那一刻的时间去比，
    // 每张卡都会显示「节点时间超前」，要等下一次定时器才消失（站长 2026-11-13）。
    // 同一分钟里读几次都是同一个值，useSyncExternalStore 要的快照稳定不受影响。
    getSnapshot() {
      if (listeners.size > 0 && refresh()) {
        queueMicrotask(() => {
          for (const listener of listeners) listener();
        });
      }
      return snapshot;
    },
  };
}

const NOOP_SUBSCRIBE = () => () => undefined;
const MINUTE_CLOCK = createClockStore(60_000);
const HOUR_CLOCK = createClockStore(3_600_000);

function useClock(store: ClockStore, enabled: boolean) {
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribe(listener) : NOOP_SUBSCRIBE()),
    [enabled, store],
  );
  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
}

export function useMinuteClock(enabled = true) {
  return useClock(MINUTE_CLOCK, enabled);
}

export function useHourlyClock(enabled = true) {
  return useClock(HOUR_CLOCK, enabled);
}
