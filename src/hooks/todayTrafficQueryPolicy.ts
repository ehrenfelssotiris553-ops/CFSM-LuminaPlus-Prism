const HOUR_MS = 60 * 60 * 1000;
/**
 * 流量页的数据多久算旧：只在打开页面、或离开后回到页面时超过这个时长才重查一次，不再定时轮询
 * （原来开着页面每 5 分钟、出错时每分钟把每台机器的历史都重拉一遍 —— 后端主题规范禁止定时轮询，
 * 今天的流量本来也变得慢；要最新的点页面上的刷新按钮）。
 */
export const TODAY_TRAFFIC_STALE_MS = 5 * 60 * 1000;

/** `/api/history/all` 支持的时长档位。 */
const HISTORY_HOURS_STEPS = [1, 6, 12, 24, 48] as const;

export function selectActiveTodayTrafficUuids(
  uuids: string[],
  activeUuids: ReadonlySet<string>,
) {
  return [...new Set(uuids.filter((uuid) => activeUuids.has(uuid)))];
}

/**
 * 今日流量由速率采样积分得到，需要覆盖午夜前的一个采样点作为时间基准，
 * 同时时长必须落在后端支持的档位上。
 */
export function getTodayTrafficRecordRangeHours(startMs: number, endMs: number) {
  const elapsedHours = Math.max(1, Math.ceil((endMs - startMs) / HOUR_MS) + 1);
  return HISTORY_HOURS_STEPS.find((hours) => hours >= elapsedHours) ?? 48;
}
