import { useSyncExternalStore } from "react";

/** 主题支持的界面语言，和后端 `/api/config` 的 `default_language` 同一套取值（另有 `auto`）。 */
export type Language = "zh" | "en" | "es";

export const LANGUAGES: readonly Language[] = ["zh", "en", "es"];

/** 各语言给 `Intl` 用的区域：西语跟后端一样用拉美西语（es-419）。 */
const LOCALES: Record<Language, string> = {
  zh: "zh-CN",
  en: "en-US",
  es: "es-419",
};

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/**
 * 后端自带前端（内置主题和后台页面顶上的 EN / 中 / ES 切换）把访客选的语言存在这个键里，同一个站点下本主题读得到。
 * 见后端 `src/frontend/utils/constants.js` 的 `STORAGE.LANGUAGE_PREFERENCE`。
 */
const BACKEND_LANGUAGE_STORAGE_KEY = "language_preference";

function asLanguage(value: unknown): Language | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "zh" || normalized === "en" || normalized === "es" ? normalized : null;
}

/** 访客在后端自带前端里亲手选过的语言；没选过（或存的是 auto、读不到）返回 null。 */
export function readBackendLanguagePreference(): Language | null {
  try {
    return asLanguage(window.localStorage.getItem(BACKEND_LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 换算界面语言，优先级和后端内置主题（`src/frontend/utils/i18n.js` 的 `applyDefaultLanguage`）一样：
 * ① 访客在后台 / 内置主题里亲手选过的语言（`visitorChoice`）；② 后台「默认语言」`zh` / `en` / `es`；
 * ③ `auto`（或缺省、认不出的值）按浏览器：首选里先出现西语就西语、先出现中文就中文，都没有用英文。
 *
 * 站长 2026-10-14 在后台顶上点了 EN，内置主题跟着变、本主题没变 —— 原来只看了 ②③。
 */
export function resolveLanguage(
  defaultLanguage: string | null | undefined,
  languages: readonly string[] = browserLanguages(),
  visitorChoice: Language | null = null,
): Language {
  if (visitorChoice) return visitorChoice;
  const preferred = asLanguage(defaultLanguage);
  if (preferred) return preferred;
  for (const raw of languages) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (value === "es" || value.startsWith("es-")) return "es";
    if (value === "zh" || value.startsWith("zh-")) return "zh";
  }
  return "en";
}

// 默认中文：页面在读到站点配置之前只有加载圈和页脚，语言由 `applySiteLanguage` 在配置到手那一刻定下来；
// 单测不经过入口，保持中文，现有断言不受影响。
let current: Language = "zh";
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function getLocale(language: Language = current): string {
  return LOCALES[language];
}

/**
 * 词典按需加载（i18n/index.ts 注册）：英文、西语各是单独的文件，用到才下载，中文直接打包在首页里 ——
 * 三种语言原来全打进首页，中文站每次白下载两份用不到的词典。返回 null 表示这门语言的词典已经在了。
 */
type DictionaryLoader = (language: Language) => Promise<void> | null;
let ensureDictionary: DictionaryLoader = () => null;

export function registerDictionaryLoader(loader: DictionaryLoader) {
  ensureDictionary = loader;
}

/** 最近一次要切到的语言；词典还在下载时 `current` 先不变，下载完再切，不会半中半英。 */
let requested: Language = current;

export function setLanguage(language: Language) {
  requested = language;
  const pending = ensureDictionary(language);
  if (pending) {
    void pending.then(() => {
      if (requested === language) commitLanguage(language);
    });
    return;
  }
  commitLanguage(language);
}

function commitLanguage(language: Language) {
  if (language === current) return;
  current = language;
  if (typeof document !== "undefined") document.documentElement.lang = getLocale(language);
  listeners.forEach((listener) => listener());
}

/** 等词典最多这么久：网络卡住时先按中文显示，词典到了再自动切过去，不让页面一直转圈。 */
const LANGUAGE_READY_TIMEOUT_MS = 4_000;

/** 等要用的那门语言的词典下载好。读到站点配置后、渲染内容前调用（见 api.ts 的 getPublic），页面不会先中文再跳。 */
export function whenLanguageReady(): Promise<void> {
  const pending = ensureDictionary(requested);
  if (!pending) return Promise.resolve();
  return Promise.race([
    pending,
    new Promise<void>((resolve) => setTimeout(resolve, LANGUAGE_READY_TIMEOUT_MS)),
  ]);
}

let siteDefaultLanguage: string | null | undefined = "auto";

/** 按站点配置的 `default_language`（和访客在后台选过的语言）定界面语言。在解析 `/api/config` 时调用，内容渲染前语言就已经定了，不会先中文再跳。 */
export function applySiteLanguage(defaultLanguage: string | null | undefined) {
  siteDefaultLanguage = defaultLanguage;
  setLanguage(resolveLanguage(defaultLanguage, browserLanguages(), readBackendLanguagePreference()));
}

/**
 * 页面启动时调用一次：先按访客选过的语言 / 浏览器语言显示（站点配置到手前的加载圈、出错页、人机验证），
 * 并跟着别的标签页里的切换走 —— 后台页面开在另一个标签页，点了 EN / 中 / ES，这边立刻换。
 */
export function initLanguage() {
  applySiteLanguage(siteDefaultLanguage);
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== BACKEND_LANGUAGE_STORAGE_KEY) return;
    applySiteLanguage(siteDefaultLanguage);
  });
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅界面语言。语言变了（站长改了默认语言、重新拉到配置）由 App 整棵树按语言重新挂载，见 App.tsx。 */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}
