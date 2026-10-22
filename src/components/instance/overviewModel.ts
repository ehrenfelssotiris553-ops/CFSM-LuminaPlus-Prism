import type { PingOverviewBucket } from "@/types/cfsm";
import type { HealthIssue } from "@/utils/nodeHealth";

/**
 * 详情页上半部分（体检结论、此刻、线路、账单和流量）用到的纯计算，不碰 React，方便单测。
 * 数据全部来自首页已经有的实时数据和节点信息，不多发请求。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 详情页各块的锚点：体检结论里的「看 ↓」跳到这里。 */
export const OVERVIEW_SECTION = {
  vitals: "instance-vitals",
  lines: "instance-lines",
  billing: "instance-billing",
} as const;

export type OverviewSection = (typeof OVERVIEW_SECTION)[keyof typeof OVERVIEW_SECTION];

/** 体检结论里每条问题对应下面哪一块；离线没有可跳的地方。 */
export function healthIssueSection(key: HealthIssue["key"]): OverviewSection | null {
  switch (key) {
    case "health.cpu":
    case "health.mem":
    case "health.disk":
      return OVERVIEW_SECTION.vitals;
    case "health.loss":
    case "health.lossSingle":
      return OVERVIEW_SECTION.lines;
    case "health.expired":
    case "health.expireSoon":
    case "health.traffic":
      return OVERVIEW_SECTION.billing;
    default:
      return null;
  }
}

export interface TrafficCycle {
  start: number;
  end: number;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** 某年某月的重置那天零点（本地时间）；31 号这种在小月取月底。 */
function resetAt(year: number, month: number, day: number) {
  const normalized = new Date(year, month, 1);
  const y = normalized.getFullYear();
  const m = normalized.getMonth();
  return new Date(y, m, Math.min(day, daysInMonth(y, m))).getTime();
}

/** 按每月流量重置日推出现在所在的计费周期；重置日没填（0）按每月 1 日。 */
export function resolveTrafficCycle(resetDay: number, now: number): TrafficCycle {
  const day = Number.isInteger(resetDay) && resetDay >= 1 && resetDay <= 31 ? resetDay : 1;
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const thisMonth = resetAt(year, month, day);
  return thisMonth <= now
    ? { start: thisMonth, end: resetAt(year, month + 1, day) }
    : { start: resetAt(year, month - 1, day), end: thisMonth };
}

/**
 * 按本周期到现在的用量线性推算到下次重置时大约用多少。
 * 周期刚开始不到一天时不推算（头几个小时的速度乘上一整个月，数字会离谱）。
 */
export function projectCycleUsage(used: number, cycle: TrafficCycle, now: number): number | null {
  const elapsed = now - cycle.start;
  const total = cycle.end - cycle.start;
  if (!Number.isFinite(used) || used <= 0 || total <= 0 || elapsed < DAY_MS) return null;
  return used * (total / Math.min(elapsed, total));
}

/** 一条线路这段时间的平均和最高延迟（只算有回包的格子）。 */
export function summarizeBuckets(buckets: readonly PingOverviewBucket[]): { avg: number; max: number } | null {
  let sum = 0;
  let count = 0;
  let max = 0;
  for (const bucket of buckets) {
    const value = bucket.value;
    if (bucket.offline || value == null || !Number.isFinite(value) || value < 0) continue;
    sum += value;
    count += 1;
    max = Math.max(max, value);
  }
  return count > 0 ? { avg: sum / count, max } : null;
}

/**
 * 几条线路共用的柱子顶：取这段时间里最高的延迟，夹在 100～1000ms 之间。
 * 都在几十毫秒时柱子照样看得出起伏；有一条冲到上千毫秒时，其余几条自然就矮，一眼看出谁出了问题。
 */
export function latencyBarCeiling(rows: readonly { buckets: readonly PingOverviewBucket[] }[]): number {
  let max = 0;
  for (const row of rows) {
    for (const bucket of row.buckets) {
      if (!bucket.offline && bucket.value != null && Number.isFinite(bucket.value)) max = Math.max(max, bucket.value);
    }
  }
  return Math.min(1000, Math.max(100, max));
}

/** 延迟柱的高度（0～1）：开方压缩，相对柱子顶（见 latencyBarCeiling）；有回包至少留一截。 */
export function latencyBarLevel(value: number | null, ceiling = 1000): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return Math.max(0.12, Math.sqrt(Math.min(value, ceiling) / ceiling));
}

/** 丢包柱的高度（0～1）：没丢只留一道底线（CSS 画），丢得越多越长，10% 封顶；整格掉线算满格。 */
export function lossBarLevel(bucket: PingOverviewBucket): number {
  if (bucket.offline) return 1;
  return bucket.loss != null && bucket.loss > 0 ? Math.min(bucket.loss, 10) / 10 : 0;
}

/** 丢包格子的档位，和首页丢包图同一套：没数据 / 没丢 / 丢了一点（2% 以下）/ 丢得多。 */
export function lossTone(bucket: PingOverviewBucket): "none" | "ok" | "warn" | "bad" {
  if (bucket.offline) return "bad";
  if (bucket.loss == null) return "none";
  if (bucket.loss <= 0) return "ok";
  return bucket.loss >= 2 ? "bad" : "warn";
}
