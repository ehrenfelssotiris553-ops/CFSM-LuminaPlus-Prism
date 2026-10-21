import { t } from "@/i18n";
import { useMaskPicking, useScreenshotMask } from "@/hooks/useScreenshotMask";
import { setPickingMask, toggleMaskedNode, writeScreenshotMask } from "@/utils/screenshotMask";

/*
 * 图标直接画，不从 lucide-react 引（原因见 OwnerStrip 顶部：首页新引用一个只有延迟页面用的图标，
 * Rolldown 会多拆出一个首页文件）。线条和 lucide 一致。
 */
export function MaskIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 这台机器在选机器模式下的状态：picked 表示已经选进打码名单。 */
export function useMaskPick(uuid: string) {
  const state = useScreenshotMask();
  const picking = useMaskPicking();
  return { picking, picked: state.nodes.includes(uuid) };
}

/**
 * 选机器模式下盖在卡片上的一层按钮：点一下选中 / 取消，右上角打勾。
 * 不在选机器模式时什么都不渲染，平时卡片不受影响。
 */
export function MaskPickOverlay({ uuid }: { uuid: string }) {
  const { picking, picked } = useMaskPick(uuid);
  if (!picking) return null;
  return (
    <button
      type="button"
      className="mask-pick-overlay"
      aria-pressed={picked}
      aria-label={t("mask.pickCard")}
      onClick={() => toggleMaskedNode(uuid)}
    >
      <span className="mask-pick-check">{picked ? <CheckIcon /> : null}</span>
    </button>
  );
}

/**
 * 选机器模式的提示条，贴在屏幕底部：已选几台、全选当前显示的机器、完成。
 * uuids 是当前筛选下显示的机器，allUuids 是首页全部机器（算「已选 N 台」，不算已经删掉的机器）。
 */
export function MaskPickBar({ uuids, allUuids }: { uuids: readonly string[]; allUuids: readonly string[] }) {
  const state = useScreenshotMask();
  const picking = useMaskPicking();
  if (!picking) return null;

  const selected = new Set(state.nodes);
  const count = allUuids.filter((uuid) => selected.has(uuid)).length;
  const allShownPicked = uuids.length > 0 && uuids.every((uuid) => selected.has(uuid));
  const toggleAll = () => {
    const shown = new Set(uuids);
    writeScreenshotMask({
      nodes: allShownPicked
        ? state.nodes.filter((uuid) => !shown.has(uuid))
        : [...state.nodes, ...uuids.filter((uuid) => !selected.has(uuid))],
    });
  };

  return (
    <div className="mask-pick-bar" role="region" aria-label={t("mask.title")}>
      <MaskIcon size={15} />
      <span className="mask-pick-bar-text">{t("mask.pickHint")}</span>
      <span className="mask-pick-bar-count" aria-live="polite">
        {t("mask.pickedCount", { n: count })}
      </span>
      <button type="button" className="mask-pick-bar-button" onClick={toggleAll}>
        {t(allShownPicked ? "mask.pickNone" : "mask.pickAll")}
      </button>
      <button type="button" className="mask-pick-bar-button is-primary" onClick={() => setPickingMask(false)}>
        {t("mask.pickDone")}
      </button>
    </div>
  );
}
