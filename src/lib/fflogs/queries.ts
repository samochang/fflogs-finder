import type { JobId } from "../jobs/jobs.ts";
import { getJob } from "../jobs/jobs.ts";
import type { EncounterRankings, FflogsCharacter, ZoneRankings } from "./types.ts";
import { SAVAGE_DIFFICULTY_ID } from "./types.ts";
import type { CharacterJobData, EncounterStats, TierJobData } from "./model.ts";
import type { Tier } from "./tiers.ts";

/**
 * GraphQL クエリの組み立て（仕様 §24）。
 *
 * 1 層 = 1 request / 1 Tier = 1 request には分割しない。
 * `characterData.character { z73: zoneRankings(...) z68: ... }` のように
 * alias で 1 リクエストにまとめる。
 *
 * 注意: zoneRankings / encounterRankings / report.table は GraphQL 上は JSON スカラーなので
 * sub-selection を書けない（書くと "must not have a sub selection" エラー）。
 */

export interface ZoneRankingsRequest {
  /** キャラクターの FFLogs ID（canonicalID） */
  characterId: number;
  jobId: JobId;
  zoneIds: number[];
  /** 省略時は FFLogs 側の既定（= UI と同じ）パーティション */
  partition?: number;
  /** 省略時は Savage */
  difficulty?: number;
  metric?: string;
}

const CHARACTER_FIELDS = /* GraphQL */ `
  id
  canonicalID
  name
  hidden
  lodestoneID
  server {
    id
    name
    slug
    region {
      id
      name
      slug
    }
  }
`;

function aliasForZone(zoneId: number): string {
  return `z${zoneId}`;
}

/**
 * 複数キャラクター × 複数 Tier を 1 リクエストにまとめる。
 * 8 人 × 6 Tier = 48 alias になる。
 */
export function buildZoneRankingsQuery(requests: readonly ZoneRankingsRequest[]): string {
  const blocks = requests.map((request, index) => {
    const job = getJob(request.jobId);
    const difficulty = request.difficulty ?? SAVAGE_DIFFICULTY_ID;
    const metric = request.metric ?? "dps";
    const partition = request.partition !== undefined ? `, partition: ${request.partition}` : "";

    const zoneFields = request.zoneIds
      .map((zoneId) => `${aliasForZone(zoneId)}: zoneRankings(zoneID: ${zoneId}, specName: ${JSON.stringify(job.specName)}, difficulty: ${difficulty}, metric: ${metric}${partition})`)
      .join("\n      ");

    return `    c${index}: character(id: ${request.characterId}) {\n      ${CHARACTER_FIELDS}\n      ${zoneFields}\n    }`;
  });

  return `query ZoneRankingsBatch {\n  characterData {\n${blocks.join("\n")}\n  }\n}`;
}

/** キャラクター特定クエリ（仕様 §11）。名前 + World + Region で引く。 */
export function buildCharacterLookupQuery(name: string, serverSlug: string, serverRegion: string): string {
  return `query CharacterLookup {
  characterData {
    character(name: ${JSON.stringify(name)}, serverSlug: ${JSON.stringify(serverSlug)}, serverRegion: ${JSON.stringify(serverRegion)}) {
      ${CHARACTER_FIELDS}
    }
  }
}`;
}

/**
 * 複数のキャラクター特定を 1 リクエストにまとめる。
 *
 * 1 件ずつ引くと 1 回あたり 200ms 程度かかるため、8 人ぶんを直列に引くと 1.6 秒かかる。
 * alias でまとめて 1 往復にする。
 */
export interface CharacterLookupTarget {
  /** 結果の割り当てに使うキー */
  key: string;
  name?: string;
  serverSlug?: string;
  serverRegion?: string;
  lodestoneID?: number;
  id?: number;
}

export function buildCharacterBatchQuery(targets: readonly CharacterLookupTarget[]): string {
  const blocks = targets.map((target, index) => {
    const args: string[] = [];
    if (target.id !== undefined) args.push(`id: ${target.id}`);
    if (target.lodestoneID !== undefined) args.push(`lodestoneID: ${target.lodestoneID}`);
    if (target.name !== undefined) args.push(`name: ${JSON.stringify(target.name)}`);
    if (target.serverSlug !== undefined) args.push(`serverSlug: ${JSON.stringify(target.serverSlug)}`);
    if (target.serverRegion !== undefined) args.push(`serverRegion: ${JSON.stringify(target.serverRegion)}`);
    return `    t${index}: character(${args.join(", ")}) {
      ${CHARACTER_FIELDS}
    }`;
  });

  return `query CharacterBatch {\n  characterData {\n${blocks.join("\n")}\n  }\n}`;
}

/** Lodestone ID からキャラクターを引く（World 表記が無いときに使う）。 */
export function buildCharacterByLodestoneIdQuery(lodestoneId: number): string {
  return `query CharacterByLodestone {
  characterData {
    character(lodestoneID: ${lodestoneId}) {
      ${CHARACTER_FIELDS}
    }
  }
}`;
}

/** canonicalID からキャラクターを引く。 */
export function buildCharacterByIdQuery(id: number): string {
  return `query CharacterById {
  characterData {
    character(id: ${id}) {
      ${CHARACTER_FIELDS}
    }
  }
}`;
}

/**
 * 「他ジョブのログが存在するか」を安価に判定するためのプローブ（仕様 §20 / §22）。
 * 直近 1 Tier だけを全ジョブぶん alias でまとめて 1 リクエストにする。
 */
export function buildJobProbeQuery(characterId: number, zoneId: number, jobIds: readonly JobId[]): string {
  const fields = jobIds
    .map((jobId, index) => {
      const job = getJob(jobId);
      return `      j${index}: zoneRankings(zoneID: ${zoneId}, specName: ${JSON.stringify(job.specName)}, difficulty: ${SAVAGE_DIFFICULTY_ID}, metric: dps)`;
    })
    .join("\n");

  return `query JobProbe {
  characterData {
    character(id: ${characterId}) {
      id
      canonicalID
${fields}
    }
  }
}`;
}

/**
 * 「その Tier にログが 1 つでもあるか」をまとめて確認する軽いクエリ。
 *
 * `specName` を指定しない `zoneRankings` は既定ジョブ 1 つぶんだけを返すため、
 * 1 キャラ = 1 alias（実測 約 5 points）で判定できる。
 * World 候補が複数あるとき、ログが無いキャラを推測で選ばないために使う。
 */
export function buildHasLogsQuery(
  characterIds: readonly number[],
  zoneIds: readonly number[],
  difficulty = SAVAGE_DIFFICULTY_ID,
): string {
  const blocks = characterIds.map((id, index) => {
    const zones = zoneIds
      .map((zoneId, zi) => `      z${zi}: zoneRankings(zoneID: ${zoneId}, difficulty: ${difficulty}, metric: dps)`)
      .join("\n");
    return `    h${index}: character(id: ${id}) {\n      id\n${zones}\n    }`;
  });
  return `query HasLogs {\n  characterData {\n${blocks.join("\n")}\n  }\n}`;
}

/** Active 取得用: encounter のランキングから Best Perf の fight（report code / fightID）を得る。 */
export function buildEncounterRankingsQuery(
  characterId: number,
  encounterId: number,
  jobId: JobId,
  difficulty = SAVAGE_DIFFICULTY_ID,
  metric = "dps",
): string {
  const job = getJob(jobId);
  return `query EncounterRankings {
  characterData {
    character(id: ${characterId}) {
      id
      encounterRankings(encounterID: ${encounterId}, specName: ${JSON.stringify(job.specName)}, difficulty: ${difficulty}, metric: ${metric})
    }
  }
}`;
}

/** FFLogs の "Active" 列（DamageDone テーブルの activeTime）を取る。 */
export function buildDamageDoneQuery(reportCode: string, fightIds: readonly number[]): string {
  return `query DamageDone {
  reportData {
    report(code: ${JSON.stringify(reportCode)}) {
      table(dataType: DamageDone, fightIDs: [${fightIds.join(", ")}])
    }
  }
}`;
}

/**
 * ワールド一覧の解決（ワールド名 -> slug/region）。
 *
 * 実測 31 points かかるため通常は使わない。
 * `npm run fetch:worlds` で `worlds.generated.ts` を更新するのが基本。
 */
export function buildWorldIndexQuery(): string {
  return `query WorldIndex {
  worldData {
    regions {
      id
      name
      slug
      servers(limit: 500) {
        data {
          name
          slug
        }
      }
    }
  }
}`;
}

/** レスポンスから `c0`, `c1`, ... を取り出す。 */
export interface ZoneRankingsBatchResponse {
  characterData: Record<string, (FflogsCharacter & Record<string, ZoneRankings | null>) | null>;
}

export function parseZoneRankingsBatch(
  response: ZoneRankingsBatchResponse,
  requests: readonly ZoneRankingsRequest[],
  tiers: readonly Tier[],
): Array<{ character: FflogsCharacter | null; jobData: CharacterJobData | null }> {
  return requests.map((request, index) => {
    const key = `c${index}`;
    const raw = response.characterData[key] ?? null;
    if (!raw) return { character: null, jobData: null };

    const job = getJob(request.jobId);
    const tiersData: Record<string, TierJobData> = {};
    const now = new Date().toISOString();

    for (const tier of tiers) {
      const rankings = raw[aliasForZone(tier.zoneId)] as ZoneRankings | null | undefined;
      if (!rankings) continue;
      tiersData[String(tier.zoneId)] = mapTierJobData(tier, rankings, now);
    }

    return {
      character: raw,
      jobData: {
        jobId: request.jobId,
        specName: job.specName,
        tiers: tiersData,
        fetchedAt: now,
      },
    };
  });
}

/** zoneRankings の JSON を層ごとの成績に正規化する。 */
export function mapTierJobData(tier: Tier, rankings: ZoneRankings, fetchedAt: string): TierJobData {
  const byEncounterId = new Map((rankings.rankings ?? []).map((r) => [r.encounter.id, r]));

  const encounters: EncounterStats[] = tier.floors.map((floor) => {
    const entries = floor.encounterIds.map((id) => byEncounterId.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));

    if (entries.length === 0) {
      return {
        encounterId: floor.encounterIds[0]!,
        encounterName: floor.encounterNames[0]!,
        encounterIds: floor.encounterIds,
        bestPercent: null,
        medianPercent: null,
        kills: 0,
        bestAmount: 0,
        fastestKill: 0,
        lockedIn: false,
      };
    }

    // 最終層が 2 フェーズに分かれる場合は、良い方（kill がある方）を代表値にする
    const primary = entries.reduce((best, e) => {
      if ((e.totalKills ?? 0) !== (best.totalKills ?? 0)) return (e.totalKills ?? 0) > (best.totalKills ?? 0) ? e : best;
      return (e.rankPercent ?? -1) > (best.rankPercent ?? -1) ? e : best;
    });

    const killTimes = entries.map((e) => e.fastestKill ?? 0).filter((t) => t > 0);
    const fastestKill = killTimes.length > 0 ? Math.min(...killTimes) : 0;

    return {
      encounterId: primary.encounter.id,
      encounterName: primary.encounter.name,
      encounterIds: floor.encounterIds,
      bestPercent: primary.rankPercent,
      medianPercent: primary.medianPercent,
      kills: entries.reduce((sum, e) => sum + (e.totalKills ?? 0), 0),
      bestAmount: Math.max(...entries.map((e) => e.bestAmount ?? 0)),
      fastestKill,
      lockedIn: entries.every((e) => e.lockedIn),
    };
  });

  return {
    zoneId: tier.zoneId,
    difficulty: rankings.difficulty ?? SAVAGE_DIFFICULTY_ID,
    metric: rankings.metric ?? "dps",
    partition: rankings.partition ?? -1,
    bestPerformanceAverage: rankings.bestPerformanceAverage ?? null,
    medianPerformanceAverage: rankings.medianPerformanceAverage ?? null,
    encounters,
    fetchedAt,
  };
}

/** encounterRankings の JSON から Best Perf の fight を取り出す。 */
export function extractBestFight(rankings: EncounterRankings | null | undefined): { reportCode: string; fightId: number } | undefined {
  const ranks = rankings?.ranks;
  if (!ranks || ranks.length === 0) return undefined;
  const best = ranks.reduce((a, b) => ((b.rankPercent ?? -1) > (a.rankPercent ?? -1) ? b : a));
  if (!best.report?.code) return undefined;
  return { reportCode: best.report.code, fightId: best.report.fightID };
}
