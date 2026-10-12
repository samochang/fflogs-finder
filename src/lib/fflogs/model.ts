import type { JobId } from "../jobs/jobs.ts";

/**
 * 内部データモデル（仕様 §30）。
 *
 * 重要なのは Character → Job → Tier → Encounter という構造で、複数ジョブを混同しないこと。
 * Redis には `character:{canonicalID}` の 1 ドキュメントとして保存する。
 */

/** 1 層（P1〜P4）ぶんの成績。 */
export interface EncounterStats {
  /** 層に複数の encounter が含まれる場合、代表として使った encounter の ID */
  encounterId: number;
  encounterName: string;
  /** 層に含まれる encounter ID（P4 が 2 フェーズに分かれるケース用） */
  encounterIds: number[];
  /** FFLogs の "Best Perf." = zoneRankings.rankings[].rankPercent */
  bestPercent: number | null;
  /** FFLogs の "Median Perf." = zoneRankings.rankings[].medianPercent */
  medianPercent: number | null;
  kills: number;
  bestAmount: number;
  fastestKill: number;
  lockedIn: boolean;
  /** Active（FFLogs の DamageDone テーブルの activeTime）。取得は遅延・任意。 */
  activePercent?: number | null;
  /** Active を取得できなかった理由 */
  activeUnavailableReason?: string;
}

export interface TierJobData {
  zoneId: number;
  difficulty: number;
  metric: string;
  /** FFLogs が返した partition。UI 照合のためそのまま保存する */
  partition: number;
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  /** zoneId -> 層ごとの成績（encounterId をキーにする） */
  encounters: EncounterStats[];
  fetchedAt: string;
}

export interface CharacterJobData {
  jobId: JobId;
  /** FFLogs に渡した specName */
  specName: string;
  /** zoneId -> データ */
  tiers: Record<string, TierJobData>;
  fetchedAt: string;
}

export interface CharacterDocument {
  canonicalId: number;
  name: string;
  world: string;
  worldSlug: string;
  region: string;
  /** 論理データセンター（Elemental / Mana / Gaia / Meteor など）。Lodestone から補う */
  dataCenter?: string;
  /** FFLogs 側でランキング非公開（仕様 §32） */
  hidden: boolean;
  lodestoneId?: number;
  jobs: Record<string, CharacterJobData>;
  /**
   * ログがあると確認できたジョブ（プローブ結果）。
   * 一度調べれば再問い合わせしないよう、キャラクター単位で保持する。
   */
  knownJobs?: JobId[];
  /** knownJobs を取得した日時 */
  knownJobsProbedAt?: string;
  /**
   * ログの有無をすでに調べたジョブ（**結果が無かったものも含む**）。
   *
   * 探索は「見つかった時点で打ち切る」ため、これが全 21 ジョブを覆っていない限り
   * 「他にログのあるジョブが無い」とは言えない。覆っているかどうかを UI で区別する。
   */
  probedJobs?: JobId[];
  /**
   * 対象 Tier のスナップショット（安い 1 クエリで得たもの）。
   *
   * `specName` 無しの `zoneRankings` は encounter ごとに「代表 1 ジョブ」しか返さないため、
   * これは**メインジョブの手掛かり**であって全ジョブの一覧ではない。
   */
  tierSnapshot?: {
    /** この snapshot が対象にしている拡張（大型パッチ）。変わったら取り直す */
    expansion: string;
    /** 対象にした零式（拡張に含まれるもの全部） */
    zoneIds: number[];
    /** 集計方法のバージョン。変わったらキャッシュを取り直す */
    version: number;
    hasLogs: boolean;
    /**
     * 実際にクエリできて得た結果か。
     * レート制限などで確認できなかった場合は false で、**保存しない**
     * （「確認できなかった」を「ログあり」として固定してしまうと、
     *   以降ずっと誤ったキャラクターを選び続ける）。
     */
    verified: boolean;
    /** encounter の代表に選ばれたジョブを kill 数の多い順に並べたもの */
    mainJobs: JobId[];
  };
  updatedAt: string;
}

/** 比較画面に渡す募集情報（仕様 §31）。FFLogs 上のキャラクター情報とは別物。 */
export interface RecruitmentSlot {
  characterId: number | null;
  name: string;
  world?: string;
  /** 募集文に Lodestone のキャラクター URL があればその ID（FFLogs を直接引ける） */
  lodestoneId?: number;
  recruitmentJob?: JobId;
  /**
   * 募集文に「モ＞竜」のように着替え可として併記されたジョブ。
   * 他ジョブのログを探すときの探索対象に使う（全 21 ジョブを引かずに済む）。
   */
  alternativeJobs?: JobId[];
  recruitmentPosition?: string;
  /** ジョブ判定の信頼度（曖昧な場合は UI で確認させる：仕様 §8） */
  jobConfidence?: "high" | "medium" | "low";
}

export function emptyCharacterDocument(input: {
  canonicalId: number;
  name: string;
  world: string;
  worldSlug: string;
  region: string;
  hidden: boolean;
  lodestoneId?: number;
  dataCenter?: string;
}): CharacterDocument {
  return {
    canonicalId: input.canonicalId,
    name: input.name,
    world: input.world,
    worldSlug: input.worldSlug,
    region: input.region,
    hidden: input.hidden,
    lodestoneId: input.lodestoneId,
    dataCenter: input.dataCenter,
    jobs: {},
    updatedAt: new Date().toISOString(),
  };
}
