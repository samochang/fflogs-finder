/**
 * FFLogs v2 client API のレスポンス型。
 *
 * `zoneRankings` / `encounterRankings` / `report.table` は GraphQL 上は JSON スカラーで、
 * sub-selection を書けない（書くとエラーになる）。
 * そのため、実際のレスポンスを観測してここに型として固定する（docs/API-FINDINGS.md 参照）。
 */

export interface FflogsServer {
  id?: number;
  name: string;
  slug: string;
  region?: { id?: number; name: string; slug: string };
}

export interface FflogsCharacter {
  id: number;
  canonicalID: number;
  name: string;
  hidden: boolean;
  lodestoneID?: number;
  claimed?: boolean;
  server: FflogsServer;
}

export interface ZoneRankingEntry {
  encounter: { id: number; name: string };
  /** FFLogs の "Best Perf."（その encounter での最高 parse 百分位） */
  rankPercent: number | null;
  /** FFLogs の "Median Perf."（中央値百分位） */
  medianPercent: number | null;
  allStars: number | null;
  lockedIn: boolean;
  totalKills: number;
  fastestKill: number;
  bestAmount: number;
  /** このランキングが集計された FFLogs の spec（例: "Gunbreaker"） */
  spec: string | null;
}

export interface ZoneRankings {
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  difficulty: number;
  metric: string;
  partition: number;
  zone: number;
  size: number;
  allStars: unknown[];
  rankings: ZoneRankingEntry[];
}

export interface EncounterRank {
  lockedIn: boolean;
  rankPercent: number;
  historicalPercent: number;
  todayPercent: number;
  rankTotalParses: number;
  historicalTotalParses: number;
  todayTotalParses: number;
  guild: { id: number | null; name: string | null; faction: string | null };
  report: { code: string; startTime: number; fightID: number };
  duration: number;
  startTime: number;
  amount: number;
  bracketData: number;
  spec: string;
  bestSpec: string;
  class: number;
  aDPS?: number;
  rDPS?: number;
  pDPS?: number;
}

export interface EncounterRankings {
  bestAmount: number;
  medianPerformance: number;
  /** encounterRankings にのみ存在する「平均」。仕様 §15 の照合結果は docs/API-FINDINGS.md 参照。 */
  averagePerformance: number;
  totalKills: number;
  fastestKill: number;
  difficulty: number;
  metric: string;
  partition: number;
  zone: number;
  ranks: EncounterRank[];
}

export interface FflogsZoneSummary {
  id: number;
  name: string;
  frozen: boolean;
  expansion?: { id: number; name: string };
  difficulties: Array<{ id: number; name: string; sizes: number[] }>;
  encounters: Array<{ id: number; name: string }>;
  partitions: Array<{ id: number; name: string; compactName: string; default: boolean }>;
}

/** report.table(dataType: DamageDone) の最小形。 */
export interface DamageDoneTable {
  data: {
    entries: Array<{
      name: string;
      id: number;
      type: string;
      /**
       * アクティブだった時間（**ミリ秒**）。% ではない。
       * FFLogs の "Active" 列（%）は `activeTime / table.data.totalTime * 100`。
       */
      activeTime: number;
      activeTimeReduced?: number;
      total: number;
      totalRDPS?: number;
      totalADPS?: number;
    }>;
    /** 戦闘時間（ミリ秒）。Active % の分母 */
    totalTime: number;
    /** 戦闘時間（ミリ秒、戦闘外を除く） */
    combatTime: number;
  };
}

export const SAVAGE_DIFFICULTY_ID = 101;
export const NORMAL_DIFFICULTY_ID = 100;
/** FF14 のレイドは 8 人。これで Criterion(4) や Delubrum(48) を除外する。 */
export const RAID_SIZE = 8;
