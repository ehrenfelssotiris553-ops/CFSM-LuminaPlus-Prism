import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta } from "@/hooks/useNode";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getLocalThemeSettings, saveLocalThemeSettings } from "@/services/themeSettingsStore";
import { agentUpdateTarget, findOutdatedAgents } from "@/utils/agentVersion";

/**
 * 「N 台 Agent 可更新」：只有登录站长有（最新版本号 `/api/config` 只发给站长），用的都是页面已经拿到的数据。
 * 首页隐藏的节点也算进去 —— 隐藏只是不展示，Agent 照样要升级。站长条的摘要和展开后的提醒共用这一份。
 */
export function useAgentUpdate() {
  const { data: me } = useAuth();
  const { data: config } = usePublicConfig();
  const settings = useThemeSettings();
  const nodes = useAllNodeMeta();
  const enabled = me?.logged_in === true && settings.isReady;
  const latest = agentUpdateTarget(
    config?.latestAgentVersion ?? "",
    settings.agentUpdateIgnoredVersion,
    settings.showAgentUpdateHint,
  );
  const outdated = useMemo(
    () => (enabled ? findOutdatedAgents(nodes, latest) : []),
    [enabled, nodes, latest],
  );
  return {
    latest,
    outdated,
    /** 这一版不再提醒。存进主题设置：站长的改动会自动同步到后端，换台设备也一样。 */
    ignore: () => saveLocalThemeSettings({ ...getLocalThemeSettings(), agentUpdateIgnoredVersion: latest }),
  };
}
