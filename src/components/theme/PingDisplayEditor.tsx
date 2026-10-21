import { useState } from "react";
import { ScopeBadge } from "@/components/theme/SettingsParts";
import { EyeOff } from "lucide-react";
import { t } from "@/i18n";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { IP_STACK_MODES, ipStackModeLabel, SettingSelect as Select, SettingToggle } from "@/components/theme/SettingControls";
import type { NodeInfo, PingTask } from "@/types/cfsm";
import type { ResolvedThemeSettings } from "@/utils/themeSettings";
import { getIpStackOverride, ipStackMode, setIpStackMode, type IpStackMode } from "@/utils/ipStack";
import {
  explainHomepagePingVisibility,
  isHomepagePingVisible,
  nodePingVisibility,
  setPingVisibilityMode,
  type PingProtocol,
  type PingVisibilitySource,
} from "@/utils/pingVisibility";
import { nodePingLineOverrides, resolveNodePingLineTaskIds, switchPingLine, type PingLineOverridesByNode } from "@/utils/pingLineOverrides";
import { setPingLineOverrides } from "@/services/pingLineOverrideStore";
import { HOMEPAGE_MULTI_PING_MAX_COUNT } from "@/utils/pingTasks";

type Settings = Pick<ResolvedThemeSettings, "showPingIpv4" | "showPingIpv6" | "homepagePingGroupOverrides" | "homepagePingProtocols" | "homepagePingVisibilityOverrides" | "homepageMultiPingTaskIds" | "enableHomepageMultiPing">;
function ModeOptions() {
  return IP_STACK_MODES.map((mode) => <option key={mode} value={mode}>{ipStackModeLabel(mode)}</option>);
}

/** 结果来自哪一层，写在每条线路下面：三层规则叠在一起时，光看「显示 / 隐藏」猜不出为什么。 */
function sourceText(source: PingVisibilitySource, protocol: PingProtocol): string {
  const family = protocol === "ipv6" ? "V6" : "V4";
  switch (source) {
    case "line":
      return t("settings.pingSourceLine");
    case "group":
      return t("settings.pingSourceGroup", { family });
    case "global":
      return t("settings.pingSourceGlobal", { family });
    default:
      return t("settings.pingSourceOther");
  }
}

export function PingDisplayEditor({ settings, clients, tasks, loading, lineOverrides, localLineOverrides, onChange }: {
  settings: Settings;
  clients: NodeInfo[];
  tasks: PingTask[];
  loading: boolean;
  lineOverrides: PingLineOverridesByNode;
  localLineOverrides: PingLineOverridesByNode;
  onChange: (updates: Partial<Settings>) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter((client) => [client.name, client.uuid, client.group, client.region].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const hasOverrides = Object.keys(settings.homepagePingGroupOverrides).length > 0 || Object.keys(settings.homepagePingVisibilityOverrides).length > 0;
  return <InstancePanel id="set-ping-visibility" titleAction={<ScopeBadge kind="site" />} title={t("settings.pingVisibilityTitle")} aside={<EyeOff size={16} />}>
    <p className="setting-hint mb-3">{t("settings.pingVisibilityHint")}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <SettingToggle title={t("settings.showPingIpv4")} checked={settings.showPingIpv4} onChange={(checked) => onChange({ showPingIpv4: checked })} />
      <SettingToggle title={t("settings.showPingIpv6")} checked={settings.showPingIpv6} onChange={(checked) => onChange({ showPingIpv6: checked })} />
    </div>
    <details className="setting-disclosure surface-inset mt-3 px-3 py-3">
      <summary className="text-[13px] font-medium">{t("settings.pingProtocolTitle")}</summary>
      <p className="setting-hint my-3">{t("settings.pingProtocolHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {tasks.map((task) => <label key={task.id} className="min-w-0">
          <span className="setting-hint mb-1 block truncate">{task.name}</span>
          <Select aria-label={t("settings.pingProtocolLabel", { task: task.name })} value={settings.homepagePingProtocols[String(task.id)] ?? "other"} onChange={(event) => onChange({ homepagePingProtocols: { ...settings.homepagePingProtocols, [task.id]: event.target.value as PingProtocol } })}>
            <option value="ipv4">IPv4</option><option value="ipv6">IPv6</option><option value="other">{t("settings.pingProtocolOther")}</option>
          </Select>
        </label>)}
      </div>
    </details>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input type="search" aria-label={t("settings.pingVisibilitySearch")} placeholder={t("settings.pingVisibilitySearch")} value={search} onChange={(event) => setSearch(event.target.value)} className="surface-inset min-w-0 flex-1 px-3 py-2 text-[13px]" />
      <button type="button" className="control-button px-3 py-2 text-[12px]" disabled={!hasOverrides} onClick={() => {
        if (window.confirm(t("settings.pingResetConfirm"))) onChange({ homepagePingVisibilityOverrides: {}, homepagePingGroupOverrides: {} });
      }}>{t("settings.ipStackReset")}</button>
    </div>
    <div className="mt-3 grid gap-3">
      {loading ? <p className="setting-hint">{t("common.loading")}</p> : null}
      {!loading && !filtered.length ? <p className="setting-hint">{t("settings.ipStackEmpty")}</p> : null}
      {filtered.map((client) => {
        const overrides = nodePingVisibility(settings.homepagePingVisibilityOverrides, client.uuid);
        const group = getIpStackOverride(settings.homepagePingGroupOverrides, client.uuid);
        const nodeDefault = resolveNodePingLineTaskIds(settings.homepageMultiPingTaskIds, nodePingLineOverrides(lineOverrides, client.uuid));
        const local = nodePingLineOverrides(localLineOverrides, client.uuid);
        const selected = resolveNodePingLineTaskIds(nodeDefault, local);
        const visibleCount = selected.filter((id) => isHomepagePingVisible(client.uuid, id, settings)).length;
        // 选进首页的线路排前面直接给；没选进的收进「其余线路」—— 它们的显示 / 隐藏要等选进首页才有效果。
        const selectedTasks = selected.flatMap((id) => tasks.filter((task) => task.id === id));
        const otherTasks = tasks.filter((task) => !selected.includes(task.id));
        const renderTask = (task: PingTask) => {
          const included = selected.includes(task.id);
          const effect = explainHomepagePingVisibility(client.uuid, task.id, settings);
          return <div key={task.id} data-task-id={task.id} className="surface-inset min-w-0 rounded-lg px-3 py-3">
            <label className="block min-w-0">
              <span className="mb-1 block break-words text-[13px]">{task.name}</span>
              <Select aria-label={`${client.name} · ${task.name}`} value={ipStackMode(overrides[String(task.id)])} onChange={(event) => onChange({ homepagePingVisibilityOverrides: setPingVisibilityMode(settings.homepagePingVisibilityOverrides, client.uuid, task.id, event.target.value as IpStackMode) })}><ModeOptions /></Select>
            </label>
            <span className="setting-hint mt-2 block" role="status">
              {!included
                ? t("settings.pingNotSelected")
                : `${t(effect.visible ? "settings.pingEffectiveShow" : "settings.pingEffectiveHide")} · ${sourceText(effect.source, effect.protocol)}`}
            </span>
            {!included ? <button type="button" className="control-button mt-2 w-full px-2 py-1 text-[12px]" title={settings.homepageMultiPingTaskIds.includes(task.id) ? undefined : t("settings.pingAddGlobalHint")} disabled={!settings.homepageMultiPingTaskIds.includes(task.id) && settings.homepageMultiPingTaskIds.length >= HOMEPAGE_MULTI_PING_MAX_COUNT} onClick={() => {
              const slot = settings.homepageMultiPingTaskIds.indexOf(task.id);
              if (slot >= 0) setPingLineOverrides(client.uuid, switchPingLine(nodeDefault, local, slot, task.id));
              else if (window.confirm(t("settings.pingAddGlobalHint"))) onChange({ enableHomepageMultiPing: true, homepageMultiPingTaskIds: [...settings.homepageMultiPingTaskIds, task.id] });
            }}>{t(settings.homepageMultiPingTaskIds.includes(task.id) ? "settings.pingRestoreLocal" : "settings.pingAddGlobal")}</button> : null}
          </div>;
        };
        return <details key={client.uuid} data-node-id={client.uuid} open={search.trim() ? true : undefined} className="setting-disclosure surface-inset min-w-0 px-3 py-3">
          <summary className="text-[13px] font-medium">
            <span className="break-words">{client.name}</span>
            <span className="setting-hint ml-2">{t("settings.pingVisibleCount", { visible: visibleCount, selected: selected.length })}</span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["ipv4", "ipv6"] as const).map((protocol) => <label key={protocol} className="min-w-0">
              <span className="setting-hint mb-1 block">{t(protocol === "ipv4" ? "settings.pingGroupV4" : "settings.pingGroupV6")}</span>
              <Select aria-label={`${client.name} ${protocol === "ipv4" ? "V4" : "V6"} ${t("settings.pingGroup")}`} value={ipStackMode(group[protocol])} onChange={(event) => onChange({ homepagePingGroupOverrides: setIpStackMode(settings.homepagePingGroupOverrides, client.uuid, protocol, event.target.value as IpStackMode) })}><ModeOptions /></Select>
            </label>)}
          </div>
          <p className="setting-hint my-3">{t("settings.pingNodeHint")}</p>
          {!settings.enableHomepageMultiPing ? <p className="setting-hint mb-3">{t("settings.pingMultiDisabled")}</p> : null}
          {selectedTasks.length > 0 ? <div className="grid min-w-0 gap-3 sm:grid-cols-2">{selectedTasks.map(renderTask)}</div> : null}
          {otherTasks.length > 0 ? <details className="setting-disclosure mt-3 min-w-0">
            <summary className="setting-hint text-[12px]">{t("settings.pingOtherLines", { n: otherTasks.length })}</summary>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">{otherTasks.map(renderTask)}</div>
          </details> : null}
        </details>;
      })}
    </div>
  </InstancePanel>;
}
