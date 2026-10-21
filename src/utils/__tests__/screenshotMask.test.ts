// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCREENSHOT_MASK_STORAGE_KEY,
  isPickingMask,
  maskNodeLike,
  maskPrice,
  maskText,
  maskTokens,
  nodeMaskFields,
  normalizeScreenshotMask,
  readScreenshotMask,
  setPickingMask,
  subscribeScreenshotMask,
  toggleMaskedNode,
  toggleScreenshotMask,
  writeScreenshotMask,
} from "@/utils/screenshotMask";

const ALL_FIELDS = { name: true, region: true, tags: true, price: true, asset: true };

beforeEach(() => {
  window.localStorage.clear();
  // 模块里有缓存，每个用例先写回默认状态。
  writeScreenshotMask({ on: false, nodes: [], fields: ALL_FIELDS });
  setPickingMask(false);
});

describe("normalizeScreenshotMask", () => {
  it("falls back to off with every field on for garbage", () => {
    for (const value of [null, "x", 1, [], { on: "yes" }]) {
      expect(normalizeScreenshotMask(value)).toEqual({ on: false, nodes: [], fields: ALL_FIELDS });
    }
  });

  it("keeps valid fields, drops bad node ids and duplicates", () => {
    expect(
      normalizeScreenshotMask({
        on: true,
        nodes: ["a", "a", "", 3, "b"],
        fields: { name: false, price: "no", extra: true },
      }),
    ).toEqual({ on: true, nodes: ["a", "b"], fields: { ...ALL_FIELDS, name: false } });
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

describe("which nodes and fields are masked", () => {
  it("masks nothing while off, even for picked nodes", () => {
    writeScreenshotMask({ nodes: ["a"] });
    expect(nodeMaskFields(readScreenshotMask(), "a")).toBeNull();
    writeScreenshotMask({ on: true });
    expect(nodeMaskFields(readScreenshotMask(), "a")).toEqual(ALL_FIELDS);
    expect(nodeMaskFields(readScreenshotMask(), "b")).toBeNull();
  });

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

describe("state changes", () => {
  it("turning on starts picking, turning off ends it, and both persist", () => {
    toggleScreenshotMask();
    expect(readScreenshotMask().on).toBe(true);
    expect(isPickingMask()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(SCREENSHOT_MASK_STORAGE_KEY) ?? "{}").on).toBe(true);

    toggleScreenshotMask();
    expect(readScreenshotMask().on).toBe(false);
    expect(isPickingMask()).toBe(false);
  });

  it("toggles a node in and out of the list and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeScreenshotMask(listener);
    toggleMaskedNode("a");
    toggleMaskedNode("b");
    expect(readScreenshotMask().nodes).toEqual(["a", "b"]);
    toggleMaskedNode("a");
    expect(readScreenshotMask().nodes).toEqual(["b"]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    toggleMaskedNode("c");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
