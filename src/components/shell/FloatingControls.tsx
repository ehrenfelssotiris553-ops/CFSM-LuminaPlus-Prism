import { t, type MessageKey } from "@/i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Monitor, Palette, Settings, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { Link } from "react-router-dom";
import { usePreferences } from "@/hooks/usePreferences";
import { useViewMode } from "@/hooks/useViewMode";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useAuth } from "@/hooks/useAuth";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useScreenshotMask } from "@/hooks/useScreenshotMask";
import { MaskIcon } from "@/components/node/MaskPicker";
import { LayoutIcon } from "@/components/node/LayoutIcon";
import { ViewModeMenu } from "./ViewModeMenu";
import { toggleScreenshotMask } from "@/utils/screenshotMask";
import { getAdminUrl } from "@/services/cfsm/config";
import { readQuickControlsExpanded, writeQuickControlsExpanded } from "@/utils/quickControlsStorage";
import { clsx } from "clsx";

const MetricColorPicker = lazy(() =>
  import("./MetricColorPicker").then((module) => ({ default: module.MetricColorPicker })),
);

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, labelKey: "appearance.light" },
  { value: "system", icon: Monitor, labelKey: "appearance.system" },
  { value: "dark", icon: Moon, labelKey: "appearance.dark" },
] as const;

export function FloatingControls({
  onExpandedChange,
}: {
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { appearance, setAppearance } = usePreferences();
  const { mode, device, setMode } = useViewMode();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { failureStreak } = useNodeStoreStatus();
  // 上次展开着就接着展开（只在宽屏上，见 quickControlsStorage）。
  const [collapsed, setCollapsed] = useState(() => !readQuickControlsExpanded());
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorsMounted, setColorsMounted] = useState(false);
  // 卡片视图的弹出菜单（十种布局，点哪个切哪个）。
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const closeViewMenu = useCallback(() => setViewMenuOpen(false), []);
  const settingsReady = themeSettings.isReady;
  const showAdmin = settingsReady && themeSettings.enableAdminButton;
  // 主题设置与配色都只保存在本机浏览器（第三方主题不能写后端配置），
  // 因此对所有访客开放，各自调各自的。
  // 哪些按钮显示由「设置 → 外观 → 快捷栏」决定；主题设置按钮不让关，否则关光了就回不到设置页。
  const showThemeManage = settingsReady;
  const showAppearance = settingsReady && themeSettings.quickShowAppearance;
  const showViewMode = settingsReady && themeSettings.quickShowViewMode;
  const showColorPicker = settingsReady && themeSettings.quickShowColors;
  const showMask = settingsReady && themeSettings.quickShowMask;
  const mask = useScreenshotMask();
  const showSyncWarning = failureStreak >= 2;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;
  // 只要不在最宽松的大卡默认态,就视为"已切换"，按钮保持高亮。
  const isReducedView = mode !== "large";
  useEffect(() => {
    onExpandedChange?.(!collapsed);
  }, [collapsed, onExpandedChange]);
  useEffect(() => () => onExpandedChange?.(false), [onExpandedChange]);

  const toggleControls = () => {
    // 收起快捷栏时同时结束子面板状态，避免下次展开时调色盘自动复现。
    const nextCollapsed = !collapsed;
    if (nextCollapsed) {
      setColorsOpen(false);
      setViewMenuOpen(false);
    }
    setCollapsed(nextCollapsed);
    writeQuickControlsExpanded(!nextCollapsed);
  };

  return (
    <div
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            {showAppearance && (
              <div
                className="control-group floating-controls-appearance"
                role="group"
                aria-label={t("quick.appearance")}
              >
                {APPEARANCE_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAppearance(value)}
                    aria-label={t(labelKey)}
                    aria-pressed={appearance === value}
                    title={t(labelKey)}
                    tabIndex={hiddenTabIndex}
                    className={clsx(
                      "control-button grid h-9 w-9 place-items-center",
                      appearance === value && "control-toggle is-active",
                    )}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            )}
            {showViewMode && (
              <button
                ref={viewButtonRef}
                type="button"
                onClick={() => {
                  setColorsOpen(false);
                  setViewMenuOpen((value) => !value);
                }}
                aria-label={t("quick.switchView")}
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
                title={t("quick.currentView", { view: t(`viewMode.${mode}` as MessageKey) })}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  (isReducedView || viewMenuOpen) && "control-toggle is-active",
                )}
              >
                <LayoutIcon mode={mode} size={16} />
              </button>
            )}
            {showColorPicker && (
              <button
                type="button"
                onClick={() => {
                  setColorsMounted(true);
                  setViewMenuOpen(false);
                  setColorsOpen((value) => !value);
                }}
                aria-label={t("quick.cardColors")}
                aria-pressed={colorsOpen}
                title={t("quick.cardColors")}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  colorsOpen && "control-toggle is-active",
                )}
              >
                <Palette size={16} />
              </button>
            )}
            {showMask && (
              <button
                type="button"
                onClick={toggleScreenshotMask}
                aria-label={t("quick.mask")}
                aria-pressed={mask.on}
                title={t(mask.on ? "quick.maskOff" : "quick.mask")}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  mask.on && "control-toggle is-active",
                )}
              >
                <MaskIcon />
              </button>
            )}
            {showThemeManage && (
              <Link
                to="/?view=theme-manage"
                aria-label={t("quick.themeSettings")}
                title={t("quick.themeSettings")}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <SlidersHorizontal size={16} />
              </Link>
            )}
            {showAdmin && (
              <a
                href={getAdminUrl()}
                aria-label={t(me?.logged_in ? "quick.admin" : "quick.adminLogin")}
                title={t(me?.logged_in ? "quick.admin" : "quick.adminLogin")}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <Settings size={16} />
              </a>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={t(collapsed ? "quick.expand" : "quick.collapse")}
            aria-expanded={!collapsed}
            onClick={toggleControls}
            title={t(collapsed ? "quick.expand" : "quick.collapse")}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
        </div>
        {showViewMode && viewMenuOpen && !collapsed && (
          <ViewModeMenu
            current={mode}
            device={device}
            anchorRef={viewButtonRef}
            onClose={closeViewMenu}
            onPick={(next) => {
              setMode(next);
              setViewMenuOpen(false);
            }}
          />
        )}
        {showColorPicker && colorsMounted && (
          <Suspense fallback={null}>
            <MetricColorPicker hidden={collapsed || !colorsOpen} />
          </Suspense>
        )}
        {showSyncWarning && !collapsed && !colorsOpen && !viewMenuOpen && (
          <div className="floating-controls-sync-warning pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-a)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>{t("quick.syncWarning")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
