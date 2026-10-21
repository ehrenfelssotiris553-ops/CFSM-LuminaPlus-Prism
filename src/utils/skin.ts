/**
 * 配色风格（设置 → 外观 → 风格）。样式在 styles/skins.css，这里只决定 <html> 上挂哪些属性。
 *
 * 风格和卡片视图（大卡 / 小卡 / 迷你 / 列表）互不相关，可以任意搭配。
 * 「流光」是原版，<html> 上什么都不挂；主色、圆角、疏密、数字字体留空时跟随所选风格。
 * 和其它主题设置一样：站长的选择同步到后端成为全站默认，访客改了只留在自己的浏览器。
 */

export const SKIN_IDS = ["lumina", "paper", "frost", "terminal", "aurora", "cockpit"] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export const SKIN_RADII = ["auto", "none", "sm", "md", "lg"] as const;
export type SkinRadius = (typeof SKIN_RADII)[number];

export const SKIN_DENSITIES = ["loose", "std", "tight"] as const;
export type SkinDensity = (typeof SKIN_DENSITIES)[number];

export const SKIN_NUMERIC_FONTS = ["auto", "mono"] as const;
export type SkinNumericFont = (typeof SKIN_NUMERIC_FONTS)[number];

/** 设置页给的主色；留空（""）表示用风格自带的强调色。 */
export const SKIN_ACCENTS = [
  "#3b82f6",
  "#5b5bf0",
  "#8b5cf6",
  "#db2777",
  "#c2410c",
  "#b45309",
  "#059669",
  "#0e7490",
] as const;

export interface SkinStyle {
  skin: SkinId;
  /** "" = 跟随风格；否则是 #rrggbb。 */
  accent: string;
  radius: SkinRadius;
  density: SkinDensity;
  numericFont: SkinNumericFont;
}

export const DEFAULT_SKIN_STYLE: SkinStyle = {
  skin: "lumina",
  accent: "",
  radius: "auto",
  density: "std",
  numericFont: "auto",
};

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeSkinId(value: unknown): SkinId {
  return oneOf(SKIN_IDS, value, DEFAULT_SKIN_STYLE.skin);
}

export function normalizeSkinRadius(value: unknown): SkinRadius {
  return oneOf(SKIN_RADII, value, DEFAULT_SKIN_STYLE.radius);
}

export function normalizeSkinDensity(value: unknown): SkinDensity {
  return oneOf(SKIN_DENSITIES, value, DEFAULT_SKIN_STYLE.density);
}

export function normalizeSkinNumericFont(value: unknown): SkinNumericFont {
  return oneOf(SKIN_NUMERIC_FONTS, value, DEFAULT_SKIN_STYLE.numericFont);
}

/** 只认 #rrggbb：这个值会原样写进 CSS 变量，其它写法一律当作「跟随风格」。 */
export function normalizeSkinAccent(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
}

export function normalizeSkinStyle(value: unknown): SkinStyle {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    skin: normalizeSkinId(raw.skin),
    accent: normalizeSkinAccent(raw.accent),
    radius: normalizeSkinRadius(raw.radius),
    density: normalizeSkinDensity(raw.density),
    numericFont: normalizeSkinNumericFont(raw.numericFont),
  };
}

/** 「我的风格」：没存过是 null。 */
export function normalizeMySkin(value: unknown): SkinStyle | null {
  return value && typeof value === "object" && !Array.isArray(value) ? normalizeSkinStyle(value) : null;
}

export function sameSkinStyle(left: SkinStyle | null, right: SkinStyle | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.skin === right.skin &&
    left.accent === right.accent &&
    left.radius === right.radius &&
    left.density === right.density &&
    left.numericFont === right.numericFont
  );
}

/** 从主题设置里取出风格的五项。 */
export function skinStyleOf(settings: {
  skin: SkinId;
  skinAccent: string;
  skinRadius: SkinRadius;
  skinDensity: SkinDensity;
  skinNumericFont: SkinNumericFont;
}): SkinStyle {
  return {
    skin: settings.skin,
    accent: settings.skinAccent,
    radius: settings.skinRadius,
    density: settings.skinDensity,
    numericFont: settings.skinNumericFont,
  };
}

/** <html> 上要挂的属性；值为 null 表示去掉。流光 + 全部跟随时一个都不挂，和原版一样。 */
export function skinRootAttributes(style: SkinStyle): Record<string, string | null> {
  return {
    "data-skin": style.skin === "lumina" ? null : style.skin,
    "data-accent": style.accent ? "" : null,
    "data-radius": style.radius === "auto" ? null : style.radius,
    "data-density": style.density === "std" ? null : style.density,
    "data-num-font": style.numericFont === "auto" ? null : style.numericFont,
  };
}

let appliedSignature = "";

/** <html> 上已经是这套风格了吗（index.html 的首帧脚本可能已经按缓存挂好了）。 */
function rootMatches(root: HTMLElement, style: SkinStyle): boolean {
  for (const [name, value] of Object.entries(skinRootAttributes(style))) {
    if (root.getAttribute(name) !== value) return false;
  }
  return root.style.getPropertyValue("--accent-custom") === style.accent;
}

/** 把风格写到 <html>；没变化时什么都不做。返回是否真的改了（改了要让画布图表重取颜色）。 */
export function applySkinStyle(style: SkinStyle): boolean {
  if (typeof document === "undefined") return false;
  const signature = JSON.stringify(style);
  if (signature === appliedSignature) return false;
  appliedSignature = signature;
  const root = document.documentElement;
  // 首帧脚本已经挂好同一套：不用再写，也不用让所有图表重画一遍。
  if (rootMatches(root, style)) return false;
  for (const [name, value] of Object.entries(skinRootAttributes(style))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  if (style.accent) root.style.setProperty("--accent-custom", style.accent);
  else root.style.removeProperty("--accent-custom");
  return true;
}

/** 首帧缓存：index.html 里的内联脚本在 React 启动前读它，避免先闪一下原版配色。 */
export const SKIN_CACHE_KEY = "cfsm-lumina-prism:skin";

export function persistSkinStyle(style: SkinStyle): void {
  try {
    if (sameSkinStyle(style, DEFAULT_SKIN_STYLE)) localStorage.removeItem(SKIN_CACHE_KEY);
    else localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify(style));
  } catch {
    // 存不了只是下次首帧先显示原版配色，随即被纠正。
  }
}
