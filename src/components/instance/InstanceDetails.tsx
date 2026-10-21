import { memoByLanguage, t } from "@/i18n";
import { useEffect, type ReactNode } from "react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { useMaskLookup } from "@/hooks/useScreenshotMask";
import { InstanceSwitcher } from "./InstanceSwitcher";
import {
  formatBytes,
  formatUptimeDays,
} from "@/utils/format";
import { resolveTrafficUsage } from "@/utils/traffic";
import { InstancePanel } from "./InstancePanel";
import { IpStackBadges } from "@/components/node/IpStackBadges";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { resolveIpStackVisibility } from "@/utils/ipStack";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { formatVersionLabel, isNewerVersion } from "@/utils/versionCompare";
import { agentUpdateTarget } from "@/utils/agentVersion";

// Intl.DateTimeFormat 构造开销大，复用一个实例，别每次 metrics 更新都重建
const timeFormatter = memoByLanguage(
  (locale) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
);

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const mask = useMaskLookup();
  const { showIpv4, showIpv6, homepageIpStackOverrides, showAgentUpdateHint, agentUpdateIgnoredVersion } = useThemeSettings();
  const { data: me } = useAuth();
  const { data: config } = usePublicConfig();
  const isOwner = me?.logged_in === true;
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
  const uptime = formatUptimeDays(metrics.uptime);
  // 按 traffic_limit_type (max/sum/up/down/min) 归并上下行，和卡片、后端保持一致——
  // 对非 "sum" 节点直接把上下行相加是错的。配额用按周期重置的月度累计值。
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    metrics.trafficUpMonthly,
    metrics.trafficDownMonthly,
    meta.traffic_limit,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? timeFormatter().format(metrics.updatedAt) : "—";
  // 和首页卡片同一套规则（全站默认 + 每台单独设置），首页显示什么这里就显示什么。
  const ipStack = resolveIpStackVisibility(meta, { showIpv4, showIpv6, homepageIpStackOverrides });
  const trimmedName = meta.name?.trim() ? mask.name(uuid, meta.name.trim()) : undefined;
  const panelTitle = trimmedName
    ? t("instance.panelTitle", { name: trimmedName })
    : t("instance.panelTitleFallback");

  return (
    <InstancePanel
      title={panelTitle}
      titleAction={<InstanceSwitcher currentUuid={uuid} />}
      description={
        isOnline ? undefined : t("instance.offlineNotice")
      }
    >
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("instance.groupSystem")}</div>
          <InfoRow
            label={t("instance.status")}
            value={isOnline ? t("status.online") : t("status.offline")}
          />
          <InfoRow
            label={t("instance.ipStack")}
            value={
              ipStack.ipv4 || ipStack.ipv6 ? (
                <span className="instance-ip-stack">
                  <IpStackBadges {...ipStack} />
                </span>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label="CPU"
            value={`${meta.cpu_name || "—"}${meta.cpu_cores > 0 ? ` (x${meta.cpu_cores})` : ""}`}
          />
          <InfoRow label={t("instance.arch")} value={meta.arch || "—"} />
          <InfoRow label={t("instance.gpu")} value={meta.gpu_name || "—"} />
          <InfoRow label={t("instance.os")} value={meta.os || "—"} />
          {/* 原来这里是「虚拟化」，但 CF-Server-Monitor 不上报该字段(见 toNodeInfo)，
              永远显示「—」。换成后端确实下发、之前一直没用上的内核版本。 */}
          <InfoRow label={t("instance.kernel")} value={meta.kernel_version || "—"} />
          {/* Agent 版本只给登录站长看：最新版本号也只有站长拿得到，访客看了也没法处理。 */}
          {isOwner ? (
            <InfoRow
              label={t("instance.agentVersion")}
              value={
                <AgentVersionValue
                  version={meta.agent_version}
                  latest={agentUpdateTarget(config?.latestAgentVersion ?? "", agentUpdateIgnoredVersion, showAgentUpdateHint)}
                />
              }
            />
          ) : null}
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("instance.groupResources")}</div>
          <InfoRow label={t("metric.memory")} value={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`} />
          <InfoRow
            label="Swap"
            value={
              metrics.swapTotal > 0
                ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                : t("instance.none")
            }
          />
          <InfoRow label={t("metric.disk")} value={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`} />
          <InfoRow
            label={t("metric.load")}
            value={`${metrics.load1.toFixed(2)} | ${metrics.load5.toFixed(2)} | ${metrics.load15.toFixed(2)}`}
          />
          <InfoRow
            label={t("instance.uptime")}
            value={uptime.unit ? `${uptime.value} ${uptime.unit}` : uptime.value}
          />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("instance.groupNetwork")}</div>
          <InfoRow
            label={isOnline ? t("instance.liveNetwork") : t("instance.cachedNetwork")}
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOnline ? t("instance.lastUpdate") : t("instance.lastReport")} value={lastUpdated} />
          {/* 「今日流量」「峰值速度」已移除：后端没有今日累计字节字段，两者只能由历史瞬时速率
              积分/取极值得出，而历史接口每次固定只返回约 120 个点（区间越长采样越粗），
              数值会随返回的采样点大幅漂移，误导性大于参考价值。 */}
          <div className="instance-info-item is-stack">
            <span className="instance-info-label">{t("instance.totalTraffic")}</span>
            <div className="instance-info-traffic">
              <span className="instance-info-value">{`↑ ${formatBytes(metrics.trafficUp)} · ↓ ${formatBytes(metrics.trafficDown)}`}</span>
              {meta.traffic_limit > 0 && (
                <>
                  <div className="instance-progress-track" aria-hidden>
                    <span
                      className="instance-progress-fill"
                      style={{ width: `${trafficUsage.fraction * 100}%` }}
                    />
                  </div>
                  <span className="instance-info-note">
                    {`${formatBytes(trafficUsage.used)} / ${formatBytes(meta.traffic_limit)}`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </InstancePanel>
  );
}

function AgentVersionValue({ version, latest }: { version: string; latest: string }) {
  if (!version) return <>—</>;
  const outdated = isNewerVersion(latest, version);
  return (
    <span className="instance-agent-version">
      {formatVersionLabel(version)}
      {outdated ? (
        <span className="ip-stack-badge" data-tag="amber" title={t("agentUpdate.badgeTitle", { version: formatVersionLabel(latest) })}>
          {t("agentUpdate.badge", { version: formatVersionLabel(latest) })}
        </span>
      ) : null}
    </span>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
