import type { JobId } from "../jobs/jobs.ts";
import { getJob, isFullyScanned, sortJobsForPosition } from "../jobs/jobs.ts";
import { fflogsCharacterUrl } from "../fflogs/links.ts";
import type { CharacterDocument, CharacterJobData, EncounterStats, RecruitmentSlot } from "../fflogs/model.ts";
import type { Tier } from "../fflogs/tiers.ts";
import type { CharacterResolution, CompareLoadResult } from "../fflogs/repository.ts";

/** クライアントに返す JSON の形。 */

export interface ApiTier {
  zoneId: number;
  name: string;
  expansion: string;
  partitionName?: string;
  floors: Array<{ index: number; label: string; encounterNames: string[] }>;
}

export interface ApiCell {
  floorIndex: number;
  encounterNames: string[];
  bestPercent: number | null;
  medianPercent: number | null;
  kills: number;
  bestAmount: number;
  fastestKill: number;
  activePercent: number | null;
  activeUnavailableReason?: string;
}

export interface ApiRow {
  name: string;
  world?: string;
  canonicalId: number | null;
  /** そのキャラクターの論理データセンター（候補選択の並び替えに使う） */
  dataCenter?: string;
  /** FFLogs のキャラクターページ。名前をクリックしたときに開く */
  fflogsUrl?: string;
  recruitmentJob: JobId | null;
  recruitmentJobName?: string;
  recruitmentPosition?: string;
  jobConfidence?: "high" | "medium" | "low";
  status: "ok" | "no_world" | "not_found" | "hidden" | "error" | "ambiguous";
  message?: string;
  /** zoneId -> 層ごとの成績 */
  tiers: Record<string, ApiCell[]>;
  /** そのキャラが実際にログを持つジョブ（プローブ済みの場合のみ） */
  availableJobs?: JobId[];
  /** 募集文に着替え可として併記されたジョブ（他ジョブ探索の対象） */
  alternativeJobs?: JobId[];
  /**
   * World 候補が複数あり、DC 優先の先頭を推定で採用した状態。
   * UI で「推定」と示し、ユーザーが選び直せるようにする。
   */
  autoSelected?: boolean;
  /** 募集文にジョブが無く、ログのあるジョブから推定で決めたか */
  autoSelectedJob?: boolean;
  /**
   * **全 21 ジョブを調べ終えたか。**
   * false の間は「他にログのあるジョブが無い」とは言えない（取り漏らしの可能性がある）。
   */
  jobsFullyScanned?: boolean;
  /** ログの有無をすでに調べたジョブ（結果が無かったものも含む） */
  jobsScanned?: JobId[];
  /** World 表記が無く候補が複数ある場合の選択肢 */
  candidates?: Array<{
    canonicalId: number;
    name: string;
    world: string;
    region: string;
    dataCenter?: string;
    lodestoneId?: number;
  }>;
}

export interface ApiWarning {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface ApiRateLimit {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
}

export interface CompareResponse {
  tiers: ApiTier[];
  rows: ApiRow[];
  warnings: ApiWarning[];
  meta: {
    servedFromCache: boolean;
    cacheStoreKind: string;
    credentialsConfigured: boolean;
    rateLimit?: ApiRateLimit;
    fetched: { characters: number; tiers: number };
    /** 鮮度が十分で再取得を見送った Tier 数 */
    skippedFreshTiers: number;
    failures: Array<{ canonicalId: number; jobId: string; message: string }>;
    /** FFLogs へ問い合わせできず、キャッシュのみで応答したか */
    degraded: boolean;
    degradedReason?: string;
    /** どこに時間がかかったか（ms） */
    timings?: { resolveMs: number; rankingsMs: number; totalMs: number };
  /** この compare で FFLogs へ投げたリクエスト数（0 = キャッシュのみ） */
  fflogsRequests?: number;
  };
}

export function toApiTier(tier: Tier): ApiTier {
  return {
    zoneId: tier.zoneId,
    name: tier.name,
    expansion: tier.expansion,
    partitionName: tier.partition?.compactName,
    floors: tier.floors.map((f) => ({ index: f.index, label: f.label, encounterNames: f.encounterNames })),
  };
}

function toApiCell(floorIndex: number, stats: EncounterStats | undefined, names: string[]): ApiCell {
  if (!stats) {
    return {
      floorIndex,
      encounterNames: names,
      bestPercent: null,
      medianPercent: null,
      kills: 0,
      bestAmount: 0,
      fastestKill: 0,
      activePercent: null,
    };
  }
  return {
    floorIndex,
    encounterNames: names,
    bestPercent: stats.bestPercent,
    medianPercent: stats.medianPercent,
    kills: stats.kills,
    bestAmount: stats.bestAmount,
    fastestKill: stats.fastestKill,
    activePercent: stats.activePercent ?? null,
    activeUnavailableReason: stats.activeUnavailableReason,
  };
}

export function toApiRow(
  slot: RecruitmentSlot,
  resolution: CharacterResolution,
  tiers: readonly Tier[],
  jobData: CharacterJobData | undefined,
): ApiRow {
  const jobId = slot.recruitmentJob ?? null;

  const tierMap: Record<string, ApiCell[]> = {};
  for (const tier of tiers) {
    const data = jobData?.tiers[String(tier.zoneId)];
    tierMap[String(tier.zoneId)] = tier.floors.map((floor, i) =>
      toApiCell(floor.index, data?.encounters[i], floor.encounterNames),
    );
  }

  const status: ApiRow["status"] = resolution.reason ?? "ok";

  return {
    name: slot.name,
    world: slot.world,
    canonicalId: resolution.character?.canonicalId ?? null,
    dataCenter: resolution.character?.dataCenter,
    fflogsUrl:
      fflogsCharacterUrl({
        region: resolution.character?.region,
        world: resolution.character?.worldSlug ?? resolution.character?.world ?? slot.world,
        name: resolution.character?.name ?? slot.name,
      }) ?? undefined,
    recruitmentJob: jobId,
    recruitmentJobName: jobId ? getJob(jobId).nameJa : undefined,
    alternativeJobs: slot.alternativeJobs?.filter((id) => id !== jobId),
    recruitmentPosition: slot.recruitmentPosition,
    jobConfidence: slot.jobConfidence,
    status,
    message: resolution.message,
    tiers: tierMap,
    autoSelected: resolution.autoSelected === true,
    autoSelectedJob: resolution.autoSelectedJob === true,
    availableJobs: resolution.availableJobs?.length ? resolution.availableJobs : undefined,
    jobsFullyScanned: resolution.jobsFullyScanned === true,
    jobsScanned: resolution.jobsScanned,
    candidates: resolution.candidates?.map((c) => ({
      canonicalId: c.canonicalId,
      name: c.name,
      world: c.world,
      region: c.region,
      dataCenter: c.dataCenter,
      lodestoneId: c.lodestoneId,
    })),
  };
}

export function buildCompareResponse(
  result: CompareLoadResult,
  slots: readonly RecruitmentSlot[],
  warnings: ApiWarning[] = [],
): CompareResponse {
  const rows = result.resolutions.map((resolution, index) => {
    // resolution.slot は Lodestone から解決した world を含むため、そちらを優先する
    const slot = { ...(slots[index] ?? resolution.slot), ...resolution.slot };
    const jobId = resolution.slot.recruitmentJob;
    const doc: CharacterDocument | null = resolution.character;
    const jobData = doc && jobId ? doc.jobs[jobId] : undefined;
    const row = toApiRow({ ...slot, recruitmentJob: jobId }, resolution, result.tiers, jobData);
    if (doc) {
      // 探索結果・メインジョブの手掛かり・取得済みジョブを合わせて候補にする。
      // 探索は近いロールで打ち切るため、探索結果だけで上書きすると
      // 先に分かっていたメインジョブが候補から消えてしまう。
      const fetched = Object.entries(doc.jobs)
        .filter(([, data]) => Object.keys(data.tiers).length > 0)
        .map(([id]) => id as JobId);
      const available = [
        ...new Set<JobId>([
          ...(doc.knownJobs ?? []),
          ...(doc.tierSnapshot?.mainJobs ?? []),
          ...(row.availableJobs ?? []),
          ...fetched,
        ]),
      ];
      if (available.length > 0) row.availableJobs = sortJobsForPosition(available, row.recruitmentPosition);
      row.jobsScanned = doc.probedJobs ?? [];
      // 「調べた」か「ログがあると分かっている」のどちらかで覆われていれば取り漏らしは無い
      row.jobsFullyScanned = isFullyScanned(doc.probedJobs ?? [], doc.knownJobs ?? []);
    }
    return row;
  });

  return {
    tiers: result.tiers.map(toApiTier),
    rows,
    warnings,
    meta: {
      servedFromCache: result.servedFromCache,
      cacheStoreKind: result.cacheStoreKind,
      credentialsConfigured: result.credentialsConfigured,
      rateLimit: result.rateLimit,
      fetched: result.fetched,
      skippedFreshTiers: result.skippedFreshTiers,
      failures: result.failures.map((f) => ({ canonicalId: f.canonicalId, jobId: f.jobId, message: f.message })),
      degraded: result.degraded,
      degradedReason: result.degradedReason,
      timings: result.timings,
      fflogsRequests: result.fflogsRequests,
    },
  };
}
