import { useCallback, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { canSyncSiteTheme } from "@/services/siteOwner";
import { patchLocalThemeSettings } from "@/services/themeSettingsStore";
import { subscribeMediaQuery } from "@/utils/mediaQuery";
import { NODE_VIEW_MODES, type NodeViewMode } from "@/utils/themeSettings";

// 老版本在快捷栏选布局只存在这个标签页里（sessionStorage）；现在站长选的就是全站默认，这两个键不再用，打开时顺手清掉。
const LEGACY_OVERRIDE_KEYS = [
  "cfsm-luminaplus:node-view-mode-session:desktop",
  "cfsm-luminaplus:node-view-mode-session:mobile",
];
export const MOBILE_VIEW_MODE_QUERY = "(max-width: 720px)";
// 循环顺序：大卡 → 小卡 → 迷你 → 列表 → 六种新布局 → 大卡……（快捷栏用弹出菜单直接选，这里给键盘 / 测试用）
const VIEW_MODE_CYCLE: readonly NodeViewMode[] = NODE_VIEW_MODES;
// 列表档天生不适合窄屏,仅桌面可用:移动端从循环里剔除,且默认值解析成 list 时兜底回 compact。
export const MOBILE_VIEW_MODES: readonly NodeViewMode[] = NODE_VIEW_MODES.filter((mode) => mode !== "list");

export type ViewModeDevice = "desktop" | "mobile";

export function normalizeViewModeForDevice(
  mode: NodeViewMode,
  device: ViewModeDevice,
): NodeViewMode {
  return device === "mobile" && mode === "list" ? "compact" : mode;
}

export function getNextViewMode(mode: NodeViewMode, device: ViewModeDevice): NodeViewMode {
  const cycle = device === "mobile" ? MOBILE_VIEW_MODES : VIEW_MODE_CYCLE;
  const normalized = normalizeViewModeForDevice(mode, device);
  return cycle[(cycle.indexOf(normalized) + 1) % cycle.length] ?? cycle[0];
}

/** 老版本留下的「这个标签页临时用的布局」：现在不用了，清掉。 */
export function clearViewModeOverrides() {
  for (const key of LEGACY_OVERRIDE_KEYS) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // session storage 不可用时没什么可清的。
    }
  }
}

let mediaQuery: MediaQueryList | null = null;

function getMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  mediaQuery ??= window.matchMedia(MOBILE_VIEW_MODE_QUERY);
  return mediaQuery;
}

function getDevice(): ViewModeDevice {
  return getMediaQuery()?.matches ? "mobile" : "desktop";
}

let legacyCleared = false;

function subscribe(listener: () => void) {
  if (!legacyCleared) {
    legacyCleared = true;
    clearViewModeOverrides();
  }
  const mq = getMediaQuery();
  return mq ? subscribeMediaQuery(mq, listener) : () => {};
}

/**
 * 首页用哪种卡片布局：就是站点设置里的「电脑默认 / 手机默认」。
 * 站长在快捷栏选一个，改的就是这台设备那一类（手机或电脑）的全站默认，随后自动同步到后端，访客下次打开就跟着变；
 * 访客没有布局按钮（setMode 对访客什么都不做）。
 */
export function useViewMode() {
  const themeSettings = useThemeSettings();
  const device = useSyncExternalStore(subscribe, getDevice, getDevice);
  const isMobile = device === "mobile";
  const defaultMode = isMobile ? themeSettings.mobileNodeViewMode : themeSettings.desktopNodeViewMode;
  // 移动端若被解析成 list(默认值被强制写成 list 等极端情况),兜底回 compact —— 列表仅桌面可用。
  const mode = normalizeViewModeForDevice(defaultMode, device);
  const nextMode = getNextViewMode(mode, device);

  const setMode = useCallback(
    (next: NodeViewMode) => {
      if (!canSyncSiteTheme() || next === mode) return;
      patchLocalThemeSettings(isMobile ? { mobileNodeViewMode: next } : { desktopNodeViewMode: next });
    },
    [isMobile, mode],
  );

  const toggleMode = useCallback(() => {
    setMode(nextMode);
  }, [nextMode, setMode]);

  return {
    device,
    mode,
    nextMode,
    setMode,
    toggleMode,
  };
}

// 给用不了 hook 的场景做非响应式读取（如 class ErrorBoundary 的诊断）。
export function readViewModeHint(): string {
  try {
    return getDevice();
  } catch {
    return "unknown";
  }
}
