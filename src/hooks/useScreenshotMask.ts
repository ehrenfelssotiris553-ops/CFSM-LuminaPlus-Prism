import { useMemo, useSyncExternalStore } from "react";
import {
  isPickingMask,
  maskNodeLike,
  maskText,
  nodeMaskFields,
  readScreenshotMask,
  subscribeScreenshotMask,
} from "@/utils/screenshotMask";

/** 截图打码的状态（本机）。 */
export function useScreenshotMask() {
  return useSyncExternalStore(subscribeScreenshotMask, readScreenshotMask, readScreenshotMask);
}

/** 是否正在首页上点卡片选打码的机器。 */
export function useMaskPicking() {
  return useSyncExternalStore(subscribeScreenshotMask, isPickingMask, isPickingMask);
}

/** 这台机器要打码的字段；不打码时 null。 */
export function useNodeMask(uuid: string) {
  const state = useScreenshotMask();
  return nodeMaskFields(state, uuid);
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
