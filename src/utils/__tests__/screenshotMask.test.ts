import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MASK_FIELDS,
  isNodeInMaskScope,
  maskNodeLike,
  maskPrice,
  maskText,
  maskTokens,
  nodeMaskFields,
  normalizeMaskFields,
  normalizeMaskMode,
  normalizeMaskNodes,
  readMaskSession,
  resetMaskSessionForTest,
  resolveScreenshotMask,
  subscribeMaskSession,
  toggleRevealNode,
  toggleScreenshotMask,
  type MaskSettings,
} from "@/utils/screenshotMask";

const ALL_FIELDS = { name: true, region: true, tags: true, price: true, asset: true };

function settings(patch: Partial<MaskSettings> = {}): MaskSettings {
  return {
    screenshotMaskFields: ALL_FIELDS,
    screenshotMaskNodes: [],
    screenshotMaskMode: "except",
    screenshotMaskVisitors: false,
    ...patch,
  };
}

beforeEach(() => {
  resetMaskSessionForTest();
});

describe("normalizing the site settings", () => {
  it("falls back to every field on, 'all except selected', and no nodes for garbage", () => {
    expect(normalizeMaskFields("nope")).toEqual(DEFAULT_MASK_FIELDS);
    expect(normalizeMaskFields({ name: false, region: "x" })).toEqual({ ...ALL_FIELDS, name: false });
    expect(normalizeMaskMode("weird")).toBe("except");
    expect(normalizeMaskMode("only")).toBe("only");
    expect(normalizeMaskNodes(["a", "", 3, "a", "b"])).toEqual(["a", "b"]);
    expect(normalizeMaskNodes(null)).toEqual([]);
  });
});

describe("placeholder text", () => {
  it("keeps the length and separators but none of the content", () => {
    const masked = maskText("HK-01 香港 CN2");
    expect(masked).toBe("xx-xx 口口 xxx");
    expect(masked).toHaveLength("HK-01 香港 CN2".length);
  });

  it("replaces amounts with a fixed placeholder so the digit count gives nothing away", () => {
    expect(maskPrice("¥30.5/月")).toBe("¥xx/月");
    expect(maskPrice("¥ 12,345.67")).toBe("¥ xx");
    expect(maskPrice("$5/年")).toBe("$xx/年");
  });
});

describe("who sees what", () => {
  it("the owner starts unmasked every visit and masks only after tapping the eye", () => {
    const owner = resolveScreenshotMask(settings(), true, readMaskSession());
    expect(owner.on).toBe(false);
    expect(nodeMaskFields(owner, "a")).toBeNull();
    toggleScreenshotMask();
    const masked = resolveScreenshotMask(settings(), true, readMaskSession());
    expect(masked.on).toBe(true);
    expect(masked.canReveal).toBe(true);
    expect(nodeMaskFields(masked, "a")).toEqual(ALL_FIELDS);
  });

  it("visitors follow the 'mask for visitors' switch and can never reveal", () => {
    expect(resolveScreenshotMask(settings(), false, readMaskSession()).on).toBe(false);
    toggleScreenshotMask(); // 站长按钮的状态对访客没有意义
    const visitor = resolveScreenshotMask(settings({ screenshotMaskVisitors: true }), false, readMaskSession());
    expect(visitor.on).toBe(true);
    expect(visitor.canReveal).toBe(false);
    expect(nodeMaskFields(visitor, "a")).toEqual(ALL_FIELDS);
  });

  it("'only selected' masks the picked servers, 'all except selected' masks everything else", () => {
    toggleScreenshotMask();
    const only = resolveScreenshotMask(settings({ screenshotMaskMode: "only", screenshotMaskNodes: ["a"] }), true, readMaskSession());
    expect(isNodeInMaskScope(only, "a")).toBe(true);
    expect(isNodeInMaskScope(only, "b")).toBe(false);
    const except = resolveScreenshotMask(settings({ screenshotMaskMode: "except", screenshotMaskNodes: ["a"] }), true, readMaskSession());
    expect(isNodeInMaskScope(except, "a")).toBe(false);
    expect(isNodeInMaskScope(except, "brand-new")).toBe(true);
  });

  it("revealing a card is temporary and is cleared by toggling the eye again", () => {
    const listener = vi.fn();
    const stop = subscribeMaskSession(listener);
    toggleScreenshotMask();
    toggleRevealNode("a");
    let state = resolveScreenshotMask(settings(), true, readMaskSession());
    expect(isNodeInMaskScope(state, "a")).toBe(true);
    expect(nodeMaskFields(state, "a")).toBeNull();
    expect(nodeMaskFields(state, "b")).toEqual(ALL_FIELDS);
    toggleRevealNode("a");
    state = resolveScreenshotMask(settings(), true, readMaskSession());
    expect(nodeMaskFields(state, "a")).toEqual(ALL_FIELDS);
    toggleRevealNode("a");
    toggleScreenshotMask();
    toggleScreenshotMask();
    expect(readMaskSession().revealed.size).toBe(0);
    expect(listener).toHaveBeenCalled();
    stop();
  });
});

describe("card tokens and replaced data", () => {
  it("lists blur tokens for the card root, without the overview-only asset field", () => {
    expect(maskTokens(null)).toBeUndefined();
    expect(maskTokens(ALL_FIELDS)).toBe("name region tags price");
    expect(maskTokens({ ...ALL_FIELDS, name: false, region: false, tags: false, price: false })).toBeUndefined();
  });

  it("returns the same object when nothing needs replacing", () => {
    const item = { uuid: "a", name: "Tokyo", region: "JP" };
    expect(maskNodeLike(item, null)).toBe(item);
    expect(maskNodeLike(item, { ...ALL_FIELDS, name: false, region: false })).toBe(item);
    expect(maskNodeLike(item, ALL_FIELDS)).toEqual({ uuid: "a", name: "xxxxx", region: "" });
    expect(maskNodeLike({ uuid: "b", name: "x", region: null }, ALL_FIELDS).region).toBeNull();
  });
});
