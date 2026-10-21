import type { SkinId } from "@/utils/skin";
import type { NodeViewMode } from "@/utils/themeSettings";

/** 原来的四种卡片视图，和 Lumina Prism 新加的六种（弹出菜单、设置页分两组列出）。 */
export const CLASSIC_VIEW_MODES = ["large", "compact", "mini", "list"] as const satisfies readonly NodeViewMode[];
export const NEW_VIEW_MODES = ["ring", "hero", "route", "bento", "health", "gauge"] as const satisfies readonly NodeViewMode[];
export type NewViewMode = (typeof NEW_VIEW_MODES)[number];

/** 每种新布局的推荐风格；设置页「一键套用」同时换上布局和风格。风格和布局仍然可以随意混搭。 */
export const LAYOUT_PAIRS: readonly (readonly [NodeViewMode, SkinId])[] = [
  ["ring", "frost"],
  ["hero", "aurora"],
  ["route", "terminal"],
  ["bento", "lumina"],
  ["health", "paper"],
  ["gauge", "cockpit"],
];

/**
 * 新布局的延迟画法，和布局分开选（设置「延迟样式」）：
 * 走势胶囊 / 对比条 / 柱状历史 / 信号方块 / 状态色条 / 示波器。每种都能看到近一段时间的走势。
 * 经典的四种布局有自己的延迟显示，不受这个设置影响。
 */
export const LATENCY_STYLES = ["capsule", "compare", "histo", "tiles", "status", "scope"] as const;
export type LatencyStyle = (typeof LATENCY_STYLES)[number];
/** 设置里存的值：auto = 每种布局用自己配的那种。 */
export type LatencyStyleSetting = "auto" | LatencyStyle;
/** 设置页、首页布局面板列出的顺序：跟随布局在最前。 */
export const LATENCY_STYLE_OPTIONS: readonly LatencyStyleSetting[] = ["auto", ...LATENCY_STYLES];

export const LATENCY_STYLE_BY_LAYOUT: Record<NewViewMode, LatencyStyle> = {
  ring: "capsule",
  hero: "compare",
  route: "histo",
  bento: "tiles",
  health: "status",
  gauge: "scope",
};

export function isNewViewMode(mode: NodeViewMode): mode is NewViewMode {
  return (NEW_VIEW_MODES as readonly NodeViewMode[]).includes(mode);
}

export function normalizeLatencyStyle(value: unknown): LatencyStyleSetting {
  return typeof value === "string" && (LATENCY_STYLES as readonly string[]).includes(value)
    ? (value as LatencyStyle)
    : "auto";
}

export function resolveLatencyStyle(setting: LatencyStyleSetting, mode: NewViewMode): LatencyStyle {
  return setting === "auto" ? LATENCY_STYLE_BY_LAYOUT[mode] : setting;
}
