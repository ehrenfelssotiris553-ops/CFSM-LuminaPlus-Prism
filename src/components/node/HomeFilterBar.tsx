import { getLocale, t, type MessageKey } from "@/i18n";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import type { HomeSortControlState } from "@/hooks/useHomeSort";
import { HOME_ALL_GROUP, HOME_ALL_REGION, type HomeRegionOption } from "@/utils/homeNodes";
import { HOME_SORT_FIELDS, homeSortFieldLabel } from "@/utils/homeSort";
import { IP_STACK_CATEGORIES, type IpStackCategory } from "@/utils/ipStack";

/*
 * 首页筛选栏：一条圆角底槽里四个下拉 —— 分组 / 地区 / 协议 / 排序（关掉的、只有一种选项的不出现）。
 * 原来是分组一排按钮、地区国旗一排、协议又一排，手机上占两三排还很大；现在只占一排小按钮。
 * 平时每格只写名字（分组、地区…），选了东西就换成选中的值并变蓝；分组那格在当前范围里有离线机器时带个红点。
 * 地区的顺序原来在首页按住国旗拖，现在挪到设置页「首页 → 筛选栏」里拖。
 */

export const STACK_ALL = "all";
export type StackFilter = typeof STACK_ALL | (typeof IP_STACK_CATEGORIES)[number];

export interface GroupMenuItem {
  group: string;
  count: number;
  offline: number;
}

interface Option {
  key: string;
  label: string;
  count?: number;
  flag?: string;
  offline?: boolean;
  active: boolean;
  /** 排序当前项的方向箭头。 */
  arrow?: string;
  pick: () => void;
}

interface Segment {
  key: string;
  label: string;
  /** 选了非默认值时显示这个，并且变蓝。 */
  value: string | null;
  title: string;
  dot?: boolean;
  options: Option[];
}

let regionNames: Intl.DisplayNames | null | undefined;
let regionNamesLocale = "";

/** 地区代码 → 当前语言的国家 / 地区名（浏览器不支持就用代码）。 */
function regionName(code: string): string {
  const locale = getLocale();
  if (regionNames === undefined || regionNamesLocale !== locale) {
    regionNamesLocale = locale;
    try {
      regionNames = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  if (code === "UN") return t("filter.otherRegion");
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

const STACK_LABEL_KEYS: Record<IpStackCategory, MessageKey> = {
  dual: "filter.stack.dual",
  ipv4: "filter.stack.ipv4",
  ipv6: "filter.stack.ipv6",
  none: "filter.stack.none",
};

function Dropdown({ segment, index, total, open, onToggle, onClose }: { segment: Segment; index: number; total: number; open: boolean; onToggle: () => void; onClose: () => void }) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);
  const active = segment.value != null;
  return (
    <div ref={rootRef} className="home-filter-seg">
      <button
        ref={triggerRef}
        type="button"
        className="home-filter-trigger"
        data-active={active ? "" : undefined}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={segment.title}
        onClick={onToggle}
      >
        <span className="home-filter-text">{segment.value ?? segment.label}</span>
        {segment.dot ? <i className="home-filter-dot" aria-hidden /> : null}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div id={panelId} className={clsx("home-filter-panel", index >= total / 2 && "is-end")} role="group" aria-label={segment.title}>
          <span className="home-filter-panel-title">{segment.title}</span>
          {segment.options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="menuitemradio"
              aria-checked={option.active}
              className="home-filter-option"
              data-empty={option.count === 0 && !option.active ? "" : undefined}
              onClick={() => {
                option.pick();
                onClose();
              }}
            >
              {option.flag ? <Flag region={option.flag} size={14} /> : null}
              <span className="home-filter-option-label">{option.label}</span>
              {option.offline ? <i className="home-filter-dot" aria-label={t("filter.hasOffline")} /> : null}
              {option.arrow ? <span className="home-filter-arrow">{option.arrow}</span> : null}
              {option.count != null ? <span className="home-filter-count tabular">{option.count}</span> : null}
              <span className="home-filter-tick" aria-hidden>
                ✓
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HomeFilterBar({
  groups,
  selectedGroup,
  onSelectGroup,
  regions,
  selectedRegion,
  onSelectRegion,
  stackCounts,
  selectedStack,
  onSelectStack,
  sort,
  hidePriceSort = false,
  scopeOffline,
}: {
  groups: GroupMenuItem[] | null;
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  regions: HomeRegionOption[] | null;
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  stackCounts: Record<IpStackCategory, number> | null;
  selectedStack: StackFilter;
  onSelectStack: (stack: StackFilter) => void;
  sort: HomeSortControlState | null;
  /** 后台关了「显示价格」：价格都抹掉了，「价格」排序不列出来。 */
  hidePriceSort?: boolean;
  /** 现在显示的机器里有离线的：分组那格带个红点。 */
  scopeOffline: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const close = useCallback(() => setOpenKey(null), []);
  const segments: Segment[] = [];

  if (groups) {
    segments.push({
      key: "group",
      label: t("filter.group"),
      value: selectedGroup === HOME_ALL_GROUP ? null : selectedGroup,
      title: t("filter.groupTitle"),
      dot: scopeOffline,
      options: groups.map((item) => ({
        key: item.group,
        label: item.group === HOME_ALL_GROUP ? t("common.all") : item.group,
        count: item.count,
        offline: item.offline > 0,
        active: item.group === selectedGroup,
        pick: () => onSelectGroup(item.group),
      })),
    });
  }
  if (regions) {
    const total = regions.reduce((sum, region) => sum + region.count, 0);
    segments.push({
      key: "region",
      label: t("filter.region"),
      value: selectedRegion === HOME_ALL_REGION ? null : regionName(selectedRegion),
      title: t("filter.regionTitle"),
      options: [
        { key: HOME_ALL_REGION, label: t("common.all"), count: total, active: selectedRegion === HOME_ALL_REGION, pick: () => onSelectRegion(HOME_ALL_REGION) },
        ...regions.map((region) => ({
          key: region.code,
          label: regionName(region.code),
          flag: region.code,
          count: region.count,
          active: region.code === selectedRegion,
          pick: () => onSelectRegion(region.code),
        })),
      ],
    });
  }
  if (stackCounts) {
    const total = IP_STACK_CATEGORIES.reduce((sum, category) => sum + stackCounts[category], 0);
    segments.push({
      key: "stack",
      label: t("filter.stack"),
      value: selectedStack === STACK_ALL ? null : t(STACK_LABEL_KEYS[selectedStack]),
      title: t("filter.stackTitle"),
      options: [
        { key: STACK_ALL, label: t("common.all"), count: total, active: selectedStack === STACK_ALL, pick: () => onSelectStack(STACK_ALL) },
        ...IP_STACK_CATEGORIES.filter((category) => stackCounts[category] > 0 || selectedStack === category).map((category) => ({
          key: category,
          label: t(STACK_LABEL_KEYS[category]),
          count: stackCounts[category],
          active: category === selectedStack,
          pick: () => onSelectStack(category),
        })),
      ],
    });
  }
  if (sort) {
    const arrow = sort.direction === "asc" ? "↑" : "↓";
    segments.push({
      key: "sort",
      label: t("filter.sort"),
      value: sort.field === "default" ? null : `${homeSortFieldLabel(sort.field)} ${arrow}`,
      title: t("filter.sortTitle"),
      options: HOME_SORT_FIELDS.filter((field) => !(hidePriceSort && field === "price")).map((field) => ({
        key: field,
        label: homeSortFieldLabel(field),
        arrow: field === sort.field ? arrow : undefined,
        active: field === sort.field,
        // 再选一次当前项换方向；离线机器总在最后（见 homeSort）。
        pick: () => (field === sort.field ? sort.toggleDirection() : sort.setField(field)),
      })),
    });
  }

  if (segments.length === 0) return null;
  return (
    <nav className="home-filter" aria-label={t("filter.label")} style={{ "--segs": segments.length } as CSSProperties}>
      {segments.map((segment, index) => (
        <Dropdown
          key={segment.key}
          segment={segment}
          index={index}
          total={segments.length}
          open={openKey === segment.key}
          onToggle={() => setOpenKey((value) => (value === segment.key ? null : segment.key))}
          onClose={close}
        />
      ))}
    </nav>
  );
}

