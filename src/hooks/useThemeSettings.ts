import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useCanSyncSiteTheme } from "@/services/siteOwner";
import {
  getLocalThemeSettings,
  subscribeLocalThemeSettings,
} from "@/services/themeSettingsStore";
import {
  normalizeThemeSettings,
  mergeThemeSettingsLayers,
  withPreferredAppearance,
  type Appearance,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";

type RawThemeSettings = Parameters<typeof normalizeThemeSettings>[0];

let cachedRemote: RawThemeSettings = undefined;
let cachedLocal: Record<string, unknown> | null = null;
let cachedPreferred: Appearance | undefined = undefined;
let cachedResolved: ResolvedThemeSettings | null = null;

/**
 * 后端 `theme_options` 是站点设置；登录站长这台设备上还没同步上去的改动（本地存储）盖在上面。
 * 两者都没设置的键落到主题默认值；默认外观例外，先垫一层后台「默认外观」（`preferred_theme`）。
 * 访客不能改布局、风格和配色（看不到这些按钮、进不了设置页），以前存在浏览器里的本机设置一律不用。
 */
function getResolvedThemeSettings(
  remote: RawThemeSettings,
  local: Record<string, unknown>,
  preferred: Appearance | undefined,
): ResolvedThemeSettings {
  if (
    cachedResolved &&
    remote === cachedRemote &&
    local === cachedLocal &&
    preferred === cachedPreferred
  ) {
    return cachedResolved;
  }
  cachedRemote = remote;
  cachedLocal = local;
  cachedPreferred = preferred;
  cachedResolved = normalizeThemeSettings(
    withPreferredAppearance(preferred, mergeThemeSettingsLayers(remote, local)) as RawThemeSettings,
  );
  return cachedResolved;
}

type ThemeSettingsState = ResolvedThemeSettings & {
  /**
   * 服务端 config 到达后为 true。config 请求失败时它也会变 true，
   * 让应用回退到默认值，而不是一直空白。
   */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useLocalThemeSettings(): Record<string, unknown> {
  const getSnapshot = useCallback(() => getLocalThemeSettings(), []);
  return useSyncExternalStore(subscribeLocalThemeSettings, getSnapshot, getSnapshot);
}

const NO_LOCAL: Record<string, unknown> = {};

export function useThemeSettings(): ThemeSettingsState {
  const { data: config, isError, isLoading } = usePublicConfig();
  const isOwner = useCanSyncSiteTheme();
  const ownLocal = useLocalThemeSettings();
  const local = isOwner ? ownLocal : NO_LOCAL;
  const hasConfig = config != null;
  const isReady = hasConfig || isError;
  return useMemo(
    () => ({
      ...getResolvedThemeSettings(config?.theme_settings, local, config?.preferredAppearance),
      isReady,
      isLoading: isLoading && !hasConfig,
      isError,
    }),
    [
      config?.preferredAppearance,
      config?.theme_settings,
      hasConfig,
      isError,
      isLoading,
      isReady,
      local,
    ],
  );
}
