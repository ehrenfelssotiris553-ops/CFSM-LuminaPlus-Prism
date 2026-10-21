import { describe, expect, it } from "vitest";
import { applyPingVisibilityEdits, diffPingVisibility, filterVisiblePingTasks, isHomepagePingVisible, LOCAL_PING_VISIBILITY_EDITS_KEY, mergePingVisibilityEdits, normalizePingVisibility, normalizePingVisibilityEdits, migratePingDisplaySettings, migrateLocalPingPreferences, pingTaskProtocol, setPingVisibilityMode } from "@/utils/pingVisibility";
import { mergeLocalThemeSettingsEdits, mergeThemeSettingsLayers, normalizeThemeSettings } from "@/utils/themeSettings";

describe("per-node homepage ping visibility", () => {
  it("preserves every existing line unless explicitly hidden", () => {
    const settings = normalizeThemeSettings({});
    for (const id of [1, 3, 5, 8]) {
      expect(isHomepagePingVisible("a", id, settings)).toBe(true);
    }
  });
  it("hides the chosen protocol for only the chosen VPS", () => {
    const settings = normalizeThemeSettings({ homepagePingGroupOverrides: { a: { ipv6: false } }, homepagePingProtocols: { 1: "ipv4", 5: "ipv6", 6: "ipv6" } });
    expect(isHomepagePingVisible("a", 5, settings)).toBe(false);
    expect(isHomepagePingVisible("a", 6, settings)).toBe(false);
    expect(isHomepagePingVisible("a", 1, settings)).toBe(true);
    expect(isHomepagePingVisible("b", 5, settings)).toBe(true);
    expect(isHomepagePingVisible("a", 8, settings)).toBe(true);
  });
  it("honors global hiding and per-line show/hide before family defaults", () => {
    const settings = normalizeThemeSettings({ showPingIpv6: false, homepagePingProtocols: { 1: "ipv4", 5: "ipv6", 6: "ipv6" }, homepagePingVisibilityOverrides: { a: { 5: true, 1: false } } });
    expect(isHomepagePingVisible("a", 5, settings)).toBe(true);
    expect(isHomepagePingVisible("a", 6, settings)).toBe(false);
    expect(isHomepagePingVisible("a", 1, settings)).toBe(false);
    expect(isHomepagePingVisible("b", 1, settings)).toBe(true);
  });
  it("never guesses IP families from fixed backend slot IDs or ambiguous names", () => {
    expect(pingTaskProtocol("四川移动V6")).toBe("ipv6");
    expect(pingTaskProtocol("IPv4 TCP")).toBe("ipv4");
    expect(pingTaskProtocol("Dual V4 / V6")).toBe(null);
    expect(pingTaskProtocol("Node 4")).toBe(null);
    expect(pingTaskProtocol("v64")).toBe(null);
    expect(pingTaskProtocol("v40")).toBe(null);
  });
  it("restores inherited state without deleting another line or node", () => {
    const original = { a: { 1: false, 5: true }, b: { 3: false } };
    const next = setPingVisibilityMode(original, "a", 1, "auto");
    expect(next).toEqual({ a: { 5: true }, b: { 3: false } });
    expect(setPingVisibilityMode(next, "a", 5, "auto")).toEqual({ b: { 3: false } });
    expect(original.a[1]).toBe(false);
  });
  it("rejects malformed input and prototype keys", () => {
    expect(normalizePingVisibility(JSON.parse('{"__proto__":{"1":false},"a":{"01":false,"0":false,"9":false,"1":false,"2":"false","3":"auto"},"b":[]}'))).toEqual({ a: { 1: false } });
    expect(normalizePingVisibilityEdits({ a: { 3: "auto" } })).toEqual({ a: { 3: "auto" } });
    expect(normalizePingVisibility(null)).toEqual({});
    expect(setPingVisibilityMode({}, "__proto__", 1, "hide")).toEqual({});
    expect(setPingVisibilityMode({}, "a", 9, "hide")).toEqual({});
    expect(isHomepagePingVisible("constructor", 1, normalizeThemeSettings({}))).toBe(true);
  });
  it("rebases only edited lines on fresh backend values", () => {
    const before = { a: { 1: false } };
    const edits = diffPingVisibility(before, { a: { 1: false, 5: false } });
    expect(applyPingVisibilityEdits({ a: { 1: false, 6: true }, b: { 3: false } }, edits)).toEqual({ a: { 1: false, 5: false, 6: true }, b: { 3: false } });
    const undo = diffPingVisibility({ a: { 5: false } }, {});
    expect(mergePingVisibilityEdits(edits, undo)).toEqual({ a: { 5: "auto" } });
  });
  it("keeps undo and concurrent sparse edits local and never posts bookkeeping", () => {
    const key = LOCAL_PING_VISIBILITY_EDITS_KEY;
    const local = mergeLocalThemeSettingsEdits({ [key]: { a: { 1: false } } }, { [key]: { a: { 5: true } } });
    const result = mergeThemeSettingsLayers({ homepagePingVisibilityOverrides: { a: { 6: false }, b: { 3: true } } }, local);
    expect(result.homepagePingVisibilityOverrides).toEqual({ a: { 1: false, 5: true, 6: false }, b: { 3: true } });
    expect(result).not.toHaveProperty(key);
    const undo = mergeLocalThemeSettingsEdits(local, { [key]: { a: { 1: "auto", 5: "auto" } } });
    expect(mergeThemeSettingsLayers({ homepagePingVisibilityOverrides: { a: { 6: false } } }, undo).homepagePingVisibilityOverrides).toEqual({ a: { 6: false } });
  });
});


describe("independent ping display migration", () => {
  it("copies legacy rules once and decouples future badge changes", () => {
    const migrated = migratePingDisplaySettings({ showIpv6: false, homepageIpStackOverrides: { a: { ipv6: true } } }, { 1: "电信V4", 5: "移动V6", 8: "备用" });
    const settings = normalizeThemeSettings(migrated);
    expect(settings.homepagePingProtocols).toEqual({ 1: "ipv4", 5: "ipv6", 8: "other" });
    expect(isHomepagePingVisible("a", 5, settings)).toBe(true);
    expect(isHomepagePingVisible("b", 5, settings)).toBe(false);
    const badgesChanged = { ...settings, showIpv6: true, homepageIpStackOverrides: { b: { ipv6: true } } };
    expect(isHomepagePingVisible("b", 5, badgesChanged)).toBe(false);
    expect(migratePingDisplaySettings(migrated, { 1: "电信V6", 5: "改名后", 8: "备用V4" })).toBe(migrated);
  });
  it("has explicit per-line > node group > global priority and Other ignores family switches", () => {
    const settings = normalizeThemeSettings({ showPingIpv6: false, homepagePingProtocols: { 1: "ipv6", 2: "other" }, homepagePingGroupOverrides: { a: { ipv6: true } }, homepagePingVisibilityOverrides: { a: { 1: false } } });
    expect(isHomepagePingVisible("a", 1, settings)).toBe(false);
    expect(isHomepagePingVisible("b", 1, settings)).toBe(false);
    expect(isHomepagePingVisible("a", 2, settings)).toBe(true);
    expect(isHomepagePingVisible("b", 2, settings)).toBe(true);
  });
});


describe("legacy browser choices", () => {
  it("moves only old local choices to independent ping preferences", () => {
    const local = { showIpv6: false, __luminaplusIpStackEdits: { a: { ipv6: false } }, accent: "blue" };
    const migrated = migrateLocalPingPreferences(local);
    expect(migrated).toMatchObject({ pingDisplayVersion: 1, showPingIpv6: false, __luminaplusPingGroupEdits: { a: { ipv6: false } }, accent: "blue" });
    expect(migrated).not.toHaveProperty("showPingIpv4");
    expect(migrateLocalPingPreferences(migrated)).toBe(migrated);
  });
  it("keeps explicit new group choices ahead of old local badge edits", () => {
    const migrated = migrateLocalPingPreferences({ __luminaplusIpStackEdits: { a: { ipv6: false } }, __luminaplusPingGroupEdits: { a: { ipv6: true } } });
    expect(migrated.__luminaplusPingGroupEdits).toEqual({ a: { ipv6: true } });
  });
});

describe("explainHomepagePingVisibility", () => {
  it("names the rule layer that decided, in the same order as isHomepagePingVisible", async () => {
    const { explainHomepagePingVisibility, isHomepagePingVisible } = await import("@/utils/pingVisibility");
    const settings = {
      showPingIpv4: true,
      showPingIpv6: false,
      homepagePingGroupOverrides: { a: { ipv4: false } },
      homepagePingProtocols: { "1": "ipv4", "2": "ipv6", "3": "other" } as const,
      homepagePingVisibilityOverrides: { a: { "2": true } },
    };
    const cases = [
      ["a", 2, { visible: true, source: "line", protocol: "ipv6" }],
      ["a", 1, { visible: false, source: "group", protocol: "ipv4" }],
      ["b", 1, { visible: true, source: "global", protocol: "ipv4" }],
      ["b", 2, { visible: false, source: "global", protocol: "ipv6" }],
      ["b", 3, { visible: true, source: "other", protocol: "other" }],
    ] as const;
    for (const [uuid, taskId, expected] of cases) {
      expect(explainHomepagePingVisibility(uuid, taskId, settings)).toEqual(expected);
      expect(isHomepagePingVisible(uuid, taskId, settings)).toBe(expected.visible);
    }
  });
});

describe("detail page ping lines", () => {
  it("leaves out lines hidden in settings, e.g. V6 turned off for a V4-only machine", () => {
    const settings = normalizeThemeSettings({
      homepagePingGroupOverrides: { v4only: { ipv6: false } },
      homepagePingProtocols: { 1: "ipv4", 2: "ipv4", 4: "ipv6", 5: "ipv6" },
    });
    const tasks = [{ id: 1 }, { id: 2 }, { id: 4 }, { id: 5 }, { id: 7 }];
    expect(filterVisiblePingTasks(tasks, "v4only", settings).map((task) => task.id)).toEqual([1, 2, 7]);
    expect(filterVisiblePingTasks(tasks, "dual", settings).map((task) => task.id)).toEqual([1, 2, 4, 5, 7]);
  });
});
