import { t, type MessageKey } from "@/i18n";
import { memo, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useHourlyClock } from "@/hooks/useClock";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { HOMEPAGE_PING_BUCKET_COUNT } from "@/hooks/usePingOverview";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatByteRate, formatBytes, formatClockTime, getExpireDaysRemaining } from "@/utils/format";
import { computeNodeHealth, type HealthTone } from "@/utils/nodeHealth";
import { resolveLatencyStyle, type NewViewMode } from "@/utils/layouts";
import type { TrafficTrendSample } from "@/types/cfsm";
import { IpStackBadges } from "./IpStackBadges";
import { LatencyBlock, toLatLines } from "./LatencyStyles";
import { NodeClockWarning } from "./NodeClockWarning";
import { shortLineName } from "@/services/cfsm/mappers";
import { formatCompactPercent, nodeDetailLinkLabels } from "./nodeCardShared";

/*
 * Lumina Prism 新加的六种卡片：圆环卡、数据大卡、线路卡、便当盒、健康分卡、仪表盘。
 * 和原来的四种卡片用同一个 useNodeCardModel，所以打码、离线、V4 / V6、线路切换都一样生效。
 * 每种布局的信息都是全的（名称、地区、系统、V4/V6、标签、分组、CPU 和核数、内存和磁盘的已用/总量、负载、
 * 实时网速、累计流量、本月流量和剩余、在线时长、连接数、价格、到期、每条线路的延迟和丢包），只是摆放和
 * 强调不一样；「卡片上显示什么」的开关对六种都生效。延迟用哪种画法见 LatencyStyles（设置「延迟样式」）。
 * 离线的机器收起来：只留离线提示、标签、分组、价格和到期，不显示停在那一刻的旧数值，免得被当成实时数据。
 * 只用 CSS 和 SVG 画，样式在 styles/layout-cards.css，颜色全部走主题变量，六套风格都能直接套。
 */

type CardModel = ReturnType<typeof useNodeCardModel>;
type ReadyModel = Extract<CardModel, { traffic: unknown }>;

function clampPct(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

/** 百分比读数的颜色：75% 起黄、90% 起红，其余用正文色（条和圆环本身仍是各指标的颜色）。 */
function levelTextColor(pct: number) {
  return pct >= 90 ? "var(--status-error)" : pct >= 75 ? "var(--status-warning)" : undefined;
}

function levelFill(pct: number, base: string) {
  return pct >= 90 ? "var(--status-error)" : pct >= 75 ? "var(--status-warning)" : base;
}

const TONE_COLOR: Record<HealthTone, string> = {
  good: "var(--status-success)",
  warn: "var(--status-warning)",
  bad: "var(--status-error)",
};

function sumTrend(trend: { up: TrafficTrendSample[]; down: TrafficTrendSample[] }, count: number) {
  const up = trend.up.slice(-count);
  const down = trend.down.slice(-count);
  const length = Math.max(up.length, down.length);
  const out: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const upSample = up[up.length - length + index];
    const downSample = down[down.length - length + index];
    out.push((upSample?.value ?? 0) + (downSample?.value ?? 0));
  }
  return out;
}

function bytesPair(used: number, total: number) {
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

/** 卡片要用到的全部内容：模型 + 「卡片上显示什么」的开关 + 到期提醒的程度 + 延迟线路。 */
function useLayoutCard(uuid: string, kind: NewViewMode) {
  const model = useNodeCardModel(uuid, { pingBucketCount: HOMEPAGE_PING_BUCKET_COUNT, includeMultiPing: true });
  const settings = useThemeSettings();
  const now = useHourlyClock();
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;
  const showPing = model.node ? (model as ReadyModel).showHomepagePing : false;
  // 只跟着线路数据变（每秒刷新的 CPU、网速不重算），延迟那块的 memo 才有用。
  const lines = useMemo(
    () => (showPing ? toLatLines(model.homepagePingLines, model.ping, model.pingBuckets) : []),
    [showPing, model.homepagePingLines, model.ping, model.pingBuckets],
  );
  if (!model.node) return null;
  const ready = model as ReadyModel;
  const { node } = ready;
  // 打码了价格，到期也不能拿来算（「6 天后到期」会把打码的内容说出来）。
  const priceMasked = ready.maskTokens?.split(" ").includes("price") === true;
  const expireDays = priceMasked ? null : getExpireDaysRemaining(node.expired_at, now);
  // 按月付的机器剩余天数永远在 30 天内，30 天就提醒等于一直亮黄灯：7 天内提醒、3 天内告警。
  const expireTone = expireDays == null ? "none" : expireDays <= 3 ? "bad" : expireDays <= 7 ? "warn" : "none";
  const showBilling = settings.compactShowBilling;
  return {
    model: ready,
    node,
    kind,
    lines,
    redrawKey,
    latencyStyle: resolveLatencyStyle(settings.latencyStyle, kind),
    showTotals: settings.compactShowTrafficTotal,
    showUptime: settings.compactShowUptime,
    showConn: settings.showConnections,
    showPrice: showBilling && ready.showSitePrice && settings.showCardPrice && Boolean(ready.renewalPrice),
    showExpire: showBilling && ready.showSiteExpire,
    expireTone,
    expireText: `${ready.expire.value}${ready.expire.unit}`,
    // 「23天」才拼成「23天到期」；「已过期」「长期」原样写；没填到期日（—）就不显示。
    expireHasDays: /\d/.test(ready.expire.value),
    expireEmpty: !ready.expire.value || ready.expire.value === "—",
    cores: node.cpu_cores > 0 ? node.cpu_cores : null,
    memDetail: bytesPair(node.ramUsed, node.ramTotal),
    diskDetail: bytesPair(node.diskUsed, node.diskTotal),
    totals: `↑${formatBytes(node.trafficUp)} ↓${formatBytes(node.trafficDown)}`,
    uptime: `${ready.uptime.value}${ready.uptime.unit}`,
    conn: `${node.connectionsTcp} · ${node.connectionsUdp}`,
    loads: `${node.load1.toFixed(2)} · ${node.load5.toFixed(2)} · ${node.load15.toFixed(2)}`,
  };
}

type Card = NonNullable<ReturnType<typeof useLayoutCard>>;

// ---------- 公共部分 ----------

function Tags({ card, withGroup = true }: { card: Card; withGroup?: boolean }) {
  const { tags, subtitle } = card.model;
  if (tags.length === 0 && !(withGroup && subtitle)) return null;
  return (
    <>
      {tags.map((tag, index) => (
        <span key={`${tag.label}-${index}`} className="lc-tag" data-tag={tag.color}>
          {tag.label}
        </span>
      ))}
      {withGroup && subtitle ? (
        <span className="lc-group" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
    </>
  );
}

function Price({ card }: { card: Card }) {
  return card.showPrice ? <span className="lc-price tabular">{card.model.renewalPrice}</span> : null;
}

function Expire({ card }: { card: Card }) {
  if (!card.showExpire || card.expireEmpty) return null;
  return (
    <span className="lc-expire tabular" data-tone={card.expireTone}>
      {card.expireHasDays ? t("lc.expireIn", { v: card.expireText }) : card.expireText}
    </span>
  );
}

function CardShell({ card, children, top }: { card: Card; children: ReactNode; top?: ReactNode }) {
  const { model, node, kind } = card;
  const href = `/server/${encodeURIComponent(node.uuid)}`;
  const labels = nodeDetailLinkLabels(node.name, model.osName);
  return (
    <article className={clsx("lc-card", `lc-card-${kind}`, model.isOffline && "is-offline")} data-mask={model.maskTokens}>
      {top}
      <header className="lc-head">
        <Flag region={node.region} size={15} />
        <Link to={href} className="lc-title" title={node.name}>
          {node.name}
        </Link>
        <IpStackBadges {...model.ipStack} />
        <Link to={href} className="lc-os" title={labels.title} aria-label={labels.ariaLabel}>
          <i className="lc-status" data-online={model.isOffline ? undefined : ""} aria-hidden />
          <OsLogo value={node.os} size={14} />
          <span className="lc-os-name">{model.osName}</span>
        </Link>
      </header>
      <NodeClockWarning sampleAt={node.updatedAt} />
      {model.isOffline ? <OfflineBody card={card} /> : children}
    </article>
  );
}

/** 离线：卡片收起，只留离线提示和标签、分组、价格、到期。 */
function OfflineBody({ card }: { card: Card }) {
  return (
    <>
      <div className="lc-offline" role="status">
        <b>{t("lc.offlineSince", { time: formatClockTime(card.node.updatedAt) })}</b>
        <span>{t("lc.offlineHint")}</span>
      </div>
      <div className="lc-foot">
        <Tags card={card} />
        <span className="lc-foot-end">
          <Price card={card} />
          <Expire card={card} />
        </span>
      </div>
    </>
  );
}

function Latency({ card, className }: { card: Card; className?: string }) {
  if (card.lines.length === 0) return null;
  return (
    <div className={clsx("lc-lat-slot", className)}>
      <LatencyBlock uuid={card.node.uuid} lines={card.lines} style={card.latencyStyle} redrawKey={card.redrawKey} />
    </div>
  );
}

function Ring({ value, label, detail, color, size = 58 }: { value: number; label: string; detail?: string; color: string; size?: number }) {
  const style = { "--lc-ring": `${clampPct(value)}%`, "--lc-ring-color": levelFill(value, color), "--lc-ring-size": `${size}px` } as CSSProperties;
  const display = formatCompactPercent(value);
  return (
    <div className="lc-ring-item">
      <div className="lc-ring" style={style} role="img" aria-label={`${label} ${display}`}>
        <span className="tabular" style={{ color: levelTextColor(value) }}>
          {display}
        </span>
      </div>
      <span className="lc-label">{label}</span>
      {detail ? <span className="lc-detail tabular">{detail}</span> : null}
    </div>
  );
}

function Meter({ label, value, color, detail, text, segmented = false }: { label: string; value: number; color: string; detail?: string; text?: string; segmented?: boolean }) {
  return (
    <div className="lc-meter">
      <span className="lc-meter-head">
        <span className="lc-label">{label}</span>
        <b className="tabular" style={{ color: levelTextColor(value) }}>
          {text ?? formatCompactPercent(value)}
        </b>
      </span>
      <span className={clsx("lc-track", segmented && "is-seg")} aria-hidden>
        <span style={{ "--lc-fill": clampPct(value) / 100, background: levelFill(value, color) } as CSSProperties} />
      </span>
      {detail ? <span className="lc-detail tabular">{detail}</span> : null}
    </div>
  );
}

/** 本月流量：已用 / 上限、条、剩余；累计上下行跟着「累计流量」开关。 */
function Quota({ card, variant = "plain" }: { card: Card; variant?: "plain" | "boxed" | "seg" | "grad" }) {
  const { traffic } = card.model;
  return (
    <div className={clsx("lc-quota", `is-${variant}`)} title={traffic.tooltip}>
      <span className="lc-quota-head">
        <span className="lc-label">{t("lc.quota")}</span>
        <span className="tabular">{traffic.detail}</span>
      </span>
      <span className={clsx("lc-track", "is-quota", variant === "seg" && "is-seg")} aria-hidden>
        <span style={{ "--lc-fill": clampPct(traffic.fraction * 100) / 100, background: variant === "grad" ? undefined : traffic.color } as CSSProperties} />
      </span>
      <span className="lc-detail tabular">
        {t("lc.remaining", { v: traffic.remainingLabel })}
        {card.showTotals ? ` · ${t("lc.totals", { v: card.totals })}` : ""}
      </span>
    </div>
  );
}

/** 最近网速走势（上下行加起来），数据就是小卡片那排小点用的同一份。 */
function Spark({ card, width = 120, height = 40 }: { card: Card; width?: number; height?: number }) {
  const { trafficTrend } = card.model;
  const path = useMemo(() => {
    const values = sumTrend(trafficTrend, 30);
    if (values.length < 2) return null;
    const max = Math.max(...values, 1) * 1.12;
    const step = width / (values.length - 1);
    const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`);
    return { line: points.join(" "), area: `M0,${height} L${points.join(" L")} L${width},${height} Z` };
  }, [trafficTrend, width, height]);
  return (
    <svg className="lc-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {path ? (
        <>
          <path d={path.area} className="lc-spark-area" />
          <polyline points={path.line} className="lc-spark-line" />
        </>
      ) : null}
    </svg>
  );
}

function Rate({ card, dir }: { card: Card; dir: "up" | "down" }) {
  const rate = dir === "up" ? card.model.upRate : card.model.downRate;
  return (
    <span className="tabular">
      <span className={dir === "up" ? "lc-up" : "lc-down"}>{dir === "up" ? "↑" : "↓"}</span>
      {rate.value}
      <small>{rate.unit}</small>
    </span>
  );
}

function LoadingCard({ kind }: { kind: string }) {
  return <article className={clsx("lc-card animate-pulse", `lc-card-${kind}`)} aria-busy />;
}

/** 底部一行的「在线 · TCP/UDP」：两个开关都关就没有。 */
function UpConn({ card }: { card: Card }) {
  const parts = [card.showUptime ? t("lc.uptime", { v: card.uptime }) : null, card.showConn ? t("lc.conn", { v: card.conn }) : null].filter(Boolean);
  return parts.length > 0 ? <span className="lc-upconn tabular">{parts.join(" · ")}</span> : null;
}

// ---------- 圆环卡：标签在名字下面，价格到期是两颗胶囊 ----------

export const RingNodeCard = memo(function RingNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "ring");
  if (!card) return <LoadingCard kind="ring" />;
  const { node } = card;
  return (
    <CardShell card={card} top={null}>
      <TagRow card={card} />
      <div className="lc-ring-row">
        <Ring value={node.cpuPct} label="CPU" detail={card.cores ? t("lc.cores", { n: card.cores }) : undefined} color="var(--progress-cpu)" />
        <Ring value={node.ramPct} label={t("metric.memory")} detail={formatBytes(node.ramUsed)} color="var(--progress-memory)" />
        <Ring value={node.diskPct} label={t("metric.disk")} detail={formatBytes(node.diskUsed)} color="var(--progress-disk)" />
        <div className="lc-ring-net">
          <span className="lc-label">{t("lc.netSpeed")}</span>
          <strong>
            <Rate card={card} dir="down" />
          </strong>
          <Rate card={card} dir="up" />
          <span className="lc-detail tabular">
            {t("metric.load")} <b>{node.load1.toFixed(2)}</b> · {node.load5.toFixed(2)} · {node.load15.toFixed(2)}
          </span>
        </div>
      </div>
      <Quota card={card} variant="boxed" />
      <Latency card={card} />
      <footer className="lc-foot">
        <UpConn card={card} />
        <span className="lc-foot-end">
          <Price card={card} />
          <Expire card={card} />
        </span>
      </footer>
    </CardShell>
  );
});

function TagRow({ card }: { card: Card }) {
  if (card.model.tags.length === 0 && !card.model.subtitle) return null;
  return (
    <div className="lc-tags">
      <Tags card={card} />
    </div>
  );
}

// ---------- 数据大卡：分组是名字上面一行小字，标签放底部 ----------

export const HeroNodeCard = memo(function HeroNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "hero");
  if (!card) return <LoadingCard kind="hero" />;
  const { node } = card;
  const total = formatByteRate(node.netUp + node.netDown);
  const stats = [
    { label: t("metric.load"), value: `${node.load1.toFixed(2)} · ${node.load5.toFixed(1)}` },
    card.showUptime ? { label: t("lc.uptimeLabel"), value: card.uptime } : null,
    card.showConn ? { label: "TCP · UDP", value: card.conn } : null,
  ].filter((item): item is { label: string; value: string } => item != null);
  const eyebrow = card.model.subtitle ? <span className="lc-eyebrow">{card.model.subtitle}</span> : null;
  return (
    <CardShell card={card} top={eyebrow}>
      <div className="lc-hero-top">
        <div className="lc-hero-number">
          <span className="lc-label">{t("lc.netSpeed")}</span>
          <strong className="tabular">
            {total.value}
            <small>{total.unit}</small>
          </strong>
          <span className="lc-hero-pair">
            <Rate card={card} dir="up" /> <Rate card={card} dir="down" />
          </span>
        </div>
        <Spark card={card} width={128} height={48} />
      </div>
      <div className="lc-meters">
        <Meter label="CPU" value={node.cpuPct} color="var(--progress-cpu)" detail={card.cores ? t("lc.cores", { n: card.cores }) : undefined} />
        <Meter label={t("metric.memory")} value={node.ramPct} color="var(--progress-memory)" detail={card.memDetail} />
        <Meter label={t("metric.disk")} value={node.diskPct} color="var(--progress-disk)" detail={card.diskDetail} />
      </div>
      <div className="lc-stats" style={{ "--cols": stats.length } as CSSProperties}>
        {stats.map((item) => (
          <span key={item.label} className="lc-stat">
            <span className="lc-label">{item.label}</span>
            <b className="tabular">{item.value}</b>
          </span>
        ))}
      </div>
      <Quota card={card} variant="grad" />
      <Latency card={card} />
      <footer className="lc-foot">
        <Tags card={card} withGroup={false} />
        <span className="lc-foot-end">
          <Price card={card} />
          <Expire card={card} />
        </span>
      </footer>
    </CardShell>
  );
});

// ---------- 线路卡：延迟在最上面，标签分组放底部状态栏 ----------

export const RouteNodeCard = memo(function RouteNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "route");
  if (!card) return <LoadingCard kind="route" />;
  const { node } = card;
  const loadPct = (node.load1 / (card.cores ?? 4)) * 100;
  return (
    <CardShell card={card}>
      {card.lines.length > 0 ? <Latency card={card} /> : <p className="lc-note">{t("card.pingUnsetTitle")}</p>}
      <div className="lc-seg-meters">
        <Meter label={card.cores ? `CPU · ${t("lc.cores", { n: card.cores })}` : "CPU"} value={node.cpuPct} color="var(--progress-cpu)" segmented detail={t("lc.loadAvg", { v: card.loads })} />
        <Meter label={t("metric.memory")} value={node.ramPct} color="var(--progress-memory)" segmented detail={card.memDetail} />
        <Meter label={t("metric.disk")} value={node.diskPct} color="var(--progress-disk)" segmented detail={card.diskDetail} />
        <Meter label={t("metric.load")} value={loadPct} text={node.load1.toFixed(2)} color="var(--progress-load)" segmented detail={t("lc.load515", { a: node.load5.toFixed(2), b: node.load15.toFixed(2) })} />
      </div>
      <div className="lc-route-net">
        <span className="tabular">
          {t("lc.netSpeed")} <Rate card={card} dir="up" /> <Rate card={card} dir="down" />
        </span>
        <Quota card={card} variant="seg" />
      </div>
      <footer className="lc-statusbar">
        <span className="lc-statusbar-tags">
          <Tags card={card} />
        </span>
        <span className="lc-statusbar-row">
          <UpConn card={card} />
          <span className="lc-foot-end">
            <Price card={card} />
            <Expire card={card} />
          </span>
        </span>
      </footer>
    </CardShell>
  );
});

// ---------- 便当盒：一格一格拼，分组标签和续费各占一格 ----------

export const BentoNodeCard = memo(function BentoNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "bento");
  if (!card) return <LoadingCard kind="bento" />;
  const { node } = card;
  const small = [
    card.showUptime ? { key: "up", label: t("lc.uptimeLabel"), value: card.uptime } : null,
    card.showConn ? { key: "conn", label: "TCP · UDP", value: card.conn } : null,
  ].filter((item): item is { key: string; label: string; value: string } => item != null);
  // 价格、到期都没东西可写时不留空的账单格。
  const showBill = card.showPrice || (card.showExpire && !card.expireEmpty);
  return (
    <CardShell card={card}>
      <div className="lc-bento">
        <div className="lc-tile lc-tile-speed" data-tint="net">
          <div className="lc-hero-number is-small">
            <span className="lc-label">{t("lc.netSpeed")}</span>
            <strong>
              <Rate card={card} dir="down" />
            </strong>
            <Rate card={card} dir="up" />
          </div>
          <Spark card={card} width={78} height={34} />
        </div>
        <div className="lc-tile lc-tile-cpu" data-tint="cpu">
          <Ring value={node.cpuPct} label={card.cores ? `CPU · ${t("lc.cores", { n: card.cores })}` : "CPU"} detail={`${t("metric.load")} ${node.load1.toFixed(2)}`} color="var(--progress-cpu)" size={60} />
        </div>
        <div className="lc-tile" data-tint="mem">
          <Meter label={t("metric.memory")} value={node.ramPct} color="var(--progress-memory)" detail={card.memDetail} />
        </div>
        <div className="lc-tile" data-tint="disk">
          <Meter label={t("metric.disk")} value={node.diskPct} color="var(--progress-disk)" detail={card.diskDetail} />
        </div>
        <div className="lc-tile lc-tile-full" data-tint="quota">
          <Quota card={card} />
        </div>
      </div>
      <Latency card={card} className="lc-bento-lat" />
      <div className="lc-bento">
        {card.model.tags.length > 0 || card.model.subtitle ? (
          <div className="lc-tile lc-tile-full lc-tile-tags">
            {card.model.subtitle ? <span className="lc-label">{t("lc.groupLabel", { v: card.model.subtitle })}</span> : null}
            <span className="lc-tags">
              <Tags card={card} withGroup={false} />
            </span>
          </div>
        ) : null}
        {small.map((item) => (
          <div key={item.key} className="lc-tile" data-tint="misc">
            <span className="lc-label">{item.label}</span>
            <b className="tabular">{item.value}</b>
          </div>
        ))}
        {showBill ? (
          <div className="lc-tile lc-tile-bill" data-tone={card.expireTone} style={small.length < 2 ? { gridColumn: `span ${3 - small.length}` } : undefined}>
            <span className="lc-label">{t("lc.renew")}</span>
            <Price card={card} />
            <Expire card={card} />
          </div>
        ) : null}
      </div>
    </CardShell>
  );
});

// ---------- 健康分卡：体检单式排版，标签分组价格放底部 ----------

export const HealthNodeCard = memo(function HealthNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "health");
  const now = useHourlyClock();
  if (!card) return <LoadingCard kind="health" />;
  const { node, model } = card;
  const priceMasked = model.maskTokens?.split(" ").includes("price") === true;
  const losses =
    model.homepagePingLines.length > 0
      ? model.homepagePingLines.map((line) => ({ name: shortLineName(line.taskName), loss: line.loss }))
      : model.showHomepagePing
        ? [{ name: "", loss: model.ping.loss }]
        : [];
  const health = computeNodeHealth({
    online: !model.isOffline,
    cpuPct: node.cpuPct,
    ramPct: node.ramPct,
    diskPct: node.diskPct,
    losses,
    expireDays: priceMasked ? null : getExpireDaysRemaining(node.expired_at, now),
    trafficFraction: model.traffic.fraction,
  });
  const toneColor = TONE_COLOR[health.tone];
  const scoreStyle = { "--lc-ring": `${health.score ?? 0}%`, "--lc-ring-color": toneColor } as CSSProperties;
  const issues = health.issues.slice(0, 3);
  const report: { label: string; value: string; note?: string; color?: string }[] = [
    { label: "CPU", value: formatCompactPercent(node.cpuPct), note: card.cores ? t("lc.cores", { n: card.cores }) : undefined, color: levelTextColor(node.cpuPct) },
    { label: t("metric.memory"), value: formatCompactPercent(node.ramPct), note: card.memDetail, color: levelTextColor(node.ramPct) },
    { label: t("metric.disk"), value: formatCompactPercent(node.diskPct), note: card.diskDetail, color: levelTextColor(node.diskPct) },
    { label: t("metric.load"), value: node.load1.toFixed(2), note: `${node.load5.toFixed(2)} · ${node.load15.toFixed(2)}` },
    { label: t("lc.netSpeed"), value: `↑${model.upRate.value}${model.upRate.unit} ↓${model.downRate.value}${model.downRate.unit}` },
    { label: t("lc.quota"), value: model.traffic.detail, note: t("lc.remaining", { v: model.traffic.remainingLabel }) },
  ];
  if (card.showTotals) report.push({ label: t("lc.totalsLabel"), value: card.totals });
  if (card.showUptime || card.showConn) {
    report.push({
      label: card.showUptime ? t("lc.uptimeLabel") : "TCP · UDP",
      value: card.showUptime ? card.uptime : card.conn,
      note: card.showUptime && card.showConn ? `TCP · UDP ${card.conn}` : undefined,
    });
  }
  return (
    <CardShell card={card}>
      <div className="lc-health">
        <div
          className="lc-ring lc-score"
          style={scoreStyle}
          role="img"
          aria-label={health.score == null ? t("health.offline") : t("health.scoreAria", { n: health.score })}
        >
          <span>
            <b className="tabular" style={{ color: toneColor }}>
              {health.score ?? "—"}
            </b>
            <small>{t(`health.grade.${health.tone}` as MessageKey)}</small>
          </span>
        </div>
        <ul className="lc-issues">
          {issues.length === 0 ? (
            <li data-tone="good">{t("health.ok")}</li>
          ) : (
            issues.map((issue) => (
              <li key={issue.key + JSON.stringify(issue.params ?? {})} data-tone={issue.tone}>
                {t(issue.key, issue.params)}
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="lc-report">
        <span className="lc-section-title">{t("lc.report")}</span>
        {report.map((row) => (
          <span key={row.label} className="lc-report-row">
            <span>{row.label}</span>
            <i aria-hidden />
            <b className="tabular" style={{ color: row.color }}>
              {row.value}
            </b>
            {row.note ? <small className="tabular">{row.note}</small> : null}
          </span>
        ))}
      </div>
      <Latency card={card} />
      <footer className="lc-foot">
        <Tags card={card} />
        <span className="lc-foot-end">
          <Price card={card} />
          <Expire card={card} />
        </span>
      </footer>
    </CardShell>
  );
});

// ---------- 仪表盘：标签像指示灯排在名字下面，读数放液晶格 ----------

/** 大表盘的刻度：半圆上 9 根（两端那两根是水平的，会压到下面的字，不画），中间那根长一点。 */
const GAUGE_TICKS = Array.from({ length: 9 }, (_, slot) => {
  const index = slot + 1;
  const angle = Math.PI - (index * Math.PI) / 10;
  const outer = 52;
  const inner = index % 5 === 0 ? 44 : 47;
  return {
    x1: (80 + outer * Math.cos(angle)).toFixed(1),
    y1: (82 - outer * Math.sin(angle)).toFixed(1),
    x2: (80 + inner * Math.cos(angle)).toFixed(1),
    y2: (82 - inner * Math.sin(angle)).toFixed(1),
    major: index % 5 === 0,
  };
});

function SideGauge({ value, label, detail, color }: { value: number; label: string; detail?: string; color: string }) {
  const pct = clampPct(value);
  return (
    <div className="lc-side-gauge" role="img" aria-label={`${label} ${formatCompactPercent(value)}`}>
      <svg width="72" height="42" viewBox="0 0 72 42" aria-hidden>
        <path d="M6 38 A30 30 0 0 1 66 38" pathLength={100} className="lc-arc-track" />
        <path d="M6 38 A30 30 0 0 1 66 38" pathLength={100} className="lc-arc-fill" style={{ stroke: levelFill(value, color), strokeDasharray: `${pct} 100` }} />
      </svg>
      <b className="tabular" style={{ color: levelTextColor(value) }}>
        {formatCompactPercent(value)}
      </b>
      <span className="lc-label">{label}</span>
      {detail ? <span className="lc-detail tabular">{detail}</span> : null}
    </div>
  );
}

export const GaugeNodeCard = memo(function GaugeNodeCard({ uuid }: { uuid: string }) {
  const card = useLayoutCard(uuid, "gauge");
  if (!card) return <LoadingCard kind="gauge" />;
  const { node, model } = card;
  const totalBytes = node.netUp + node.netDown;
  // 表盘满格 = 最近一段时间的峰值（至少 128 KB/s），不然空闲的机器指针永远贴着 0。
  const peakBytes = Math.max(totalBytes, ...sumTrend(model.trafficTrend, 30), 128 * 1024);
  const fraction = peakBytes > 0 ? Math.min(1, totalBytes / peakBytes) : 0;
  const total = formatByteRate(totalBytes);
  const peak = formatByteRate(peakBytes);
  const lcd = [
    { label: t("metric.disk"), value: formatCompactPercent(node.diskPct), color: levelTextColor(node.diskPct) },
    { label: t("metric.load"), value: node.load1.toFixed(2) },
    card.showUptime ? { label: t("lc.uptimeLabel"), value: card.uptime } : null,
    card.showConn ? { label: "TCP · UDP", value: card.conn } : null,
  ].filter((item): item is { label: string; value: string; color?: string } => item != null);
  return (
    <CardShell card={card}>
      <TagRow card={card} />
      <div className="lc-gauges">
        <SideGauge value={node.cpuPct} label="CPU" detail={card.cores ? t("lc.cores", { n: card.cores }) : undefined} color="var(--progress-cpu)" />
        <div className="lc-main-gauge" role="img" aria-label={`${t("lc.netSpeed")} ${total.value} ${total.unit}`}>
          <svg width="160" height="88" viewBox="0 0 160 88" aria-hidden>
            <path d="M14 82 A66 66 0 0 1 146 82" pathLength={100} className="lc-arc-track is-main" />
            <path d="M14 82 A66 66 0 0 1 146 82" pathLength={100} className="lc-arc-fill is-main" style={{ strokeDasharray: `${(fraction * 100).toFixed(1)} 100` }} />
            {GAUGE_TICKS.map((tick, index) => (
              <line key={index} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} className={clsx("lc-tick", tick.major && "is-major")} />
            ))}
          </svg>
          <strong className="tabular">{total.value}</strong>
          <span className="lc-label">
            {total.unit} · {t("lc.peak", { value: `${peak.value} ${peak.unit}` })}
          </span>
        </div>
        <SideGauge value={node.ramPct} label={t("metric.memory")} detail={formatBytes(node.ramUsed)} color="var(--progress-memory)" />
      </div>
      <div className="lc-lcds" style={{ "--cols": lcd.length } as CSSProperties}>
        {lcd.map((item) => (
          <span key={item.label} className="lc-lcd">
            <span className="lc-label">{item.label}</span>
            <b className="tabular" style={{ color: item.color }}>
              {item.value}
            </b>
          </span>
        ))}
      </div>
      <div className="lc-gauge-quota">
        <Quota card={card} />
        <span className="lc-detail tabular">
          <Rate card={card} dir="up" /> <Rate card={card} dir="down" />
        </span>
      </div>
      <Latency card={card} />
      {/* 价格、到期都不显示（主题开关或后台「显示价格 / 显示到期」关了）时，不留一个只有「续费」两个字的空底栏。 */}
      {card.showPrice || (card.showExpire && !card.expireEmpty) ? (
        <footer className="lc-foot">
          <span className="lc-label">{t("lc.renew")}</span>
          <span className="lc-foot-end">
            <Price card={card} />
            <Expire card={card} />
          </span>
        </footer>
      ) : null}
    </CardShell>
  );
});
