import { t } from "@/i18n";
import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { shortLineName } from "@/services/cfsm/mappers";
import { latencyHeatColor } from "@/utils/metricTone";
import type { LatencyStyle } from "@/utils/layouts";
import type { HomepagePingDisplayLine, PingOverviewBucket, PingOverviewItem } from "@/types/cfsm";
import { LatencyBars } from "./LatencyBars";
import { PingLineSwitcher } from "./PingLineSwitcher";

/*
 * 六种新布局的延迟画法（设置「延迟样式」，见 utils/layouts）。每种都能看到最近一段时间的走势：
 *   capsule 走势胶囊：两列小胶囊，大数字配一条平滑走势线
 *   compare 对比条：条越短越快，浅色段是这段时间的波动范围，右边一条小走势线
 *   histo   柱状历史：高柱子（和经典卡片同一套柱子），另外写平均和抖动
 *   tiles   信号方块：每条线路一个方块，信号格越满越快，底下衬走势
 *   status  状态色条：绿黄红小格子，像服务状态页
 *   scope   示波器：红黄绿分区的走势窗，越往上越慢，右边箭头指着当前值
 * 只用 SVG 和 CSS（状态色条一条线路一个元素，靠渐变画格子），格数和经典卡片一样（HOMEPAGE_PING_BUCKET_COUNT）。
 */

export interface LatLine {
  key: string;
  name: string;
  /** 多线路时这一行在线路表里的位置，点线路名可以换线；单线路是 null。 */
  slot: number | null;
  value: number | null;
  loss: number | null;
  buckets: PingOverviewBucket[];
  pending: boolean;
}

export function toLatLines(
  multi: HomepagePingDisplayLine[],
  single: PingOverviewItem,
  singleBuckets: PingOverviewBucket[],
): LatLine[] {
  if (multi.length > 0) {
    return multi.map((line, index) => ({
      key: `${line.taskId}-${line.slot ?? index}`,
      name: shortLineName(line.taskName),
      slot: line.slot ?? null,
      value: line.lastValue,
      loss: line.loss,
      buckets: line.buckets,
      pending: line.loadState === "pending" && line.lastValue == null,
    }));
  }
  return [
    {
      key: "single",
      name: t("card.latency"),
      slot: null,
      value: single.lastValue,
      loss: single.loss,
      buckets: singleBuckets,
      pending: single.loadState === "pending" && single.lastValue == null,
    },
  ];
}

interface LineStats {
  min: number;
  max: number;
  avg: number;
  jitter: number;
  count: number;
}

function statsOf(buckets: PingOverviewBucket[]): LineStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  let jitterSum = 0;
  let jitterCount = 0;
  let previous: number | null = null;
  for (const bucket of buckets) {
    const value = bucket.value;
    if (value == null || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
    if (previous != null) {
      jitterSum += Math.abs(value - previous);
      jitterCount += 1;
    }
    previous = value;
  }
  return count === 0
    ? { min: 0, max: 0, avg: 0, jitter: 0, count: 0 }
    : { min, max, avg: sum / count, jitter: jitterCount ? jitterSum / jitterCount : 0, count };
}

/** 按格子画一条走势：x 平均分，y 由 scale 换算（0 在上）。没数据的格子跳过，前后连起来。 */
function tracePoints(buckets: PingOverviewBucket[], width: number, scale: (value: number) => number): string[] {
  const step = buckets.length > 1 ? width / (buckets.length - 1) : width;
  const points: string[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.value == null || !Number.isFinite(bucket.value)) return;
    points.push(`${(index * step).toFixed(1)},${scale(bucket.value).toFixed(1)}`);
  });
  return points;
}

function sparkPaths(buckets: PingOverviewBucket[], stats: LineStats, height = 24) {
  if (stats.count < 2) return null;
  const range = stats.max - stats.min || 1;
  const points = tracePoints(buckets, 100, (value) => height - 3 - ((value - stats.min) / range) * (height - 7));
  if (points.length < 2) return null;
  const first = points[0]!.split(",")[0];
  const last = points[points.length - 1]!.split(",")[0];
  return { line: points.join(" "), area: `M${first},${height} L${points.join(" L")} L${last},${height} Z` };
}

function msText(line: LatLine) {
  if (line.value == null) return line.pending ? "…" : "—";
  return String(Math.round(line.value));
}

function lossText(loss: number | null) {
  if (loss == null) return "—";
  return `${loss === 0 ? "0" : loss < 10 ? loss.toFixed(1) : Math.round(loss)}%`;
}

function lossColor(loss: number | null) {
  if (loss == null || loss <= 0) return "var(--text-tertiary)";
  return loss >= 2 ? "var(--status-error)" : "var(--status-warning)";
}

/** 线路名：多线路时点一下可以换这一行显示的线路（和经典卡片同一个菜单）。 */
function LineName({ uuid, line }: { uuid: string; line: LatLine }) {
  if (line.slot != null) {
    return (
      <span className="lc-lat-name is-switch">
        <PingLineSwitcher uuid={uuid} slot={line.slot} taskName={line.name} />
      </span>
    );
  }
  return (
    <span className="lc-lat-name" title={line.name}>
      {line.name}
    </span>
  );
}

function Ms({ line, className = "lc-ms" }: { line: LatLine; className?: string }) {
  return (
    <b className={`${className} tabular`} style={{ "--lat": latencyHeatColor(line.value) } as CSSProperties}>
      {msText(line)}
      {line.value != null ? <small>ms</small> : null}
    </b>
  );
}

function Spark({ line, stats, className }: { line: LatLine; stats: LineStats; className: string }) {
  const paths = useMemo(() => sparkPaths(line.buckets, stats), [line.buckets, stats]);
  const color = latencyHeatColor(line.value);
  return (
    <svg className={className} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden style={{ "--lat": color } as CSSProperties}>
      {paths ? (
        <>
          <path d={paths.area} className="lc-spark-fill" />
          <polyline points={paths.line} className="lc-spark-stroke" />
        </>
      ) : (
        <line x1="0" y1="20" x2="100" y2="20" className="lc-spark-empty" />
      )}
    </svg>
  );
}

const HINT_KEYS: Record<LatencyStyle, string> = {
  capsule: "lat.hint.capsule",
  compare: "lat.hint.compare",
  histo: "lat.hint.histo",
  tiles: "lat.hint.tiles",
  status: "",
  scope: "lat.hint.scope",
};

function Head({ count, style, extra }: { count: number; style: LatencyStyle; extra?: ReactNode }) {
  const hint = HINT_KEYS[style];
  return (
    <div className="lc-lat-head">
      <span className="lc-lat-title">{count > 1 ? t("lat.title", { n: count }) : t("card.latency")}</span>
      {extra ?? (hint ? <span className="lc-lat-hint">{t(hint as Parameters<typeof t>[0])}</span> : null)}
    </div>
  );
}

// ---------- 六种画法 ----------

function Capsules({ uuid, lines, stats }: StyleProps) {
  return (
    <div className="lc-lat-capsules">
      {lines.map((line, index) => (
        <div key={line.key} className="lc-lat-capsule">
          <span className="lc-lat-row">
            <LineName uuid={uuid} line={line} />
            <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
              {lossText(line.loss)}
            </span>
          </span>
          <span className="lc-lat-row is-bottom">
            <Ms line={line} />
            <Spark line={line} stats={stats[index]!} className="lc-lat-spark" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Compare({ uuid, lines, stats }: StyleProps) {
  const scaleMax = Math.max(150, ...lines.map((line) => line.value ?? 0)) * 1.15;
  return (
    <div className="lc-lat-rows is-compare">
      {lines.map((line, index) => {
        const s = stats[index]!;
        const color = latencyHeatColor(line.value);
        const fill = line.value == null ? 0 : Math.min(100, (line.value / scaleMax) * 100);
        const bandLeft = s.count ? (s.min / scaleMax) * 100 : 0;
        const bandWidth = s.count ? Math.max(2, ((s.max - s.min) / scaleMax) * 100) : 0;
        return (
          <div key={line.key} className="lc-lat-compare">
            <LineName uuid={uuid} line={line} />
            <span className="lc-cmp-track" style={{ "--lat": color } as CSSProperties} aria-hidden>
              {s.count ? <span className="lc-cmp-band" style={{ left: `${bandLeft}%`, width: `${Math.min(100 - bandLeft, bandWidth)}%` }} /> : null}
              <span className="lc-cmp-fill" style={{ width: `${fill}%` }} />
            </span>
            <Spark line={line} stats={s} className="lc-cmp-spark" />
            <span className="lc-cmp-num">
              <Ms line={line} />
              <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
                {t("lat.lossShort", { v: lossText(line.loss) })}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Histo({ uuid, lines, stats, redrawKey }: StyleProps) {
  return (
    <div className="lc-lat-histo">
      {lines.map((line, index) => {
        const s = stats[index]!;
        return (
          <div key={line.key} className="lc-histo-line">
            <span className="lc-lat-row">
              <LineName uuid={uuid} line={line} />
              <span className="lc-lat-stat tabular">
                {s.count ? t("lat.avgJitter", { avg: Math.round(s.avg), jitter: Math.round(s.jitter) }) : t("lat.noData")}
              </span>
              <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
                {t("lat.loss", { v: lossText(line.loss) })}
              </span>
              <Ms line={line} className="lc-ms is-big" />
            </span>
            <span className="lc-histo-bars">
              <LatencyBars buckets={line.buckets} redrawKey={redrawKey} height={22} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SIGNAL_HEIGHTS = [4, 6.5, 9, 11.5];

function signalBars(value: number | null) {
  if (value == null) return 0;
  return value < 60 ? 4 : value < 100 ? 3 : value < 160 ? 2 : 1;
}

function Tiles({ uuid, lines, stats }: StyleProps) {
  const rest = lines.length % 3;
  return (
    <div className="lc-lat-tiles">
      {lines.map((line, index) => {
        const lit = signalBars(line.value);
        const span = index === lines.length - 1 && rest ? 4 - rest : 1;
        return (
          <div key={line.key} className="lc-lat-tile" style={span > 1 ? { gridColumn: `span ${span}` } : undefined}>
            <Spark line={line} stats={stats[index]!} className="lc-tile-spark" />
            <span className="lc-lat-row">
              <LineName uuid={uuid} line={line} />
              <span className="lc-signal" style={{ "--lat": latencyHeatColor(line.value) } as CSSProperties} aria-hidden>
                {SIGNAL_HEIGHTS.map((height, bar) => (
                  <i key={bar} style={{ height }} data-on={bar < lit ? "" : undefined} />
                ))}
              </span>
            </span>
            <Ms line={line} className="lc-ms is-big" />
            <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
              {t("lat.loss", { v: lossText(line.loss) })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function tickColor(bucket: PingOverviewBucket) {
  if (bucket.offline) return "var(--status-error)";
  if (bucket.value == null) return "var(--progress-bg)";
  if ((bucket.loss ?? 0) >= 2 || bucket.value >= 200) return "var(--status-error)";
  if (bucket.value >= 100) return "var(--status-warning)";
  return "var(--status-success)";
}

/** 一条线路一个元素：每格一段硬边渐变，格子之间的缝靠 mask 切出来。 */
function statusBackground(buckets: PingOverviewBucket[]) {
  const n = buckets.length || 1;
  return `linear-gradient(90deg, ${buckets
    .map((bucket, index) => `${tickColor(bucket)} ${((index / n) * 100).toFixed(2)}% ${(((index + 1) / n) * 100).toFixed(2)}%`)
    .join(", ")})`;
}

function Status({ uuid, lines }: StyleProps) {
  return (
    <div className="lc-lat-rows is-status">
      {lines.map((line) => (
        <div key={line.key} className="lc-lat-status">
          <LineName uuid={uuid} line={line} />
          <span
            className="lc-status-strip"
            style={{ background: statusBackground(line.buckets), "--n": line.buckets.length || 1 } as CSSProperties}
            aria-hidden
          />
          <Ms line={line} />
          <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
            {lossText(line.loss)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 示波器的纵轴：0–200ms 开平方，低延迟也看得出起伏；200 以上贴顶。 */
function scopeY(value: number) {
  return 29 - Math.sqrt(Math.min(Math.max(value, 0), 200) / 200) * 27;
}
const SCOPE_ZONES = [
  { y: 0, h: scopeY(160), tone: "var(--status-error)" },
  { y: scopeY(160), h: scopeY(60) - scopeY(160), tone: "var(--status-warning)" },
  { y: scopeY(60), h: 30 - scopeY(60), tone: "var(--status-success)" },
];

function Scope({ uuid, lines }: StyleProps) {
  return (
    <div className="lc-lat-rows is-scope">
      {lines.map((line) => {
        const points = tracePoints(line.buckets, 100, scopeY);
        const color = latencyHeatColor(line.value);
        return (
          <div key={line.key} className="lc-lat-scope">
            <LineName uuid={uuid} line={line} />
            <span className="lc-scope-box" style={{ "--lat": color } as CSSProperties}>
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
                {SCOPE_ZONES.map((zone) => (
                  <rect key={zone.tone} x="0" y={zone.y} width="100" height={zone.h} style={{ fill: zone.tone }} className="lc-scope-zone" />
                ))}
                <line x1="25" y1="0" x2="25" y2="30" className="lc-scope-grid" />
                <line x1="50" y1="0" x2="50" y2="30" className="lc-scope-grid" />
                <line x1="75" y1="0" x2="75" y2="30" className="lc-scope-grid" />
                {points.length > 1 ? <polyline points={points.join(" ")} className="lc-scope-trace" /> : null}
              </svg>
              {line.value != null ? <i className="lc-scope-pointer" style={{ top: `${((scopeY(line.value) / 30) * 100).toFixed(1)}%` }} /> : null}
            </span>
            <span className="lc-scope-read">
              <Ms line={line} />
              <span className="lc-loss tabular" style={{ color: lossColor(line.loss) }}>
                <i className="lc-led" style={{ background: line.loss == null ? "var(--progress-bg)" : line.loss > 0 ? lossColor(line.loss) : "var(--status-success)" }} />
                {lossText(line.loss)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface StyleProps {
  uuid: string;
  lines: LatLine[];
  stats: LineStats[];
  redrawKey: string;
}

const RENDERERS: Record<LatencyStyle, (props: StyleProps) => ReactNode> = {
  capsule: Capsules,
  compare: Compare,
  histo: Histo,
  tiles: Tiles,
  status: Status,
  scope: Scope,
};

/** 新布局里的延迟一块：按设置选一种画法。 */
export const LatencyBlock = memo(function LatencyBlock({
  uuid,
  lines,
  style,
  redrawKey,
}: {
  uuid: string;
  lines: LatLine[];
  style: LatencyStyle;
  redrawKey: string;
}) {
  const stats = useMemo(() => lines.map((line) => statsOf(line.buckets)), [lines]);
  const Renderer = RENDERERS[style];
  const legend =
    style === "status" ? (
      <span className="lc-lat-legend">
        <span data-tone="good">{t("lat.legend.good")}</span>
        <span data-tone="warn">{t("lat.legend.warn")}</span>
        <span data-tone="bad">{t("lat.legend.bad")}</span>
      </span>
    ) : undefined;
  return (
    <section className={`lc-lat is-${style}`} aria-label={t("card.latency")}>
      <Head count={lines.length} style={style} extra={legend} />
      <Renderer uuid={uuid} lines={lines} stats={stats} redrawKey={redrawKey} />
    </section>
  );
});
