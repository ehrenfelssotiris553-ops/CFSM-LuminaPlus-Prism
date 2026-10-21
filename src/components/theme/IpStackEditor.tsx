import { useMemo, useState } from "react";
import { ScopeBadge } from "@/components/theme/SettingsParts";
import { Network } from "lucide-react";
import { t } from "@/i18n";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { IpStackBadges } from "@/components/node/IpStackBadges";
import { IP_STACK_MODES, ipStackModeLabel, SettingSelect, SettingToggle } from "@/components/theme/SettingControls";
import type { NodeInfo } from "@/types/cfsm";
import { dedupeGroupLabels, getHomeGroupLabel } from "@/utils/homeNodes";
import {
  getIpStackOverride,
  ipStackMode,
  resolveIpStackVisibility,
  setIpStackMode,
  setIpStackModeForNodes,
  type IpStackMode,
  type IpStackOverridesByNode,
} from "@/utils/ipStack";

export interface IpStackEditorSettings {
  showIpv4: boolean;
  showIpv6: boolean;
  homepageIpStackOverrides: IpStackOverridesByNode;
  showIpStackFilter: boolean;
  showIpStackStats: boolean;
}

const PROTOCOLS = ["ipv4", "ipv6"] as const;
/** 批量设置里「这个协议不动」。 */
const KEEP = "keep";
/** 批量设置的「全部节点」。分组名来自后台，用一个不会和分组名撞上的值。 */
const ALL_NODES = "\u0000all";

function protocolLabel(protocol: (typeof PROTOCOLS)[number]): string {
  return protocol === "ipv4" ? "IPv4" : "IPv6";
}

function matchesSearch(client: NodeInfo, keyword: string): boolean {
  if (!keyword) return true;
  return [client.name, client.uuid, client.group, client.region].join(" ").toLowerCase().includes(keyword);
}

/** 一台节点一个协议的「自动 / 显示 / 隐藏」：三个并排按钮，比下拉框少点一次、当前值一眼看得到。 */
function ModeButtons({
  label,
  value,
  onChange,
}: {
  label: string;
  value: IpStackMode;
  onChange: (mode: IpStackMode) => void;
}) {
  return (
    <div className="instance-segmented ip-stack-mode" role="group" aria-label={label}>
      {IP_STACK_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          data-active={value === mode ? "true" : "false"}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {ipStackModeLabel(mode)}
        </button>
      ))}
    </div>
  );
}

/**
 * 主题设置 → 卡片 → V4 / V6 标签与协议筛选。
 *
 * 节点多的站（几十台）原来每台一行两个下拉框，整块比常用的「卡片显示项」还长、手机上要滑几屏。
 * 现在默认只列「已单独设置」的节点，其余靠搜索或「显示全部」；每行用三段按钮并直接显示首页效果。
 */
export function IpStackEditor({
  settings,
  clients,
  loading,
  onChange,
}: {
  settings: IpStackEditorSettings;
  clients: NodeInfo[];
  loading: boolean;
  onChange: (updates: Partial<IpStackEditorSettings>) => void;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [bulkGroup, setBulkGroup] = useState(ALL_NODES);
  const [bulkModes, setBulkModes] = useState<Record<(typeof PROTOCOLS)[number], IpStackMode | typeof KEEP>>({
    ipv4: KEEP,
    ipv6: KEEP,
  });
  const overrides = settings.homepageIpStackOverrides;
  const overriddenCount = clients.filter((client) => Object.hasOwn(overrides, client.uuid)).length;
  const groups = useMemo(() => dedupeGroupLabels(clients.map((client) => client.group)), [clients]);
  const bulkTargets = useMemo(
    () =>
      clients
        .filter((client) => bulkGroup === ALL_NODES || getHomeGroupLabel(client.group || "") === bulkGroup)
        .map((client) => client.uuid),
    [bulkGroup, clients],
  );
  const keyword = search.trim().toLowerCase();
  const listed = clients.filter((client) =>
    keyword ? matchesSearch(client, keyword) : showAll || Object.hasOwn(overrides, client.uuid),
  );
  const bulkReady = bulkTargets.length > 0 && (bulkModes.ipv4 !== KEEP || bulkModes.ipv6 !== KEEP);

  const applyBulk = () => {
    if (!bulkReady) return;
    onChange({
      homepageIpStackOverrides: setIpStackModeForNodes(overrides, bulkTargets, {
        ipv4: bulkModes.ipv4 === KEEP ? null : bulkModes.ipv4,
        ipv6: bulkModes.ipv6 === KEEP ? null : bulkModes.ipv6,
      }),
    });
    setBulkModes({ ipv4: KEEP, ipv6: KEEP });
  };

  const resetAll = () => {
    if (!window.confirm(t("settings.ipStackResetConfirm", { n: overriddenCount }))) return;
    onChange({ homepageIpStackOverrides: {} });
  };

  return (
    <InstancePanel
      id="set-ip-stack"
      titleAction={<ScopeBadge kind="site" />}
      title={t("settings.ipStackTitle")}
      aside={<Network size={16} />}
    >
      <p className="setting-hint mb-3">{t("settings.ipStackHint")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SettingToggle
          title={t("settings.showIpv4")}
          desc={t("settings.ipStackDefaultDesc")}
          checked={settings.showIpv4}
          onChange={(checked) => onChange({ showIpv4: checked })}
        />
        <SettingToggle
          title={t("settings.showIpv6")}
          desc={t("settings.ipStackDefaultDesc")}
          checked={settings.showIpv6}
          onChange={(checked) => onChange({ showIpv6: checked })}
        />
        <SettingToggle
          title={t("settings.showIpStackFilter")}
          desc={t("settings.showIpStackFilterDesc")}
          checked={settings.showIpStackFilter}
          onChange={(checked) => onChange({ showIpStackFilter: checked })}
        />
        <SettingToggle
          title={t("settings.showIpStackStats")}
          desc={t("settings.showIpStackStatsDesc")}
          checked={settings.showIpStackStats}
          onChange={(checked) => onChange({ showIpStackStats: checked })}
        />
      </div>

      {clients.length > 0 && (
        <div className="mt-4">
          <div className="setting-subhead">
            <span className="setting-subhead-title">{t("settings.ipStackBulkTitle")}</span>
            <span className="setting-hint">{t("settings.ipStackBulkHint")}</span>
          </div>
          <div className="ip-stack-bulk mt-2">
            <SettingSelect
              aria-label={t("settings.ipStackBulkGroup")}
              value={bulkGroup}
              onChange={(event) => setBulkGroup(event.target.value)}
            >
              <option value={ALL_NODES}>{t("settings.ipStackBulkAll", { n: clients.length })}</option>
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </SettingSelect>
            {PROTOCOLS.map((protocol) => (
              <SettingSelect
                key={protocol}
                aria-label={`${t("settings.ipStackBulkGroup")} ${protocolLabel(protocol)}`}
                value={bulkModes[protocol]}
                onChange={(event) => {
                  const value = event.target.value as IpStackMode | typeof KEEP;
                  setBulkModes((previous) => ({ ...previous, [protocol]: value }));
                }}
              >
                <option value={KEEP}>{t("settings.ipStackBulkKeep", { protocol: protocolLabel(protocol) })}</option>
                {IP_STACK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {`${protocolLabel(protocol)} · ${ipStackModeLabel(mode)}`}
                  </option>
                ))}
              </SettingSelect>
            ))}
            <button
              type="button"
              className="control-button px-3 py-2 text-[12px]"
              disabled={!bulkReady}
              onClick={applyBulk}
            >
              {t("settings.ipStackBulkApply", { n: bulkTargets.length })}
            </button>
          </div>
        </div>
      )}

      <div className="setting-subhead mt-4">
        <span className="setting-subhead-title">{t("settings.ipStackPerNode")}</span>
        <span className="setting-hint">{t("settings.ipStackOverriddenCount", { n: overriddenCount, total: clients.length })}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label={t("settings.ipStackSearch")}
          placeholder={t("settings.ipStackSearch")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="surface-inset min-w-0 flex-1 px-3 py-2 text-[13px] outline-none"
        />
        <button
          type="button"
          className="control-button px-3 py-2 text-[12px]"
          aria-pressed={showAll}
          disabled={keyword !== ""}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t("settings.ipStackShowOverridden") : t("settings.ipStackShowAll", { n: clients.length })}
        </button>
        <button
          type="button"
          className="control-button px-3 py-2 text-[12px]"
          disabled={overriddenCount === 0}
          onClick={resetAll}
        >
          {t("settings.ipStackReset")}
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        {loading ? <p className="setting-hint">{t("common.loading")}</p> : null}
        {!loading && listed.length === 0 ? (
          <p className="setting-hint">
            {keyword ? t("settings.ipStackEmpty") : t("settings.ipStackNoneOverridden")}
          </p>
        ) : null}
        {listed.map((client) => {
          const override = getIpStackOverride(overrides, client.uuid);
          const effective = resolveIpStackVisibility(client, settings);
          return (
            <div key={client.uuid} className="surface-inset ip-stack-row" data-node-id={client.uuid}>
              <div className="ip-stack-row-info">
                <div className="truncate text-[13px] font-medium" title={client.name}>
                  {client.name}
                </div>
                <div className="ip-stack-row-meta setting-hint">
                  <span>
                    {t("settings.ipStackDetected", {
                      ipv4: client.ipv4 ? "V4 ✓" : "V4 —",
                      ipv6: client.ipv6 ? "V6 ✓" : "V6 —",
                    })}
                  </span>
                  <span className="ip-stack-row-effect">
                    {t("settings.ipStackEffective")}
                    {effective.ipv4 || effective.ipv6 ? (
                      <IpStackBadges {...effective} />
                    ) : (
                      <span>{t("settings.ipStackEffectiveNone")}</span>
                    )}
                  </span>
                </div>
              </div>
              {PROTOCOLS.map((protocol) => (
                <div key={protocol} className="ip-stack-row-control">
                  <span className="setting-hint">{protocolLabel(protocol)}</span>
                  <ModeButtons
                    label={`${client.name} ${protocolLabel(protocol)}`}
                    value={ipStackMode(override[protocol])}
                    onChange={(mode) =>
                      onChange({
                        homepageIpStackOverrides: setIpStackMode(overrides, client.uuid, protocol, mode),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </InstancePanel>
  );
}
