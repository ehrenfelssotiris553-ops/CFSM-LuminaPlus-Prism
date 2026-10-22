import { memoByLanguage, t } from "@/i18n";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { IpStackBadges } from "@/components/node/IpStackBadges";
import { NodeClockWarning } from "@/components/node/NodeClockWarning";
import { useAuth } from "@/hooks/useAuth";
import { useHourlyClock, useMinuteClock } from "@/hooks/useClock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useShowThreeNetDetails, useSiteBillingSwitches } from "@/hooks/useNode";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import {
  HOMEPAGE_PING_BUCKET_COUNT,
  buildPingBuckets,
  useNodeAvailablePingLines,
  useNodeMultiPingTaskIds,
  withLiveLatency,
} from "@/hooks/usePingOverview";
import { useLatencyWindowMs, usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { shortLineName } from "@/services/cfsm/mappers";
import type { CarrierPingSnapshot, PingOverviewBucket } from "@/types/cfsm";
import { agentUpdateTarget } from "@/utils/agentVersion";
import { LONG_TERM_EXPIRE_DAYS, formatBytes, getExpireDaysRemaining, resolveExpireTimestamp } from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { resolveTrafficUsage } from "@/utils/traffic";
import { computeNodeHealth, type HealthTone } from "@/utils/nodeHealth";
import { selectDetailPingTasks } from "@/utils/pingVisibility";
import { isHomepageMultiPingConfigured } from "@/utils/pingTasks";
import { formatVersionLabel, isNewerVersion } from "@/utils/versionCompare";
import { InstanceSwitcher, useSwitchableNodes } from "./InstanceSwitcher";
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
  type OverviewSection,
} from "./overviewModel";
import "@/styles/instance-overview.css";

/*
 * 详情页上半部分（改版第一步）：先告诉你结论，再给证据。
 * 顺序：顶栏（返回、切换、上一台 / 下一台）→ 名字和状态 → 体检结论 → 此刻 → 线路 →（下面原来的两套图表）→ 账单和流量、硬件与系统。
 * 全部用首页已经有的数据（实时推送 + /api/servers 的延迟窗口），不多发请求；打码、离线、「卡片上显示什么」的开关都和首页一样生效。
 * 样式在 styles/instance-overview.css，只跟着详情页加载，首页不多一个字节。
 */

type CardModel = ReturnType<typeof useNodeCardModel>;
type ReadyModel = Extract<CardModel, { traffic: unknown }>;
type Node = ReadyModel["node"];

const timeFormatter = memoByLanguage(
  (locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
);
// 到期日：今年的只写月日（手机上一格放不下年份），跨年的写全。
// 后端的到期日多是「YYYY-MM-DD」，解析出来是 UTC 零点；按 UTC 显示才是字面那一天（西半球按本地时区会早一天）。
const dateFormatters = memoByLanguage((locale) => {
  const make = (withYear: boolean, utc: boolean) =>
    new Intl.DateTimeFormat(locale, {
      ...(withYear ? { year: "numeric" } : {}),
      month: "2-digit",
      day: "2-digit",
      ...(utc ? { timeZone: "UTC" } : {}),
    });
  return { full: make(true, false), short: make(false, false), fullUtc: make(true, true), shortUtc: make(false, true) };
});

function formatExpireDate(timestamp: number, dateOnly: boolean, now: number) {
  const formatters = dateFormatters();
  const year = dateOnly ? new Date(timestamp).getUTCFullYear() : new Date(timestamp).getFullYear();
  const sameYear = year === new Date(now).getFullYear();
  if (dateOnly) return (sameYear ? formatters.shortUtc : formatters.fullUtc).format(timestamp);
  return (sameYear ? formatters.short : formatters.full).format(timestamp);
}
const shortDateFormatter = memoByLanguage((locale) => new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }));

const TONE_COLOR: Record<HealthTone, string> = {
  good: "var(--status-success)",
  warn: "var(--status-warning)",
  bad: "var(--status-error)",
};

/** 百分比读数：75% 起黄、90% 起红，其余用各指标自己的颜色（和首页卡片一样）。 */
function levelFill(pct: number, base: string) {
  return pct >= 90 ? "var(--status-error)" : pct >= 75 ? "var(--status-warning)" : base;
}

function clampPct(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function formatReportTime(timeMs: number) {
  return timeMs > 0 ? timeFormatter().format(timeMs) : "—";
}

/**
 * 价格、到期在这台机器的详情页上能不能显示：后台「显示价格 / 显示到期」开关（后端前台就是按它藏的；
 * 直接打开详情页时拿不到开关，先当作不显示），再加主题「卡片上显示费用到期 / 显示价格」（首页看不到的这里也看不到）；
 * 打码了价格，到期也不能拿来算。
 */
function useBillingVisibility(model: ReadyModel) {
  const settings = useThemeSettings();
  const site = useSiteBillingSwitches();
  const priceMasked = model.maskTokens?.split(" ").includes("price") === true;
  const showBilling = settings.compactShowBilling;
  return {
    priceMasked,
    showPrice: site.price && showBilling && settings.showCardPrice && Boolean(model.renewalPrice),
    showExpire: site.expire && showBilling,
  };
}

function scrollToSection(id: OverviewSection) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function InstanceOverview({ uuid, children }: { uuid: string; children?: ReactNode }) {
  const model = useNodeCardModel(uuid, { pingBucketCount: HOMEPAGE_PING_BUCKET_COUNT });
  const ready = model.node ? (model as ReadyModel) : null;
  const metricsPing = ready?.isOnline ? ready.node.ping : null;
  const offlineSince = ready?.isOffline && ready.node.updatedAt > 0 ? ready.node.updatedAt : null;
  const lines = useDetailLines(uuid, metricsPing, offlineSince);
  const now = useHourlyClock();

  return (
    // 截图打码：和首页卡片一样，名称、标签、价格已经在数据层换成假内容，data-mask 再把它们模糊掉（见 styles/mask.css）。
    <div className="iov" data-mask={ready?.maskTokens}>
      <InstanceNav uuid={uuid} />
      {ready ? (
        <>
          <Hero model={ready} />
          <NodeClockWarning sampleAt={ready.node.updatedAt} />
          <Verdict model={ready} lines={lines.visible} now={now} />
          <Vitals model={ready} />
          {lines.enabled && lines.rows.length > 0 ? <Lines lines={lines} /> : null}
        </>
      ) : null}
      {children}
      {ready ? (
        <div className="iov-pair">
          <Billing model={ready} now={now} />
          <Hardware node={ready.node} model={ready} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- 顶栏 ----------

function InstanceNav({ uuid }: { uuid: string }) {
  const nodes = useSwitchableNodes();
  const index = nodes.findIndex((node) => node.uuid === uuid);
  const prev = index > 0 ? nodes[index - 1] : null;
  const next = index >= 0 && index < nodes.length - 1 ? nodes[index + 1] : null;
  return (
    <nav className="iov-nav">
      <Link to="/" className="instance-page-back">
        <ChevronLeft size={14} />
        {t("common.back")}
      </Link>
      {nodes.length > 1 ? (
        <span className="iov-nav-end">
          <InstanceSwitcher currentUuid={uuid} label={t("instance.nav.switch")} />
          <NavStep target={prev} dir="prev" />
          <NavStep target={next} dir="next" />
        </span>
      ) : null}
    </nav>
  );
}

function NavStep({ target, dir }: { target: { uuid: string; name: string } | null; dir: "prev" | "next" }) {
  const label = t(dir === "prev" ? "instance.nav.prev" : "instance.nav.next");
  const icon = dir === "prev" ? <ChevronLeft size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />;
  if (!target) {
    return (
      <span className="iov-step" data-dir={dir} aria-disabled="true" title={label}>
        {icon}
        <span className="iov-step-text">{label}</span>
      </span>
    );
  }
  return (
    <Link
      to={`/server/${encodeURIComponent(target.uuid)}`}
      className="iov-step"
      data-dir={dir}
      title={`${label} · ${target.name}`}
      aria-label={`${label} · ${target.name}`}
    >
      {icon}
      <span className="iov-step-text">
        {label}
        <span className="iov-step-name"> · {target.name}</span>
      </span>
    </Link>
  );
}

// ---------- 名字、状态、标签 ----------

function Hero({ model }: { model: ReadyModel }) {
  const { node } = model;
  const status = model.isOffline
    ? { tone: "bad", text: t("lc.offlineSince", { time: formatReportTime(node.updatedAt) }) }
    : model.isOnline
      ? { tone: "good", text: t("instance.hero.online", { v: `${model.uptime.value} ${model.uptime.unit}`.trim() }) }
      : { tone: "none", text: t("status.unknown") };
  return (
    <section className="instance-panel iov-hero">
      <Flag region={node.region} size={26} />
      <div className="iov-hero-main">
        <div className="iov-hero-title">
          <h1 className="instance-panel-title iov-name">{node.name}</h1>
          <span className="iov-status" data-tone={status.tone}>
            <i aria-hidden />
            {status.text}
          </span>
          <IpStackBadges {...model.ipStack} />
        </div>
        <div className="iov-hero-meta">
          <span className="iov-os">
            <OsLogo value={node.os} size={14} />
            {model.osName}
          </span>
          {model.subtitle ? <span className="iov-sub">{model.subtitle}</span> : null}
          {model.tags.map((tag, index) => (
            <span key={`${tag.label}-${index}`} className="lc-tag" data-tag={tag.color}>
              {tag.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- 体检结论 ----------

const SECTION_LINK: Record<OverviewSection, "instance.v.toVitals" | "instance.v.toLines" | "instance.v.toBilling"> = {
  [OVERVIEW_SECTION.vitals]: "instance.v.toVitals",
  [OVERVIEW_SECTION.lines]: "instance.v.toLines",
  [OVERVIEW_SECTION.billing]: "instance.v.toBilling",
};

function Verdict({ model, lines, now }: { model: ReadyModel; lines: DetailLine[]; now: number }) {
  const { node } = model;
  // 到期不显示的站点（或打码了价格），体检结论里也不提到期（「6 天后到期」会把藏起来的内容说出来）。
  const billing = useBillingVisibility(model);
  const expireDays = billing.priceMasked || !billing.showExpire ? null : getExpireDaysRemaining(node.expired_at, now);
  // 和首页健康分卡同一套判断（utils/nodeHealth），丢包按详情页显示的这几条线路算。
  // 离线时资源、丢包是停在那一刻的旧数，不拿来判断；到期和流量照样要提醒。
  const health = computeNodeHealth({
    online: true,
    cpuPct: model.isOffline ? 0 : node.cpuPct,
    ramPct: model.isOffline ? 0 : node.ramPct,
    diskPct: model.isOffline ? 0 : node.diskPct,
    losses: model.isOffline ? [] : lines.map((line) => ({ name: line.short, loss: line.loss })),
    expireDays,
    trafficFraction: model.traffic.fraction,
  });
  const issues = health.issues;
  const tone: HealthTone = model.isOffline ? "bad" : issues.length === 0 ? "good" : issues[0].tone;
  const title = model.isOffline ? t("health.offline") : issues.length > 0 ? t("instance.v.attention") : t("health.ok");

  const restParts: string[] = [];
  if (!model.isOffline) {
    if (issues.length > 0) restParts.push(t("instance.v.restOk"));
    if (model.isOnline) restParts.push(t("instance.hero.online", { v: `${model.uptime.value} ${model.uptime.unit}`.trim() }));
  }
  const expireFlagged = issues.some((issue) => issue.key === "health.expired" || issue.key === "health.expireSoon");
  if (expireDays != null && !expireFlagged) {
    restParts.push(
      expireDays > LONG_TERM_EXPIRE_DAYS ? t("expire.longTerm") : expireDays >= 0 ? t("health.expireSoon", { n: expireDays }) : t("health.expired"),
    );
  }

  return (
    <section className="iov-verdict" data-tone={tone} style={{ "--iov-tone": TONE_COLOR[tone] } as CSSProperties}>
      <div className="iov-verdict-head">
        <b>{title}</b>
        <span>{t("instance.v.hint")}</span>
      </div>
      {model.isOffline ? (
        <p className="iov-verdict-item" data-tone="bad">
          <i aria-hidden />
          <span>{t("instance.v.offline", { time: formatReportTime(node.updatedAt) })}</span>
        </p>
      ) : null}
      {issues.map((issue) => {
        const section = healthIssueSection(issue.key);
        return (
          <p key={issue.key + JSON.stringify(issue.params ?? {})} className="iov-verdict-item" data-tone={issue.tone}>
            <i aria-hidden />
            <span>{t(issue.key, issue.params)}</span>
            {section ? (
              <button type="button" className="iov-verdict-link" onClick={() => scrollToSection(section)}>
                {t(SECTION_LINK[section])}
              </button>
            ) : null}
          </p>
        );
      })}
      {restParts.length > 0 ? (
        <p className="iov-verdict-item" data-tone="good" data-rest="">
          <i aria-hidden />
          <span>{restParts.join(" · ")}</span>
        </p>
      ) : null}
    </section>
  );
}

// ---------- 此刻 ----------

interface Vital {
  key: string;
  label: string;
  value: string;
  unit: string;
  color: string;
  bar: number | null;
  sub: string;
}

function Vitals({ model }: { model: ReadyModel }) {
  const { node } = model;
  const cores = node.cpu_cores > 0 ? node.cpu_cores : null;
  const vitals: Vital[] = [
    {
      key: "cpu",
      label: "CPU",
      value: String(Math.round(node.cpuPct)),
      unit: "%",
      color: levelFill(node.cpuPct, "var(--progress-cpu)"),
      bar: clampPct(node.cpuPct),
      sub: cores ? t("lc.cores", { n: cores }) : "",
    },
    {
      key: "mem",
      label: t("metric.memory"),
      value: String(Math.round(node.ramPct)),
      unit: "%",
      color: levelFill(node.ramPct, "var(--progress-memory)"),
      bar: clampPct(node.ramPct),
      sub: `${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`,
    },
    {
      key: "disk",
      label: t("metric.disk"),
      value: String(Math.round(node.diskPct)),
      unit: "%",
      color: levelFill(node.diskPct, "var(--progress-disk)"),
      bar: clampPct(node.diskPct),
      sub: `${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`,
    },
    {
      key: "net",
      label: t("lc.netSpeed"),
      value: `↑${model.upRate.value}`,
      unit: model.upRate.unit,
      color: "var(--traffic-up)",
      bar: null,
      sub: `↓ ${model.downRate.value} ${model.downRate.unit}`,
    },
    {
      key: "load",
      label: t("metric.load"),
      value: node.load1.toFixed(2),
      unit: "",
      color: levelFill(model.loadFraction * 100, "var(--progress-load)"),
      bar: model.loadFraction * 100,
      sub: t("instance.vitals.load515", { v: `${node.load5.toFixed(2)} · ${node.load15.toFixed(2)}` }),
    },
    {
      key: "uptime",
      label: t("lc.uptimeLabel"),
      value: model.isOffline ? "—" : model.uptime.value,
      unit: model.isOffline ? "" : model.uptime.unit,
      color: "var(--text-primary)",
      bar: null,
      sub: `TCP ${node.connectionsTcp} · UDP ${node.connectionsUdp} · ${t("instance.vitals.proc", { n: node.process })}`,
    },
  ];
  return (
    <section id={OVERVIEW_SECTION.vitals} className="iov-vitals" data-stale={model.isOffline ? "" : undefined}>
      {vitals.map((vital) => (
        <div key={vital.key} className="instance-panel iov-vital">
          <span className="iov-vital-label">{vital.label}</span>
          <b className="iov-vital-value tabular" style={{ color: vital.color }}>
            {vital.value}
            {vital.unit ? <small>{vital.unit}</small> : null}
          </b>
          {vital.bar != null ? (
            <span className="iov-vital-bar" aria-hidden>
              <i style={{ width: `${clampPct(vital.bar)}%`, background: vital.color }} />
            </span>
          ) : null}
          <span className="iov-vital-sub tabular" title={vital.sub}>
            {vital.sub}
          </span>
        </div>
      ))}
    </section>
  );
}

// ---------- 线路 ----------

interface DetailLine {
  taskId: number;
  name: string;
  short: string;
  value: number | null;
  loss: number | null;
  buckets: PingOverviewBucket[];
}

interface DetailLines {
  enabled: boolean;
  /** 柱子实际覆盖了多久（毫秒）。直接打开详情页时后端不给延迟窗口，柱子从打开那刻起靠实时推送攒。 */
  coverageMs: number;
  visible: DetailLine[];
  rows: DetailLine[];
  hiddenCount: number;
  showHidden: boolean;
  setShowHidden: (value: boolean) => void;
}

/**
 * 这台机器的线路：所有有数据的线路，按和 Ping 图一样的规则先只画首页显示的那几条
 * （selectDetailPingTasks），其余的点「另有 N 条」临时显示。柱子用首页同一份延迟窗口，数字用实时推送。
 */
function useDetailLines(uuid: string, livePing: CarrierPingSnapshot | null, offlineSince: number | null): DetailLines {
  const settings = useThemeSettings();
  const showThreeNetDetails = useShowThreeNetDetails();
  // 「显示 Ping 图」关了、或后端关了三网详情（窗口是空的，首页也不画小图），这一块就不出现。
  const enabled = settings.isReady && settings.showPingChart && showThreeNetDetails;
  const raw = useNodeAvailablePingLines(uuid, enabled);
  const nodeLineIds = useNodeMultiPingTaskIds(uuid);
  const homepageLineIds =
    settings.enableHomepageMultiPing && isHomepageMultiPingConfigured(settings.homepageMultiPingTaskIds) ? nodeLineIds : null;
  const now = useMinuteClock(enabled);
  const windowMs = useLatencyWindowMs();
  const [showHidden, setShowHidden] = useState(false);
  const { showPingIpv4, showPingIpv6, homepagePingGroupOverrides, homepagePingProtocols, homepagePingVisibilityOverrides } = settings;

  // 柱子只跟着延迟窗口和时间走；当前延迟用实时推送补（同首页），分开算，免得每次推送都把柱子重算一遍。
  const bucketsByLine = useMemo(
    () => raw.map((line) => buildPingBuckets(line, HOMEPAGE_PING_BUCKET_COUNT, now, offlineSince, windowMs)),
    [now, offlineSince, raw, windowMs],
  );
  const all = useMemo<DetailLine[]>(
    () =>
      raw.map((line, index) => ({
        taskId: line.taskId,
        name: line.taskName,
        short: shortLineName(line.taskName),
        value: withLiveLatency(line, livePing, line.taskId).lastValue,
        loss: line.loss,
        buckets: bucketsByLine[index],
      })),
    [bucketsByLine, livePing, raw],
  );
  const visible = useMemo(
    () =>
      selectDetailPingTasks(
        all.map((line) => ({ id: line.taskId, line })),
        uuid,
        { showPingIpv4, showPingIpv6, homepagePingGroupOverrides, homepagePingProtocols, homepagePingVisibilityOverrides },
        homepageLineIds,
      ).map((entry) => entry.line),
    [all, homepageLineIds, homepagePingGroupOverrides, homepagePingProtocols, homepagePingVisibilityOverrides, showPingIpv4, showPingIpv6, uuid],
  );
  const hidden = useMemo(() => all.filter((line) => !visible.includes(line)), [all, visible]);
  let oldest = Infinity;
  for (const line of raw) {
    const first = line.samples[0]?.time;
    if (first != null && first < oldest) oldest = first;
  }
  return {
    enabled,
    coverageMs: Number.isFinite(oldest) ? Math.max(0, now - oldest) : 0,
    visible,
    rows: showHidden ? [...visible, ...hidden] : visible,
    hiddenCount: hidden.length,
    showHidden,
    setShowHidden,
  };
}

function Lines({ lines }: { lines: DetailLines }) {
  const ceiling = latencyBarCeiling(lines.rows);
  return (
    <section id={OVERVIEW_SECTION.lines} className="instance-panel iov-lines">
      <div className="iov-section-head">
        <b>{t("instance.lines.title", { n: lines.rows.length })}</b>
        <span>{t("instance.lines.hint", { span: coverageLabel(lines.coverageMs) })}</span>
        {lines.hiddenCount > 0 ? (
          <button
            type="button"
            className="iov-ghost-button"
            aria-pressed={lines.showHidden}
            title={t("ping.settingHiddenTitle")}
            onClick={() => lines.setShowHidden(!lines.showHidden)}
          >
            {t(lines.showHidden ? "ping.settingHiddenShown" : "ping.settingHidden", { n: lines.hiddenCount })}
          </button>
        ) : null}
      </div>
      {lines.rows.map((line) => (
        <LineRow key={line.taskId} line={line} ceiling={ceiling} />
      ))}
    </section>
  );
}

/** 「2 小时」或「15 分钟」：说清楚柱子实际覆盖多久，不写死两小时。 */
function coverageLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes >= 90 ? t("duration.hours", { n: Math.round(minutes / 60) }) : t("duration.minutes", { n: minutes });
}

function LineRow({ line, ceiling }: { line: DetailLine; ceiling: number }) {
  const stats = summarizeBuckets(line.buckets);
  const statText = stats ? t("instance.lines.stats", { avg: Math.round(stats.avg), max: Math.round(stats.max) }) : "";
  return (
    <div className="iov-line" title={statText ? `${line.name} · ${statText}` : line.name}>
      <span className="iov-line-name">
        <span>{line.name}</span>
        <small className="tabular" style={{ color: lossHeatColor(line.loss) }}>
          {line.loss == null ? "—" : t("instance.lines.loss", { n: Number(line.loss.toFixed(1)) })}
        </small>
      </span>
      <span className="iov-line-chart" aria-hidden>
        <span className="iov-line-bars">
          {line.buckets.map((bucket) => (
            <i
              key={bucket.index}
              data-empty={bucket.value == null && !bucket.offline ? "" : undefined}
              style={{
                height: `${(bucket.offline ? 1 : latencyBarLevel(bucket.value, ceiling)) * 100}%`,
                background: bucket.offline ? "var(--latency-critical)" : latencyHeatColor(bucket.value),
              }}
            />
          ))}
        </span>
        <span className="iov-line-loss">
          {line.buckets.map((bucket) => (
            <i key={bucket.index} data-tone={lossTone(bucket)} style={{ height: `${lossBarLevel(bucket) * 100}%` }} />
          ))}
        </span>
      </span>
      <b className="iov-line-ms tabular" style={{ color: latencyHeatColor(line.value) }}>
        {line.value == null ? "—" : Math.round(line.value)}
        {line.value == null ? null : <small>ms</small>}
      </b>
      <span className="iov-line-stat tabular">{statText}</span>
    </div>
  );
}

// ---------- 账单和流量 ----------

function Billing({ model, now }: { model: ReadyModel; now: number }) {
  const { node } = model;
  const { priceMasked, showPrice, showExpire } = useBillingVisibility(model);
  const showTiles = showPrice || showExpire;
  const expireDays = priceMasked ? null : getExpireDaysRemaining(node.expired_at, now);
  const expireTone = expireDays == null ? "none" : expireDays <= 3 ? "bad" : expireDays <= 7 ? "warn" : "none";
  const expireAt = resolveExpireTimestamp(node.expired_at);
  const longTerm = expireDays != null && expireDays > LONG_TERM_EXPIRE_DAYS;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(node.expired_at ?? "").trim());
  const expireDate = priceMasked
    ? "••"
    : expireAt == null
      ? "—"
      : longTerm
        ? t("expire.longTerm")
        : formatExpireDate(expireAt, dateOnly, now);
  // 「还有 24 天」；今天到期、已过期照原样写；没填、长期、打码时不写。
  const expireSub =
    priceMasked || expireAt == null || longTerm
      ? ""
      : /\d/.test(model.expire.value)
        ? t("instance.billing.daysLeft", { v: `${model.expire.value} ${model.expire.unit}`.trim() })
        : model.expire.value;

  // 和卡片同一个口径：按 traffic_limit_type 归并本周期的上下行。
  const usage = resolveTrafficUsage(node.traffic_limit_type, node.trafficUpMonthly, node.trafficDownMonthly, node.traffic_limit);
  const cycle = resolveTrafficCycle(node.traffic_reset_day, now);
  const projected = projectCycleUsage(usage.used, cycle, now);
  const projectedFraction = projected != null && !usage.unlimited ? projected / usage.limit : null;

  return (
    <section id={OVERVIEW_SECTION.billing} className="instance-panel iov-billing">
      <div className="iov-section-head">
        <b>{t(showTiles ? "instance.billing.title" : "instance.billing.trafficTitle")}</b>
      </div>
      {showTiles ? (
        <div className="iov-billing-tiles">
          {showPrice ? (
            <span className="iov-tile" data-field="price">
              <span>{t("instance.billing.price")}</span>
              <b className="tabular">{model.renewalPrice}</b>
            </span>
          ) : null}
          {showExpire ? (
            <>
              <span className="iov-tile" data-tone={expireTone}>
                <span>{t("instance.billing.expire")}</span>
                <b className="tabular">{expireDate}</b>
                {expireSub ? <small>{expireSub}</small> : null}
              </span>
              <span className="iov-tile">
                <span>{t("instance.billing.autoRenew")}</span>
                <b>{priceMasked ? "••" : t(node.auto_renewal ? "instance.billing.on" : "instance.billing.off")}</b>
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="iov-traffic" title={model.traffic.tooltip}>
        <span className="iov-traffic-head">
          <b>{t("lc.quota")}</b>
          <span className="tabular">{model.traffic.detail}</span>
        </span>
        {!usage.unlimited ? (
          <span className="iov-traffic-bar" aria-hidden>
            <i className="is-used" style={{ width: `${clampPct(model.traffic.fraction * 100)}%`, background: model.traffic.color }} />
            {projectedFraction != null ? (
              <>
                <i
                  className="is-projected"
                  style={{
                    left: `${clampPct(model.traffic.fraction * 100)}%`,
                    width: `${clampPct(projectedFraction * 100) - clampPct(model.traffic.fraction * 100)}%`,
                  }}
                />
                <i className="is-marker" style={{ left: `${clampPct(projectedFraction * 100)}%` }} />
              </>
            ) : null}
          </span>
        ) : null}
        <span className="iov-traffic-meta tabular">
          <span>{t("lc.remaining", { v: model.traffic.remainingLabel })}</span>
          {node.traffic_reset_day > 0 ? <span>{t("instance.billing.resetDay", { d: node.traffic_reset_day })}</span> : null}
          {projected != null ? (
            <span className="iov-traffic-projection" data-over={projectedFraction != null && projectedFraction > 1 ? "" : undefined}>
              {projectedFraction != null
                ? t("instance.billing.projection", {
                    date: shortDateFormatter().format(cycle.end),
                    v: formatBytes(projected),
                    p: Math.round(projectedFraction * 100),
                  })
                : t("instance.billing.projectionUnlimited", { date: shortDateFormatter().format(cycle.end), v: formatBytes(projected) })}
            </span>
          ) : null}
        </span>
        <span className="iov-traffic-meta tabular">
          {t("instance.billing.totals", { up: formatBytes(node.trafficUp), down: formatBytes(node.trafficDown) })}
        </span>
      </div>
    </section>
  );
}

// ---------- 硬件与系统 ----------

function Hardware({ node, model }: { node: Node; model: ReadyModel }) {
  const { data: me } = useAuth();
  const { data: config } = usePublicConfig();
  const { showAgentUpdateHint, agentUpdateIgnoredVersion } = useThemeSettings();
  const wide = useMediaQuery("(min-width: 768px)");
  // 平时很少看：电脑上默认展开（放在最下面不占地方），手机上默认收起。
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? wide;
  const isOwner = me?.logged_in === true;
  const cpu = `${node.cpu_name || "—"}${node.cpu_cores > 0 ? ` ×${node.cpu_cores}` : ""}`;
  const rows: { key: string; label: string; value: ReactNode }[] = [
    { key: "cpu", label: "CPU", value: cpu },
    { key: "arch", label: t("instance.arch"), value: node.arch || "—" },
    { key: "gpu", label: t("instance.gpu"), value: node.gpu_name || "—" },
    { key: "os", label: t("instance.os"), value: node.os || "—" },
    { key: "kernel", label: t("instance.kernel"), value: node.kernel_version || "—" },
    {
      key: "swap",
      label: "Swap",
      value: node.swapTotal > 0 ? `${formatBytes(node.swapUsed)} / ${formatBytes(node.swapTotal)}` : t("instance.none"),
    },
    {
      key: "report",
      label: t(model.isOffline ? "instance.lastReport" : "instance.lastUpdate"),
      value: formatReportTime(node.updatedAt),
    },
  ];
  // Agent 版本只给登录站长看：最新版本号也只有站长拿得到，访客看了也没法处理。
  if (isOwner) {
    rows.push({
      key: "agent",
      label: t("instance.agentVersion"),
      value: (
        <AgentVersionValue
          version={node.agent_version}
          latest={agentUpdateTarget(config?.latestAgentVersion ?? "", agentUpdateIgnoredVersion, showAgentUpdateHint)}
        />
      ),
    });
  }
  return (
    <section className="instance-panel iov-hardware">
      <button type="button" className="iov-fold" aria-expanded={open} onClick={() => setToggled(!open)}>
        <b>{t("instance.hw.title")}</b>
        {!open ? <span className="iov-fold-summary">{[node.cpu_name, model.osName].filter(Boolean).join(" · ")}</span> : null}
        {open ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
      </button>
      {open ? (
        <div className="iov-hw-rows">
          {rows.map((row) => (
            <span key={row.key} className="iov-hw-row">
              <span>{row.label}</span>
              <span className="iov-hw-value">{row.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AgentVersionValue({ version, latest }: { version: string; latest: string }) {
  if (!version) return <>—</>;
  const outdated = isNewerVersion(latest, version);
  return (
    <span className="instance-agent-version">
      {formatVersionLabel(version)}
      {outdated ? (
        <span className="ip-stack-badge" data-tag="amber" title={t("agentUpdate.badgeTitle", { version: formatVersionLabel(latest) })}>
          {t("agentUpdate.badge", { version: formatVersionLabel(latest) })}
        </span>
      ) : null}
    </span>
  );
}
