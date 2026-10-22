import { describe, expect, it } from "vitest";
import { computeNodeHealth, type NodeHealthInput } from "@/utils/nodeHealth";
import { followLayout, NEW_VIEW_MODES } from "@/utils/layouts";
import { SKIN_IDS } from "@/utils/skin";
import { isNodeViewMode, normalizeThemeSettings } from "@/utils/themeSettings";

const healthy: NodeHealthInput = {
  online: true,
  cpuPct: 20,
  ramPct: 40,
  diskPct: 30,
  losses: [
    { name: "电信", loss: 0 },
    { name: "联通", loss: 0.4 },
  ],
  expireDays: 120,
  trafficFraction: 0.2,
};

describe("health score", () => {
  it("is 100 with nothing to report for a quiet machine", () => {
    expect(computeNodeHealth(healthy)).toEqual({ score: 100, tone: "good", issues: [] });
  });

  it("names what is wrong, worst first", () => {
    const health = computeNodeHealth({
      ...healthy,
      ramPct: 86,
      losses: [{ name: "移动", loss: 6 }],
      expireDays: 5,
    });
    expect(health.issues.map((issue) => issue.key)).toEqual(["health.loss", "health.mem", "health.expireSoon"]);
    expect(health.issues[0]).toMatchObject({ params: { line: "移动", n: 6 }, tone: "bad" });
    // 86% 内存 -7、6% 丢包 -15、5 天到期 -10：68 分，「注意」。
    expect(health.score).toBe(68);
    expect(health.tone).toBe("warn");
  });

  it("uses a plain loss message for a single line and ignores unknown values", () => {
    const health = computeNodeHealth({ ...healthy, losses: [{ name: "", loss: 3 }, { name: "x", loss: null }] });
    expect(health.issues).toEqual([{ key: "health.lossSingle", params: { n: 3 }, tone: "warn" }]);
  });

  it("does not judge expiry it cannot see, and flags expired machines", () => {
    expect(computeNodeHealth({ ...healthy, expireDays: null }).issues).toEqual([]);
    expect(computeNodeHealth({ ...healthy, expireDays: -1 }).issues).toEqual([{ key: "health.expired", tone: "bad" }]);
  });

  it("has no score while offline", () => {
    expect(computeNodeHealth({ ...healthy, online: false })).toEqual({
      score: null,
      tone: "bad",
      issues: [{ key: "health.offline", tone: "bad" }],
    });
  });

  it("never goes below zero", () => {
    const health = computeNodeHealth({
      ...healthy,
      cpuPct: 100,
      ramPct: 100,
      diskPct: 100,
      losses: [{ name: "", loss: 50 }],
      expireDays: -3,
      trafficFraction: 1,
    });
    expect(health.score).toBe(0);
  });
});

describe("new layouts", () => {
  it("are valid view modes and survive normalization", () => {
    for (const mode of NEW_VIEW_MODES) {
      expect(isNodeViewMode(mode)).toBe(true);
      expect(normalizeThemeSettings({ desktopNodeViewMode: mode, mobileNodeViewMode: mode })).toMatchObject({
        desktopNodeViewMode: mode,
        mobileNodeViewMode: mode,
      });
    }
  });

  it("following the style gives every new layout to exactly one style, and the original layout to Lumina", () => {
    const followed = SKIN_IDS.filter((skin) => skin !== "lumina").map((skin) => followLayout(skin, "desktop"));
    expect([...followed].sort()).toEqual([...NEW_VIEW_MODES].sort());
    expect(followLayout("lumina", "desktop")).toBe("large");
    expect(followLayout("lumina", "mobile")).toBe("compact");
    expect(followLayout("collage", "mobile")).toBe("bento");
  });
});

describe("short line names", () => {
  it("drops only a leading carrier code", async () => {
    const { shortLineName } = await import("@/services/cfsm/mappers");
    expect(shortLineName("CT 电信")).toBe("电信");
    expect(shortLineName("cu 联通")).toBe("联通");
    expect(shortLineName("移动")).toBe("移动");
    expect(shortLineName("Node 3")).toBe("Node 3");
    expect(shortLineName("Hong Kong BGP")).toBe("Hong Kong BGP");
  });
});
