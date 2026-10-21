import { t } from "@/i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign, X } from "lucide-react";
import { useMaskLookup } from "@/hooks/useScreenshotMask";
import { maskPrice, maskText } from "@/utils/screenshotMask";
import {
  EMPTY_RENEWAL_REMINDER_PREFERENCES,
  formatRenewalReminderExpiry,
  getRenewalReminders,
  getVisibleRenewalReminders,
  RENEWAL_SNOOZE_DAYS,
  RENEWAL_SNOOZE_MS,
  type RenewalReminderPreferences,
  type RenewalReminderSource,
} from "@/utils/renewalReminder";

const STORAGE_KEY = "lumina-renewal-reminders-v1";
const MAX_VISIBLE_ROWS = 4;
const CLOCK_REFRESH_MS = 60 * 60 * 1000;

function readPreferences(): RenewalReminderPreferences {
  if (typeof window === "undefined") return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<RenewalReminderPreferences> | null;
    return {
      dismissedCycles: Array.isArray(parsed?.dismissedCycles)
        ? parsed.dismissedCycles.filter((value): value is string => typeof value === "string")
        : [],
      snoozedUntil:
        parsed?.snoozedUntil && typeof parsed.snoozedUntil === "object"
          ? Object.fromEntries(
              Object.entries(parsed.snoozedUntil)
                .filter(([key, value]) => key.length > 0 && Number.isFinite(Number(value)))
                .map(([key, value]) => [key, Number(value)]),
            )
          : {},
    };
  } catch {
    return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  }
}

function storePreferences(value: RenewalReminderPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 隐私模式或存储配额异常时仍允许本次页面内关闭，持久化失败不打断提醒交互。
  }
}

function AssetLink() {
  return (
    <Link
      to="/assets"
      className="overview-card-action"
      aria-label={t("home.openAssets")}
      title={t("home.assetsTitle")}
    >
      <CircleDollarSign size={15} aria-hidden />
    </Link>
  );
}

export function RenewalReminder({
  nodes,
  warningDays,
}: {
  nodes: RenewalReminderSource[];
  /** 提前几天提醒；站长在设置里定，0 时首页压根不渲染这个入口。 */
  warningDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [preferences, setPreferences] = useState(readPreferences);
  const mask = useMaskLookup();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const titleId = useId();
  const reminders = useMemo(
    () => getRenewalReminders(nodes, clock, { requireOnlineForExpired: true, warningDays }),
    [clock, nodes, warningDays],
  );
  const visibleReminders = useMemo(
    () => getVisibleRenewalReminders(reminders, preferences, clock),
    [clock, preferences, reminders],
  );

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (visibleReminders.length === 0 && open) setOpen(false);
  }, [open, visibleReminders.length]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPreferences(readPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const now = Date.now();
    let nextWakeAt = now + CLOCK_REFRESH_MS;
    for (const value of Object.values(preferences.snoozedUntil)) {
      if (value > now && value < nextWakeAt) nextWakeAt = value;
    }
    const timeout = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(1_000, nextWakeAt - now + 50),
    );
    return () => window.clearTimeout(timeout);
  }, [clock, preferences.snoozedUntil]);

  const updatePreferences = (next: RenewalReminderPreferences) => {
    setPreferences(next);
    storePreferences(next);
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const snooze = () => {
    const until = Date.now() + RENEWAL_SNOOZE_MS;
    updatePreferences({
      ...preferences,
      snoozedUntil: {
        ...preferences.snoozedUntil,
        ...Object.fromEntries(visibleReminders.map((item) => [item.cycleKey, until])),
      },
    });
    setClock(Date.now());
    closeAndRestoreFocus();
  };

  const dismissCurrentCycles = () => {
    const dismissed = new Set(preferences.dismissedCycles);
    const snoozedUntil = { ...preferences.snoozedUntil };
    for (const item of visibleReminders) {
      dismissed.add(item.cycleKey);
      delete snoozedUntil[item.cycleKey];
    }
    updatePreferences({ dismissedCycles: [...dismissed], snoozedUntil });
    closeAndRestoreFocus();
  };

  if (visibleReminders.length === 0) return <AssetLink />;

  // 截图打码的机器：名称、价格、到期天数都换掉（和首页卡片一致）。
  const rows = visibleReminders.slice(0, MAX_VISIBLE_ROWS).map((item) => {
    const fields = mask.fieldsOf(item.uuid);
    return {
      ...item,
      name: fields?.name ? maskText(item.name) : item.name,
      priceLabel: fields?.price ? maskPrice(item.priceLabel) : item.priceLabel,
      expiryLabel: fields?.price ? "••" : formatRenewalReminderExpiry(item.daysRemaining),
    };
  });
  const hiddenCount = visibleReminders.length - rows.length;

  return (
    <div className="renewal-reminder" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="overview-card-action renewal-reminder-trigger"
        aria-label={t("renewal.count", { n: visibleReminders.length })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={t("renewal.count", { n: visibleReminders.length })}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleDollarSign size={15} aria-hidden />
        <span className="renewal-reminder-dot" aria-hidden />
      </button>

      {open && (
        <section
          id={panelId}
          className="renewal-reminder-panel"
          role="dialog"
          aria-labelledby={titleId}
        >
          <header className="renewal-reminder-head">
            <div>
              <div className="renewal-reminder-title-line">
                <h2 id={titleId}>{t("renewal.title")}</h2>
                <span className="renewal-reminder-count">{visibleReminders.length}</span>
              </div>
              <p>{t("renewal.summary", { n: visibleReminders.length, days: warningDays })}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="renewal-reminder-close"
              aria-label={t("renewal.closeLabel")}
              title={t("common.close")}
              onClick={closeAndRestoreFocus}
            >
              <X size={15} aria-hidden />
            </button>
          </header>

          <div className="renewal-reminder-list">
            {rows.map((item) => (
              <div className="renewal-reminder-row" key={item.cycleKey}>
                <div className="renewal-reminder-row-main">
                  <strong title={item.name}>{item.name}</strong>
                  <span>{item.expiryLabel}</span>
                  <span>{item.priceLabel}</span>
                </div>
                <span className="renewal-reminder-status" data-tone={item.tone}>
                  {item.statusLabel}
                </span>
              </div>
            ))}
            {hiddenCount > 0 && (
              <p className="renewal-reminder-more">{t("renewal.more", { n: hiddenCount })}</p>
            )}
          </div>

          <footer className="renewal-reminder-actions">
            <Link to="/assets" className="renewal-reminder-detail" onClick={() => setOpen(false)}>
              {t("common.viewDetails")}
            </Link>
            <button type="button" className="renewal-reminder-later" onClick={snooze}>
              {t("renewal.snooze", { days: RENEWAL_SNOOZE_DAYS })}
            </button>
            <button
              type="button"
              className="renewal-reminder-dismiss"
              onClick={dismissCurrentCycles}
            >
              {t("renewal.dismissCycle")}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
