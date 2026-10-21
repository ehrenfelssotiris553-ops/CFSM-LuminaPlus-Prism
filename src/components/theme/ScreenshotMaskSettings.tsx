import { useMemo } from "react";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "@/i18n";
import { SettingToggle } from "@/components/theme/SettingControls";
import { useScreenshotMask } from "@/hooks/useScreenshotMask";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import {
  MASK_FIELDS,
  setPickingMask,
  toggleMaskedNode,
  writeScreenshotMask,
  type MaskField,
} from "@/utils/screenshotMask";

const FIELD_LABEL_KEYS: Record<MaskField, MessageKey> = {
  name: "mask.fieldName",
  region: "mask.fieldRegion",
  tags: "mask.fieldTags",
  price: "mask.fieldPrice",
  asset: "mask.fieldAsset",
};

/**
 * 设置 → 外观 →「截图打码」。只存本机、不进站点设置（和掉线通知一样），所以不走设置页的草稿和保存按钮，
 * 改了立刻生效。首页快捷栏的按钮和这里是同一份状态。
 */
export function ScreenshotMaskSettings() {
  const state = useScreenshotMask();
  const nodes = useVisibleNodes();
  const sorted = useMemo(
    () => [...nodes].sort((left, right) => left.weight - right.weight),
    [nodes],
  );
  const selected = new Set(state.nodes);
  const count = sorted.filter((node) => selected.has(node.uuid)).length;
  const allPicked = sorted.length > 0 && count === sorted.length;

  return (
    <div className="flex flex-col gap-4">
      <SettingToggle
        title={t("mask.enable")}
        desc={t("mask.enableDesc")}
        checked={state.on}
        onChange={(on) => writeScreenshotMask({ on })}
      />

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
              aria-pressed={state.fields[field]}
              onClick={() => writeScreenshotMask({ fields: { ...state.fields, [field]: !state.fields[field] } })}
            >
              {t(FIELD_LABEL_KEYS[field])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="setting-subhead flex flex-wrap items-center justify-between gap-2">
          <span className="setting-subhead-title">{t("mask.nodesTitle", { n: count })}</span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className="control-button px-3 py-1.5 text-[12px]"
              disabled={sorted.length === 0}
              onClick={() =>
                writeScreenshotMask({ nodes: allPicked ? [] : sorted.map((node) => node.uuid) })
              }
            >
              {t(allPicked ? "mask.pickNone" : "mask.pickAll")}
            </button>
            <Link
              to="/"
              className="control-button px-3 py-1.5 text-[12px]"
              onClick={() => {
                writeScreenshotMask({ on: true });
                setPickingMask(true);
              }}
            >
              {t("mask.pickOnHome")}
            </Link>
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="setting-hint">{t("common.loading")}</p>
        ) : (
          <div className="mask-node-list">
            {sorted.map((node) => (
              <label key={node.uuid} className="surface-inset mask-node-item">
                <input
                  type="checkbox"
                  checked={selected.has(node.uuid)}
                  onChange={() => toggleMaskedNode(node.uuid)}
                  className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
                />
                <span className="truncate" title={node.name}>
                  {node.name?.trim() || node.uuid}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <p className="setting-hint">{t("mask.hint")}</p>
    </div>
  );
}
