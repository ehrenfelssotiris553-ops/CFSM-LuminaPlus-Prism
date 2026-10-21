import type { SkinId } from "@/utils/skin";
import type { NodeViewMode } from "@/utils/themeSettings";

/** 原来的四种卡片视图，和 Lumina Prism 新加的六种（弹出菜单、设置页分两组列出）。 */
export const CLASSIC_VIEW_MODES = ["large", "compact", "mini", "list"] as const satisfies readonly NodeViewMode[];
export const NEW_VIEW_MODES = ["ring", "hero", "route", "bento", "health", "gauge"] as const satisfies readonly NodeViewMode[];

/** 每种新布局的推荐风格；设置页「一键套用」同时换上布局和风格。风格和布局仍然可以随意混搭。 */
export const LAYOUT_PAIRS: readonly (readonly [NodeViewMode, SkinId])[] = [
  ["ring", "frost"],
  ["hero", "aurora"],
  ["route", "terminal"],
  ["bento", "lumina"],
  ["health", "paper"],
  ["gauge", "cockpit"],
];
