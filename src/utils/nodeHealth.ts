import type { MessageKey } from "@/i18n";

/**
 * 健康分卡的打分：只用首页已有的数据（CPU / 内存 / 硬盘、丢包、到期、流量），不多发请求。
 * 满分 100，每样超过阈值按超出的多少扣分；分数只是给眼睛一个总印象，具体原因看 issues。
 */
export type HealthTone = "good" | "warn" | "bad";

export interface HealthIssue {
  key: MessageKey;
  params?: Record<string, string | number>;
  tone: Exclude<HealthTone, "good">;
}

export interface NodeHealthInput {
  online: boolean;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  /** 每条延迟线路的丢包（%）；name 为空表示单线路。 */
  losses: readonly { name: string; loss: number | null }[];
  /** 离到期还有几天；不知道（没填到期 / 打码了价格）就是 null。 */
  expireDays: number | null;
  /** 流量配额用掉的比例；不限量是 null。 */
  trafficFraction: number | null;
}

export interface NodeHealth {
  /** 离线时是 null。 */
  score: number | null;
  tone: HealthTone;
  issues: HealthIssue[];
}

function over(value: number, threshold: number, weight: number, cap: number) {
  return value > threshold ? Math.min(cap, (value - threshold) * weight) : 0;
}

export function computeNodeHealth(input: NodeHealthInput): NodeHealth {
  if (!input.online) {
    return { score: null, tone: "bad", issues: [{ key: "health.offline", tone: "bad" }] };
  }
  const issues: HealthIssue[] = [];
  let score = 100;

  score -= over(input.cpuPct, 70, 0.9, 27);
  if (input.cpuPct >= 75) {
    issues.push({ key: "health.cpu", params: { n: Math.round(input.cpuPct) }, tone: input.cpuPct >= 90 ? "bad" : "warn" });
  }
  score -= over(input.ramPct, 80, 1.2, 24);
  if (input.ramPct >= 80) {
    issues.push({ key: "health.mem", params: { n: Math.round(input.ramPct) }, tone: input.ramPct >= 90 ? "bad" : "warn" });
  }
  score -= over(input.diskPct, 85, 1.6, 24);
  if (input.diskPct >= 85) {
    issues.push({ key: "health.disk", params: { n: Math.round(input.diskPct) }, tone: input.diskPct >= 95 ? "bad" : "warn" });
  }

  let worstLoss = 0;
  for (const { name, loss } of input.losses) {
    if (loss == null || !Number.isFinite(loss)) continue;
    worstLoss = Math.max(worstLoss, loss);
    if (loss >= 2) {
      const n = Number(loss.toFixed(1));
      issues.push(
        name
          ? { key: "health.loss", params: { line: name, n }, tone: loss >= 5 ? "bad" : "warn" }
          : { key: "health.lossSingle", params: { n }, tone: loss >= 5 ? "bad" : "warn" },
      );
    }
  }
  score -= over(worstLoss, 1, 3, 30);

  if (input.expireDays != null) {
    if (input.expireDays < 0) {
      score -= 25;
      issues.push({ key: "health.expired", tone: "bad" });
    } else if (input.expireDays <= 7) {
      score -= 10;
      issues.push({ key: "health.expireSoon", params: { n: input.expireDays }, tone: "warn" });
    }
  }

  if (input.trafficFraction != null && input.trafficFraction >= 0.9) {
    score -= Math.min(10, (input.trafficFraction - 0.9) * 100);
    issues.push({
      key: "health.traffic",
      params: { n: Math.round(input.trafficFraction * 100) },
      tone: input.trafficFraction >= 1 ? "bad" : "warn",
    });
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  // 严重的排前面，卡片上只放得下两条。
  issues.sort((left, right) => (left.tone === right.tone ? 0 : left.tone === "bad" ? -1 : 1));
  return {
    score: finalScore,
    tone: finalScore >= 85 ? "good" : finalScore >= 65 ? "warn" : "bad",
    issues,
  };
}
