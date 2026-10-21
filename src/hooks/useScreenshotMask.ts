import { useMemo, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useCanSyncSiteTheme } from "@/hooks/useSiteThemeOptions";
import {
  isNodeInMaskScope,
  maskNodeLike,
  maskText,
  nodeMaskFields,
  readMaskSession,
  resolveScreenshotMask,
  subscribeMaskSession,
} from "@/utils/screenshotMask";

/** 合起来的打码状态（站点设置 + 是不是站长 + 站长这次打开页面点没点小眼睛）。 */
export function useScreenshotMask() {
  const { screenshotMaskFields, screenshotMaskNodes, screenshotMaskMode, screenshotMaskVisitors } = useThemeSettings();
  const isOwner = useCanSyncSiteTheme();
  const current = useSyncExternalStore(subscribeMaskSession, readMaskSession, readMaskSession);
  return useMemo(
    () =>
      resolveScreenshotMask(
        { screenshotMaskFields, screenshotMaskNodes, screenshotMaskMode, screenshotMaskVisitors },
        isOwner,
        current,
      ),
    [current, isOwner, screenshotMaskFields, screenshotMaskMode, screenshotMaskNodes, screenshotMaskVisitors],
  );
}

/** 这台机器要打码的字段；不打码时 null。 */
export function useNodeMask(uuid: string) {
  const state = useScreenshotMask();
  return nodeMaskFields(state, uuid);
}

/** 卡片右上角的小眼睛：站长打码时、这台在打码范围里才显示；revealed 表示现在临时显示着。 */
export function useMaskReveal(uuid: string) {
  const state = useScreenshotMask();
  return { show: state.canReveal && isNodeInMaskScope(state, uuid), revealed: state.revealed.has(uuid) };
}

/**
 * 卡片以外显示机器名的地方（详情页标题、切换下拉、续费提醒、资产页、流量页等）用：
 * name 换名称，node 把一条带 uuid/name/region 的数据整条换好。
 */
export function useMaskLookup() {
  const state = useScreenshotMask();
  return useMemo(
    () => ({
      fieldsOf: (uuid: string) => nodeMaskFields(state, uuid),
      name: (uuid: string, name: string) => (nodeMaskFields(state, uuid)?.name ? maskText(name) : name),
      node: <T extends { uuid: string; name: string; region?: string | null }>(item: T): T =>
        maskNodeLike(item, nodeMaskFields(state, item.uuid)),
    }),
    [state],
  );
}

/** 总览里的资产金额要不要遮住：打码开着、并且勾了「总览资产」。 */
export function useMaskAsset() {
  const state = useScreenshotMask();
  return state.on && state.fields.asset;
}
