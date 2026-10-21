import { useSyncExternalStore } from "react";
import { resolveMe } from "@/services/api";
import { getJwtToken } from "@/services/cfsm/config";
import { queryClient } from "@/services/queryClient";
import type { PublicConfig } from "@/types/cfsm";

/**
 * 这台设备是不是登录站长（改动会自动同步到后端）：站点配置（`authorization`）判成已登录；有令牌时 config 还没到也先算是。
 * 光看令牌不够：令牌过期的老访客每改一次颜色都会撞一次 401。没令牌但后端认 Cookie 的站长也算（见 resolveMe）。
 *
 * 访客看不到布局、风格、配色按钮，也进不了设置页；他们浏览器里以前存过的这些本机设置一律不用（见 useThemeSettings）。
 */
export function canSyncSiteTheme(): boolean {
  const me = resolveMe(queryClient.getQueryData<PublicConfig>(["public"]));
  return getJwtToken() ? me?.logged_in !== false : me?.logged_in === true;
}

/** 设置页、快捷栏、取色器判断「登录站长」用，与自动同步同口径；随登录校验结果更新。 */
export function useCanSyncSiteTheme(): boolean {
  return useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    canSyncSiteTheme,
  );
}
