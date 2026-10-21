import { t, type MessageKey } from "@/i18n";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LatencyThumb, LayoutThumb, SKIN_PREVIEW } from "@/components/ui/OptionCards";
import { getAdminUrl } from "@/services/cfsm/config";
import { isNewViewMode, resolveLatencyStyle, type LatencyStyleSetting } from "@/utils/layouts";
import type { SkinId } from "@/utils/skin";
import type { NodeViewMode } from "@/utils/themeSettings";

/*
 * 设置页的几个小部件：影响范围标签、搜索、电脑上右边的实时预览、访客打开设置页时的说明。
 */

export type ScopeKind = "site" | "device" | "owner" | "visitor";

const SCOPE_KEYS: Record<ScopeKind, MessageKey> = {
  site: "scope.site",
  device: "scope.device",
  owner: "scope.owner",
  visitor: "scope.visitor",
};

/** 每个设置板块标题旁的小标签：改了影响谁（全站 / 仅本机 / 只有你看得到 / 访客可自己切）。 */
export function ScopeBadge({ kind }: { kind: ScopeKind }) {
  return (
    <span className="scope-badge" data-kind={kind} title={t(`scope.${kind}Title` as MessageKey)}>
      {t(SCOPE_KEYS[kind])}
    </span>
  );
}

export interface SettingsIndexEntry {
  id: string;
  tab: string;
  title: MessageKey;
  words?: readonly MessageKey[];
}

/** 搜索设置：输入「打码」「排序」之类，列出有关的板块，点一下跳过去。 */
export function SettingsSearch({
  index,
  tabLabel,
  onGo,
}: {
  index: readonly SettingsIndexEntry[];
  tabLabel: (tab: string) => string;
  onGo: (entry: SettingsIndexEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    // 标题直接命中的排前面，其次是板块里某项设置命中的。
    const hit = (key: MessageKey) => t(key).toLowerCase().includes(needle);
    const byTitle = index.filter((entry) => hit(entry.title));
    const byWord = index.filter((entry) => !hit(entry.title) && (entry.words ?? []).some(hit));
    return [...byTitle, ...byWord].slice(0, 8);
  }, [index, query]);
  const go = (entry: SettingsIndexEntry) => {
    setQuery("");
    onGo(entry);
  };
  return (
    <div className="settings-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={query}
        placeholder={t("settings.searchPlaceholder")}
        aria-label={t("settings.searchLabel")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) go(results[0]);
          if (event.key === "Escape") setQuery("");
        }}
      />
      {query.trim() ? (
        <div className="settings-search-results" role="listbox" aria-label={t("settings.searchLabel")}>
          {results.length === 0 ? (
            <span className="settings-search-empty">{t("settings.searchEmpty")}</span>
          ) : (
            results.map((entry) => (
              <button key={entry.id} type="button" role="option" aria-selected={false} onClick={() => go(entry)}>
                <b>{t(entry.title)}</b>
                <span>{tabLabel(entry.tab)}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 电脑上设置页右边的实时预览：用所选风格的颜色画一个小首页，里面是所选布局和延迟样式的示意图。
 * 只是示意（不连实时数据、不多开连接），手机上不显示，改完点顶上「首页」看真的。
 */
export function SettingsPreview({
  skin,
  desktopMode,
  mobileMode,
  latencyStyle,
}: {
  skin: SkinId;
  desktopMode: NodeViewMode;
  mobileMode: NodeViewMode;
  latencyStyle: LatencyStyleSetting;
}) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const mode = device === "mobile" ? mobileMode : desktopMode;
  const lat = isNewViewMode(mode) ? resolveLatencyStyle(latencyStyle, mode) : null;
  const p = SKIN_PREVIEW[skin];
  const radius = Math.min(p.radius, 10);
  return (
    <aside className="settings-preview" aria-label={t("settings.previewTitle")}>
      <div className="settings-preview-head">
        <b>{t("settings.previewTitle")}</b>
        <span className="instance-segmented settings-preview-switch" role="group">
          {(["mobile", "desktop"] as const).map((value) => (
            <button key={value} type="button" data-active={device === value ? "true" : "false"} aria-pressed={device === value} onClick={() => setDevice(value)}>
              {t(value === "mobile" ? "settings.previewPhone" : "settings.previewDesktop")}
            </button>
          ))}
        </span>
      </div>
      <div className="settings-preview-frame" style={{ background: p.bg, color: p.bar1 }} aria-hidden>
        <span className="settings-preview-top">
          <i style={{ background: p.text, opacity: 0.7 }} />
          <i style={{ background: p.card, border: `1px solid ${p.border}` }} />
        </span>
        <span className="settings-preview-tiles">
          {[50, 64, 44, 58].map((width) => (
            <span key={width} style={{ background: p.card, borderColor: p.border, borderRadius: radius }}>
              <i style={{ background: p.text, opacity: 0.25, width: "40%" }} />
              <i style={{ background: p.text, opacity: 0.7, width: `${width}%`, height: 6 }} />
            </span>
          ))}
        </span>
        {[0, 1].map((index) => (
          <span key={index} className="settings-preview-card" style={{ background: p.card, borderColor: p.border, borderRadius: radius }}>
            <span className="settings-preview-line">
              <i style={{ background: p.text, opacity: 0.35, width: 14 }} />
              <i style={{ background: p.text, opacity: 0.7, width: 70 }} />
            </span>
            <span className="settings-preview-glyph">
              <LayoutThumb mode={mode} />
            </span>
            {lat ? (
              <span className="settings-preview-glyph is-small">
                <LatencyThumb style={lat} />
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <span className="settings-preview-tags">
        <span>{t("settings.previewSkin", { v: t(`skin.name.${skin}` as MessageKey) })}</span>
        <span>{t("settings.previewLayout", { v: t(`viewMode.${mode}` as MessageKey) })}</span>
        <span>{lat ? t("settings.previewLatency", { v: t(`lat.name.${lat}` as MessageKey) }) : t("settings.previewClassicLatency")}</span>
      </span>
      <p className="setting-hint">{t("settings.previewHint")}</p>
    </aside>
  );
}

/** 访客打开设置页：主题设置只有站长能改，这里只说一句、给回首页和去登录的按钮。 */
export function OwnerOnlyNotice() {
  return (
    <div className="owner-only-notice" role="status">
      <span className="owner-only-icon" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
      <b>{t("settings.ownerOnlyTitle")}</b>
      <p>{t("settings.ownerOnlyBody")}</p>
      <span className="owner-only-actions">
        <Link to="/" className="control-button control-toggle is-active px-4 py-2 text-[13px] font-semibold">
          {t("settings.backHome")}
        </Link>
        <a href={getAdminUrl()} className="control-button px-4 py-2 text-[13px] font-semibold">
          {t("settings.ownerOnlyLogin")}
        </a>
      </span>
    </div>
  );
}
