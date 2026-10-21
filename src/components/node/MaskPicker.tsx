import { t } from "@/i18n";
import { useMaskReveal } from "@/hooks/useScreenshotMask";
import { toggleRevealNode } from "@/utils/screenshotMask";

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

function EyeIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * 打码时被打码的卡片右上角的小眼睛：点一下临时显示这一台，再点又遮住。
 * 只有站长、并且首页小眼睛开着时才有；访客、没打码时什么都不渲染。点卡片其它地方照常进详情页。
 */
export function MaskRevealButton({ uuid }: { uuid: string }) {
  const { show, revealed } = useMaskReveal(uuid);
  if (!show) return null;
  return (
    <button
      type="button"
      className="mask-reveal"
      aria-pressed={revealed}
      aria-label={t(revealed ? "mask.revealHide" : "mask.revealShow")}
      title={t(revealed ? "mask.revealHide" : "mask.revealShow")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleRevealNode(uuid);
      }}
    >
      {revealed ? <EyeIcon /> : <MaskIcon size={15} />}
    </button>
  );
}
