// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applySiteLanguage,
  getLanguage,
  readBackendLanguagePreference,
  resolveLanguage,
  setLanguage,
  t,
  whenLanguageReady,
} from "@/i18n";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { zh } from "@/i18n/messages/zh";

describe("resolveLanguage", () => {
  it("uses the site default when it names a language", () => {
    expect(resolveLanguage("zh", ["en-US"])).toBe("zh");
    expect(resolveLanguage("EN", ["zh-CN"])).toBe("en");
    expect(resolveLanguage("es", ["zh-CN"])).toBe("es");
  });

  it("follows the browser for auto, like the built-in theme", () => {
    expect(resolveLanguage("auto", ["es-MX", "en"])).toBe("es");
    expect(resolveLanguage("auto", ["zh-TW"])).toBe("zh");
    expect(resolveLanguage("auto", ["fr-FR", "zh-CN"])).toBe("zh");
    expect(resolveLanguage("auto", ["fr-FR", "de"])).toBe("en");
    // 老后端不下发、或值认不出：按 auto 处理。
    expect(resolveLanguage("", ["es"])).toBe("es");
    expect(resolveLanguage("jp", [])).toBe("en");
  });

  it("puts the visitor's own choice from the backend's language switch first", () => {
    // 后台页面 / 内置主题顶上的 EN / 中 / ES 存在 language_preference，压过站点默认和浏览器。
    expect(resolveLanguage("zh", ["zh-CN"], "en")).toBe("en");
    expect(resolveLanguage("auto", ["zh-CN"], "es")).toBe("es");
    expect(resolveLanguage("en", ["zh-CN"], null)).toBe("en");
  });
});

describe("t", () => {
  afterEach(() => setLanguage("zh"));

  it("switches language once its dictionary has loaded, and fills in parameters", async () => {
    expect(getLanguage()).toBe("zh");
    expect(t("renewal.expiresIn", { n: 3 })).toBe("3 天后到期");
    setLanguage("en");
    await whenLanguageReady();
    expect(getLanguage()).toBe("en");
    expect(t("renewal.expiresIn", { n: 3 })).toBe("Expires in 3 d");
    setLanguage("es");
    await whenLanguageReady();
    expect(t("renewal.expiresIn", { n: 3 })).toBe("Vence en 3 d");
  });

  it("keeps the same placeholders in every language", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(placeholders(en[key]), `en ${key}`).toEqual(placeholders(zh[key]));
      expect(placeholders(es[key]), `es ${key}`).toEqual(placeholders(zh[key]));
    }
  });

  it("has no untranslated Chinese left in en / es", () => {
    const cjk = /[一-鿿]/;
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(cjk.test(en[key]), `en ${key}: ${en[key]}`).toBe(false);
      expect(cjk.test(es[key]), `es ${key}: ${es[key]}`).toBe(false);
    }
  });
});

describe("backend language preference", () => {
  afterEach(() => {
    window.localStorage.removeItem("language_preference");
    setLanguage("zh");
  });

  it("reads the key the backend's own frontend writes", () => {
    expect(readBackendLanguagePreference()).toBeNull();
    window.localStorage.setItem("language_preference", "EN");
    expect(readBackendLanguagePreference()).toBe("en");
    // 存的是 auto：等于没选，交给站点默认。
    window.localStorage.setItem("language_preference", "auto");
    expect(readBackendLanguagePreference()).toBeNull();
  });

  it("lets the stored choice override the site default when the config arrives", () => {
    window.localStorage.setItem("language_preference", "es");
    applySiteLanguage("zh");
    expect(getLanguage()).toBe("es");
    window.localStorage.removeItem("language_preference");
    applySiteLanguage("zh");
    expect(getLanguage()).toBe("zh");
  });
});
