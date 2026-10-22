import { describe, expect, it } from "vitest";
import type { PingOverviewBucket } from "@/types/cfsm";
import {
  OVERVIEW_SECTION,
  healthIssueSection,
  latencyBarCeiling,
  latencyBarLevel,
  lossBarLevel,
  lossTone,
  projectCycleUsage,
  resolveTrafficCycle,
  summarizeBuckets,
} from "../overviewModel";

function bucket(partial: Partial<PingOverviewBucket>): PingOverviewBucket {
  return { index: 0, value: null, loss: null, total: 0, lost: 0, startAt: null, endAt: null, ...partial };
}

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe("resolveTrafficCycle", () => {
  it("重置日之后：本月重置日到下月重置日", () => {
    expect(resolveTrafficCycle(5, at(2026, 10, 22, 14))).toEqual({ start: at(2026, 10, 5), end: at(2026, 11, 5) });
  });

  it("重置日之前：上月重置日到本月重置日；跨年也对", () => {
    expect(resolveTrafficCycle(25, at(2026, 1, 3))).toEqual({ start: at(2025, 12, 25), end: at(2026, 1, 25) });
  });

  it("31 号在小月取月底；没填重置日按每月 1 日", () => {
    expect(resolveTrafficCycle(31, at(2026, 3, 10))).toEqual({ start: at(2026, 2, 28), end: at(2026, 3, 31) });
    expect(resolveTrafficCycle(0, at(2026, 10, 22))).toEqual({ start: at(2026, 10, 1), end: at(2026, 11, 1) });
  });
});

describe("projectCycleUsage", () => {
  const cycle = { start: at(2026, 10, 1), end: at(2026, 10, 31) };

  it("按已过的时间线性推到周期结束", () => {
    // 30 天的周期过了 10 天用了 100：到结束约 300。
    expect(projectCycleUsage(100, cycle, at(2026, 10, 11))).toBeCloseTo(300);
  });

  it("周期刚开始不到一天、没用量时不推算", () => {
    expect(projectCycleUsage(100, cycle, at(2026, 10, 1, 20))).toBeNull();
    expect(projectCycleUsage(0, cycle, at(2026, 10, 20))).toBeNull();
  });
});

describe("summarizeBuckets", () => {
  it("只算有回包的格子，掉线和没数据的跳过", () => {
    const stats = summarizeBuckets([
      bucket({ value: 90 }),
      bucket({ value: 110 }),
      bucket({ value: null }),
      bucket({ value: 900, offline: true }),
    ]);
    expect(stats).toEqual({ avg: 100, max: 110 });
    expect(summarizeBuckets([bucket({})])).toBeNull();
  });
});

describe("柱子", () => {
  it("延迟开方压缩、到柱子顶封顶、有回包至少留一截", () => {
    expect(latencyBarLevel(null)).toBe(0);
    expect(latencyBarLevel(1)).toBe(0.12);
    expect(latencyBarLevel(250)).toBeCloseTo(0.5);
    expect(latencyBarLevel(5000)).toBe(1);
    expect(latencyBarLevel(25, 100)).toBeCloseTo(0.5);
  });

  it("柱子顶取最高延迟，夹在 100～1000ms，掉线的格子不算", () => {
    const rows = (values: (number | null)[]) => [{ buckets: values.map((value) => bucket({ value })) }];
    expect(latencyBarCeiling(rows([40, 60]))).toBe(100);
    expect(latencyBarCeiling(rows([40, 380]))).toBe(380);
    expect(latencyBarCeiling(rows([40, 5000]))).toBe(1000);
    expect(latencyBarCeiling([{ buckets: [bucket({ value: 900, offline: true }), bucket({ value: 50 })] }])).toBe(100);
  });

  it("丢包档位和高度和首页丢包图一样", () => {
    expect(lossTone(bucket({}))).toBe("none");
    expect(lossTone(bucket({ loss: 0 }))).toBe("ok");
    expect(lossTone(bucket({ loss: 1 }))).toBe("warn");
    expect(lossTone(bucket({ loss: 2 }))).toBe("bad");
    expect(lossTone(bucket({ offline: true }))).toBe("bad");
    expect(lossBarLevel(bucket({ loss: 5 }))).toBe(0.5);
    expect(lossBarLevel(bucket({ loss: 30 }))).toBe(1);
  });
});

describe("healthIssueSection", () => {
  it("资源跳到此刻、丢包跳到线路、到期和流量跳到账单，离线不跳", () => {
    expect(healthIssueSection("health.disk")).toBe(OVERVIEW_SECTION.vitals);
    expect(healthIssueSection("health.loss")).toBe(OVERVIEW_SECTION.lines);
    expect(healthIssueSection("health.expireSoon")).toBe(OVERVIEW_SECTION.billing);
    expect(healthIssueSection("health.traffic")).toBe(OVERVIEW_SECTION.billing);
    expect(healthIssueSection("health.offline")).toBeNull();
  });
});
