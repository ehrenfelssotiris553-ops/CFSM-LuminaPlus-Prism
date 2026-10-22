import { t, type MessageKey } from "@/i18n";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CfUsageThumb, FollowThumb, LatencyThumb, LayoutThumb, OptionCard, SkinThumb } from "@/components/ui/OptionCards";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { resetMetricColorsToSkin, useHasCustomMetricColors } from "@/hooks/useMetricColors";
import type { ViewModeDevice } from "@/hooks/useViewMode";
import { patchLocalThemeSettings } from "@/services/themeSettingsStore";
import {
  CF_USAGE_STYLE_OPTIONS,
  CLASSIC_VIEW_MODES,
  LATENCY_STYLE_OPTIONS,
  NEW_VIEW_MODES,
  followLayout,
  resolveCfUsageStyle,
} from "@/utils/layouts";
import { SKIN_IDS, type SkinId } from "@/utils/skin";
import type { NodeViewMode, NodeViewModeSetting } from "@/utils/themeSettings";

const MetricColorPicker = lazy(() =>
  import("./MetricColorPicker").then((module) => ({ default: module.MetricColorPicker })),
);

/*
 * 首页快捷栏的两个弹出面板：「布局」和「风格」。两个长得一样（同一种卡片、同样的标题栏），一次只开一个；
 * 点面板外面、按 Esc 都会关上。面板里每一块都折叠着（标题右边写着现在选的是什么），点开一块别的自动收起。
 * 只有登录站长看得到这两个按钮，改了就是全站默认（随后自动同步到后端），设置页里是同一份设置，改哪边都一样。
 */

function QuickPopover({
  label,
  title,
  badge,
  anchorRef,
  onClose,
  children,
}: {
  label: string;
  title: string;
  badge: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
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
  // 打开时焦点放到当前选中的那一项；都折叠着时放到第一块的标题上。
  useEffect(() => {
    const panel = panelRef.current;
    (panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? panel?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={panelRef} className="quick-pop" role="dialog" aria-label={label}>
      <div className="quick-pop-head">
        <b>{title}</b>
        <span className="quick-pop-badge">{badge}</span>
      </div>
      {children}
    </div>
  );
}

function Fold({ title, sub, value, open, onToggle, children }: { title: string; sub: string; value?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <button type="button" className="quick-fold" aria-expanded={open} onClick={onToggle}>
        <span className="quick-fold-text">
          <b>{title}</b>
          <span>{sub}</span>
        </span>
        {value}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? children : null}
    </>
  );
}

/** 「跟随风格」那一项的说明：现在跟到哪个布局（流光跟随时是原版布局）。 */
export function followLayoutText(skin: SkinId, device: ViewModeDevice): string {
  const name = t(`viewMode.${followLayout(skin, device)}` as MessageKey);
  const layout = skin === "lumina" ? t("layout.original", { layout: name }) : name;
  return t("layout.followNow", { skin: t(`skin.name.${skin}` as MessageKey), layout });
}

/** 「布局」面板：「卡片布局」（跟随风格 + 经典 4 种 + 新布局 6 种）和「延迟样式」两块，都折叠着。 */
export function LayoutMenu({
  current,
  setting,
  device,
  anchorRef,
  onPick,
  onClose,
}: {
  /** 这台设备实际用的布局。 */
  current: NodeViewMode;
  /** 设置里存的值（可能是跟随风格）。 */
  setting: NodeViewModeSetting;
  device: ViewModeDevice;
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (mode: NodeViewModeSetting) => void;
  onClose: () => void;
}) {
  const { latencyStyle, skin } = useThemeSettings();
  const [open, setOpen] = useState<"layout" | "lat" | null>(null);
  const toggle = (key: "layout" | "lat") => setOpen((value) => (value === key ? null : key));
  const follows = setting === "follow";
  const currentName = t(`viewMode.${current}` as MessageKey);
  const groups: { titleKey: MessageKey; modes: readonly NodeViewMode[] }[] = [
    { titleKey: "quick.layoutsClassic", modes: device === "mobile" ? CLASSIC_VIEW_MODES.filter((mode) => mode !== "list") : CLASSIC_VIEW_MODES },
    { titleKey: "quick.layoutsNew", modes: NEW_VIEW_MODES },
  ];
  return (
    <QuickPopover
      label={t("quick.layoutMenu")}
      title={t("quick.layoutTitle")}
      badge={t(device === "mobile" ? "quick.defaultPhone" : "quick.defaultDesktop")}
      anchorRef={anchorRef}
      onClose={onClose}
    >
      <Fold
        title={t("quick.cardLayout")}
        sub={t("quick.cardLayoutSub")}
        value={<span className="quick-fold-value">{follows ? t("quick.followValue", { layout: currentName }) : currentName}</span>}
        open={open === "layout"}
        onToggle={() => toggle("layout")}
      >
        <div className="opt-grid" role="radiogroup" aria-label={t("layout.follow")}>
          <OptionCard
            role="menuitemradio"
            thumb={<FollowThumb />}
            name={t("layout.follow")}
            sub={followLayoutText(skin, device)}
            active={follows}
            style={{ gridColumn: "1 / -1" }}
            onPick={() => onPick("follow")}
          />
        </div>
        {groups.map(({ titleKey, modes }) => (
          <div key={titleKey} className="quick-pop-group">
            <span className="quick-pop-label">{t(titleKey)}</span>
            <div className="opt-grid" role="radiogroup" aria-label={t(titleKey)}>
              {modes.map((mode) => (
                <OptionCard
                  key={mode}
                  role="menuitemradio"
                  thumb={<LayoutThumb mode={mode} />}
                  name={t(`viewMode.${mode}` as MessageKey)}
                  sub={follows && mode === current ? t("layout.following") : t(`viewModeSub.${mode}` as MessageKey)}
                  active={!follows && mode === current}
                  following={follows && mode === current}
                  onPick={() => onPick(mode)}
                />
              ))}
            </div>
          </div>
        ))}
      </Fold>
      <Fold
        title={t("lat.setting")}
        sub={t("lat.settingSub")}
        value={<span className="quick-fold-value">{t(`lat.name.${latencyStyle}` as MessageKey)}</span>}
        open={open === "lat"}
        onToggle={() => toggle("lat")}
      >
        <div className="opt-grid">
          {LATENCY_STYLE_OPTIONS.map((style) => (
            <OptionCard
              key={style}
              thumb={<LatencyThumb style={style} />}
              name={t(`lat.name.${style}` as MessageKey)}
              sub={t(`lat.sub.${style}` as MessageKey)}
              active={style === latencyStyle}
              style={style === "auto" ? { gridColumn: "1 / -1" } : undefined}
              onPick={() => patchLocalThemeSettings({ latencyStyle: style })}
            />
          ))}
        </div>
      </Fold>
    </QuickPopover>
  );
}

/** 「风格」面板：「整体风格」（七种，默认的流光占一整行）、「站长用量」、「配色自定义」三块，都折叠着。 */
export function StyleMenu({ anchorRef, onClose }: { anchorRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { skin, cfUsageStyle } = useThemeSettings();
  const { data: config } = usePublicConfig();
  const hasCustomColors = useHasCustomMetricColors();
  const [open, setOpen] = useState<"skin" | "usage" | "colors" | null>(null);
  const toggle = (key: "skin" | "usage" | "colors") => setOpen((value) => (value === key ? null : key));
  const usageNow = resolveCfUsageStyle(cfUsageStyle, skin);
  // 这次打开面板里换过风格、并且指标配色是自己改过的：提示一下能恢复成风格自带的配色。
  const [switched, setSwitched] = useState(false);
  const pick = (next: SkinId) => {
    if (next === skin) return;
    patchLocalThemeSettings({ skin: next });
    setSwitched(true);
  };
  return (
    <QuickPopover label={t("quick.styleMenu")} title={t("skin.title")} badge={t("quick.defaultSite")} anchorRef={anchorRef} onClose={onClose}>
      <Fold
        title={t("quick.skinFold")}
        sub={t("quick.skinFoldSub")}
        value={<span className="quick-fold-value">{t(`skin.name.${skin}` as MessageKey)}</span>}
        open={open === "skin"}
        onToggle={() => toggle("skin")}
      >
        <div className="opt-grid" role="radiogroup" aria-label={t("skin.title")}>
          {SKIN_IDS.map((id) => (
            <OptionCard
              key={id}
              role="menuitemradio"
              thumb={<SkinThumb skin={id} />}
              name={t(`skin.name.${id}` as MessageKey)}
              sub={t(`skin.sub.${id}` as MessageKey)}
              active={id === skin}
              style={id === "lumina" ? { gridColumn: "1 / -1" } : undefined}
              onPick={() => pick(id)}
            />
          ))}
        </div>
        {switched && hasCustomColors ? (
          <div className="quick-pop-hint" role="status">
            <span>{t("quick.customColorsHint")}</span>
            <button type="button" onClick={() => resetMetricColorsToSkin(config?.theme_settings)}>
              {t("quick.resetToSkinColors")}
            </button>
          </div>
        ) : null}
      </Fold>
      <Fold
        title={t("cfStyle.title")}
        sub={t("cfStyle.sub")}
        value={<span className="quick-fold-value">{t(`cfStyle.name.${cfUsageStyle}` as MessageKey)}</span>}
        open={open === "usage"}
        onToggle={() => toggle("usage")}
      >
        <div className="opt-grid" role="radiogroup" aria-label={t("cfStyle.title")}>
          {CF_USAGE_STYLE_OPTIONS.map((style) => (
            <OptionCard
              key={style}
              role="menuitemradio"
              thumb={<CfUsageThumb style={style} />}
              name={t(`cfStyle.name.${style}` as MessageKey)}
              sub={
                style === "auto"
                  ? t("cfStyle.followNow", { v: t(`cfStyle.name.${usageNow}` as MessageKey) })
                  : cfUsageStyle === "auto" && style === usageNow
                    ? t("layout.following")
                    : t(`cfStyle.sub.${style}` as MessageKey)
              }
              active={style === cfUsageStyle}
              following={cfUsageStyle === "auto" && style === usageNow}
              style={style === "auto" ? { gridColumn: "1 / -1" } : undefined}
              onPick={() => patchLocalThemeSettings({ cfUsageStyle: style })}
            />
          ))}
        </div>
      </Fold>
      <Fold
        title={t("colors.title")}
        sub={t(hasCustomColors ? "quick.colorsCustom" : "quick.colorsFollow")}
        value={
          <span className="quick-fold-dots" aria-hidden>
            <i style={{ background: "var(--progress-cpu)" }} />
            <i style={{ background: "var(--progress-memory)" }} />
            <i style={{ background: "var(--progress-disk)" }} />
            <i style={{ background: "var(--progress-network)" }} />
            <i style={{ background: "var(--progress-load)" }} />
          </span>
        }
        open={open === "colors"}
        onToggle={() => toggle("colors")}
      >
        <Suspense fallback={null}>
          <MetricColorPicker embedded />
        </Suspense>
      </Fold>
    </QuickPopover>
  );
}
