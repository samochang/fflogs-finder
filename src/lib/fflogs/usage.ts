import { getCacheStore } from "../cache/store.ts";
import { logger } from "../logger.ts";

/**
 * FFLogs API の利用実績（points / リクエスト数）を日次で記録する。
 *
 * 注意: `pointsSpentThisHour` は 1 リクエスト分遅れて反映されるため、
 * 1 リクエスト単位の消費ポイントは誤差が出る。
 * そこで「リクエスト数（正確）」と「観測された points 増分の累計」を分けて持つ。
 */

export interface UsageEntry {
  /** operation 名 -> リクエスト数 */
  requests: Record<string, number>;
  requestsTotal: number;
  /** 観測された points 増分の累計 */
  pointsObserved: number;
  /** 最後に観測した pointsSpentThisHour */
  lastPointsSpentThisHour?: number;
  /** 観測された最大の limitPerHour */
  limitPerHour?: number;
  /** 最後に観測した pointsResetIn（秒）。観測時刻と合わせて残り時間を出す */
  lastPointsResetIn?: number;
  /**
   * points と pointsResetIn を**同時に**観測した時刻。
   *
   * lastAt は rateLimitData を含まない記録でも更新されるため、
   * それと組み合わせると「古い resetIn + 新しい時刻」で残り時間を誤って長く見積もる。
   */
  lastPointsObservedAt?: string;
  firstAt: string;
  lastAt: string;
}

const EMPTY: UsageEntry = {
  requests: {},
  requestsTotal: 0,
  pointsObserved: 0,
  firstAt: "",
  lastAt: "",
};

export function usageDayKey(day = new Date()): string {
  return day.toISOString().slice(0, 10);
}

function usageStoreKey(day: string): string {
  return `fflogs:usage:${day}`;
}

export interface UsageRecord {
  operation: string;
  /** このリクエストの応答に含まれていた pointsSpentThisHour */
  pointsSpentThisHour?: number;
  limitPerHour?: number;
  pointsResetIn?: number;
  durationMs: number;
}

/** 1 リクエスト分の実績を記録する。 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const store = getCacheStore();
  const day = usageDayKey();
  const key = usageStoreKey(day);
  const current = (await store.get<UsageEntry>(key)) ?? { ...EMPTY, requests: {}, firstAt: new Date().toISOString() };

  current.requests[record.operation] = (current.requests[record.operation] ?? 0) + 1;
  current.requestsTotal += 1;

  if (record.pointsSpentThisHour !== undefined) {
    const previous = current.lastPointsSpentThisHour;
    if (previous !== undefined && record.pointsSpentThisHour >= previous) {
      current.pointsObserved = Math.round((current.pointsObserved + (record.pointsSpentThisHour - previous)) * 100) / 100;
    }
    // points / limit / resetIn は同じ応答から来るので、まとめて 1 つの時刻で記録する
    current.lastPointsSpentThisHour = record.pointsSpentThisHour;
    if (record.limitPerHour !== undefined) current.limitPerHour = record.limitPerHour;
    if (record.pointsResetIn !== undefined) current.lastPointsResetIn = record.pointsResetIn;
    current.lastPointsObservedAt = new Date().toISOString();
  }
  current.lastAt = new Date().toISOString();

  // 実績は長く残す（points は時間枠ごとにリセットされるが、日次の合計は有用）
  await store.set(key, current, 60 * 60 * 24 * 90);
}

export interface UsageSummary {
  today: UsageEntry;
  /** 直近 N 日の合計 */
  recent: { days: number; requestsTotal: number; pointsObserved: number; byOperation: Record<string, number> };
  /** 直近に観測した pointsSpentThisHour と上限 */
  current?: {
    pointsSpentThisHour: number;
    limitPerHour: number;
    remaining: number;
    /** 観測時刻（ISO）。ここから pointsResetIn を数えて残り時間を出す */
    observedAt: string;
    /** 観測時点での回復までの秒数 */
    pointsResetIn?: number;
  };
}

export async function getUsageSummary(days = 7): Promise<UsageSummary> {
  const store = getCacheStore();
  const todayKey = usageDayKey();
  const today = (await store.get<UsageEntry>(usageStoreKey(todayKey))) ?? EMPTY;

  const byOperation: Record<string, number> = {};
  let requestsTotal = 0;
  let pointsObserved = 0;

  for (let i = 0; i < days; i += 1) {
    const day = usageDayKey(new Date(Date.now() - i * 86_400_000));
    const entry = day === todayKey ? today : await store.get<UsageEntry>(usageStoreKey(day));
    if (!entry) continue;
    requestsTotal += entry.requestsTotal;
    pointsObserved += entry.pointsObserved;
    for (const [op, count] of Object.entries(entry.requests)) {
      byOperation[op] = (byOperation[op] ?? 0) + count;
    }
  }

  const current =
    today.lastPointsSpentThisHour !== undefined && today.limitPerHour !== undefined
      ? {
          pointsSpentThisHour: today.lastPointsSpentThisHour,
          limitPerHour: today.limitPerHour,
          remaining: Math.max(0, today.limitPerHour - today.lastPointsSpentThisHour),
          /** points を観測した時刻。ここから pointsResetIn を数えて残り時間を出す */
          observedAt: today.lastPointsObservedAt ?? today.lastAt,
          pointsResetIn: today.lastPointsResetIn,
        }
      : undefined;

  return {
    today,
    recent: { days, requestsTotal, pointsObserved: Math.round(pointsObserved * 100) / 100, byOperation },
    current,
  };
}

/** ログにも出す（開発時に流れを追いやすくする）。 */
export function logUsage(record: UsageRecord, extra: Record<string, unknown> = {}): void {
  logger.info("fflogs.usage", {
    operation: record.operation,
    durationMs: record.durationMs,
    pointsSpentThisHour: record.pointsSpentThisHour,
    limitPerHour: record.limitPerHour,
    pointsResetIn: record.pointsResetIn,
    ...extra,
  });
}
