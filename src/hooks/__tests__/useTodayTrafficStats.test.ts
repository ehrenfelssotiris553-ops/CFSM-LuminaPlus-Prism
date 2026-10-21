import { describe, expect, it } from "vitest";
import {
  getTodayTrafficRecordRangeHours,
  TODAY_TRAFFIC_STALE_MS,
  selectActiveTodayTrafficUuids,
} from "@/hooks/todayTrafficQueryPolicy";
import { throwIfSignalAborted } from "@/hooks/useTodayTrafficStats";

describe("today traffic query policy", () => {
  it("rounds the buffered range up to a supported history step", () => {
    const startMs = Date.parse("2026-08-06T00:00:00+08:00");
    const endMs = Date.parse("2026-08-06T23:58:00+08:00");

    // 24h + 1h 缓冲 → 后端支持的下一档是 48。
    expect(getTodayTrafficRecordRangeHours(startMs, endMs)).toBe(48);
  });

  it("keeps early-morning queries on the smallest supported step", () => {
    const startMs = Date.parse("2026-08-06T00:00:00+08:00");
    const endMs = Date.parse("2026-08-06T02:30:00+08:00");

    expect(getTodayTrafficRecordRangeHours(startMs, endMs)).toBe(6);
  });

  it("only queries nodes whose popovers are currently active", () => {
    const active = new Set(["node-b", "node-c"]);

    expect(
      selectActiveTodayTrafficUuids(
        ["node-a", "node-b", "node-b", "node-c"],
        active,
      ),
    ).toEqual(["node-b", "node-c"]);
    expect(selectActiveTodayTrafficUuids(["node-a"], new Set())).toEqual([]);
  });

  it("treats data as fresh for five minutes instead of polling", () => {
    expect(TODAY_TRAFFIC_STALE_MS).toBe(5 * 60 * 1000);
  });

  it("uses the abort flag directly for older Safari without throwIfAborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfSignalAborted(controller.signal)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});
