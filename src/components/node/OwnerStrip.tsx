import { useId, useState } from "react";
import { t } from "@/i18n";
import { useAgentUpdate } from "@/hooks/useAgentUpdate";
import { useCfUsage } from "@/hooks/useCfUsage";
import { cfUsageMeters, formatCfUsagePercent, topCfUsageMeters } from "@/utils/cfUsage";
import { AgentUpdateNotice } from "./AgentUpdateNotice";
import { CfUsagePanel, METRIC_SHORT_KEYS } from "./CfUsagePanel";

/*
 * 两个图标直接画，不从 lucide-react 引：向下箭头 / 仪表盘原来只有设置页等延迟加载的页面在用，
 * 首页一引用，Rolldown 就把首页和其它页面共用的模块（实时数据、登录态等约 20KB）拆成单独一个文件，首页多一次请求。
 * 线条和 lucide 一致（24 网格、1.8 线宽、圆头）。
 */
function GaugeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="owner-strip-icon">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="owner-strip-chevron">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 展开还是收起记在这台设备上；默认收起，电脑和手机都一样。 */
const EXPANDED_STORAGE_KEY = "cfsm-luminaplus:owner-strip-expanded";

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // 存不了（隐私模式等）就只在这次打开页面内有效。
  }
}

/**
 * 站长条：只有登录站长看得到，把 Agent 更新提醒和 CF 用量收在一起。
 * 收起时一行：今天用得最多的那一项 + 「N 台可更新」；点开是完整的用量和提醒。两样都没有时整条不显示。
 * 收起时用量照常按「刷新方式」查 —— 摘要要用；和展开后的卡片是同一个查询，不会多查一次。
 */
export function OwnerStrip() {
  const usage = useCfUsage();
  const agent = useAgentUpdate();
  const [expanded, setExpanded] = useState(readExpanded);
  const bodyId = useId();
  const agentCount = agent.outdated.length;
  if (!usage.visible && agentCount === 0) return null;

  const { query, mode } = usage;
  const top = query.data ? topCfUsageMeters(cfUsageMeters(query.data.today), 1)[0] : undefined;
  const usageStatus = query.isFetching
    ? t("cfUsage.loading")
    : query.isError
      ? t("cfUsage.failedShort")
      : mode === "manual"
        ? t("cfUsage.notQueried")
        : t("cfUsage.loading");
  const toggle = () =>
    setExpanded((previous) => {
      writeExpanded(!previous);
      return !previous;
    });

  return (
    <section className="owner-strip" data-expanded={expanded ? "true" : "false"} aria-label={t("owner.title")}>
      <button
        type="button"
        className="owner-strip-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={t(expanded ? "owner.collapse" : "owner.expand")}
        onClick={toggle}
      >
        <GaugeIcon />
        <span className="owner-strip-title">{t("owner.title")}</span>
        {/* 展开后下面就是完整内容，摘要不再重复显示。 */}
        <span className="owner-strip-chips">
          {expanded ? null : usage.visible ? (
            top ? (
              <span className="owner-strip-chip" data-level={top.level}>
                <span className="owner-strip-chip-dot" aria-hidden />
                {t(METRIC_SHORT_KEYS[top.metric])} {formatCfUsagePercent(top.ratio)}
              </span>
            ) : (
              <span className="owner-strip-chip" data-level={query.isError ? "danger" : undefined}>
                {query.isError ? <span className="owner-strip-chip-dot" aria-hidden /> : null}
                {t("cfUsage.title")} · {usageStatus}
              </span>
            )
          ) : null}
          {!expanded && agentCount > 0 ? (
            <span className="owner-strip-chip" data-level="warn">
              <span className="owner-strip-chip-dot" aria-hidden />
              {t("owner.agentChip", { n: agentCount })}
            </span>
          ) : null}
        </span>
        <ChevronIcon />
      </button>
      {expanded ? (
        <div id={bodyId} className="owner-strip-body">
          <CfUsagePanel />
          <AgentUpdateNotice />
        </div>
      ) : null}
    </section>
  );
}
