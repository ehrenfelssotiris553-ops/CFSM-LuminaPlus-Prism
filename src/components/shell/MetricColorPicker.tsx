import { t } from "@/i18n";
import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Gauge,
  Database,
  Zap,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import {
  METRIC_COLOR_GROUPS,
  METRIC_COLOR_META,
  readEffectiveColors,
  useMetricColorsEditor,
  type MetricColorKey,
} from "@/hooks/useMetricColors";
import { useCanSyncSiteTheme } from "@/hooks/useSiteThemeOptions";
import { useThemeSettings } from "@/hooks/useThemeSettings";

const DARK_DEPTH_PRESETS = [
  { value: 0, labelKey: "colors.depthGray", titleKey: "colors.depthGrayTitle" },
  { value: 60, labelKey: "colors.depthDeep", titleKey: "colors.depthDeepTitle" },
  { value: 100, labelKey: "colors.depthPure", titleKey: "colors.depthPureTitle" },
] as const;

const ICONS: Record<MetricColorKey, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  load: Gauge,
  swap: Database,
  speedIdle: Zap,
  speedLow: Zap,
  speedHigh: Zap,
  speedMax: Zap,
  trafficUp: ArrowUp,
  trafficDown: ArrowDown,
};

/**
 * 指标配色和深色背景深浅。`embedded`：放在首页「风格」面板的折叠区里（不要自己的边框和标题栏底色）。
 * 深色深浅只对「流光」有用（其它风格的深色是配好的），换了风格就灰掉。
 */
export function MetricColorPicker({ hidden = false, embedded = false }: { hidden?: boolean; embedded?: boolean }) {
  const syncsToSite = useCanSyncSiteTheme();
  const { skin } = useThemeSettings();
  const depthLocked = skin !== "lumina";
  const {
    colors,
    darkDepth,
    overriddenColors,
    setColor,
    resetColor,
    setDarkDepth,
    resetAll,
    hasLocalOverrides,
    saveError,
  } = useMetricColorsEditor({ syncsToSite });
  const { resolvedAppearance } = usePreferences();

  // 默认色（无覆盖时生效的 token）。只在明暗模式切换/重置时重读 ——
  // 不能放进拖动热路径：getComputedStyle 会强制同步重排，每帧多次=掉帧。
  const [base, setBase] = useState(readEffectiveColors);
  useEffect(() => setBase(readEffectiveColors()), [resolvedAppearance]);
  const refreshBase = useCallback(() => setBase(readEffectiveColors()), []);

  // 拖动时取色框的值直接来自草稿（无 getComputedStyle），其余指标用稳定的默认色。
  const valueOf = useCallback(
    (key: MetricColorKey) => colors[key] ?? base[key],
    [colors, base],
  );
  return (
    <div
      className={embedded ? "metric-color-picker is-embedded" : "metric-color-picker"}
      role="group"
      aria-label={t("quick.cardColors")}
      hidden={hidden}
    >
      <div className="metric-color-picker-head">
        {/* 登录站长的改动会自动同步到后端（见 startSiteThemeAutoSync），失败提示在页面底部。 */}
        <span>{t("colors.title")}</span>
        <div className="metric-color-head-actions">
          <button
            type="button"
            className="metric-color-reset-all"
            onClick={() => {
              resetAll();
              refreshBase();
            }}
            disabled={!hasLocalOverrides}
          >
            {t("colors.resetAll")}
          </button>
        </div>
      </div>
      {saveError && <div className="metric-color-error">{t("colors.saveError")}</div>}
      <div className="metric-color-group">
        <div className="metric-color-group-title">{t("colors.darkBackground")}</div>
        <fieldset className="dark-depth-control" disabled={depthLocked} data-locked={depthLocked ? "" : undefined}>
          <div className="dark-depth-presets" role="group" aria-label={t("colors.depthPresets")}>
            {DARK_DEPTH_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className="dark-depth-preset"
                data-active={darkDepth === preset.value ? "true" : "false"}
                data-depth={preset.value}
                aria-pressed={darkDepth === preset.value}
                title={t(preset.titleKey)}
                onClick={() => setDarkDepth(preset.value)}
              >
                <span className="dark-depth-preset-swatch" aria-hidden />
                <span>{t(preset.labelKey)}</span>
              </button>
            ))}
          </div>
          <label className="dark-depth-range">
            <span className="dark-depth-range-head">
              <span>{t("colors.blackLevel")}</span>
              <output>{darkDepth}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={darkDepth}
              aria-label={t("colors.blackLevel")}
              onChange={(event) => setDarkDepth(Number(event.target.value))}
            />
          </label>
          {depthLocked ? (
            <p className="dark-depth-hint">{t("colors.depthLumina")}</p>
          ) : resolvedAppearance !== "dark" ? (
            <p className="dark-depth-hint">{t("colors.darkHint")}</p>
          ) : null}
        </fieldset>
      </div>
      {METRIC_COLOR_GROUPS.map((group) => (
        <div className="metric-color-group" key={group.id}>
          <div className="metric-color-group-title">{t(group.labelKey)}</div>
          <div className="metric-color-list">
            {METRIC_COLOR_META.filter((item) => item.group === group.id).map(({ key, labelKey }) => {
              const Icon = ICONS[key];
              const label = t(labelKey);
              // 只有本机改过的颜色能「恢复」（回到站点预设色，站点没设才是主题默认色）。
              const overridden = overriddenColors[key] != null;
              return (
                <div className="metric-color-row" key={key}>
                  <Icon size={14} className="metric-color-icon" />
                  <span className="metric-color-name">{label}</span>
                  <label className="metric-color-swatch" style={{ background: valueOf(key) }}>
                    <input
                      type="color"
                      value={valueOf(key)}
                      onChange={(event) => setColor(key, event.target.value)}
                      aria-label={t("colors.colorOf", { label })}
                    />
                  </label>
                  <button
                    type="button"
                    className="metric-color-reset"
                    onClick={() => {
                      resetColor(key);
                      refreshBase();
                    }}
                    disabled={!overridden}
                    aria-label={t("colors.resetOne", { label })}
                    title={t("switcher.reset")}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
