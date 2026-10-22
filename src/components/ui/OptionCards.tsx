import type { CSSProperties, ReactNode } from "react";
import type { CfUsageStyleSetting, LatencyStyle, LatencyStyleSetting } from "@/utils/layouts";
import type { SkinId } from "@/utils/skin";
import type { NodeViewMode } from "@/utils/themeSettings";

/*
 * 首页快捷栏的弹出面板（布局、延迟样式、风格）和设置页用的同一套选项卡片：左边一张小预览图，右边名字和一行说明，
 * 选中的那张蓝框加右上角的勾。两边长得一样，看得出改的是同一个设置。
 * 预览图直接画（SVG / 几个色块），不从 lucide 引图标，避免首页多拆出一个文件（原因见 OwnerStrip 顶部）。
 */

/** 风格卡片上的小预览（画布 / 卡片 / 一根强调色条 / 一根细线），颜色取自各风格的代表色。 */
export const SKIN_PREVIEW: Record<SkinId, { bg: string; card: string; border: string; text: string; bar1: string; bar2: string; radius: number; barRadius: number }> = {
  lumina: { bg: "#f4f4f5", card: "#ffffff", border: "rgba(24,24,27,0.08)", text: "#18181b", bar1: "#3b82f6", bar2: "#8b5cf6", radius: 8, barRadius: 999 },
  paper: { bg: "#f5f2ea", card: "#fbf9f4", border: "#2b2a26", text: "#1c1b18", bar1: "#2b2a26", bar2: "#b8441a", radius: 0, barRadius: 0 },
  frost: {
    bg: "radial-gradient(70% 70% at 15% 10%, #ffd8c6 0%, rgba(255,216,198,0) 70%), radial-gradient(70% 70% at 90% 40%, #d9d4ff 0%, rgba(217,212,255,0) 70%), #eef0f6",
    card: "rgba(255,255,255,0.6)",
    border: "rgba(255,255,255,0.9)",
    text: "#1b2133",
    bar1: "#5b5bf0",
    bar2: "#a35bf0",
    radius: 11,
    barRadius: 999,
  },
  terminal: {
    bg: "#0a0d0b",
    card: "#0e1310",
    border: "#1f3a28",
    text: "#d4e4d8",
    bar1: "repeating-linear-gradient(90deg, #4ade80 0 4px, transparent 4px 6px)",
    bar2: "repeating-linear-gradient(90deg, #22d3ee 0 4px, transparent 4px 6px)",
    radius: 1,
    barRadius: 0,
  },
  aurora: {
    bg: "radial-gradient(120% 60% at 50% -10%, rgba(45,212,191,0.45) 0%, rgba(139,92,246,0.35) 40%, rgba(139,92,246,0) 75%), #07070d",
    card: "rgba(255,255,255,0.07)",
    border: "rgba(255,255,255,0.14)",
    text: "#f3f3f8",
    bar1: "#a78bfa",
    bar2: "#22d3ee",
    radius: 9,
    barRadius: 999,
  },
  cockpit: {
    bg: "radial-gradient(90% 60% at 50% 0%, rgba(255,176,32,0.22) 0%, rgba(255,176,32,0) 70%), #0a0a0b",
    card: "#141416",
    border: "rgba(255,176,32,0.3)",
    text: "#f3efe7",
    bar1: "#ffb020",
    bar2: "#ff8a3d",
    radius: 6,
    barRadius: 999,
  },
  collage: { bg: "#f3f1ec", card: "#ffffff", border: "rgba(31,35,40,0.08)", text: "#1f2328", bar1: "#2563c9", bar2: "#0f7a51", radius: 12, barRadius: 999 },
};

/** 拼贴的预览是四块不同颜色的小格子（天蓝、薄荷、杏、樱粉）。 */
const COLLAGE_TILES = ["#cfe2ff", "#c8eedb", "#ffdcb8", "#fbcfdc"];

export function SkinThumb({ skin, accent }: { skin: SkinId; accent?: string }) {
  const p = SKIN_PREVIEW[skin];
  if (skin === "collage") {
    return (
      <span className="opt-thumb is-skin" style={{ background: p.bg }} aria-hidden>
        <span className="opt-collage">
          {COLLAGE_TILES.map((color) => (
            <span key={color} style={{ background: color }} />
          ))}
        </span>
      </span>
    );
  }
  return (
    <span className="opt-thumb is-skin" style={{ background: p.bg }} aria-hidden>
      <span className="opt-skin-card" style={{ background: p.card, borderColor: p.border, borderRadius: Math.min(p.radius, 5) }}>
        <span style={{ background: accent || p.bar1, borderRadius: p.barRadius }} />
        <span style={{ background: p.text, opacity: 0.25 }} />
      </span>
    </span>
  );
}

const O = { fill: "currentColor" } as const;
const SOFT = { fill: "currentColor", fillOpacity: 0.16 } as const;
const MID = { fill: "currentColor", fillOpacity: 0.5 } as const;
const LINE = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** 十种布局的小示意图（40×30）。 */
const LAYOUT_GLYPHS: Record<NodeViewMode, ReactNode> = {
  large: (
    <>
      <rect x="4" y="4" width="32" height="22" rx="3.5" {...SOFT} />
      <rect x="8" y="8" width="13" height="3.5" rx="1.75" {...O} />
      <rect x="8" y="14.5" width="24" height="2.5" rx="1.25" {...MID} />
      <rect x="8" y="19.5" width="17" height="2.5" rx="1.25" {...MID} />
    </>
  ),
  compact: (
    <>
      <rect x="4" y="5" width="15" height="20" rx="3" {...SOFT} />
      <rect x="21" y="5" width="15" height="20" rx="3" {...SOFT} />
      <rect x="7" y="9" width="8" height="3" rx="1.5" {...O} />
      <rect x="24" y="9" width="8" height="3" rx="1.5" {...O} />
      <rect x="7" y="15" width="9" height="2" rx="1" {...MID} />
      <rect x="24" y="15" width="9" height="2" rx="1" {...MID} />
      <rect x="7" y="19" width="6" height="2" rx="1" {...MID} />
      <rect x="24" y="19" width="6" height="2" rx="1" {...MID} />
    </>
  ),
  mini: (
    <>
      {[4, 15.25, 26.5].flatMap((x) =>
        [5, 16].map((y) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="9.5" height="9" rx="2" fill="currentColor" fillOpacity={0.22} />
            <rect x={x + 2} y={y + 3} width="5" height="2" rx="1" {...O} />
          </g>
        )),
      )}
    </>
  ),
  list: (
    <>
      {[7, 13, 19].map((y, index) => (
        <g key={y}>
          <circle cx="7" cy={y} r="2" {...O} />
          <rect x="11" y={y - 1} width={[25, 20, 23][index]} height="2.5" rx="1.25" {...MID} />
        </g>
      ))}
      <circle cx="7" cy="25" r="2" fill="currentColor" fillOpacity={0.45} />
      <rect x="11" y="24" width="16" height="2.5" rx="1.25" fill="currentColor" fillOpacity={0.3} />
    </>
  ),
  ring: (
    <>
      <circle cx="13" cy="15" r="8" {...LINE} strokeOpacity={0.2} strokeWidth={3.5} />
      <circle cx="13" cy="15" r="8" {...LINE} strokeWidth={3.5} strokeDasharray="33 60" transform="rotate(-90 13 15)" />
      <rect x="25" y="9" width="11" height="3" rx="1.5" {...O} />
      <rect x="25" y="15" width="9" height="2.5" rx="1.25" {...MID} />
      <rect x="25" y="20" width="7" height="2.5" rx="1.25" {...MID} />
    </>
  ),
  hero: (
    <>
      <rect x="4" y="5" width="6" height="12" rx="1.5" {...O} />
      <rect x="12" y="5" width="6" height="12" rx="1.5" {...O} />
      <rect x="20" y="12" width="5" height="5" rx="1.2" {...MID} />
      <polyline points="4,25 11,22 17,24 24,19 30,21 36,15" {...LINE} strokeOpacity={0.6} strokeWidth={2} />
    </>
  ),
  route: (
    <>
      {[7, 13, 19, 25].map((y, index) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1.8" {...O} />
          <rect x="10" y={y - 1.2} width={[26, 19, 23, 13][index]} height="2.6" rx="1.3" fill="currentColor" fillOpacity={[1, 0.7, 0.5, 0.35][index]} />
        </g>
      ))}
    </>
  ),
  bento: (
    <>
      <rect x="4" y="4" width="16" height="22" rx="3" fill="currentColor" fillOpacity={0.35} />
      <rect x="22" y="4" width="14" height="10" rx="3" fill="currentColor" fillOpacity={0.2} />
      <rect x="22" y="16" width="6" height="10" rx="2.5" fill="currentColor" fillOpacity={0.2} />
      <rect x="30" y="16" width="6" height="10" rx="2.5" fill="currentColor" fillOpacity={0.2} />
      <rect x="7" y="8" width="8" height="3" rx="1.5" {...O} />
    </>
  ),
  health: (
    <>
      <circle cx="12" cy="15" r="8.5" fill="currentColor" fillOpacity={0.18} />
      <circle cx="12" cy="15" r="8.5" {...LINE} strokeWidth={2.5} />
      <path d="M8.5 15.2l2.4 2.4 4.6-5" {...LINE} strokeWidth={2.2} />
      <rect x="24" y="9" width="12" height="3" rx="1.5" {...O} />
      <rect x="24" y="15" width="9" height="2.5" rx="1.25" {...MID} />
      <rect x="24" y="20" width="11" height="2.5" rx="1.25" {...MID} />
    </>
  ),
  gauge: (
    <>
      <path d="M7 23a13 13 0 0 1 26 0" {...LINE} strokeOpacity={0.2} strokeWidth={3.5} />
      <path d="M7 23a13 13 0 0 1 17.5-12.2" {...LINE} strokeWidth={3.5} />
      <line x1="20" y1="23" x2="26.5" y2="14" {...LINE} strokeWidth={2} />
      <circle cx="20" cy="23" r="2.2" {...O} />
    </>
  ),
};

/** 延迟样式的小示意图（40×30）；auto 是「布局里带一条走势」。 */
const LATENCY_GLYPHS: Record<LatencyStyleSetting, ReactNode> = {
  auto: (
    <>
      <rect x="4" y="4" width="32" height="22" rx="3.5" {...LINE} strokeOpacity={0.45} strokeWidth={1.6} />
      <path d="M9 19 L14 13 L19 16 L25 9 L31 12" {...LINE} strokeWidth={2} />
    </>
  ),
  capsule: (
    <>
      <rect x="3" y="5" width="16" height="20" rx="4.5" {...SOFT} />
      <rect x="21" y="5" width="16" height="20" rx="4.5" {...SOFT} />
      <rect x="6" y="8.5" width="8" height="2.5" rx="1.25" {...O} />
      <rect x="24" y="8.5" width="8" height="2.5" rx="1.25" {...O} />
      <polyline points="6,20 9,16 12,18 16,13" {...LINE} strokeWidth={1.6} />
      <polyline points="24,17 27,19 30,14 34,16" {...LINE} strokeWidth={1.6} />
    </>
  ),
  compare: (
    <>
      {[6, 13, 20].map((y, index) => (
        <g key={y}>
          <rect x="4" y={y} width="32" height="4" rx="2" {...SOFT} />
          <rect x="4" y={y} width={[11, 24, 17][index]} height="4" rx="2" fill="currentColor" fillOpacity={[1, 0.75, 0.85][index]} />
        </g>
      ))}
    </>
  ),
  histo: (
    <>
      {[14, 10, 16, 7, 12, 17, 11].map((y, index) => (
        <rect key={index} x={4 + index * 4.5} y={y} width="3" height={26 - y} rx="0.8" fill="currentColor" fillOpacity={index === 3 ? 1 : 0.6} />
      ))}
    </>
  ),
  tiles: (
    <>
      {[3, 14.75, 26.5].map((x, tile) => (
        <g key={x}>
          <rect x={x} y="5" width="10.5" height="20" rx="2.5" {...SOFT} />
          {[0, 1, 2].map((bar) => (
            <rect key={bar} x={x + 2.5 + bar * 2.1} y={17 - bar * 2} width="1.6" height={3 + bar * 2} fill="currentColor" fillOpacity={bar < 3 - tile ? 1 : 0.3} />
          ))}
        </g>
      ))}
    </>
  ),
  status: (
    <>
      {[7, 17].flatMap((y, row) =>
        Array.from({ length: 9 }, (_, index) => (
          <rect key={`${row}-${index}`} x={4 + index * 3.4} y={y} width="2.4" height="6" rx="0.6" fill="currentColor" fillOpacity={(row === 0 && index === 3) || (row === 1 && (index === 5 || index === 6)) ? 0.35 : 1} />
        )),
      )}
    </>
  ),
  scope: (
    <>
      <rect x="3" y="4" width="32" height="22" rx="3" fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.4} />
      <line x1="13.7" y1="4" x2="13.7" y2="26" stroke="currentColor" strokeOpacity={0.22} />
      <line x1="24.3" y1="4" x2="24.3" y2="26" stroke="currentColor" strokeOpacity={0.22} />
      <polyline points="5,20 9,18 13,21 17,14 21,16 25,10 29,13 33,11" {...LINE} strokeWidth={1.8} />
      <path d="M36.5 11 l3 -2.5 v5z" {...O} />
    </>
  ),
};

/** 「跟随风格」：左边调色盘，箭头指向右边的卡片。 */
const FOLLOW_GLYPH = (
  <>
    <circle cx="11" cy="15" r="7.5" fill="currentColor" fillOpacity={0.18} />
    <circle cx="8.5" cy="12.5" r="1.6" {...O} />
    <circle cx="13.5" cy="11.5" r="1.6" {...O} />
    <circle cx="10" cy="17.8" r="1.6" fill="currentColor" fillOpacity={0.55} />
    <path d="M20.5 15h5.5m-2.3-2.6l2.6 2.6-2.6 2.6" {...LINE} strokeWidth={1.8} />
    <rect x="28.5" y="7" width="8.5" height="16" rx="2.2" fill="currentColor" fillOpacity={0.35} />
  </>
);

/** 站长用量的四种画法（40×30）；auto 和布局的「跟随风格」同一个图。 */
const CF_USAGE_GLYPHS: Record<CfUsageStyleSetting, ReactNode> = {
  auto: FOLLOW_GLYPH,
  bars: (
    <>
      {[8, 14, 20].map((y, index) => (
        <g key={y}>
          <rect x="5" y={y} width="30" height="3.5" rx="1.75" {...SOFT} />
          <rect x="5" y={y} width={[12, 22, 5][index]} height="3.5" rx="1.75" {...O} />
        </g>
      ))}
    </>
  ),
  rings: (
    <>
      {[12, 28].map((cx, index) => (
        <g key={cx}>
          <circle cx={cx} cy="15" r="6.5" {...LINE} strokeOpacity={0.2} strokeWidth={3} />
          <circle cx={cx} cy="15" r="6.5" {...LINE} strokeWidth={3} strokeDasharray={index ? "26 60" : "8 60"} transform={`rotate(-90 ${cx} 15)`} />
        </g>
      ))}
    </>
  ),
  chars: (
    <>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <rect key={index} x={4 + index * 5.4} y="12" width="4.2" height="6" fill="currentColor" fillOpacity={index < 2 ? 1 : 0.2} />
      ))}
    </>
  ),
  meters: (
    <>
      {[0, 1, 2, 3].map((column) =>
        [0, 1, 2, 3, 4].map((row) => (
          <rect key={`${column}-${row}`} x={7 + column * 7.5} y={22 - row * 4} width="5" height="3" rx="0.6" fill="currentColor" fillOpacity={row < [2, 4, 1, 3][column] ? 1 : 0.18} />
        )),
      )}
    </>
  ),
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="opt-thumb" aria-hidden>
      <svg width="38" height="28" viewBox="0 0 40 30">
        {children}
      </svg>
    </span>
  );
}

export function LayoutThumb({ mode }: { mode: NodeViewMode }) {
  return <Glyph>{LAYOUT_GLYPHS[mode]}</Glyph>;
}

export function LatencyThumb({ style }: { style: LatencyStyleSetting | LatencyStyle }) {
  return <Glyph>{LATENCY_GLYPHS[style]}</Glyph>;
}

export function FollowThumb() {
  return <Glyph>{FOLLOW_GLYPH}</Glyph>;
}

export function CfUsageThumb({ style }: { style: CfUsageStyleSetting }) {
  return <Glyph>{CF_USAGE_GLYPHS[style]}</Glyph>;
}

/**
 * 一张选项卡片：预览图 + 名字 + 一行说明，选中的蓝框打勾。
 * following：选的是「跟随」，这一项是跟出来的那一个 —— 虚线框，说明写「跟随中」。
 */
export function OptionCard({
  thumb,
  name,
  sub,
  active,
  following = false,
  onPick,
  role = "radio",
  style,
}: {
  thumb: ReactNode;
  name: string;
  sub?: string;
  active: boolean;
  following?: boolean;
  onPick: () => void;
  role?: "radio" | "menuitemradio";
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={active}
      className="opt-card"
      data-following={following ? "" : undefined}
      style={style}
      onClick={onPick}
    >
      {thumb}
      <span className="opt-text">
        <span className="opt-name">{name}</span>
        {sub ? <span className="opt-sub">{sub}</span> : null}
      </span>
      {active ? (
        <span className="opt-check" aria-hidden>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      ) : null}
    </button>
  );
}
