import type { CSSProperties } from "react";
import { t, type MessageKey } from "@/i18n";
import { OptionCard, SkinThumb } from "@/components/ui/OptionCards";
import {
  DEFAULT_SKIN_STYLE,
  SKIN_ACCENTS,
  SKIN_DENSITIES,
  SKIN_IDS,
  SKIN_NUMERIC_FONTS,
  SKIN_RADII,
  sameSkinStyle,
  type SkinStyle,
} from "@/utils/skin";

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
      <div className="opt-grid is-settings" role="radiogroup" aria-label={t("skin.title")}>
        {SKIN_IDS.map((skin) => (
          <OptionCard
            key={skin}
            thumb={<SkinThumb skin={skin} />}
            name={t(`skin.name.${skin}` as MessageKey)}
            sub={t(`skin.sub.${skin}` as MessageKey)}
            active={value.skin === skin && !mineActive}
            // 默认的流光（原版）单独一整行，下面是另外六个。
            style={skin === "lumina" ? { gridColumn: "1 / -1" } : undefined}
            onPick={() => onChange({ skin })}
          />
        ))}
        {mySkin ? (
          <OptionCard
            thumb={<SkinThumb skin={mySkin.skin} accent={mySkin.accent} />}
            name={t("skin.mine")}
            sub={t(`skin.name.${mySkin.skin}` as MessageKey)}
            active={mineActive}
            onPick={() => onChange(mySkin)}
          />
        ) : (
          <button type="button" className="opt-card is-add" onClick={onSaveMine} title={t("skin.saveMineHint")}>
            <span className="opt-thumb" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </span>
            <span className="opt-text">
              <span className="opt-name">{t("skin.mine")}</span>
              <span className="opt-sub">{t("skin.saveMineHint")}</span>
            </span>
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
