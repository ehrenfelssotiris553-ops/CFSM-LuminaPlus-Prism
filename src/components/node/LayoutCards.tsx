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
import { formatByteRate, getExpireDaysRemaining } from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { computeNodeHealth, type HealthTone } from "@/utils/nodeHealth";
import type { TrafficTrendSample } from "@/types/cfsm";
import { IpStackBadges } from "./IpStackBadges";
import { LatencyBars } from "./LatencyBars";
import { MultiPingStatus } from "./MultiPingStatus";
import { NodeClockWarning } from "./NodeClockWarning";
import { formatCompactPercent, nodeDetailLinkLabels, pingEmptyLabels } from "./nodeCardShared";

/*
 * Lumina Prism 新加的六种卡片：圆环卡、数据大卡、线路卡、便当盒、健康分卡、仪表盘。
 * 和原来的四种卡片用同一个 useNodeCardModel，所以打码、离线、V4 / V6、线路切换都一样生效。
 * 只用 CSS 和 SVG 画（圆环是 conic-gradient，曲线和表盘是 SVG），不加画布，每秒刷新开销和小卡片差不多。
 * 样式在 styles/layout-cards.css，颜色全部走主题变量，所以六套配色风格都能直接套。
 */

type CardModel = ReturnType<typeof useNodeCardModel>;
type ReadyModel = Extract<CardModel, { traffic: unknown }>;

function useLayoutCardModel(uuid: string) {
  return useNodeCardModel(uuid, {
    pingBucketCount: HOMEPAGE_PING_BUCKET_COUNT,
    includeMultiPing: true,
  });
}

function clampPct(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

/** 百分比读数的颜色：75% 起黄、90% 起红，其余用正文色（条和圆环本身仍是各指标的颜色）。 */
function levelTextColor(pct: number) {
  return pct >= 90 ? "var(--status-error)" : pct >= 75 ? "var(--status-warning)" : undefined;
}

const TONE_COLOR: Record<HealthTone, string> = {
  good: "var(--status-success)",
  warn: "var(--status-warning)",
  bad: "var(--status-error)",
};

/** 「CT 电信」只留「电信」，三条线挤在一行时省地方。 */
function shortLineName(name: string) {
  return name.trim().split(/\s+/).pop() ?? name;
}

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

function useRedrawKey() {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  return `${resolvedAppearance}:${colorsVersion}`;
}

// ---------- 公共部分 ----------

function CardShell({ model, kind, children }: { model: ReadyModel; kind: string; children: ReactNode }) {
  const { node, osName, isOffline } = model;
  const href = `/server/${encodeURIComponent(node.uuid)}`;
  const labels = nodeDetailLinkLabels(node.name, osName);
  return (
    <article className={clsx("lc-card", `lc-card-${kind}`, isOffline && "is-offline")} data-mask={model.maskTokens}>
      <header className="lc-head">
        <Flag region={node.region} size={15} />
        <Link to={href} className="lc-title" title={node.name}>
          {node.name}
        </Link>
        <IpStackBadges {...model.ipStack} />
        {isOffline ? <span className="lc-offline-chip">{t("status.offline")}</span> : null}
        <Link to={href} className="lc-os" title={labels.title} aria-label={labels.ariaLabel}>
          <OsLogo value={node.os} size={15} />
        </Link>
      </header>
      <NodeClockWarning sampleAt={node.updatedAt} />
      {children}
    </article>
  );
}

/** 底部一行：分组 / 备注 · 价格 · 到期，右边可以再放东西（比如延迟）。 */
function CardFoot({ model, children }: { model: ReadyModel; children?: ReactNode }) {
  const { subtitle, renewalPrice, expire, expireColor } = model;
  return (
    <footer className="lc-foot">
      {subtitle ? (
        <span className="lc-subtitle" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
      {renewalPrice ? <span className="lc-price tabular">{renewalPrice}</span> : null}
      <span className="lc-expire tabular" style={{ color: expireColor }}>
        {t("card.expire")} {expire.value}
        {expire.unit}
      </span>
      {children ? <span className="lc-foot-end">{children}</span> : null}
    </footer>
  );
}

/** 延迟摘要：多线路是「电信 28 · 联通 36 · 移动 85 ms」，单线路一个数。没配延迟就不显示。 */
function PingSummary({ model }: { model: ReadyModel }) {
  if (!model.showHomepagePing) return null;
  const lines = model.homepagePingLines;
  if (lines.length > 0) {
    return (
      <span className="lc-ping tabular">
        {lines.map((line, index) => (
          <span key={line.slot ?? index}>
            {shortLineName(line.taskName)}{" "}
            <b style={{ color: latencyHeatColor(line.lastValue) }}>
              {line.lastValue == null ? "—" : Math.round(line.lastValue)}
            </b>
          </span>
        ))}
        <small>ms</small>
      </span>
    );
  }
  const value = model.ping.lastValue;
  return (
    <span className="lc-ping tabular">
      <b style={{ color: model.latencyColor }}>{value == null ? "—" : Math.round(value)}</b>
      <small>ms</small>
    </span>
  );
}

function Ring({ value, label, color, text, size = 58 }: { value: number; label: string; color: string; text?: string; size?: number }) {
  const style = {
    "--lc-ring": `${clampPct(value)}%`,
    "--lc-ring-color": color,
    width: size,
    height: size,
  } as CSSProperties;
  const display = text ?? formatCompactPercent(value);
  return (
    <div className="lc-ring-item">
      <div className="lc-ring" style={style} role="img" aria-label={`${label} ${display}`}>
        <span className="tabular" style={{ color: levelTextColor(value) }}>
          {display}
        </span>
      </div>
      <span className="lc-label">{label}</span>
    </div>
  );
}

function Meter({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  return (
    <div className="lc-meter">
      <span className="lc-meter-head">
        <span className="lc-label">{label}</span>
        <b className="tabular" style={{ color: levelTextColor(value) }}>
          {text ?? formatCompactPercent(value)}
        </b>
      </span>
      <span className="lc-track" aria-hidden>
        <span style={{ width: `${clampPct(value)}%`, background: color }} />
      </span>
    </div>
  );
}

function TrafficLine({ model }: { model: ReadyModel }) {
  const { traffic } = model;
  return (
    <div className="lc-traffic" title={traffic.tooltip}>
      <span className="lc-label">{t("card.traffic")}</span>
      <span className="lc-track" aria-hidden>
        <span style={{ width: `${clampPct(traffic.fraction * 100)}%`, background: traffic.color }} />
      </span>
      <span className="lc-traffic-value tabular">{traffic.detail}</span>
    </div>
  );
}

/** 最近网速走势（上下行加起来），数据就是小卡片那排小点用的同一份。 */
function Spark({ model, width = 120, height = 40 }: { model: ReadyModel; width?: number; height?: number }) {
  const { trafficTrend } = model;
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

function SpeedPair({ model }: { model: ReadyModel }) {
  return (
    <span className="lc-speed-pair tabular">
      <span className="lc-up">↑</span> {model.upRate.value}
      <small>{model.upRate.unit}</small> <span className="lc-down">↓</span> {model.downRate.value}
      <small>{model.downRate.unit}</small>
    </span>
  );
}

function OfflineNote() {
  return <p className="lc-offline">{t("lc.offline")}</p>;
}

function LoadingCard({ kind }: { kind: string }) {
  return <article className={clsx("lc-card animate-pulse", `lc-card-${kind}`)} aria-busy />;
}

// ---------- 圆环卡 ----------

export const RingNodeCard = memo(function RingNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  if (!model.node) return <LoadingCard kind="ring" />;
  const { node } = model;
  return (
    <CardShell model={model} kind="ring">
      {model.isOffline ? (
        <OfflineNote />
      ) : (
        <div className="lc-ring-row">
          <Ring value={node.cpuPct} label="CPU" color="var(--progress-cpu)" />
          <Ring value={node.ramPct} label={t("metric.memory")} color="var(--progress-memory)" />
          <Ring value={node.diskPct} label={t("metric.disk")} color="var(--progress-disk)" />
          <div className="lc-ring-net">
            <span className="lc-label">{t("lc.netSpeed")}</span>
            <strong className="tabular">
              <span className="lc-down">↓</span>
              {model.downRate.value}
              <small>{model.downRate.unit}</small>
            </strong>
            <span className="tabular">
              <span className="lc-up">↑</span>
              {model.upRate.value}
              <small>{model.upRate.unit}</small>
            </span>
          </div>
        </div>
      )}
      <TrafficLine model={model} />
      <CardFoot model={model}>
        <PingSummary model={model} />
      </CardFoot>
    </CardShell>
  );
});

// ---------- 数据大卡 ----------

export const HeroNodeCard = memo(function HeroNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  if (!model.node) return <LoadingCard kind="hero" />;
  const { node } = model;
  const total = formatByteRate(node.netUp + node.netDown);
  return (
    <CardShell model={model} kind="hero">
      {model.isOffline ? (
        <OfflineNote />
      ) : (
        <>
          <div className="lc-hero-top">
            <div className="lc-hero-number">
              <span className="lc-label">{t("lc.netSpeed")}</span>
              <strong className="tabular">
                {total.value}
                <small>{total.unit}</small>
              </strong>
              <SpeedPair model={model} />
            </div>
            <Spark model={model} width={128} height={48} />
          </div>
          <div className="lc-meters">
            <Meter label="CPU" value={node.cpuPct} color="var(--progress-cpu)" />
            <Meter label={t("metric.memory")} value={node.ramPct} color="var(--progress-memory)" />
            <Meter label={t("metric.disk")} value={node.diskPct} color="var(--progress-disk)" />
          </div>
        </>
      )}
      <TrafficLine model={model} />
      <CardFoot model={model}>
        <PingSummary model={model} />
      </CardFoot>
    </CardShell>
  );
});

// ---------- 线路卡 ----------

function SingleLineRoute({ model }: { model: ReadyModel }) {
  const redrawKey = useRedrawKey();
  const { ping, pingBuckets, hasRealHomepagePingBinding, pingLoading, pingError } = model;
  const empty = pingEmptyLabels(hasRealHomepagePingBinding, pingLoading, pingError).text;
  return (
    <div className="lc-route-single">
      <span className="lc-label">{t("card.latency")}</span>
      <span className="lc-route-bars">
        <LatencyBars buckets={pingBuckets} redrawKey={redrawKey} height={22} />
      </span>
      <strong className="tabular" style={{ color: model.latencyColor }}>
        {ping.lastValue != null ? Math.round(ping.lastValue) : empty}
        {ping.lastValue != null ? <small>ms</small> : null}
      </strong>
      <span className="lc-route-loss tabular" style={{ color: lossHeatColor(ping.loss) }}>
        {t("card.loss")} {ping.loss != null ? `${ping.loss.toFixed(1)}%` : "—"}
      </span>
    </div>
  );
}

export const RouteNodeCard = memo(function RouteNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  if (!model.node) return <LoadingCard kind="route" />;
  const { node } = model;
  return (
    <CardShell model={model} kind="route">
      {!model.showHomepagePing ? (
        <p className="lc-offline">{t("card.pingUnsetTitle")}</p>
      ) : model.homepagePingLines.length > 0 ? (
        <MultiPingStatus uuid={uuid} lines={model.homepagePingLines} density="large" className="lc-route-ping" />
      ) : (
        <SingleLineRoute model={model} />
      )}
      <div className="lc-mini-metrics tabular">
        {model.isOffline ? (
          <span>{t("status.offline")}</span>
        ) : (
          <>
            <span>
              CPU <b style={{ color: levelTextColor(node.cpuPct) }}>{formatCompactPercent(node.cpuPct)}</b>
            </span>
            <span>
              {t("metric.memory")} <b style={{ color: levelTextColor(node.ramPct) }}>{formatCompactPercent(node.ramPct)}</b>
            </span>
            <span className="lc-foot-end">
              <SpeedPair model={model} />
            </span>
          </>
        )}
      </div>
      <CardFoot model={model} />
    </CardShell>
  );
});

// ---------- 便当盒 ----------

export const BentoNodeCard = memo(function BentoNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  if (!model.node) return <LoadingCard kind="bento" />;
  const { node, expire, expireColor, renewalPrice } = model;
  return (
    <CardShell model={model} kind="bento">
      {model.isOffline ? (
        <OfflineNote />
      ) : (
        <div className="lc-bento">
          <div className="lc-tile lc-tile-speed">
            <div className="lc-hero-number is-small">
              <span className="lc-label">{t("lc.netSpeed")}</span>
              <strong className="tabular">
                <span className="lc-down">↓</span>
                {model.downRate.value}
                <small>{model.downRate.unit}</small>
              </strong>
              <span className="tabular">
                <span className="lc-up">↑</span> {model.upRate.value}
                <small>{model.upRate.unit}</small>
              </span>
            </div>
            <Spark model={model} width={78} height={34} />
          </div>
          <div className="lc-tile lc-tile-cpu">
            <Ring value={node.cpuPct} label={`${t("metric.load")} ${node.load1.toFixed(2)}`} color="var(--progress-cpu)" size={62} />
          </div>
          <div className="lc-tile">
            <Meter label={t("metric.memory")} value={node.ramPct} color="var(--progress-memory)" />
          </div>
          <div className="lc-tile">
            <Meter label={t("metric.disk")} value={node.diskPct} color="var(--progress-disk)" />
          </div>
          <div className="lc-tile lc-tile-wide">
            <span className="lc-label">{t("card.latency")}</span>
            <PingSummary model={model} />
          </div>
          <div className="lc-tile">
            <span className="lc-label">{t("card.expire")}</span>
            <b className="lc-expire tabular" style={{ color: expireColor }}>
              {expire.value}
              {expire.unit}
            </b>
            {renewalPrice ? <span className="lc-price tabular">{renewalPrice}</span> : null}
          </div>
          <div className="lc-tile lc-tile-full">
            <TrafficLine model={model} />
          </div>
        </div>
      )}
      {model.subtitle ? (
        <footer className="lc-foot">
          <span className="lc-subtitle" title={model.subtitle}>
            {model.subtitle}
          </span>
        </footer>
      ) : null}
    </CardShell>
  );
});

// ---------- 健康分卡 ----------

export const HealthNodeCard = memo(function HealthNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  const now = useHourlyClock();
  if (!model.node) return <LoadingCard kind="health" />;
  const { node, traffic } = model;
  // 打码了价格，到期也不能拿来算（「6 天后到期」会把打码的内容说出来）。
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
    trafficFraction: traffic.fraction,
  });
  const toneColor = TONE_COLOR[health.tone];
  const scoreStyle = {
    "--lc-ring": `${health.score ?? 0}%`,
    "--lc-ring-color": toneColor,
  } as CSSProperties;
  const issues = health.issues.slice(0, 2);
  return (
    <CardShell model={model} kind="health">
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
      {!model.isOffline ? (
        <div className="lc-mini-metrics tabular">
          <span>CPU {formatCompactPercent(node.cpuPct)}</span>
          <span>
            {t("metric.memory")} {formatCompactPercent(node.ramPct)}
          </span>
          <span>
            {t("metric.disk")} {formatCompactPercent(node.diskPct)}
          </span>
          <span className="lc-foot-end">
            <span className="lc-down">↓</span> {model.downRate.value}
            <small>{model.downRate.unit}</small>
          </span>
        </div>
      ) : null}
      <CardFoot model={model}>
        <PingSummary model={model} />
      </CardFoot>
    </CardShell>
  );
});

// ---------- 仪表盘 ----------

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

function SideGauge({ value, label, color }: { value: number; label: string; color: string }) {
  const pct = clampPct(value);
  return (
    <div className="lc-side-gauge" role="img" aria-label={`${label} ${formatCompactPercent(value)}`}>
      <svg width="72" height="42" viewBox="0 0 72 42" aria-hidden>
        <path d="M6 38 A30 30 0 0 1 66 38" pathLength={100} className="lc-arc-track" />
        <path d="M6 38 A30 30 0 0 1 66 38" pathLength={100} className="lc-arc-fill" style={{ stroke: color, strokeDasharray: `${pct} 100` }} />
      </svg>
      <b className="tabular" style={{ color: levelTextColor(value) }}>
        {formatCompactPercent(value)}
      </b>
      <span className="lc-label">{label}</span>
    </div>
  );
}

export const GaugeNodeCard = memo(function GaugeNodeCard({ uuid }: { uuid: string }) {
  const model = useLayoutCardModel(uuid);
  if (!model.node) return <LoadingCard kind="gauge" />;
  const { node } = model;
  const totalBytes = node.netUp + node.netDown;
  // 表盘满格 = 最近一段时间的峰值（至少 128 KB/s），不然空闲的机器指针永远贴着 0。
  const peakBytes = Math.max(totalBytes, ...sumTrend(model.trafficTrend, 30), 128 * 1024);
  const fraction = peakBytes > 0 ? Math.min(1, totalBytes / peakBytes) : 0;
  const total = formatByteRate(totalBytes);
  const peak = formatByteRate(peakBytes);
  return (
    <CardShell model={model} kind="gauge">
      {model.isOffline ? (
        <OfflineNote />
      ) : (
        <div className="lc-gauges">
          <SideGauge value={node.cpuPct} label="CPU" color="var(--progress-cpu)" />
          <div className="lc-main-gauge" role="img" aria-label={`${t("lc.netSpeed")} ${total.value} ${total.unit}`}>
            <svg width="160" height="88" viewBox="0 0 160 88" aria-hidden>
              <path d="M14 82 A66 66 0 0 1 146 82" pathLength={100} className="lc-arc-track is-main" />
              <path
                d="M14 82 A66 66 0 0 1 146 82"
                pathLength={100}
                className="lc-arc-fill is-main"
                style={{ strokeDasharray: `${(fraction * 100).toFixed(1)} 100` }}
              />
              {GAUGE_TICKS.map((tick, index) => (
                <line key={index} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} className={clsx("lc-tick", tick.major && "is-major")} />
              ))}
            </svg>
            <strong className="tabular">{total.value}</strong>
            <span className="lc-label">
              {total.unit} · {t("lc.peak", { value: `${peak.value} ${peak.unit}` })}
            </span>
          </div>
          <SideGauge value={node.ramPct} label={t("metric.memory")} color="var(--progress-memory)" />
        </div>
      )}
      {!model.isOffline ? (
        <div className="lc-mini-metrics tabular">
          <SpeedPair model={model} />
          <span className="lc-foot-end">
            {t("metric.disk")} <b style={{ color: levelTextColor(node.diskPct) }}>{formatCompactPercent(node.diskPct)}</b>
          </span>
        </div>
      ) : null}
      <CardFoot model={model}>
        <PingSummary model={model} />
      </CardFoot>
    </CardShell>
  );
});
