/**
 * 截图打码：只存在这台设备的这个浏览器里（截图是自己的事，不该改站点设置，也不影响别人看到的页面）。
 *
 * 打码的机器在数据层就把文字换成同样长度的假内容（maskText），页面上、悬停提示、读屏文字里都没有真实内容，
 * 截图里还原不出来；样式层再给名称、标签、价格加一层模糊（见 styles/mask.css），看起来是毛玻璃。
 */

export const MASK_FIELDS = ["name", "region", "tags", "price", "asset"] as const;
export type MaskField = (typeof MASK_FIELDS)[number];
export type MaskFields = Record<MaskField, boolean>;

export interface ScreenshotMaskState {
  on: boolean;
  /** 要打码的机器（uuid）。 */
  nodes: readonly string[];
  fields: MaskFields;
}

export const SCREENSHOT_MASK_STORAGE_KEY = "cfsm-luminaplus:screenshot-mask";

const DEFAULT_FIELDS: MaskFields = { name: true, region: true, tags: true, price: true, asset: true };
const DEFAULT_STATE: ScreenshotMaskState = { on: false, nodes: [], fields: DEFAULT_FIELDS };

export function normalizeScreenshotMask(value: unknown): ScreenshotMaskState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STATE;
  const raw = value as Record<string, unknown>;
  const rawFields = raw.fields && typeof raw.fields === "object" ? (raw.fields as Record<string, unknown>) : {};
  const fields = { ...DEFAULT_FIELDS };
  for (const field of MASK_FIELDS) {
    if (typeof rawFields[field] === "boolean") fields[field] = rawFields[field] as boolean;
  }
  const nodes = Array.isArray(raw.nodes)
    ? [...new Set(raw.nodes.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  return { on: raw.on === true, nodes, fields };
}

let cached: ScreenshotMaskState | null = null;
let picking = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function readScreenshotMask(): ScreenshotMaskState {
  if (cached) return cached;
  try {
    cached = normalizeScreenshotMask(JSON.parse(window.localStorage.getItem(SCREENSHOT_MASK_STORAGE_KEY) ?? "null"));
  } catch {
    cached = DEFAULT_STATE;
  }
  return cached;
}

export function writeScreenshotMask(patch: Partial<ScreenshotMaskState>) {
  cached = normalizeScreenshotMask({ ...readScreenshotMask(), ...patch });
  try {
    window.localStorage.setItem(SCREENSHOT_MASK_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // 存不了（隐私模式等）就只在这次打开页面内有效。
  }
  if (!cached.on) picking = false;
  emit();
}

export function subscribeScreenshotMask(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 选机器模式（首页顶部那条「点卡片选择要打码的机器」）。只在内存里，刷新页面就结束。 */
export function isPickingMask(): boolean {
  return picking;
}

export function setPickingMask(next: boolean) {
  if (picking === next) return;
  picking = next;
  emit();
}

/** 打开打码时直接进入选机器模式：每次打开都确认一下选了哪几台，点「完成」后页面就干净了。 */
export function toggleScreenshotMask() {
  const state = readScreenshotMask();
  if (state.on) {
    writeScreenshotMask({ on: false });
  } else {
    writeScreenshotMask({ on: true });
    setPickingMask(true);
  }
}

export function toggleMaskedNode(uuid: string) {
  const { nodes } = readScreenshotMask();
  writeScreenshotMask({ nodes: nodes.includes(uuid) ? nodes.filter((id) => id !== uuid) : [...nodes, uuid] });
}

/** 这台机器要打码的字段；不打码时返回 null。 */
export function nodeMaskFields(state: ScreenshotMaskState, uuid: string): MaskFields | null {
  return state.on && state.nodes.includes(uuid) ? state.fields : null;
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
