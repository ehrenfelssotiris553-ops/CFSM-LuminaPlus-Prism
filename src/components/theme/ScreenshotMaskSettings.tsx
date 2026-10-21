import { t, type MessageKey } from "@/i18n";
import { SettingToggle } from "@/components/theme/SettingControls";
import { MASK_FIELDS, type MaskField, type MaskFields, type MaskMode } from "@/utils/screenshotMask";

const FIELD_LABEL_KEYS: Record<MaskField, MessageKey> = {
  name: "mask.fieldName",
  region: "mask.fieldRegion",
  tags: "mask.fieldTags",
  price: "mask.fieldPrice",
  asset: "mask.fieldAsset",
};

const MODES: readonly MaskMode[] = ["only", "except"];

export interface MaskSettingsValue {
  screenshotMaskFields: MaskFields;
  screenshotMaskNodes: string[];
  screenshotMaskMode: MaskMode;
  screenshotMaskVisitors: boolean;
}

/**
 * 设置 → 隐私 →「截图打码」。打码哪些内容、哪几台、范围、访客要不要也打码，都是站点设置（走设置页草稿，自动同步到后端）。
 * 站长自己每次打开首页都不打码，点首页小眼睛才打码；打码时卡片右上角的小眼睛能临时显示某一台。
 */
export function ScreenshotMaskSettings({
  value,
  nodes: sorted,
  onChange,
}: {
  value: MaskSettingsValue;
  /** 设置页已经拉好、排好序的节点列表（不为这里去连实时数据）。 */
  nodes: readonly { uuid: string; name: string }[];
  onChange: (patch: Partial<MaskSettingsValue>) => void;
}) {
  const selected = new Set(value.screenshotMaskNodes);
  const count = sorted.filter((node) => selected.has(node.uuid)).length;
  const allPicked = sorted.length > 0 && count === sorted.length;
  const except = value.screenshotMaskMode === "except";
  const toggleNode = (uuid: string) =>
    onChange({
      screenshotMaskNodes: selected.has(uuid)
        ? value.screenshotMaskNodes.filter((id) => id !== uuid)
        : [...value.screenshotMaskNodes, uuid],
    });

  return (
    <div className="flex flex-col gap-4">
      <SettingToggle
        title={t("mask.visitors")}
        desc={t("mask.visitorsDesc")}
        checked={value.screenshotMaskVisitors}
        onChange={(on) => onChange({ screenshotMaskVisitors: on })}
      />

      <div>
        <div className="setting-subhead">
          <span className="setting-subhead-title">{t("mask.modeTitle")}</span>
        </div>
        <div className="instance-segmented is-prominent is-even" role="radiogroup" aria-label={t("mask.modeTitle")}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value.screenshotMaskMode === mode}
              data-active={value.screenshotMaskMode === mode ? "true" : "false"}
              onClick={() => onChange({ screenshotMaskMode: mode })}
            >
              {t(mode === "only" ? "mask.modeOnly" : "mask.modeExcept")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="setting-subhead">
          <span className="setting-subhead-title">{t("mask.fieldsTitle")}</span>
        </div>
        <div className="mask-field-chips" role="group" aria-label={t("mask.fieldsTitle")}>
          {MASK_FIELDS.map((field) => (
            <button
              key={field}
              type="button"
              className="mask-field-chip"
              aria-pressed={value.screenshotMaskFields[field]}
              onClick={() => onChange({ screenshotMaskFields: { ...value.screenshotMaskFields, [field]: !value.screenshotMaskFields[field] } })}
            >
              {t(FIELD_LABEL_KEYS[field])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="setting-subhead">
          <span className="setting-subhead-title">{t(except ? "mask.nodesExceptTitle" : "mask.nodesOnlyTitle")}</span>
          <span className="setting-hint">{t(except ? "mask.nodesExceptHint" : "mask.nodesOnlyHint")}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="setting-hint">{t("mask.pickedCount", { n: count })}</span>
          <button
            type="button"
            className="theme-manage-button is-compact"
            disabled={sorted.length === 0}
            onClick={() => onChange({ screenshotMaskNodes: allPicked ? [] : sorted.map((node) => node.uuid) })}
          >
            {t(allPicked ? "mask.pickNone" : "mask.pickAll")}
          </button>
        </div>
        <div className="mask-node-list mt-2">
          {sorted.map((node) => {
            const picked = selected.has(node.uuid);
            const masked = except ? !picked : picked;
            return (
              <label key={node.uuid} className="surface-inset mask-node-item">
                <input type="checkbox" checked={picked} onChange={() => toggleNode(node.uuid)} className="h-4 w-4 shrink-0 accent-[var(--accent-500)]" />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                <span className="mask-node-state" data-masked={masked ? "" : undefined}>
                  {t(masked ? "mask.stateMasked" : "mask.stateShown")}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <p className="setting-hint">{t("mask.cosmeticHint")}</p>
    </div>
  );
}
