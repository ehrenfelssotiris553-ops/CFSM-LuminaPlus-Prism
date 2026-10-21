import { getIpStackOverride, normalizeIpStackOverrides, LOCAL_IP_STACK_EDITS_KEY, mergeIpStackEdits, normalizeIpStackEdits, type IpStackOverridesByNode, type IpStackMode } from "./ipStack";

/** Keys are stable backend task IDs, never visible row positions or editable names. */
export type PingVisibilityOverrides = Readonly<Record<string, Readonly<Record<string, boolean>>>>;
export type PingVisibilityEdits = Readonly<Record<string, Readonly<Record<string, boolean | "auto">>>>;
export const LOCAL_PING_VISIBILITY_EDITS_KEY = "__luminaplusPingVisibilityEdits";
const validTask = (key: string) => /^[1-8]$/.test(key);
const validNode = (key: string) => key.length > 0 && key !== "__proto__";

export function normalizePingVisibilityEdits(value: unknown): PingVisibilityEdits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).flatMap(([uuid, raw]) => {
    if (!validNode(uuid) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entries = Object.entries(raw).filter((entry): entry is [string, boolean | "auto"] => validTask(entry[0]) && (typeof entry[1] === "boolean" || entry[1] === "auto"));
    return entries.length ? [[uuid, Object.fromEntries(entries)]] : [];
  }));
}

export function normalizePingVisibility(value: unknown): PingVisibilityOverrides {
  const edits = normalizePingVisibilityEdits(value);
  return Object.fromEntries(Object.entries(edits).flatMap(([uuid, row]) => {
    const entries = Object.entries(row).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean");
    return entries.length ? [[uuid, Object.fromEntries(entries)]] : [];
  }));
}

export function nodePingVisibility(map: PingVisibilityOverrides, uuid: string): Readonly<Record<string, boolean>> {
  return Object.hasOwn(map, uuid) ? map[uuid]! : {};
}

export function diffPingVisibility(before: PingVisibilityOverrides, after: PingVisibilityOverrides): PingVisibilityEdits {
  const edits: Record<string, Record<string, boolean | "auto">> = {};
  for (const uuid of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!validNode(uuid)) continue;
    const left = nodePingVisibility(before, uuid), right = nodePingVisibility(after, uuid);
    const row: Record<string, boolean | "auto"> = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (validTask(key) && left[key] !== right[key]) row[key] = right[key] ?? "auto";
    }
    if (Object.keys(row).length) edits[uuid] = row;
  }
  return edits;
}

export function mergePingVisibilityEdits(before: PingVisibilityEdits, after: PingVisibilityEdits): PingVisibilityEdits {
  return normalizePingVisibilityEdits(Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map((uuid) => [uuid, {
    ...(Object.hasOwn(before, uuid) ? before[uuid] : {}),
    ...(Object.hasOwn(after, uuid) ? after[uuid] : {}),
  }])));
}

export function applyPingVisibilityEdits(base: PingVisibilityOverrides, edits: PingVisibilityEdits): PingVisibilityOverrides {
  const result = { ...base };
  for (const [uuid, edit] of Object.entries(normalizePingVisibilityEdits(edits))) {
    const row = { ...nodePingVisibility(base, uuid) };
    for (const [key, value] of Object.entries(edit)) {
      if (value === "auto") delete row[key];
      else row[key] = value;
    }
    if (Object.keys(row).length) result[uuid] = row;
    else delete result[uuid];
  }
  return normalizePingVisibility(result);
}

export function setPingVisibilityMode(base: PingVisibilityOverrides, uuid: string, taskId: number, mode: IpStackMode): PingVisibilityOverrides {
  if (!validNode(uuid) || !validTask(String(taskId))) return base;
  return applyPingVisibilityEdits(base, { [uuid]: { [taskId]: mode === "auto" ? "auto" : mode === "show" } });
}

/** Backend slots can target either family. Only explicit V4/V6 names are recognized. */
export function pingTaskProtocol(name: string): "ipv4" | "ipv6" | null {
  const v4 = /(?:ipv4|v4)(?!\d)/i.test(name);
  const v6 = /(?:ipv6|v6)(?!\d)/i.test(name);
  return v4 === v6 ? null : v4 ? "ipv4" : "ipv6";
}

export type PingProtocol = "ipv4" | "ipv6" | "other";
export type PingProtocols = Readonly<Record<string, PingProtocol>>;
export const LOCAL_PING_GROUP_EDITS_KEY = "__luminaplusPingGroupEdits";
export const LOCAL_PING_PROTOCOL_EDITS_KEY = "__luminaplusPingProtocolEdits";

/** Carry old browser-only choices over once, without pinning untouched site defaults locally. */
export function migrateLocalPingPreferences(local: Record<string, unknown>): Record<string, unknown> {
  if (local.pingDisplayVersion === 1) return local;
  const next = { ...local, pingDisplayVersion: 1 };
  for (const [oldKey, newKey] of [["showIpv4", "showPingIpv4"], ["showIpv6", "showPingIpv6"]]) {
    if (Object.hasOwn(local, oldKey!) && !Object.hasOwn(local, newKey!)) Object.assign(next, { [newKey!]: local[oldKey!] });
  }
  if (Object.hasOwn(local, "homepageIpStackOverrides") && !Object.hasOwn(local, "homepagePingGroupOverrides")) Object.assign(next, { homepagePingGroupOverrides: normalizeIpStackOverrides(local.homepageIpStackOverrides) });
  if (Object.hasOwn(local, LOCAL_IP_STACK_EDITS_KEY)) Object.assign(next, {
    [LOCAL_PING_GROUP_EDITS_KEY]: mergeIpStackEdits(normalizeIpStackEdits(local[LOCAL_IP_STACK_EDITS_KEY]), normalizeIpStackEdits(local[LOCAL_PING_GROUP_EDITS_KEY])),
  });
  return next;
}

export function normalizePingProtocols(value: unknown): PingProtocols {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, PingProtocol] =>
    validTask(entry[0]) && typeof entry[1] === "string" && ["ipv4", "ipv6", "other"].includes(entry[1]),
  ));
}

/** A one-time legacy migration; subsequent renders never infer protocol from editable names. */
export function migratePingDisplaySettings(raw: Record<string, unknown>, taskNames: Readonly<Record<string, string>>): Record<string, unknown> {
  if (raw.pingDisplayVersion === 1) return raw;
  return {
    ...raw,
    pingDisplayVersion: 1,
    showPingIpv4: raw.showIpv4 !== false,
    showPingIpv6: raw.showIpv6 !== false,
    homepagePingGroupOverrides: normalizeIpStackOverrides(raw.homepageIpStackOverrides),
    homepagePingProtocols: Object.fromEntries(Object.entries(taskNames).filter(([id]) => validTask(id)).map(([id, name]) => [id, pingTaskProtocol(name) ?? "other"])),
  };
}

export interface PingDisplaySettings {
  showPingIpv4: boolean;
  showPingIpv6: boolean;
  homepagePingGroupOverrides: IpStackOverridesByNode;
  homepagePingProtocols: PingProtocols;
  homepagePingVisibilityOverrides: PingVisibilityOverrides;
}

export function isHomepagePingVisible(uuid: string, taskId: number, settings: PingDisplaySettings): boolean {
  return explainHomepagePingVisibility(uuid, taskId, settings).visible;
}

/** 按设置过滤一台机器要显示的线路，详情页的延迟图也用它：设置里隐藏的线路首页和详情页都不画。 */
export function filterVisiblePingTasks<T extends { id: number }>(
  tasks: readonly T[],
  uuid: string,
  settings: PingDisplaySettings,
): T[] {
  return tasks.filter((task) => isHomepagePingVisible(uuid, task.id, settings));
}

/** 首页这条线路为什么显示 / 隐藏：单条设置、本台协议组、全站默认，或线路不分协议（始终显示）。 */
export type PingVisibilitySource = "line" | "group" | "global" | "other";

/** 首页显示规则：单条设置 > 本台协议组 > 全站 V4 / V6 默认，不分协议的线路始终显示；另外说明结果来自哪一层，设置页据此提示。 */
export function explainHomepagePingVisibility(
  uuid: string,
  taskId: number,
  settings: PingDisplaySettings,
): { visible: boolean; source: PingVisibilitySource; protocol: PingProtocol } {
  const protocol = settings.homepagePingProtocols[String(taskId)] ?? "other";
  const explicit = nodePingVisibility(settings.homepagePingVisibilityOverrides, uuid)[String(taskId)];
  if (typeof explicit === "boolean") return { visible: explicit, source: "line", protocol };
  if (protocol === "other") return { visible: true, source: "other", protocol };
  const group = getIpStackOverride(settings.homepagePingGroupOverrides, uuid)[protocol];
  if (typeof group === "boolean") return { visible: group, source: "group", protocol };
  return { visible: protocol === "ipv4" ? settings.showPingIpv4 : settings.showPingIpv6, source: "global", protocol };
}
