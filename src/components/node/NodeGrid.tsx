import { t } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useAllNodeMeta,
  useHomeNodeSummaries,
  useNodeOnlineSummaries,
  useNodeStoreStatus,
} from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingOverview";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
} from "@/utils/format";
import { calculateCostSummary, formatCnyMoney, getExchangeRates } from "@/utils/cost";
import { useHiddenNodeUuids } from "@/hooks/useVisibleNodes";
import { speedRateColor } from "@/utils/metricTone";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  getHomeRegionOptions,
  HOME_ALL_GROUP,
  HOME_ALL_REGION,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import { getDisplayRegionCode } from "@/utils/geo";
import { useHomeSort } from "@/hooks/useHomeSort";
import { useHomeNodeOrder } from "@/hooks/useHomeNodeOrder";
import { useHourlyClock } from "@/hooks/useClock";
import { usePacedRate } from "@/hooks/usePacedRate";
import { preloadAssetsPage } from "@/services/assetsPageLoader";
import { retryNodeSync } from "@/services/wsStore";
import {
  getOverviewRating,
  type OverviewRating,
} from "@/utils/overviewRating";
import { CompactNodeCard } from "./CompactNodeCard";
import { MiniNodeCard } from "./MiniNodeCard";
import { NodeCard } from "./NodeCard";
import {
  BentoNodeCard,
  GaugeNodeCard,
  HealthNodeCard,
  HeroNodeCard,
  RingNodeCard,
  RouteNodeCard,
} from "./LayoutCards";
import { NodeListView } from "./NodeListView";
import { HomeFilterBar, STACK_ALL, type GroupMenuItem, type StackFilter } from "./HomeFilterBar";
import {
  countIpStackCategories,
  IP_STACK_CATEGORIES,
  ipStackCategory,
  resolveIpStackCapability,
  type IpStackCategory,
} from "@/utils/ipStack";
import { RenewalReminder } from "./RenewalReminder";
import { OwnerStrip } from "./OwnerStrip";
import { MaskRevealButton } from "./MaskPicker";
import { useMaskAsset } from "@/hooks/useScreenshotMask";
import { maskPrice } from "@/utils/screenshotMask";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { NodeViewMode } from "@/utils/themeSettings";
import type { RenewalReminderSource } from "@/utils/renewalReminder";

// 卡片视图网格密度；列表档由独立组件布局。
const GRID_LAYOUT: Record<NodeViewMode, { className: string; minColumnWidth: number }> = {
  // node-grid：配色风格的「疏密」按它改卡片间距（styles/skins.css）。
  large: { className: "node-grid grid gap-4 xl:gap-5", minColumnWidth: 360 },
  compact: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 340 },
  mini: { className: "node-grid grid gap-3 xl:gap-3.5", minColumnWidth: 260 },
  ring: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 340 },
  hero: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 340 },
  route: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 360 },
  bento: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 340 },
  health: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 320 },
  gauge: { className: "node-grid grid gap-3 xl:gap-4", minColumnWidth: 340 },
  // 占位以满足 Record 穷尽。
  list: { className: "", minColumnWidth: 0 },
};

type MiniGridStyle = CSSProperties & { "--mini-card-min-width": string };

/** 每种卡片视图用哪个卡片组件（列表档不在这里，它整页是一张表，见 NodeListView）。 */
const CARD_COMPONENTS: Record<Exclude<NodeViewMode, "list">, ComponentType<{ uuid: string }>> = {
  large: NodeCard,
  compact: CompactNodeCard,
  mini: MiniNodeCard,
  ring: RingNodeCard,
  hero: HeroNodeCard,
  route: RouteNodeCard,
  bento: BentoNodeCard,
  health: HealthNodeCard,
  gauge: GaugeNodeCard,
};

// 标准 UUID 不含逗号，可安全拼成稳定签名。
const UUID_KEY_SEPARATOR = ",";
/** 汇率接口失败时的占位，保持引用稳定，让 useMemo 不会每次渲染都重算。 */
const EMPTY_RATES: Record<string, number> = {};
const EMPTY_REGION_ORDER: string[] = [];

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

function formatCompactBytes(value: number): string {
  const [amount, unit = "B"] = formatBytes(value).split(" ");
  return `${amount}${unit[0]}`;
}

// 站点铭牌由 CSS 放进 AppShell 顶部留白，不占概览卡内容流。
function HomeBrand({ siteName }: { siteName: string }) {
  return (
    <header className="home-brand" aria-label={t("home.siteNameLabel")}>
      <h1 className="home-brand-title" title={siteName}>
        {siteName}
      </h1>
    </header>
  );
}

function HomeOverviewCards({
  overview,
  costSummary,
  costLoading,
  costRatesMissing,
  showOverviewRatings,
  showTrafficRating,
  showBandwidthRating,
  showAssetRating,
  trafficRatingLabels,
  bandwidthRatingLabels,
  assetRatingLabels,
  showDetailButton,
  showAssetCard,
  renewalReminderDays,
  renewalNodes,
  dense,
  compact,
  stackCounts,
}: {
  overview: HomeOverview;
  /** 手机：总览压成一行四格，首页一打开就能看到机器（见 HomeOverviewStrip）。 */
  compact: boolean;
  /** 双栈 / 仅 V4 / 仅 V6 节点数；不显示统计时为 null。 */
  stackCounts: Record<IpStackCategory, number> | null;
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  costRatesMissing: boolean;
  dense: boolean;
  showOverviewRatings: boolean;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  showDetailButton: boolean;
  showAssetCard: boolean;
  renewalReminderDays: number;
  renewalNodes: RenewalReminderSource[];
}) {
  const [trafficValue, trafficUnit] = formatBytes(
    overview.trafficUp + overview.trafficDown,
  ).split(" ");
  const rate = formatByteRate(overview.netUp + overview.netDown);
  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const offlinePct =
    overview.totalNodes > 0 ? (overview.offlineNodes / overview.totalNodes) * 100 : 0;
  // 截图打码勾了「总览资产」：金额数字换成 x 再模糊，评级（「小有资产」之类）也不显示，免得猜出大概。
  const maskAsset = useMaskAsset() && costSummary !== null;
  const remainingValue = costSummary
    ? maskAsset
      ? maskPrice(formatCnyMoney(costSummary.remainingCny))
      : formatCnyMoney(costSummary.remainingCny)
    : costLoading
      ? t("home.assetsCalculating")
      : "—";
  const trafficDetailLabel = `↑ ${formatBytes(overview.trafficUp)} · ↓ ${formatBytes(overview.trafficDown)}`;
  const trafficCompactLabel = `↑${formatCompactBytes(overview.trafficUp)} ↓${formatCompactBytes(overview.trafficDown)}`;
  const bandwidthDetailLabel = `↑ ${formatByteRateLabel(overview.netUp)} · ↓ ${formatByteRateLabel(overview.netDown)}`;
  const bandwidthCompactLabel = `↑${formatCompactBytes(overview.netUp)} ↓${formatCompactBytes(overview.netDown)}`;
  const trafficRating =
    showOverviewRatings && showTrafficRating
      ? getOverviewRating({
          kind: "traffic",
          value: overview.trafficUp + overview.trafficDown,
          customLabels: trafficRatingLabels,
        })
      : null;
  const bandwidthRating =
    showOverviewRatings && showBandwidthRating
      ? getOverviewRating({
          kind: "bandwidth",
          value: overview.netUp + overview.netDown,
          customLabels: bandwidthRatingLabels,
        })
      : null;
  const assetRating =
    showOverviewRatings && showAssetRating && costSummary && !maskAsset
      ? getOverviewRating({
          kind: "asset",
          value: costSummary.remainingCny,
          customLabels: assetRatingLabels,
        })
      : null;

  const stackStatsLabel = stackCounts
    ? IP_STACK_CATEGORIES.filter((category) => stackCounts[category] > 0)
        .map((category) => stackCountLabel(category, stackCounts[category]))
        .join(" · ")
    : "";

  if (compact) {
    return (
      <HomeOverviewStrip
        overview={overview}
        rateValue={rate.value}
        rateUnit={rate.unit}
        trafficValue={trafficValue}
        trafficUnit={trafficUnit}
        bandwidthTitle={bandwidthDetailLabel}
        trafficTitle={trafficDetailLabel}
        assetValue={
          costSummary
            ? maskAsset
              ? maskPrice(formatStripMoney(costSummary.remainingCny))
              : formatStripMoney(costSummary.remainingCny)
            : costLoading
              ? "…"
              : "—"
        }
        assetMasked={maskAsset}
        showAssetCard={showAssetCard}
        showDetailButton={showDetailButton}
        renewalReminderDays={renewalReminderDays}
        renewalNodes={renewalNodes}
      />
    );
  }

  const renderRating = (rating: OverviewRating | null) =>
    rating ? (
      <span className="overview-card-rating" data-rating-level={rating.level} title={rating.label}>
        {rating.label}
      </span>
    ) : null;

  return (
    // 资产卡可以单独关掉，列数跟着实际张数走，不然右边空一格。
    <section
      className={`home-overview${dense ? " is-dense" : ""}`}
      data-cards={showAssetCard ? 4 : 3}
      aria-label={t("home.overviewLabel")}
    >
      {/* --online-pct：雾玻璃风格把在线卡画成圆环、座舱画成指示灯条用（styles/page-skins.css）。 */}
      <article className="overview-card" data-metric="online" style={{ "--online-pct": `${onlinePct}%` } as CSSProperties}>
        <span className="overview-card-label">{t("home.onlineNodes")}</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {overview.onlineNodes}
            <span className="overview-card-unit">/ {overview.totalNodes}</span>
          </p>
        </div>
        {overview.totalNodes >= 5 && overview.totalNodes <= 10 ? (
          // 节点数 5–10 时改用块状:每台一格,在线格在左、离线格在右、未知格居中,
          // 与条状的「左绿右红」完全同步。颜色复用同一组 token,避免该红却绿。
          <div className="overview-blocks" role="presentation">
            {Array.from({ length: overview.totalNodes }, (_, i) => {
              const cls =
                i < overview.onlineNodes
                  ? "overview-block is-online"
                  : i >= overview.totalNodes - overview.offlineNodes
                    ? "overview-block is-offline"
                    : "overview-block";
              return <span key={i} className={cls} />;
            })}
          </div>
        ) : (
          <div className="overview-bar" role="presentation">
            <span className="overview-bar-online" style={{ width: `${onlinePct}%` }} />
            <span className="overview-bar-offline" style={{ width: `${offlinePct}%` }} />
          </div>
        )}
        {stackStatsLabel ? (
          <div className="overview-card-footer">
            <p className="overview-card-sub overview-stack-stats" title={stackStatsLabel}>
              {stackStatsLabel}
            </p>
          </div>
        ) : null}
      </article>

      <article className="overview-card" data-metric="bandwidth">
        <span className="overview-card-label">{t("home.liveBandwidth")}</span>
        <div className="overview-card-main">
          <p
            className="overview-card-value"
            style={{ color: speedRateColor(rate.unit) }}
          >
            {rate.value}
            <span className="overview-card-unit">{rate.unit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={bandwidthDetailLabel}>
            <span className="overview-card-sub-full">{bandwidthDetailLabel}</span>
            <span className="overview-card-sub-compact">{bandwidthCompactLabel}</span>
          </p>
          {renderRating(bandwidthRating)}
        </div>
      </article>

      <article className="overview-card" data-metric="traffic">
        <div className="overview-card-head">
          <span className="overview-card-label">{t("home.totalTraffic")}</span>
        </div>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {trafficValue}
            <span className="overview-card-unit">{trafficUnit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={trafficDetailLabel}>
            <span className="overview-card-sub-full">{trafficDetailLabel}</span>
            <span className="overview-card-sub-compact">{trafficCompactLabel}</span>
          </p>
          {renderRating(trafficRating)}
        </div>
      </article>

      {showAssetCard && (
      <article className="overview-card" data-metric="asset">
        <div className="overview-card-head">
          <span className="overview-card-label">{t("home.assets")}</span>
          {/* 提醒天数设成 0 时这个组件没有提醒可显示，会退成资产页入口图标。 */}
          {showDetailButton && (
            <RenewalReminder nodes={renewalNodes} warningDays={renewalReminderDays} />
          )}
        </div>
        <div className="overview-card-main">
          <p className={maskAsset ? "overview-card-value mask-blur" : "overview-card-value"}>{remainingValue}</p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-caption">
            {costRatesMissing ? t("home.ratesFailed") : t("home.ratesLive")}
          </p>
          {renderRating(assetRating)}
        </div>
      </article>
      )}
    </section>
  );
}

/** 一行四格里放得下的金额：上千元不要小数，¥ 后不留空格。 */
function formatStripMoney(value: number): string {
  const amount = Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("zh-CN") : value.toFixed(2);
  return `¥${amount}`;
}

/**
 * 手机上的总览：在线 / 实时 / 累计 / 资产排成一行，不左右滑。比两行四张卡省下一百多像素，
 * 评级、双栈统计这些次要信息手机上不放（电脑上的四张卡照旧）。续费提醒 / 资产入口放在这一行最右边。
 */
function HomeOverviewStrip({
  overview,
  rateValue,
  rateUnit,
  trafficValue,
  trafficUnit,
  bandwidthTitle,
  trafficTitle,
  assetValue,
  assetMasked,
  showAssetCard,
  showDetailButton,
  renewalReminderDays,
  renewalNodes,
}: {
  overview: HomeOverview;
  rateValue: string;
  rateUnit: string;
  trafficValue: string;
  trafficUnit: string;
  bandwidthTitle: string;
  trafficTitle: string;
  assetValue: string;
  assetMasked: boolean;
  showAssetCard: boolean;
  showDetailButton: boolean;
  renewalReminderDays: number;
  renewalNodes: RenewalReminderSource[];
}) {
  // MB/s → M/s：一格只有八十来像素宽。
  const shortRateUnit = rateUnit.length > 3 ? `${rateUnit[0]}/s` : rateUnit;
  return (
    <section
      className="home-overview-strip"
      data-cells={showAssetCard ? 4 : 3}
      aria-label={t("home.overviewLabel")}
    >
      <div className="home-overview-strip-cell">
        <span className="home-overview-strip-label">
          {t("home.strip.online")}
          {overview.offlineNodes > 0 ? (
            <span
              className="home-overview-strip-alert"
              role="img"
              aria-label={t("home.strip.offline", { n: overview.offlineNodes })}
            />
          ) : null}
        </span>
        <span className="home-overview-strip-value">
          {overview.onlineNodes}
          <span className="home-overview-strip-unit">/{overview.totalNodes}</span>
        </span>
      </div>
      <div className="home-overview-strip-cell" title={bandwidthTitle}>
        <span className="home-overview-strip-label">{t("home.strip.bandwidth")}</span>
        <span className="home-overview-strip-value" style={{ color: speedRateColor(rateUnit) }}>
          {rateValue}
          <span className="home-overview-strip-unit">{shortRateUnit}</span>
        </span>
      </div>
      <div className="home-overview-strip-cell" title={trafficTitle}>
        <span className="home-overview-strip-label">{t("home.strip.traffic")}</span>
        <span className="home-overview-strip-value">
          {trafficValue}
          <span className="home-overview-strip-unit">{trafficUnit}</span>
        </span>
      </div>
      {showAssetCard ? (
        <div className="home-overview-strip-cell" title={assetMasked ? undefined : assetValue}>
          <span className="home-overview-strip-label">{t("home.strip.assets")}</span>
          <span className={assetMasked ? "home-overview-strip-value mask-blur" : "home-overview-strip-value"}>{assetValue}</span>
        </div>
      ) : null}
      {showAssetCard && showDetailButton ? (
        <div className="home-overview-strip-extra">
          <RenewalReminder nodes={renewalNodes} warningDays={renewalReminderDays} />
        </div>
      ) : null}
    </section>
  );
}


function stackCountLabel(category: (typeof IP_STACK_CATEGORIES)[number], n: number): string {
  return t(
    category === "dual" ? "home.stack.dualCount" : category === "ipv4" ? "home.stack.ipv4Count" : "home.stack.ipv6Count",
    { n },
  );
}

export function NodeGrid() {
  const now = useHourlyClock();
  // 和 home.css 里手机布局的断点一致。
  const isPhone = useMediaQuery("(max-width: 680px)");
  const nodes = useHomeNodeSummaries();
  const nodeOnlineSummaries = useNodeOnlineSummaries();
  const allMeta = useAllNodeMeta();
  const { hydrated: storeHydrated, nodeInfoError, syncRetryExhausted } = useNodeStoreStatus();
  const { data: me } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const siteName = publicConfig?.sitename?.trim() || t("home.defaultSiteName");
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const sort = useHomeSort();
  // enableHomeSort 控制访客能否改排序;关闭时无视 session 覆盖、直接用管理员默认序(默认仍是 weight)。
  const sortEnabled = themeSettings.isReady && themeSettings.enableHomeSort;
  const sortField = sortEnabled ? sort.field : themeSettings.homeSortField;
  const sortDirection = sortEnabled ? sort.direction : themeSettings.homeSortDirection;
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [selectedRegion, setSelectedRegion] = useState(HOME_ALL_REGION);
  const [selectedStack, setSelectedStack] = useState<StackFilter>(STACK_ALL);
  useHomepagePingOverview(mode);

  // 摘要不含名称，先从完整 meta 解析主题隐藏列表，再统一过滤各类数据。
  const hiddenUuids = useHiddenNodeUuids();
  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [me?.logged_in, nodes, hiddenUuids],
  );
  // 资产统计与卡片使用同一可见性规则，避免泄露隐藏节点信息。
  const visibleMeta = useMemo(
    () =>
      allMeta.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [allMeta, me?.logged_in, hiddenUuids],
  );
  const renewalNodes = useMemo<RenewalReminderSource[]>(() => {
    const onlineByUuid = new Map(
      nodeOnlineSummaries.map((node) => [node.uuid, node.online]),
    );
    return visibleMeta.map((node) => ({
      ...node,
      online: onlineByUuid.get(node.uuid) ?? null,
    }));
  }, [nodeOnlineSummaries, visibleMeta]);
  // 「名称」排序需要展示名(摘要无 name),从 meta 注入。
  const nameByUuid = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visibleMeta) map.set(node.uuid, node.name?.trim() || node.uuid);
    return map;
  }, [visibleMeta]);
  // 每台节点属于双栈 / 仅 V4 / 仅 V6 哪一类：单台设置优先、自动看后端标记（见 resolveIpStackCapability）。
  const ipStackOverrides = themeSettings.homepageIpStackOverrides;
  const stackByUuid = useMemo(() => {
    const map = new Map<string, IpStackCategory>();
    for (const node of visibleMeta) {
      map.set(node.uuid, ipStackCategory(resolveIpStackCapability(node, ipStackOverrides)));
    }
    return map;
  }, [ipStackOverrides, visibleMeta]);
  const overviewStackCounts = useMemo(
    () => countIpStackCategories(visibleMeta, ipStackOverrides),
    [ipStackOverrides, visibleMeta],
  );
  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of visibleNodes) {
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes: visibleNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [visibleNodes]);
  // 顶部「实时带宽」是跨节点求和，各节点相位不同会让它一秒内变好几次。
  // 单独按 1 秒节拍统一换一次；卡片仍按各自节奏刷新。
  const pacedNet = usePacedRate(overview.netUp, overview.netDown);
  const displayOverview = useMemo<HomeOverview>(
    () => ({ ...overview, netUp: pacedNet.up, netDown: pacedNet.down }),
    [overview, pacedNet],
  );
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = visibleMeta.length > 0;
  // 「资产概览」把每月花多少钱亮给所有访客，单独一个开关，不跟着整排总览走。
  const showAssetCard = showHomeOverview && hasNodes && themeSettings.showAssetOverview;
  // 资产页入口只有一个开关：资产卡在就放卡内按钮，不在就用悬浮按钮，两个位置互斥。
  const showCostEntry = themeSettings.isReady && themeSettings.showCostSummary && hasNodes;
  const showCostDetailButton = showCostEntry && showAssetCard;
  const showCostFloatingButton = showCostEntry && !showAssetCard;

  useEffect(() => {
    if (!showCostDetailButton && !showCostFloatingButton) return;

    const idleWindow = window as IdleCapableWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preloadAssetsPage, { timeout: 2_000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    // Safari 等无 requestIdleCallback 的浏览器，在首页稳定后再低优先级预取。
    const handle = window.setTimeout(preloadAssetsPage, 1_000);
    return () => window.clearTimeout(handle);
  }, [showCostDetailButton, showCostFloatingButton]);

  // 资产入口存在时预热汇率，供概览、价格排序和资产页复用。
  const costNeeded = showAssetCard || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(themeSettings.costRateApiUrl, { signal }),
    staleTime: 60 * 60 * 1000,
    // 「价格」排序也要汇率换算月化价,即便没显示资产卡也得拉一次;但空列表无需拉。
    enabled: (costNeeded || sortField === "price") && hasNodes,
    retry: 1,
  });
  // 汇率接口拿不到时不能整卡显示 "—"：人民币定价的节点根本不需要换算，照样统计，
  // 只有外币节点会被标成「汇率缺失」不计入。
  // 注意不能只判断 isError：请求失败、被 CSP 拦下、或 React Query 判定离线把请求
  // 挂起（fetchStatus: "paused"）时查询都停在 pending，永远等不到 error。
  // 只要不是正在请求且没有数据，就按「没有汇率」出结果。
  const ratesFetching = rateQuery.fetchStatus === "fetching" && !rateQuery.data;
  const costRates = rateQuery.data?.rates ?? (ratesFetching ? null : EMPTY_RATES);
  const costSummary = useMemo(
    () =>
      costRates
        ? calculateCostSummary(
            visibleMeta,
            themeSettings.costIgnoredNodes,
            costRates,
            themeSettings.costPremiums,
            now,
          )
        : null,
    [now, visibleMeta, themeSettings.costIgnoredNodes, themeSettings.costPremiums, costRates],
  );
  // 「价格」排序键:月化价格(CNY);免费/忽略/汇率缺失的节点 null,排到默认序之后。
  const priceByUuid = useMemo(() => {
    const map = new Map<string, number | null>();
    if (costSummary) {
      for (const detail of costSummary.details) {
        map.set(detail.uuid, detail.counted ? detail.monthlyCny : null);
      }
    }
    return map;
  }, [costSummary]);
  const costLoading = costNeeded && ratesFetching;
  const costRatesMissing = costNeeded && !rateQuery.data && !ratesFetching;
  const groupOptions = useMemo(
    () =>
      sortHomeGroupOptions(
        getHomeGroupOptions(visibleNodes),
        themeSettings.isReady ? themeSettings.homeGroupOrder : [],
      ),
    [visibleNodes, themeSettings.homeGroupOrder, themeSettings.isReady],
  );
  // 站长设的默认分组只在首屏套一次：后面访客自己点了哪组就是哪组，配置回流不该把人拽回去。
  // 后端没有这个分组（改名 / 删了）时留在「全部」。
  const defaultGroupApplied = useRef(false);
  useEffect(() => {
    if (defaultGroupApplied.current) return;
    if (!themeSettings.isReady || groupOptions.length === 0) return;
    defaultGroupApplied.current = true;
    const preset = themeSettings.homeDefaultGroup;
    if (preset && groupOptions.includes(preset)) setSelectedGroup(preset);
  }, [groupOptions, themeSettings.homeDefaultGroup, themeSettings.isReady]);

  const groupFilteredNodes = useMemo(
    () =>
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup),
    [visibleNodes, selectedGroup],
  );
  // 地区选项在分组筛选之后统计,让国旗计数反映当前分组内的分布。
  const homeRegionOrder = themeSettings.isReady ? themeSettings.homeRegionOrder : EMPTY_REGION_ORDER;
  const regionOptions = useMemo(
    () => getHomeRegionOptions(groupFilteredNodes, homeRegionOrder),
    [groupFilteredNodes, homeRegionOrder],
  );
  const regionFilteredNodes = useMemo(
    () =>
      selectedRegion === HOME_ALL_REGION
        ? groupFilteredNodes
        : groupFilteredNodes.filter((node) => getDisplayRegionCode(node.region) === selectedRegion),
    [groupFilteredNodes, selectedRegion],
  );
  // 协议筛选在分组、地区之后：按钮上的数量反映当前分组 / 地区里的分布，和地区栏的计数口径一致。
  const stackCounts = useMemo(() => {
    const counts: Record<IpStackCategory, number> = { dual: 0, ipv4: 0, ipv6: 0, none: 0 };
    for (const node of regionFilteredNodes) counts[stackByUuid.get(node.uuid) ?? "none"] += 1;
    return counts;
  }, [regionFilteredNodes, stackByUuid]);
  const filteredNodes = useMemo(
    () =>
      selectedStack === STACK_ALL
        ? regionFilteredNodes
        : regionFilteredNodes.filter((node) => stackByUuid.get(node.uuid) === selectedStack),
    [regionFilteredNodes, selectedStack, stackByUuid],
  );
  // 分组下拉里的台数和离线红点：按当前的地区、协议筛选算（不管选了哪个分组），和下拉里看到的一致。
  const groupMenu = useMemo<GroupMenuItem[]>(() => {
    const inScope = visibleNodes.filter(
      (node) =>
        (selectedRegion === HOME_ALL_REGION || getDisplayRegionCode(node.region) === selectedRegion) &&
        (selectedStack === STACK_ALL || stackByUuid.get(node.uuid) === selectedStack),
    );
    const item = (group: string): GroupMenuItem => {
      const list = group === HOME_ALL_GROUP ? inScope : inScope.filter((node) => getHomeGroupLabel(node.group) === group);
      return { group, count: list.length, offline: list.filter((node) => node.online === false).length };
    };
    return [item(HOME_ALL_GROUP), ...groupOptions.map(item)];
  }, [groupOptions, selectedRegion, selectedStack, stackByUuid, visibleNodes]);
  const scopeOffline = useMemo(() => filteredNodes.some((node) => node.online === false), [filteredNodes]);
  // 排序在分组筛选之后。离线永远沉底(写死,见 homeSort);实时网速走防抖(键平滑+滞回+5s 重排)。
  const orderedNodes = useHomeNodeOrder({
    offlineFirst: themeSettings.isReady && themeSettings.offlineNodesFirst,
    nodes: filteredNodes,
    field: sortField,
    direction: sortDirection,
    nameByUuid,
    priceByUuid,
  });

  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  // 选中的地区在当前分组里不存在了(切换分组/节点变化)就回到全部。
  useEffect(() => {
    if (
      selectedRegion !== HOME_ALL_REGION &&
      !regionOptions.some((option) => option.code === selectedRegion)
    ) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [regionOptions, selectedRegion]);

  // 地区栏被配置关闭(热更新)时,清掉可能残留的地区筛选,否则会留下一个不可见的过滤条件。
  useEffect(() => {
    if (!themeSettings.showRegionBar && selectedRegion !== HOME_ALL_REGION) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [themeSettings.showRegionBar, selectedRegion]);

  useEffect(() => {
    if (!themeSettings.showGroupTabs && selectedGroup !== HOME_ALL_GROUP) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [themeSettings.showGroupTabs, selectedGroup]);

  // 协议筛选被关掉、或这一类节点在全站都没了，回到全部，别留一个看不见的过滤条件。
  useEffect(() => {
    if (selectedStack === STACK_ALL) return;
    if (!themeSettings.showIpStackFilter || overviewStackCounts[selectedStack] === 0) {
      setSelectedStack(STACK_ALL);
    }
  }, [overviewStackCounts, selectedStack, themeSettings.showIpStackFilter]);

  // 卡片列表只随 UUID 集合/顺序变化；卡片内部各自订阅实时数据。
  const uuidsKey = useMemo(
    () => orderedNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [orderedNodes],
  );
  const orderedUuids = useMemo(
    () => (uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : []),
    [uuidsKey],
  );
  // 列表档由下方 NodeListView 渲染,这里不必构造卡片元素。
  const cards = useMemo(
    () => {
      if (mode === "list") return null;
      const CardComponent = CARD_COMPONENTS[mode];
      return orderedUuids.map((uuid) => (
        <div key={uuid} className="relative min-w-0">
          <CardComponent uuid={uuid} />
          {/* 站长打码时被打码的卡片右上角的小眼睛（临时显示这一台）；平时返回 null。 */}
          <MaskRevealButton uuid={uuid} />
        </div>
      ));
    },
    [orderedUuids, mode],
  );
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  const showHomeSort = sortEnabled && visibleNodes.length > 1;
  // 地区栏:只有一个地区时筛选无意义,>1 才显示。
  const showRegionBar =
    themeSettings.isReady && themeSettings.showRegionBar && regionOptions.length > 1;
  // 全站只有一种协议（比如全是双栈）时筛选没意义，不显示。
  const stackKinds = (["dual", "ipv4", "ipv6", "none"] as const).filter(
    (category) => overviewStackCounts[category] > 0,
  ).length;
  const showStackTabs = themeSettings.isReady && themeSettings.showIpStackFilter && stackKinds > 1;
  // 分组标签栏与卡片网格共用列定义，让标签栏左缘对齐首卡。
  const isMini = mode === "mini";
  const isList = mode === "list";
  const { className: gridClassName, minColumnWidth } = GRID_LAYOUT[mode];
  const gridWrapClassName = isMini ? `${gridClassName} node-grid-mini` : gridClassName;
  const gridStyle = isList
    ? undefined
    : isMini
      ? ({ "--mini-card-min-width": `${minColumnWidth}px` } as MiniGridStyle)
      : { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumnWidth}px), 1fr))` };
  const gridElement = (
    <div className={gridWrapClassName} style={gridStyle}>
      {cards}
    </div>
  );
  if (!themeSettings.isReady || !storeHydrated) {
    if (!nodeInfoError) return null;
    return (
      <div
        className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]"
        aria-live="polite"
      >
        <span className="text-[14px]">{t("home.loadFailed")}</span>
        {syncRetryExhausted ? (
          <>
            <span className="text-[12px]">{t("home.loadRetryStopped")}</span>
            <button
              type="button"
              onClick={retryNodeSync}
              className="control-button mt-2 px-4 py-2 text-[13px] font-medium"
            >
              {t("common.retry")}
            </button>
          </>
        ) : (
          <span className="text-[12px]">{t("home.loadRetrying")}</span>
        )}
      </div>
    );
  }

  // 资产页悬浮入口 + 首页概览卡在「空节点」与正常两个分支里完全一致，提取一次复用。
  const homeHeader = (
    <>
      {showCostFloatingButton && (
        <Link
          to="/assets"
          className="cost-summary-ball show"
          aria-label={t("home.openAssets")}
          title={t("home.assetsTitle")}
        >
          <span className="cost-summary-ball-icon" aria-hidden>
            <CircleDollarSign size={16} />
          </span>
        </Link>
      )}
      <HomeBrand siteName={siteName} />
      {showHomeOverview && (
        <HomeOverviewCards
          overview={displayOverview}
          dense={mode === "mini" || mode === "list"}
          // 设置里关了「手机总览压成一行」就用原版的四张卡片。
          compact={isPhone && themeSettings.phoneOverviewStrip}
          showDetailButton={showCostDetailButton}
          showAssetCard={showAssetCard}
          renewalReminderDays={
            themeSettings.isReady ? themeSettings.renewalReminderDays : 0
          }
          renewalNodes={renewalNodes}
          stackCounts={
            themeSettings.showIpStackStats &&
            overviewStackCounts.dual + overviewStackCounts.ipv4 + overviewStackCounts.ipv6 > 0
              ? overviewStackCounts
              : null
          }
          costSummary={costSummary}
          costLoading={costLoading}
          costRatesMissing={costRatesMissing}
          showOverviewRatings={themeSettings.showOverviewRatings}
          showTrafficRating={themeSettings.showTrafficRating}
          showBandwidthRating={themeSettings.showBandwidthRating}
          showAssetRating={themeSettings.showAssetRating}
          trafficRatingLabels={themeSettings.trafficRatingLabels}
          bandwidthRatingLabels={themeSettings.bandwidthRatingLabels}
          assetRatingLabels={themeSettings.assetRatingLabels}
        />
      )}
      {/* 只有登录站长看得到：访客这里什么都不渲染、也不发请求。 */}
      <OwnerStrip />
    </>
  );

  if (visibleNodes.length === 0) {
    return (
      <>
        {homeHeader}
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">{t("home.noNodes")}</span>
          <span className="text-[12px]">{t("home.noNodesHint")}</span>
        </div>
      </>
    );
  }

  return (
    <>
      {homeHeader}
      <HomeFilterBar
        groups={showGroupTabs ? groupMenu : null}
        selectedGroup={selectedGroup}
        onSelectGroup={setSelectedGroup}
        regions={showRegionBar ? regionOptions : null}
        selectedRegion={selectedRegion}
        onSelectRegion={setSelectedRegion}
        stackCounts={showStackTabs ? stackCounts : null}
        selectedStack={selectedStack}
        onSelectStack={setSelectedStack}
        sort={showHomeSort ? sort : null}
        scopeOffline={scopeOffline}
      />
      {isList ? <NodeListView uuids={orderedUuids} /> : gridElement}
    </>
  );
}
