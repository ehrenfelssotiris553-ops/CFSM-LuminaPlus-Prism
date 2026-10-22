import { useState } from "react";
import type { CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import { getLocale, memoByLanguage, t, type MessageKey } from "@/i18n";
import { useCfUsage } from "@/hooks/useCfUsage";
import { useMinuteClock } from "@/hooks/useClock";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getAdminUrl } from "@/services/cfsm/config";
import type { CfUsageDay } from "@/types/cfsm";
import {
  cfUsageMeters,
  cfUsageResetTime,
  classifyCfUsageError,
  formatCfUsagePercent,
  type CfUsageMetric,
} from "@/utils/cfUsage";
import { resolveCfUsageStyle } from "@/utils/layouts";

type UsageDay = "today" | "yesterday";

// 12.3 万 / 123.5K：数字动辄几百万，紧凑写法一眼能看出量级。
const compactNumber = memoByLanguage(
  (locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
);
const plainNumber = memoByLanguage((locale) => new Intl.NumberFormat(locale));
const clockTime = memoByLanguage(
  (locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }),
);

const METRIC_LABEL_KEYS: Record<CfUsageMetric, MessageKey> = {
  rowsRead: "cfUsage.rowsRead",
  rowsWritten: "cfUsage.rowsWritten",
  workersRequests: "cfUsage.workersRequests",
  durableObjectsRequests: "cfUsage.durableObjectsRequests",
  durableObjectsDuration: "cfUsage.durableObjectsDuration",
};

/** 站长条收起时摘要用的短名字。 */
export const METRIC_SHORT_KEYS: Record<CfUsageMetric, MessageKey> = {
  rowsRead: "cfUsage.short.rowsRead",
  rowsWritten: "cfUsage.short.rowsWritten",
  workersRequests: "cfUsage.short.workersRequests",
  durableObjectsRequests: "cfUsage.short.durableObjectsRequests",
  durableObjectsDuration: "cfUsage.short.durableObjectsDuration",
};

function updatedLabel(updatedAt: number, now: number): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return t("cfUsage.updatedJustNow");
  if (minutes < 60) return t("cfUsage.updatedMinutesAgo", { n: minutes });
  return t("cfUsage.updatedAt", { time: clockTime().format(updatedAt) });
}

/** DO 请求是后端按计费规则估的，悬停给出怎么算出来的。 */
function durableObjectsBreakdown(day: CfUsageDay): string {
  return t("cfUsage.durableObjectsBreakdown", {
    http: plainNumber().format(day.durableObjectsHttpRequests),
    wakeups: plainNumber().format(day.durableObjectsHibernationWakeups),
    messages: plainNumber().format(day.durableObjectsInboundWebSocketMessages),
    ratio: day.durableObjectsRequestBillingRatio,
  });
}

/** 两项 DO 指标不直观，悬停说明怎么来的。 */
function meterTitle(metric: CfUsageMetric, day: CfUsageDay | undefined): string | undefined {
  if (metric === "durableObjectsDuration") return t("cfUsage.durableObjectsDurationTip");
  if (metric === "durableObjectsRequests" && day) return durableObjectsBreakdown(day);
  return undefined;
}

function UsageError({ error }: { error: unknown }) {
  const { kind, detail } = classifyCfUsageError(error);
  if (kind === "notConfigured" || kind === "loginExpired") {
    return (
      <p className="cf-usage-message" data-tone="warn" role="status">
        {t(kind === "notConfigured" ? "cfUsage.notConfigured" : "cfUsage.loginExpired")}{" "}
        <a href={getAdminUrl()} className="cf-usage-link">
          {t("cfUsage.openAdmin")}
        </a>
      </p>
    );
  }
  return (
    <p className="cf-usage-message" data-tone="error" role="status" title={detail}>
      {kind === "unavailable" ? t("cfUsage.unavailable") : t("cfUsage.failed", { detail })}
    </p>
  );
}

/**
 * 首页 CF 用量的完整内容（只有登录站长看得到）：今天 / 昨天的 D1 读写、Workers 请求、DO 请求和时长，对比免费版每日额度。
 * 放在站长条展开后的区域里，收起 / 展开由 OwnerStrip 管。数据和后台「查询 CF 用量」按钮是同一个请求，查几次看「刷新方式」。
 */
export function CfUsagePanel() {
  const { visible, mode, query } = useCfUsage();
  const { cfUsageStyle, skin } = useThemeSettings();
  const [day, setDay] = useState<UsageDay>("today");
  const hasData = query.data !== undefined;
  const now = useMinuteClock(visible && hasData);
  if (!visible) return null;

  const fetching = query.isFetching;
  const meters = query.data ? cfUsageMeters(query.data[day]) : null;
  const locale = getLocale();

  return (
    // data-shape：横条 / 小圆环 / 字符格 / 电平表（设置「站长用量」，跟随风格时按风格配），画法见 styles/page-skins.css。
    <section className="cf-usage" data-shape={resolveCfUsageStyle(cfUsageStyle, skin)} aria-label={t("cfUsage.title")} aria-busy={fetching}>
      <div className="cf-usage-head">
        <span className="overview-card-label">{t("cfUsage.title")}</span>
        {hasData ? (
          <div className="instance-segmented cf-usage-day" role="group" aria-label={t("cfUsage.dayLabel")}>
            {(["today", "yesterday"] as const).map((option) => (
              <button
                key={option}
                type="button"
                data-active={day === option ? "true" : "false"}
                aria-pressed={day === option}
                onClick={() => setDay(option)}
              >
                {t(option === "today" ? "cfUsage.today" : "cfUsage.yesterday")}
              </button>
            ))}
          </div>
        ) : null}
        <span className="cf-usage-updated">
          {fetching ? t("cfUsage.loading") : hasData ? updatedLabel(query.dataUpdatedAt, now) : ""}
        </span>
        <button
          type="button"
          className="overview-card-action cf-usage-refresh"
          data-spinning={fetching ? "true" : undefined}
          disabled={fetching}
          onClick={() => void query.refetch()}
          title={t("cfUsage.refresh")}
          aria-label={t("cfUsage.refresh")}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>

      {query.isError ? <UsageError error={query.error} /> : null}

      {meters ? (
        <div className="cf-usage-grid">
          {meters.map((meter) => (
            <div
              key={meter.metric}
              className="cf-usage-meter"
              data-level={meter.level}
              // 用了一点点也要画出一小段（见 styles/page-skins.css）。
              data-nonzero={meter.ratio > 0 ? "" : undefined}
              // 几种画法（横条、圆环、竖电平表…）都从 --ratio 取比例。
              style={{ "--ratio": Math.min(1, meter.ratio) } as CSSProperties}
              title={meterTitle(meter.metric, query.data?.[day])}
            >
              <div className="cf-usage-meter-top">
                <span className="cf-usage-meter-label">{t(METRIC_LABEL_KEYS[meter.metric])}</span>
                <span className="cf-usage-meter-pct">{formatCfUsagePercent(meter.ratio)}</span>
              </div>
              <div
                className="cf-usage-bar"
                role="progressbar"
                aria-label={t(METRIC_LABEL_KEYS[meter.metric])}
                aria-valuemin={0}
                aria-valuemax={meter.limit}
                aria-valuenow={Math.min(meter.used, meter.limit)}
                aria-valuetext={`${plainNumber().format(meter.used)} / ${plainNumber().format(meter.limit)}`}
              >
                <span style={{ width: `${Math.min(100, meter.ratio * 100)}%` }} />
              </div>
              <span className="cf-usage-meter-value">
                {compactNumber().format(meter.used)} / {compactNumber().format(meter.limit)}
              </span>
            </div>
          ))}
        </div>
      ) : !query.isError ? (
        <p className="cf-usage-message" role="status">
          {fetching || mode !== "manual" ? t("cfUsage.loading") : t("cfUsage.manualHint")}
        </p>
      ) : null}

      <p className="cf-usage-note">{t("cfUsage.note", { time: cfUsageResetTime(locale) })}</p>
    </section>
  );
}
