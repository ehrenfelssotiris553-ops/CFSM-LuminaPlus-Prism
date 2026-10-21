// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN_STYLE,
  SKIN_CACHE_KEY,
  applySkinStyle,
  normalizeMySkin,
  normalizeSkinAccent,
  normalizeSkinStyle,
  persistSkinStyle,
  sameSkinStyle,
  skinRootAttributes,
} from "@/utils/skin";
import { normalizeThemeSettings } from "@/utils/themeSettings";

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  applySkinStyle(DEFAULT_SKIN_STYLE);
});

describe("normalizing skin settings", () => {
  it("falls back to the original look for unknown values", () => {
    expect(normalizeSkinStyle({ skin: "neon", radius: "xl", density: 3, numericFont: "serif", accent: "red" })).toEqual(
      DEFAULT_SKIN_STYLE,
    );
    expect(normalizeSkinStyle(null)).toEqual(DEFAULT_SKIN_STYLE);
  });

  it("only accepts #rrggbb accents, since they go straight into CSS", () => {
    expect(normalizeSkinAccent("#5B5BF0")).toBe("#5b5bf0");
    expect(normalizeSkinAccent("#fff")).toBe("");
    expect(normalizeSkinAccent("red; background: url(x)")).toBe("");
  });

  it("keeps my style only when something was saved", () => {
    expect(normalizeMySkin(null)).toBeNull();
    expect(normalizeMySkin([])).toBeNull();
    expect(normalizeMySkin({ skin: "aurora", accent: "#db2777" })).toEqual({
      ...DEFAULT_SKIN_STYLE,
      skin: "aurora",
      accent: "#db2777",
    });
  });

  it("is part of the theme settings with the original look as default", () => {
    const settings = normalizeThemeSettings({});
    expect(settings.skin).toBe("lumina");
    expect(settings.mySkin).toBeNull();
    expect(normalizeThemeSettings({ skin: "terminal", skinDensity: "tight" })).toMatchObject({
      skin: "terminal",
      skinDensity: "tight",
    });
  });
});

describe("applying a skin to the page", () => {
  it("puts nothing on <html> for the original look", () => {
    expect(Object.values(skinRootAttributes(DEFAULT_SKIN_STYLE)).every((value) => value === null)).toBe(true);
    for (const name of ["data-skin", "data-accent", "data-radius", "data-density", "data-num-font"]) {
      expect(root().hasAttribute(name)).toBe(false);
    }
  });

  it("sets and clears attributes and the custom accent", () => {
    expect(
      applySkinStyle({ skin: "frost", accent: "#059669", radius: "lg", density: "tight", numericFont: "mono" }),
    ).toBe(true);
    expect(root().getAttribute("data-skin")).toBe("frost");
    expect(root().getAttribute("data-radius")).toBe("lg");
    expect(root().getAttribute("data-density")).toBe("tight");
    expect(root().getAttribute("data-num-font")).toBe("mono");
    expect(root().hasAttribute("data-accent")).toBe(true);
    expect(root().style.getPropertyValue("--accent-custom")).toBe("#059669");

    expect(applySkinStyle(DEFAULT_SKIN_STYLE)).toBe(true);
    expect(root().hasAttribute("data-skin")).toBe(false);
    expect(root().hasAttribute("data-accent")).toBe(false);
    expect(root().style.getPropertyValue("--accent-custom")).toBe("");
  });

  it("does nothing when the style did not change", () => {
    expect(applySkinStyle(DEFAULT_SKIN_STYLE)).toBe(false);
  });

  it("caches non-default styles for the first paint and forgets the default", () => {
    const style = { ...DEFAULT_SKIN_STYLE, skin: "paper" as const };
    persistSkinStyle(style);
    expect(JSON.parse(window.localStorage.getItem(SKIN_CACHE_KEY) ?? "null")).toEqual(style);
    persistSkinStyle(DEFAULT_SKIN_STYLE);
    expect(window.localStorage.getItem(SKIN_CACHE_KEY)).toBeNull();
  });

  it("compares styles field by field", () => {
    expect(sameSkinStyle(DEFAULT_SKIN_STYLE, { ...DEFAULT_SKIN_STYLE })).toBe(true);
    expect(sameSkinStyle(DEFAULT_SKIN_STYLE, { ...DEFAULT_SKIN_STYLE, density: "loose" })).toBe(false);
    expect(sameSkinStyle(DEFAULT_SKIN_STYLE, null)).toBe(false);
  });
});
