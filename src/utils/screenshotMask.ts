/**
 * 截图打码。
 *
 * 打码哪些内容、哪几台、范围（只打码选中的 / 全部打码但选中的除外）、对访客要不要也打码，都是站点设置
 * （主题设置「隐私」，站长改了同步到后端）。开没开着分两种人：
 * - 站长：每次打开首页都不打码，点首页小眼睛才打码（只在这个页面里，不存，刷新就回到不打码）。
 *   打码时每张被打码的卡片右上角有个小眼睛，点一下临时显示这一台；再点首页小眼睛、或刷新页面就都恢复。
 * - 访客：站长开了「对访客也打码」就一直是打码的，没有任何按钮；没开就从不打码。
 *
 * 打码的机器在数据层就把文字换成同样长度的假内容（maskText），页面上、悬停提示、读屏文字里都没有真实内容，
 * 截图里还原不出来；样式层再加一层模糊（见 styles/mask.css）。只是遮住页面上的字，接口里还是真实数据。
 */

export const MASK_FIELDS = ["name", "region", "tags", "price", "asset"] as const;
export type MaskField = (typeof MASK_FIELDS)[number];
export type MaskFields = Record<MaskField, boolean>;
/** only = 只打码选中的机器；except = 全部打码，选中的除外（以后新加的机器也自动打码）。 */
export type MaskMode = "only" | "except";

export const DEFAULT_MASK_FIELDS: MaskFields = { name: true, region: true, tags: true, price: true, asset: true };

export function normalizeMaskFields(value: unknown): MaskFields {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fields = { ...DEFAULT_MASK_FIELDS };
  for (const field of MASK_FIELDS) {
    if (typeof raw[field] === "boolean") fields[field] = raw[field] as boolean;
  }
  return fields;
}

export function normalizeMaskMode(value: unknown): MaskMode {
  return value === "only" ? "only" : "except";
}

export function normalizeMaskNodes(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 500)
    : [];
}

/** 打码相关的站点设置（themeSettings 里的四项）。 */
export interface MaskSettings {
  screenshotMaskFields: MaskFields;
  screenshotMaskNodes: readonly string[];
  screenshotMaskMode: MaskMode;
  screenshotMaskVisitors: boolean;
}

/** 站长这次打开页面的状态：开没开、临时显示了哪几台。只在内存里。 */
interface MaskSession {
  on: boolean;
  revealed: ReadonlySet<string>;
}

let session: MaskSession = { on: false, revealed: new Set() };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function readMaskSession(): MaskSession {
  return session;
}

export function subscribeMaskSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 首页小眼睛：开 / 关打码。每次切换都把临时显示的卡片清掉。 */
export function toggleScreenshotMask() {
  session = { on: !session.on, revealed: new Set() };
  emit();
}

/** 卡片右上角的小眼睛：临时显示 / 重新遮住这一台。 */
export function toggleRevealNode(uuid: string) {
  const revealed = new Set(session.revealed);
  if (revealed.has(uuid)) revealed.delete(uuid);
  else revealed.add(uuid);
  session = { ...session, revealed };
  emit();
}

/** 测试用：回到刚打开页面的状态。 */
export function resetMaskSessionForTest() {
  session = { on: false, revealed: new Set() };
}

/** 合起来的打码状态：卡片、详情页、资产页等都只认这个。 */
export interface ScreenshotMaskState {
  /** 现在是不是在打码（站长点了小眼睛，或访客被设置成打码）。 */
  on: boolean;
  /** 站长才能点卡片上的小眼睛临时显示。 */
  canReveal: boolean;
  fields: MaskFields;
  mode: MaskMode;
  nodes: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}

export function resolveScreenshotMask(settings: MaskSettings, isOwner: boolean, current: MaskSession): ScreenshotMaskState {
  const on = isOwner ? current.on : settings.screenshotMaskVisitors;
  return {
    on,
    canReveal: isOwner && on,
    fields: settings.screenshotMaskFields,
    mode: settings.screenshotMaskMode,
    nodes: new Set(settings.screenshotMaskNodes),
    revealed: isOwner ? current.revealed : new Set(),
  };
}

/** 这台机器在打码范围里（不管有没有被临时显示）。卡片上的小眼睛按这个显示。 */
export function isNodeInMaskScope(state: ScreenshotMaskState, uuid: string): boolean {
  if (!state.on) return false;
  const picked = state.nodes.has(uuid);
  return state.mode === "only" ? picked : !picked;
}

/** 这台机器要打码的字段；不打码（或被临时显示）时返回 null。 */
export function nodeMaskFields(state: ScreenshotMaskState, uuid: string): MaskFields | null {
  return isNodeInMaskScope(state, uuid) && !state.revealed.has(uuid) ? state.fields : null;
}

/** 给卡片根元素的 data-mask：哪些字段要加模糊效果，例如 "name tags price"。 */
export function maskTokens(fields: MaskFields | null): string | undefined {
  if (!fields) return undefined;
  const tokens = MASK_FIELDS.filter((field) => field !== "asset" && fields[field]);
  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

/**
 * 同样长度的假内容：字母数字换成 x，汉字等换成「口」，空格和常见符号保留。
 * 模糊之后看起来就是一段真实的文字，但内容本身已经换掉了。
 */
export function maskText(text: string): string {
  return text.replace(/[A-Za-z0-9]/g, "x").replace(/[^\sx.,·•:/\\\-_()[\]（）【】#@+]/g, "口");
}

/**
 * 金额换成固定的「xx」：「¥30.5/月」→「¥xx/月」、「¥ 12,345.67」→「¥ xx」。
 * 不按位数换，否则数一数几个 x 就知道大概多少钱；币种和周期不算隐私，保留。
 */
export function maskPrice(price: string): string {
  return price.replace(/\d[\d.,]*/g, "xx");
}

/** 一条带名称、地区的数据按打码字段换好；不用打码时原样返回（同一个对象，不打断 memo）。 */
export function maskNodeLike<T extends { name: string; region?: string | null }>(
  item: T,
  fields: MaskFields | null,
): T {
  if (!fields || (!fields.name && !fields.region)) return item;
  return {
    ...item,
    ...(fields.name ? { name: maskText(item.name) } : null),
    ...(fields.region && item.region ? { region: "" } : null),
  };
}
