import { ArrowUpCircle } from "lucide-react";
import { t } from "@/i18n";
import { useAgentUpdate } from "@/hooks/useAgentUpdate";
import { useMaskLookup } from "@/hooks/useScreenshotMask";
import { getAdminUrl } from "@/services/cfsm/config";
import { formatNodeNames } from "@/utils/offlineAlerts";
import { formatVersionLabel } from "@/utils/versionCompare";

/** 站长条展开后的「N 台 Agent 可更新到 vX」，带「忽略此版本」和后台入口。 */
export function AgentUpdateNotice() {
  const { latest, outdated: rawOutdated, ignore } = useAgentUpdate();
  const mask = useMaskLookup();
  if (rawOutdated.length === 0) return null;
  const outdated = rawOutdated.map(mask.node);

  const allNames = outdated
    .map((node) => t("agentUpdate.nodeVersion", { name: node.name, version: formatVersionLabel(node.agent_version) }))
    .join("\n");
  return (
    <p className="home-admin-notice" role="status">
      <ArrowUpCircle size={14} aria-hidden className="home-admin-notice-icon" />
      <span className="home-admin-notice-text">
        {t("agentUpdate.notice", { n: outdated.length, version: formatVersionLabel(latest) })}
      </span>
      <span className="home-admin-notice-names" title={allNames}>
        {formatNodeNames(outdated)}
      </span>
      <button
        type="button"
        className="home-admin-notice-ignore"
        title={t("agentUpdate.ignoreTitle", { version: formatVersionLabel(latest) })}
        onClick={ignore}
      >
        {t("agentUpdate.ignore")}
      </button>
      <a href={getAdminUrl()} className="home-admin-notice-link">
        {t("agentUpdate.openAdmin")}
      </a>
    </p>
  );
}
