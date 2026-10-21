import { useEffect, useRef, type RefObject } from "react";
import { t, type MessageKey } from "@/i18n";
import { LayoutIcon } from "@/components/node/LayoutIcon";
import { CLASSIC_VIEW_MODES, NEW_VIEW_MODES } from "@/utils/layouts";
import type { ViewModeDevice } from "@/hooks/useViewMode";
import type { NodeViewMode } from "@/utils/themeSettings";

/**
 * 快捷栏「切换卡片视图」的弹出菜单：十种布局分「经典」「新布局」两组列出，点哪个切哪个。
 * 点菜单外面、按 Esc 都会关上；选完也关。手机上没有列表档（列表只给宽屏用）。
 */
export function ViewModeMenu({
  current,
  device,
  anchorRef,
  onPick,
  onClose,
}: {
  current: NodeViewMode;
  device: ViewModeDevice;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onPick: (mode: NodeViewMode) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  // 打开时把焦点放到当前选中的那一项，键盘用户直接上下 Tab。
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  const groups: { titleKey: MessageKey; modes: readonly NodeViewMode[] }[] = [
    {
      titleKey: "quick.layoutsClassic",
      modes: device === "mobile" ? CLASSIC_VIEW_MODES.filter((mode) => mode !== "list") : CLASSIC_VIEW_MODES,
    },
    { titleKey: "quick.layoutsNew", modes: NEW_VIEW_MODES },
  ];

  return (
    <div ref={menuRef} className="view-mode-menu" role="menu" aria-label={t("quick.layoutMenu")}>
      {groups.map(({ titleKey, modes }) => (
        <div key={titleKey} className="view-mode-menu-group">
          <span className="view-mode-menu-title">{t(titleKey)}</span>
          <div className="view-mode-menu-grid">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={mode === current}
                className="view-mode-menu-item"
                onClick={() => onPick(mode)}
              >
                <LayoutIcon mode={mode} size={17} />
                <span>{t(`viewMode.${mode}` as MessageKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
