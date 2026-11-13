import { t } from "@/i18n";
import { useMinuteClock } from "@/hooks/useClock";
import { MAX_FUTURE_CLOCK_SKEW_MS } from "@/services/cfsm/mappers";

/** 分钟时钟的粒度：它记的是这一分钟里第一次读到的时间，最多比真正的现在慢这么多。 */
const MINUTE_CLOCK_LAG_MS = 60_000;

export function NodeClockWarning({ sampleAt }: { sampleAt: number }) {
  const now = useMinuteClock();
  // 只多给一格分钟时钟的余量：不加的话分钟末尾那几秒，快几秒的正常节点也会闪一下「超前」。
  // 要提醒的是快了几十分钟、几小时的，慢一分钟才提示没关系。
  if (sampleAt <= now + MINUTE_CLOCK_LAG_MS + MAX_FUTURE_CLOCK_SKEW_MS) return null;
  return <span className="clock-warning mx-3 my-1 inline-block text-[11px] text-[var(--status-warning)]" title={t("card.clockAheadHint")}>{t("card.clockAhead")}</span>;
}
