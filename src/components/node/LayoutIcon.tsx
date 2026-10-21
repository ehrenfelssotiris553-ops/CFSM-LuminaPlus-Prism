import { Grid3x3, LayoutGrid, List, Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import type { NodeViewMode } from "@/utils/themeSettings";

/*
 * 原来四种视图沿用 lucide 图标（快捷栏本来就在用）；新加的六种直接画，
 * 不从 lucide 引新图标，避免首页多拆出一个文件（原因见 OwnerStrip 顶部）。线条和 lucide 一致。
 */
const NEW_LAYOUT_PATHS: Partial<Record<NodeViewMode, ReactNode>> = {
  ring: (
    <>
      <circle cx="12" cy="12" r="8" opacity="0.35" />
      <path d="M12 4a8 8 0 0 1 7.6 10.5" />
    </>
  ),
  hero: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  route: (
    <>
      <path d="M5 19v-3" />
      <path d="M10 19v-7" />
      <path d="M15 19V8" />
      <path d="M20 19V4" />
    </>
  ),
  bento: (
    <>
      <rect x="3" y="3" width="11" height="8" rx="2" />
      <rect x="16" y="3" width="5" height="18" rx="2" />
      <rect x="3" y="13" width="11" height="8" rx="2" />
    </>
  ),
  health: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  gauge: (
    <>
      <path d="M4.5 18a9 9 0 1 1 15 0" />
      <path d="m12 14 4-5" />
    </>
  ),
};

export function LayoutIcon({ mode, size = 16 }: { mode: NodeViewMode; size?: number }) {
  if (mode === "large") return <LayoutGrid size={size} aria-hidden />;
  if (mode === "compact") return <Rows3 size={size} aria-hidden />;
  if (mode === "mini") return <Grid3x3 size={size} aria-hidden />;
  if (mode === "list") return <List size={size} aria-hidden />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {NEW_LAYOUT_PATHS[mode]}
    </svg>
  );
}
