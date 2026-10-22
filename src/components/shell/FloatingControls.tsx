import { t, type MessageKey } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Monitor, Palette, Settings, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { Link } from "react-router-dom";
import { usePreferences } from "@/hooks/usePreferences";
import { useViewMode } from "@/hooks/useViewMode";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useAuth } from "@/hooks/useAuth";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useScreenshotMask } from "@/hooks/useScreenshotMask";
import { useCanSyncSiteTheme } from "@/services/siteOwner";
import { MaskIcon } from "@/components/node/MaskPicker";
import { LayoutIcon } from "@/components/node/LayoutIcon";
import { LayoutMenu, StyleMenu } from "./QuickMenus";
import { toggleScreenshotMask } from "@/utils/screenshotMask";
import { getAdminUrl } from "@/services/cfsm/config";
import { readQuickControlsExpanded, writeQuickControlsExpanded } from "@/utils/quickControlsStorage";
import { clsx } from "clsx";

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, labelKey: "appearance.light" },
  { value: "system", icon: Monitor, labelKey: "appearance.system" },
  { value: "dark", icon: Moon, labelKey: "appearance.dark" },
] as const;

type OpenMenu = "layout" | "style" | null;

/**
 * 首页右上角的快捷栏。
 * - 所有人：浅色 / 跟随系统 / 深色（只影响自己这台设备）、后台入口。
 * - 登录站长另外有：布局、风格（弹出面板，改的是全站默认，随后自动同步到后端）、截图打码、主题设置。
 *   访客改不了布局和配色，这几个按钮不给访客看（主题设置页对访客也只是一句说明）。
 * 哪些按钮显示由「设置 → 首页 → 首页快捷按钮」决定；主题设置按钮不让关，否则关光了就回不到设置页。
 */
export function FloatingControls({
  onExpandedChange,
}: {
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { appearance, setAppearance } = usePreferences();
  const { mode, setting, device, setMode } = useViewMode();
  const { data: me } = useAuth();
  const isOwner = useCanSyncSiteTheme();
  const themeSettings = useThemeSettings();
  const { failureStreak } = useNodeStoreStatus();
  // 上次展开着就接着展开（只在宽屏上，见 quickControlsStorage）。
  const [collapsed, setCollapsed] = useState(() => !readQuickControlsExpanded());
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const layoutButtonRef = useRef<HTMLButtonElement>(null);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const settingsReady = themeSettings.isReady;
  const showAdmin = settingsReady && themeSettings.enableAdminButton;
  const showThemeManage = settingsReady && isOwner;
  const showAppearance = settingsReady && themeSettings.quickShowAppearance;
  const showViewMode = settingsReady && isOwner && themeSettings.quickShowViewMode;
  const showStyle = settingsReady && isOwner && themeSettings.quickShowColors;
  const showMask = settingsReady && isOwner && themeSettings.quickShowMask;
  const mask = useScreenshotMask();
  const showSyncWarning = failureStreak >= 2;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;
  useEffect(() => {
    onExpandedChange?.(!collapsed);
  }, [collapsed, onExpandedChange]);
  useEffect(() => () => onExpandedChange?.(false), [onExpandedChange]);

  const toggleControls = () => {
    // 收起快捷栏时同时关掉弹出面板，避免下次展开时自动冒出来。
    const nextCollapsed = !collapsed;
    if (nextCollapsed) setOpenMenu(null);
    setCollapsed(nextCollapsed);
    writeQuickControlsExpanded(!nextCollapsed);
  };
  const toggleMenu = (menu: Exclude<OpenMenu, null>) => setOpenMenu((value) => (value === menu ? null : menu));

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
                ref={layoutButtonRef}
                type="button"
                onClick={() => toggleMenu("layout")}
                aria-label={t("quick.switchView")}
                aria-haspopup="dialog"
                aria-expanded={openMenu === "layout"}
                title={t("quick.currentView", { view: t(`viewMode.${mode}` as MessageKey) })}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  openMenu === "layout" && "control-toggle is-active",
                )}
              >
                <LayoutIcon mode={mode} size={16} />
              </button>
            )}
            {showStyle && (
              <button
                ref={styleButtonRef}
                type="button"
                onClick={() => toggleMenu("style")}
                aria-label={t("quick.styleMenu")}
                aria-haspopup="dialog"
                aria-expanded={openMenu === "style"}
                title={t("quick.styleMenu")}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  openMenu === "style" && "control-toggle is-active",
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
        {showViewMode && openMenu === "layout" && !collapsed && (
          <LayoutMenu
            current={mode}
            setting={setting}
            device={device}
            anchorRef={layoutButtonRef}
            onClose={closeMenu}
            onPick={(next) => {
              setMode(next);
              setOpenMenu(null);
            }}
          />
        )}
        {showStyle && openMenu === "style" && !collapsed && <StyleMenu anchorRef={styleButtonRef} onClose={closeMenu} />}
        {showSyncWarning && !collapsed && openMenu === null && (
          <div className="floating-controls-sync-warning pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-a)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>{t("quick.syncWarning")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
