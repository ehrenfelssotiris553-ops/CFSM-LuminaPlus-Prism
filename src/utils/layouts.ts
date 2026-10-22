import type { SkinId } from "@/utils/skin";
import type { NodeViewMode, NodeViewModeSetting } from "@/utils/themeSettings";

/** 原来的四种卡片视图，和 Lumina Prism 新加的六种（弹出菜单、设置页分两组列出）。 */
export const CLASSIC_VIEW_MODES = ["large", "compact", "mini", "list"] as const satisfies readonly NodeViewMode[];
export const NEW_VIEW_MODES = ["ring", "hero", "route", "bento", "health", "gauge"] as const satisfies readonly NodeViewMode[];
export type NewViewMode = (typeof NEW_VIEW_MODES)[number];

/**
 * 布局选「跟随风格」时每个风格配的布局。流光是原版风格，配原版布局（电脑大卡片、手机小卡片），
 * 所以风格选流光、布局跟随时就是原来主题的样子；其它六个风格各配一种新布局。
 */
const SKIN_LAYOUT: Record<SkinId, NewViewMode | null> = {
  lumina: null,
  paper: "health",
  frost: "ring",
  terminal: "route",
  aurora: "hero",
  cockpit: "gauge",
  collage: "bento",
};

export function followLayout(skin: SkinId, device: "desktop" | "mobile"): NodeViewMode {
  return SKIN_LAYOUT[skin] ?? (device === "mobile" ? "compact" : "large");
}

/** 布局设置（可能是「跟随风格」）→ 这台设备实际用的布局。 */
export function resolveNodeViewMode(setting: NodeViewModeSetting, skin: SkinId, device: "desktop" | "mobile"): NodeViewMode {
  return setting === "follow" ? followLayout(skin, device) : setting;
}

/**
 * 站长区 CF 用量的画法（设置「站长用量」），和风格分开选；颜色仍然跟着风格。
 * auto = 跟随风格：雾玻璃小圆环、终端字符格、座舱电平表，其它风格横条。
 */
export const CF_USAGE_STYLES = ["bars", "rings", "chars", "meters"] as const;
export type CfUsageStyle = (typeof CF_USAGE_STYLES)[number];
export type CfUsageStyleSetting = "auto" | CfUsageStyle;
export const CF_USAGE_STYLE_OPTIONS: readonly CfUsageStyleSetting[] = ["auto", ...CF_USAGE_STYLES];

const SKIN_CF_USAGE: Partial<Record<SkinId, CfUsageStyle>> = { frost: "rings", terminal: "chars", cockpit: "meters" };

export function normalizeCfUsageStyle(value: unknown): CfUsageStyleSetting {
  return typeof value === "string" && (CF_USAGE_STYLES as readonly string[]).includes(value) ? (value as CfUsageStyle) : "auto";
}

export function resolveCfUsageStyle(setting: CfUsageStyleSetting, skin: SkinId): CfUsageStyle {
  return setting === "auto" ? (SKIN_CF_USAGE[skin] ?? "bars") : setting;
}

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
