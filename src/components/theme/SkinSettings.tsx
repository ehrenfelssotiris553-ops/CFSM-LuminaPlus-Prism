import type { CSSProperties } from "react";
import { t, type MessageKey } from "@/i18n";
import {
  DEFAULT_SKIN_STYLE,
  SKIN_ACCENTS,
  SKIN_DENSITIES,
  SKIN_IDS,
  SKIN_NUMERIC_FONTS,
  SKIN_RADII,
  sameSkinStyle,
  type SkinId,
  type SkinStyle,
} from "@/utils/skin";

/** 风格卡片上的小预览（画布 / 卡片 / 一行字 / 两根条），颜色取自各风格的代表色。 */
const SKIN_PREVIEW: Record<SkinId, { bg: string; card: string; border: string; text: string; bar1: string; bar2: string; radius: number; barRadius: number }> = {
  lumina: { bg: "#f4f4f5", card: "#ffffff", border: "rgba(24,24,27,0.08)", text: "#18181b", bar1: "#3b82f6", bar2: "#8b5cf6", radius: 8, barRadius: 999 },
  paper: { bg: "#f5f2ea", card: "#fbf9f4", border: "#e0d9ca", text: "#1c1b18", bar1: "#2b2a26", bar2: "#b8441a", radius: 0, barRadius: 0 },
  frost: {
    bg: "radial-gradient(70% 70% at 15% 10%, #ffd8c6 0%, rgba(255,216,198,0) 70%), radial-gradient(70% 70% at 90% 40%, #d9d4ff 0%, rgba(217,212,255,0) 70%), #eef0f6",
    card: "rgba(255,255,255,0.6)",
    border: "rgba(255,255,255,0.9)",
    text: "#1b2133",
    bar1: "#5b5bf0",
    bar2: "#a35bf0",
    radius: 11,
    barRadius: 999,
  },
  terminal: {
    bg: "#0a0d0b",
    card: "#0e1310",
    border: "#1e2b22",
    text: "#d4e4d8",
    bar1: "repeating-linear-gradient(90deg, #4ade80 0 4px, transparent 4px 6px)",
    bar2: "repeating-linear-gradient(90deg, #22d3ee 0 4px, transparent 4px 6px)",
    radius: 1,
    barRadius: 0,
  },
  aurora: {
    bg: "radial-gradient(120% 60% at 50% -10%, rgba(45,212,191,0.4) 0%, rgba(139,92,246,0.3) 40%, rgba(139,92,246,0) 75%), #07070d",
    card: "#11111b",
    border: "rgba(255,255,255,0.08)",
    text: "#f3f3f8",
    bar1: "#22d3ee",
    bar2: "#a78bfa",
    radius: 9,
    barRadius: 999,
  },
  cockpit: {
    bg: "radial-gradient(90% 60% at 50% 0%, rgba(255,176,32,0.18) 0%, rgba(255,176,32,0) 70%), #0a0a0b",
    card: "#131315",
    border: "#232327",
    text: "#f3efe7",
    bar1: "#ffb020",
    bar2: "#ff8a3d",
    radius: 9,
    barRadius: 999,
  },
};

const ACCENT_NAME_KEYS: MessageKey[] = [
  "skin.accentBlue",
  "skin.accentIndigo",
  "skin.accentViolet",
  "skin.accentPink",
  "skin.accentVermilion",
  "skin.accentAmber",
  "skin.accentGreen",
  "skin.accentTeal",
];

function SkinPreview({ skin, accent }: { skin: SkinId; accent?: string }) {
  const p = SKIN_PREVIEW[skin];
  return (
    <span className="skin-tile-preview" style={{ background: p.bg }} aria-hidden>
      <span className="skin-tile-card" style={{ background: p.card, borderColor: p.border, borderRadius: p.radius }} />
      <span className="skin-tile-line" style={{ background: p.text }} />
      <span className="skin-tile-bar" style={{ background: accent || p.bar1, borderRadius: p.barRadius }} />
      <span className="skin-tile-bar is-short" style={{ background: p.bar2, borderRadius: p.barRadius }} />
    </span>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  labelOf,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  labelOf: (option: T) => string;
  onPick: (option: T) => void;
}) {
  return (
    <div>
      <div className="setting-subhead">
        <span className="setting-subhead-title">{label}</span>
      </div>
      <div className="instance-segmented is-prominent is-even" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            data-active={value === option ? "true" : "false"}
            aria-pressed={value === option}
            onClick={() => onPick(option)}
          >
            {labelOf(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 设置 → 外观 →「风格」。五套配色 + 「我的风格」，下面四项自定义叠在所选风格上。
 * 改动走设置页草稿（自动保存），页面上即时预览由 ThemeManage 负责。
 */
export function SkinSettings({
  value,
  mySkin,
  onChange,
  onSaveMine,
}: {
  value: SkinStyle;
  mySkin: SkinStyle | null;
  /** 只传改了的那几项。 */
  onChange: (patch: Partial<SkinStyle>) => void;
  onSaveMine: () => void;
}) {
  const mineActive = sameSkinStyle(value, mySkin);
  const customized =
    value.accent !== DEFAULT_SKIN_STYLE.accent ||
    value.radius !== DEFAULT_SKIN_STYLE.radius ||
    value.density !== DEFAULT_SKIN_STYLE.density ||
    value.numericFont !== DEFAULT_SKIN_STYLE.numericFont;

  return (
    <div className="flex flex-col gap-5">
      <div className="skin-tiles" role="group" aria-label={t("skin.title")}>
        {SKIN_IDS.map((skin) => {
          const active = value.skin === skin && !mineActive;
          return (
            <button
              key={skin}
              type="button"
              className="skin-tile"
              aria-pressed={active}
              onClick={() => onChange({ skin })}
            >
              <SkinPreview skin={skin} />
              <span className="skin-tile-meta">
                <span className="skin-tile-name">{t(`skin.name.${skin}` as MessageKey)}</span>
                <span className="skin-tile-tag">{t(`skin.tag.${skin}` as MessageKey)}</span>
              </span>
            </button>
          );
        })}
        {mySkin ? (
          <button
            type="button"
            className="skin-tile"
            aria-pressed={mineActive}
            onClick={() => onChange(mySkin)}
          >
            <SkinPreview skin={mySkin.skin} accent={mySkin.accent} />
            <span className="skin-tile-meta">
              <span className="skin-tile-name">{t("skin.mine")}</span>
              <span className="skin-tile-tag">{t(`skin.name.${mySkin.skin}` as MessageKey)}</span>
            </span>
          </button>
        ) : (
          <button type="button" className="skin-tile is-empty" onClick={onSaveMine} title={t("skin.saveMineHint")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span className="skin-tile-name">{t("skin.mine")}</span>
          </button>
        )}
      </div>

      <div>
        <div className="setting-subhead">
          <span className="setting-subhead-title">{t("skin.accent")}</span>
        </div>
        <div className="skin-accents" role="group" aria-label={t("skin.accent")}>
          <button
            type="button"
            className="skin-accent is-auto"
            aria-pressed={value.accent === ""}
            aria-label={t("skin.followSkin")}
            title={t("skin.followSkin")}
            onClick={() => onChange({ accent: "" })}
          >
            <span>{t("skin.auto")}</span>
          </button>
          {SKIN_ACCENTS.map((color, index) => (
            <button
              key={color}
              type="button"
              className="skin-accent"
              aria-pressed={value.accent === color}
              aria-label={t(ACCENT_NAME_KEYS[index] ?? "skin.accent")}
              title={t(ACCENT_NAME_KEYS[index] ?? "skin.accent")}
              style={{ "--swatch": color } as CSSProperties}
              onClick={() => onChange({ accent: color })}
            >
              <span />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Segmented
          label={t("skin.radius")}
          options={SKIN_RADII}
          value={value.radius}
          labelOf={(option) => t(`skin.radius.${option}` as MessageKey)}
          onPick={(radius) => onChange({ radius })}
        />
        <Segmented
          label={t("skin.density")}
          options={SKIN_DENSITIES}
          value={value.density}
          labelOf={(option) => t(`skin.density.${option}` as MessageKey)}
          onPick={(density) => onChange({ density })}
        />
        <Segmented
          label={t("skin.numericFont")}
          options={SKIN_NUMERIC_FONTS}
          value={value.numericFont}
          labelOf={(option) => t(`skin.numericFont.${option}` as MessageKey)}
          onPick={(numericFont) => onChange({ numericFont })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="control-button px-4 py-2 text-[13px] font-semibold"
          disabled={!customized}
          onClick={() => onChange({ accent: "", radius: "auto", density: "std", numericFont: "auto" })}
        >
          {t("skin.reset")}
        </button>
        <button
          type="button"
          className="control-button control-toggle is-active px-4 py-2 text-[13px] font-semibold"
          disabled={mineActive}
          onClick={onSaveMine}
        >
          {mineActive ? t("skin.savedMine") : t("skin.saveMine")}
        </button>
      </div>

      <p className="setting-hint">{t("skin.hint")}</p>
    </div>
  );
}
