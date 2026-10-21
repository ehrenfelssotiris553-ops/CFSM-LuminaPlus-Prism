import { compareText, t, type MessageKey } from "@/i18n";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronUp, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useHourlyClock } from "@/hooks/useClock";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { useMaskLookup } from "@/hooks/useScreenshotMask";
import {
  calculateCostSummary,
  formatCnyMoney,
  formatSignedCny,
  getExchangeRates,
} from "@/utils/cost";
import { formatBillingCycle } from "@/utils/billing";
import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";
import {
  getRenewalReminders,
} from "@/utils/renewalReminder";

type AssetDetail = ReturnType<typeof calculateCostSummary>["details"][number];
type AssetsSortField =
  | "weight"
  | "price"
  | "remaining"
  | "premium"
  | "premiumMonthly"
  | "expiry";
type AssetsSortDirection = "asc" | "desc";

const NATURAL_DIRECTION: Record<AssetsSortField, AssetsSortDirection> = {
  weight: "asc",
  price: "desc",
  remaining: "desc",
  premium: "desc",
  premiumMonthly: "desc",
  expiry: "asc",
};

const TABLE_COLUMNS: Array<{ field: AssetsSortField; labelKey: MessageKey; numeric?: boolean }> = [
  { field: "weight", labelKey: "assets.colNode" },
  { field: "price", labelKey: "assets.colPrice", numeric: true },
  { field: "remaining", labelKey: "assets.colRemaining", numeric: true },
  { field: "premium", labelKey: "assets.colPremium", numeric: true },
  { field: "premiumMonthly", labelKey: "assets.colPremiumMonthly", numeric: true },
  { field: "expiry", labelKey: "assets.colExpiry", numeric: true },
];

const MOBILE_SORT_OPTIONS: Array<{ field: AssetsSortField; labelKey: MessageKey }> = [
  { field: "weight", labelKey: "assets.sortWeight" },
  { field: "price", labelKey: "assets.colPrice" },
  { field: "premium", labelKey: "assets.colPremium" },
  { field: "expiry", labelKey: "assets.colExpiry" },
];

const ASSETS_MOBILE_QUERY = "(max-width: 720px)";
/** 汇率接口失败时的占位，保持引用稳定。 */
const EMPTY_RATES: Record<string, number> = {};

function sortValue(detail: AssetDetail, field: AssetsSortField): number {
  switch (field) {
    case "price":
      return detail.priceCny;
    case "remaining":
      return detail.remainingCny;
    case "premium":
      return detail.premiumCny;
    case "premiumMonthly":
      return detail.premiumMonthlyCny;
    case "expiry": {
      const days = getExpireDaysRemaining(detail.expiredAt);
      return days == null ? Number.POSITIVE_INFINITY : days;
    }
    default:
      return detail.weight;
  }
}

function formatCostExpiry(expiredAt: string) {
  const days = getExpireDaysRemaining(expiredAt);
  if (days == null) return t("assets.expiryUnknown");
  if (days > LONG_TERM_EXPIRE_DAYS) return t("expire.longTerm");
  if (days < 0) return t("expire.expired");
  if (days === 0) return t("renewal.expiresToday");
  return t("renewal.expiresIn", { n: days });
}

function premiumTone(value: number) {
  if (value > 0) return "var(--status-error)";
  if (value < 0) return "var(--status-success)";
  return "var(--text-tertiary)";
}

function assetsRenewalTone(daysRemaining: number): "critical" | "warning" {
  return daysRemaining <= 3 ? "critical" : "warning";
}

function assetsRenewalLabel(daysRemaining: number) {
  return daysRemaining < 0 ? t("renewal.statusExpired") : t("renewal.statusExpiring");
}

// "¥ 1,234.56" → 货币符号 / 整数位 / 小数位三段,按报表数字惯例分级排印。
function HeroMoney({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="assets-hero-value is-pending">{t("assets.calculating")}</span>;
  }
  const [int, frac = "00"] = formatCnyMoney(value).replace("¥", "").trim().split(".");
  return (
    <span className="assets-hero-value">
      <span className="assets-hero-currency">¥</span>
      {int}
      <span className="assets-hero-frac">.{frac}</span>
    </span>
  );
}

export function Assets() {
  const [sortField, setSortField] = useState<AssetsSortField>("weight");
  const [sortDirection, setSortDirection] = useState<AssetsSortDirection>("asc");
  const isMobileLayout = useMediaQuery(ASSETS_MOBILE_QUERY);
  const now = useHourlyClock();
  const themeSettings = useThemeSettings();
  const mask = useMaskLookup();
  const forceRateRefresh = useRef(false);
  const nodes = useVisibleNodes();
  // 资产详情页是风险核对入口：这里始终按真实到期数据展示，不读取首页的关闭/稍后偏好。
  const renewalReminders = useMemo(() => getRenewalReminders(nodes, now), [nodes, now]);
  const renewalByUuid = useMemo(
    () => new Map(renewalReminders.map((item) => [item.uuid, item])),
    [renewalReminders],
  );
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => {
      const ignoreCache = forceRateRefresh.current;
      forceRateRefresh.current = false;
      return getExchangeRates(themeSettings.costRateApiUrl, { signal, ignoreCache });
    },
    staleTime: 60 * 60 * 1000,
    enabled: themeSettings.isReady && nodes.length > 0,
    retry: 1,
  });
  // 汇率接口失败也要出统计：人民币定价的节点不需要换算，外币节点单独标「汇率缺失」。
  // 请求失败、被拦截、或 React Query 判定离线挂起（fetchStatus: "paused"）时查询会一直
  // 停在 pending，所以判断条件是「没在请求且没有数据」，而不是 isError。
  const ratesFetching = rateQuery.fetchStatus === "fetching" && !rateQuery.data;
  const rates = rateQuery.data?.rates ?? (ratesFetching ? null : EMPTY_RATES);
  const summary = useMemo(
    () =>
      rates
        ? calculateCostSummary(
            nodes,
            themeSettings.costIgnoredNodes,
            rates,
            themeSettings.costPremiums,
            now,
          )
        : null,
    [nodes, now, themeSettings.costIgnoredNodes, themeSettings.costPremiums, rates],
  );
  const detailRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    // 排序键先算好,避免比较器里 O(n log n) 次重复解析到期日。
    const rows = (summary?.details ?? []).map((detail) => ({
      detail,
      key: sortValue(detail, sortField),
    }));
    rows.sort((a, b) => {
      if (a.detail.counted !== b.detail.counted) return a.detail.counted ? -1 : 1;
      return (
        (a.key - b.key) * direction || compareText(a.detail.name, b.detail.name)
      );
    });
    // 截图打码在排好序之后再换名称，按名称排序时顺序不受影响。
    return rows.map(({ detail }) => mask.node(detail));
  }, [sortDirection, sortField, summary, mask]);
  const exchangeRateRows = useMemo(() => {
    if (!rateQuery.data?.rates.CNY) return [];
    const rates = rateQuery.data.rates;
    return ["USD", "HKD", "EUR", "GBP", "JPY"]
      .map((code) => (rates[code] ? { code, value: rates.CNY / rates[code] } : null))
      .filter((item): item is { code: string; value: number } => Boolean(item));
  }, [rateQuery.data]);

  const handleSort = (field: AssetsSortField) => {
    if (field === sortField) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(NATURAL_DIRECTION[field]);
    }
  };

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  // 入口关掉 = 站长不想暴露资产信息，直连 URL 一并回首页。
  if (!themeSettings.showCostSummary) {
    return <Navigate to="/" replace />;
  }

  const hasPremium = summary?.details.some((detail) => detail.premiumCny !== 0) ?? false;
  const ledgerRows: Array<{
    label: string;
    value: string;
    tone?: string;
    title?: string;
  }> = [
    { label: t("assets.annualTotal"), value: summary ? formatCnyMoney(summary.totalCny) : "--" },
    { label: t("assets.monthlyAvg"), value: summary ? formatCnyMoney(summary.monthlyCny) : "--" },
    ...(summary != null && hasPremium
      ? [
          {
            label: t("assets.premiumPnl"),
            value: formatSignedCny(summary.premiumTotalCny),
            tone: premiumTone(summary.premiumTotalCny),
            title: t("assets.premiumPnlTitle"),
          },
        ]
      : []),
    ...(summary != null && summary.premiumMonthlyTotalCny !== 0
      ? [
          {
            label: t("assets.effectiveMonthly"),
            value: formatCnyMoney(summary.effectiveMonthlyCny),
            title: t("assets.effectiveMonthlyTitle"),
          },
        ]
      : []),
    ...(summary != null && hasPremium
      ? [
          {
            label: t("assets.actualRemaining"),
            value: formatCnyMoney(summary.actualRemainingCny),
            title: t("assets.actualRemainingTitle"),
          },
        ]
      : []),
  ];

  const directionIcon =
    sortDirection === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;

  return (
    <div className="assets-page flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          {t("common.back")}
        </Link>
        <button
          type="button"
          className={`cost-summary-action${rateQuery.isFetching ? " is-spinning" : ""}`}
          onClick={() => {
            forceRateRefresh.current = true;
            void rateQuery.refetch();
          }}
          disabled={rateQuery.isFetching}
          aria-busy={rateQuery.isFetching}
          aria-label={t("assets.refreshLabel")}
          title={t("common.refresh")}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">{t("assets.noNodes")}</span>
          <span className="text-[12px]">{t("home.noNodesHint")}</span>
        </div>
      ) : (
        <>
          <section className="assets-hero" aria-label={t("assets.summaryLabel")}>
            <span className="assets-hero-mark" aria-hidden>
              ¥
            </span>
            <div className="assets-hero-main">
              <span className="assets-eyebrow" title={t("assets.remainingTitle")}>
                {t("assets.remaining")}
              </span>
              <HeroMoney value={summary ? summary.remainingCny : null} />
            </div>
            <dl className="assets-ledger">
              {ledgerRows.map((row) => (
                <div className="assets-ledger-row" key={row.label} title={row.title}>
                  <dt>{row.label}</dt>
                  <dd style={row.tone ? { color: row.tone } : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="assets-section-head">
            <span className="assets-eyebrow">{t("assets.details")}</span>
            <span className="assets-count">{t("assets.count", { n: detailRows.length })}</span>
            {renewalReminders.length > 0 && (
              <span className="assets-renewal-inline">
                <CalendarClock size={12} strokeWidth={2.1} />
                {t("assets.expiringCount", { n: renewalReminders.length })}
              </span>
            )}
            <div className="assets-mobile-tools">
              <div className="cost-summary-sort-tabs" role="group" aria-label={t("assets.sortField")}>
                {MOBILE_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.field}
                    type="button"
                    className="cost-summary-sort-tab"
                    data-active={sortField === option.field}
                    onClick={() => handleSort(option.field)}
                    aria-pressed={sortField === option.field}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cost-summary-action is-direction"
                onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
                aria-label={sortDirection === "asc" ? t("assets.toDesc") : t("assets.toAsc")}
                title={sortDirection === "asc" ? t("assets.asc") : t("assets.desc")}
              >
                {sortDirection === "asc" ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </div>
          </div>

          {summary ? (
            <>
              {!isMobileLayout ? (
                <div className="assets-table-wrap">
                <table className="assets-table">
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((column) => (
                        <th
                          key={column.field}
                          data-numeric={column.numeric || undefined}
                          aria-sort={
                            sortField === column.field
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(column.field)}
                            data-active={sortField === column.field}
                          >
                            {t(column.labelKey)}
                            {sortField === column.field && directionIcon}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((detail) => {
                      const reminder = renewalByUuid.get(detail.uuid);
                      const renewalTone = reminder
                        ? assetsRenewalTone(reminder.daysRemaining)
                        : undefined;
                      const renewalLabel = reminder
                        ? assetsRenewalLabel(reminder.daysRemaining)
                        : undefined;
                      return (
                        <tr
                          key={detail.uuid}
                          data-counted={detail.counted}
                          data-renewal-tone={renewalTone}
                        >
                        <td>
                          <Link
                            to={`/server/${encodeURIComponent(detail.uuid)}`}
                            className="assets-node-link"
                            title={detail.name}
                          >
                            <Flag region={detail.region} size={12} />
                            <span>{detail.name}</span>
                          </Link>
                        </td>
                        <td data-numeric>
                          {detail.counted ? (
                            `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}`
                          ) : (
                            <span className="assets-note-chip">{detail.note}</span>
                          )}
                        </td>
                        <td data-numeric data-strong>
                          {detail.counted ? formatCnyMoney(detail.remainingCny) : "—"}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 ? (
                            <span style={{ color: premiumTone(detail.premiumCny) }}>
                              {formatSignedCny(detail.premiumCny)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 && detail.amortMonths != null ? (
                            <span
                              title={t("assets.amortTitle", { n: Math.round(detail.amortMonths) })}
                            >
                              {t("assets.perMonth", { value: formatSignedCny(detail.premiumMonthlyCny) })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-numeric>
                          {reminder ? (
                            <span
                              className="assets-expiry-reminder"
                              data-tone={renewalTone}
                              title={renewalLabel}
                            >
                              <span>{formatCostExpiry(detail.expiredAt)}</span>
                              <small>{renewalLabel}</small>
                            </span>
                          ) : (
                            formatCostExpiry(detail.expiredAt)
                          )}
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              ) : (
                <div className="assets-card-list">
                {detailRows.map((detail) => {
                  const reminder = renewalByUuid.get(detail.uuid);
                  const renewalTone = reminder
                    ? assetsRenewalTone(reminder.daysRemaining)
                    : undefined;
                  const renewalLabel = reminder
                    ? assetsRenewalLabel(reminder.daysRemaining)
                    : undefined;
                  const priceLabel =
                    detail.note ||
                    `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}`;
                  return (
                    <div
                      key={detail.uuid}
                      className="cost-summary-detail-item"
                      data-counted={detail.counted}
                      data-renewal-tone={renewalTone}
                      title={detail.name}
                    >
                      <div className="cost-summary-detail-head">
                        <Link
                          to={`/server/${encodeURIComponent(detail.uuid)}`}
                          className="cost-summary-detail-name"
                        >
                          <Flag region={detail.region} size={12} />
                          <span className="cost-summary-detail-title">{detail.name}</span>
                        </Link>
                        <strong title={t("assets.remaining")}>
                          {detail.counted ? formatCnyMoney(detail.remainingCny) : "—"}
                        </strong>
                      </div>
                      <div className="cost-summary-detail-meta">
                        <span className="cost-summary-price-chip">{priceLabel}</span>
                        {detail.premiumCny !== 0 && (
                          <span
                            className="cost-summary-premium-chip"
                            style={
                              { "--cost-premium-color": premiumTone(detail.premiumCny) } as CSSProperties
                            }
                            title={t("assets.premiumTitle")}
                          >
                            {t("assets.premiumValue", { value: formatSignedCny(detail.premiumCny) })}
                          </span>
                        )}
                        {detail.premiumCny !== 0 && detail.amortMonths != null && (
                          <span
                            className="cost-summary-premium-chip"
                            title={t("assets.premiumMonthlyTitle")}
                          >
                            {t("assets.premiumMonthlyValue", {
                              value: formatSignedCny(detail.premiumMonthlyCny),
                              n: Math.round(detail.amortMonths),
                            })}
                          </span>
                        )}
                        <span
                          className="cost-summary-expire-label"
                          data-tone={renewalTone}
                        >
                          {formatCostExpiry(detail.expiredAt)}
                          {renewalLabel && <small>{renewalLabel}</small>}
                        </span>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </>
          ) : (
            <div className="cost-summary-empty">
              {ratesFetching ? t("assets.loading") : t("assets.ratesFailed")}
            </div>
          )}

          <details className="cost-summary-rate-details">
            <summary>
              <span>{t("assets.rates")}</span>
              <strong>
                {exchangeRateRows.length > 0
                  ? exchangeRateRows
                      .slice(0, 3)
                      .map((item) => `${item.code} ${formatCnyMoney(item.value)}`)
                      .join(" · ")
                  : t("assets.noRates")}
              </strong>
            </summary>
            {exchangeRateRows.length > 0 ? (
              <div className="cost-summary-rate-list" aria-label={t("assets.rates")}>
                {exchangeRateRows.map((item) => (
                  <div className="cost-summary-rate-item" key={item.code}>
                    <span>1 {item.code}</span>
                    <strong>{formatCnyMoney(item.value)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cost-summary-empty is-compact">{t("assets.noRatesAvailable")}</div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
