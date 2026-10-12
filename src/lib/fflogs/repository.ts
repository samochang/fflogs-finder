import { characterKey, characterLookupKey, characterNameIndexKey, lodestoneSearchKey, tierCatalogueKey, worldIndexKey } from "../cache/keys.ts";
import { logger } from "../logger.ts";
import { getCacheStore } from "../cache/store.ts";
import type { JobId } from "../jobs/jobs.ts";
import {
  JOBS,
  getJob,
  jobFromSpecName,
  isFullyScanned,
  jobProbeGroups,
  positionRoles,
  sortJobsForPosition,
} from "../jobs/jobs.ts";
import { FflogsGraphQLClient, FflogsError } from "./client.ts";
import { hasCredentials, loadConfig } from "./config.ts";
import type { CharacterDocument, CharacterJobData, RecruitmentSlot, TierJobData } from "./model.ts";
import { emptyCharacterDocument } from "./model.ts";
import {
  buildCharacterBatchQuery,
  buildHasLogsQuery,
  buildCharacterByIdQuery,
  buildCharacterByLodestoneIdQuery,
  buildCharacterLookupQuery,
  buildDamageDoneQuery,
  buildEncounterRankingsQuery,
  buildJobProbeQuery,
  buildWorldIndexQuery,
  buildZoneRankingsQuery,
  extractBestFight,
  mapTierJobData,
  parseZoneRankingsBatch,
  type CharacterLookupTarget,
  type ZoneRankingsRequest,
} from "./queries.ts";
import { fetchTiers, type Tier } from "./tiers.ts";
import type { DamageDoneTable, EncounterRankings, FflogsCharacter, ZoneRankings } from "./types.ts";
import { dataCenterForWorld, lookupWorldCandidates, makeWorldMultiIndex, staticWorldIndex, type WorldRef } from "../parser/worlds.ts";
import { DATA_CENTER_REGION, searchLodestoneCharacters, type LodestoneCandidate } from "../lodestone/lodestone.ts";

/**
 * FFLogs データの取得とキャッシュ（仕様 §26〜§30）。
 *
 * 方針:
 *  - 通常のページ表示では FFLogs API へアクセスしない（仕様 §27）。
 *  - キャッシュは長く保持し、「いつ FFLogs に問い合わせるか」を制御する（仕様 §26）。
 *  - 8 人 × 6 Tier は 1 リクエストにまとめる（仕様 §24）。
 */

/**
 * キャッシュ TTL。
 *
 * 仕様 §26 のとおり「TTL で更新を制御する」のではなく、
 * FFLogs への問い合わせ頻度（`DATA_MAX_AGE_DAYS`）で制御する。
 * そのため保存期間は長くてよい。
 */
const TIER_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const WORLD_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const CHARACTER_CACHE_TTL_SECONDS = 60 * 60 * 24 * 180;
const LOOKUP_CACHE_TTL_SECONDS = 60 * 60 * 24 * 180;
/** 名前 -> FFLogs 候補の対応表（Lodestone を再検索しないため）。 */
const NAME_INDEX_TTL_SECONDS = 60 * 60 * 24 * 180;

declare global {
  // eslint-disable-next-line no-var
  var __fflogsClient: FflogsGraphQLClient | undefined;
}

export function getClient(): FflogsGraphQLClient {
  if (!globalThis.__fflogsClient) {
    globalThis.__fflogsClient = new FflogsGraphQLClient(loadConfig());
  }
  return globalThis.__fflogsClient;
}

export function resetClient(): void {
  globalThis.__fflogsClient = undefined;
}

export async function getTiers(): Promise<Tier[]> {
  const store = getCacheStore();
  const startedAt = performance.now();
  const cached = await store.get<Tier[]>(tierCatalogueKey());
  if (cached && cached.length > 0) {
    logger.debug("tiers.cache_hit", { count: cached.length, durationMs: round1(performance.now() - startedAt) });
    return cached;
  }
  const tiers = await fetchTiers(getClient());
  await store.set(tierCatalogueKey(), tiers, TIER_CACHE_TTL_SECONDS);
  logger.info("tiers.fetched", { count: tiers.length, durationMs: round1(performance.now() - startedAt) });
  return tiers;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * ワールド名 → slug / region のインデックス。
 *
 * 既定では `worlds.generated.ts` の静的一覧を使う（API を叩かない）。
 * `worldData.regions.servers` は実測 31 points かかるため、
 * `WORLD_INDEX_REFRESH=1` を明示したときだけ FFLogs から取り直す。
 */
export async function getWorldIndex(): Promise<ReadonlyMap<string, WorldRef[]>> {
  if (process.env.WORLD_INDEX_REFRESH !== "1") {
    const index = staticWorldIndex();
    logger.debug("worlds.static", { keys: index.size });
    return index;
  }

  const store = getCacheStore();
  const cached = await store.get<WorldRef[]>(worldIndexKey());
  if (cached && cached.length > 0) return makeWorldMultiIndex(cached);

  const { data } = await getClient().query<{
    worldData: { regions: Array<{ slug: string; servers: { data: Array<{ name: string; slug: string }> } }> };
  }>(buildWorldIndexQuery());

  const worlds: WorldRef[] = data.worldData.regions.flatMap((region) =>
    region.servers.data.map((server) => ({ name: server.name, slug: server.slug, region: region.slug })),
  );
  await store.set(worldIndexKey(), worlds, WORLD_CACHE_TTL_SECONDS);
  return makeWorldMultiIndex(worlds);
}

/** World 表記が無いときに提示する候補。 */
export interface CharacterCandidate {
  canonicalId: number;
  name: string;
  world: string;
  worldSlug: string;
  region: string;
  dataCenter?: string;
  lodestoneId?: number;
  avatarUrl?: string;
}

export interface CharacterResolution {
  slot: RecruitmentSlot;
  character: CharacterDocument | null;
  /** 解決できなかった理由（UI 表示用） */
  reason?: "no_world" | "not_found" | "hidden" | "error" | "ambiguous";
  message?: string;
  /** World 表記が無く候補が複数あった場合の選択肢（解決済みでも保持する） */
  candidates?: CharacterCandidate[];
  /**
   * 候補が複数あったため、DC 優先の先頭を「推定」で採用したか。
   * UI で確定状態と区別し、ユーザーが選び直せるようにする（仕様 §8）。
   */
  autoSelected?: boolean;
  /** ログがあると確認できたジョブ */
  availableJobs?: JobId[];
  /** 募集文にジョブが無く、推定でジョブを決めたか */
  autoSelectedJob?: boolean;
  /**
   * **全 21 ジョブを調べ終えたか。**
   * false の間は「他にログのあるジョブが無い」とは言えない（取り漏らしの可能性がある）。
   */
  jobsFullyScanned?: boolean;
  /** ログの有無をすでに調べたジョブ（結果が無かったものも含む） */
  jobsScanned?: JobId[];
  /** 候補選定で取得済みの Tier スナップショット（同じクエリを 2 度投げないため） */
  tierSnapshot?: TierSnapshot;
}

async function lookupCanonicalId(name: string, worldSlug: string, region: string): Promise<FflogsCharacter | null> {
  const store = getCacheStore();
  const key = characterLookupKey(region, worldSlug, name);
  const startedAt = performance.now();
  const cached = await store.get<FflogsCharacter>(key);
  if (cached) {
    logger.debug("character.lookup_cache_hit", { name, worldSlug, region, durationMs: round1(performance.now() - startedAt) });
    return cached;
  }

  const { data } = await getClient().query<{ characterData: { character: FflogsCharacter | null } }>(
    buildCharacterLookupQuery(name, worldSlug, region),
  );
  const character = data.characterData.character;
  if (character) await store.set(key, character, LOOKUP_CACHE_TTL_SECONDS);
  logger.debug("character.lookup", {
    name,
    worldSlug,
    region,
    found: Boolean(character),
    durationMs: round1(performance.now() - startedAt),
  });
  return character;
}

export async function getCharacterDocument(canonicalId: number): Promise<CharacterDocument | null> {
  const store = getCacheStore();
  return store.get<CharacterDocument>(characterKey(canonicalId));
}

async function saveCharacterDocument(doc: CharacterDocument): Promise<void> {
  const store = getCacheStore();
  await store.set(characterKey(doc.canonicalId), doc, CHARACTER_CACHE_TTL_SECONDS);
}

const LODESTONE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_NAME_CANDIDATES = 6;

function worldRefFor(candidate: LodestoneCandidate, worldIndex?: ReadonlyMap<string, WorldRef[]>): WorldRef {
  const key = candidate.world.normalize("NFKC").toLowerCase().replace(/[\s\-'’.]/g, "");
  const fromIndex = worldIndex?.get(key)?.[0];
  if (fromIndex) return fromIndex;
  // FFLogs のワールド一覧に無い場合は DC から region を推定する
  return {
    name: candidate.world,
    slug: candidate.world.toLowerCase().replace(/[\s']/g, "-"),
    region: (candidate.dataCenter && DATA_CENTER_REGION[candidate.dataCenter]) || "JP",
  };
}

/**
 * World 表記が無いときのキャラクター特定（仕様 §11 の補完）。
 *
 * FFLogs は name + serverSlug + serverRegion が必須で、名前だけでは引けない。
 * そこで Lodestone のキャラクター検索で「名前 → World / DC / Lodestone ID」を解決し、
 * 見つかった候補ごとに FFLogs を引いて実在するものだけを返す。
 *
 * 一致度の高いグループ（exact → prefix → contains）で 1 件でも見つかればそこで打ち切る。
 */
export async function findCandidatesByName(
  name: string,
  worldIndex?: ReadonlyMap<string, WorldRef[]>,
): Promise<CharacterCandidate[]> {
  const [resolution] = await resolveSlots(
    [{ characterId: null, name, recruitmentJob: undefined }],
    worldIndex,
  );
  return resolution?.candidates ?? [];
}

export interface NameIndexEntry {
  candidates: CharacterCandidate[];
  updatedAt: string;
}

/** 名前から確定済みの候補を引く（Lodestone も FFLogs も呼ばない）。 */
export async function getNameIndex(name: string): Promise<CharacterCandidate[] | undefined> {
  const store = getCacheStore();
  const entry = await store.get<NameIndexEntry>(characterNameIndexKey(name));
  if (!entry) return undefined;
  logger.debug("nameindex.hit", { name, candidates: entry.candidates.length, updatedAt: entry.updatedAt });
  return entry.candidates;
}

async function saveNameIndex(name: string, candidates: readonly CharacterCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const store = getCacheStore();
  await store.set<NameIndexEntry>(
    characterNameIndexKey(name),
    { candidates: [...candidates], updatedAt: new Date().toISOString() },
    NAME_INDEX_TTL_SECONDS,
  );
}

/**
 * Lodestone の検索結果（キャッシュ付き）。FFLogs は呼ばない。
 *
 * Lodestone の検索は**リージョン別**で返るワールドが違うため、
 * 検索するリージョンはユーザー指定（既定 JP）。キャッシュもリージョンごとに分ける。
 */
export async function lodestoneCandidates(name: string, region?: string): Promise<LodestoneCandidate[]> {
  const store = getCacheStore();
  const scope = region?.toUpperCase() || "JP";
  const key = lodestoneSearchKey(`${name}|${scope}`);
  const cached = await store.get<LodestoneCandidate[]>(key);
  if (cached) {
    logger.debug("lodestone.cache_hit", { name, region: scope, candidates: cached.length });
    return cached;
  }

  const startedAt = performance.now();
  const found = await searchLodestoneCharacters(name, { regions: [scope] });
  logger.info("lodestone.search", {
    name,
    region: scope,
    candidates: found.length,
    durationMs: round1(performance.now() - startedAt),
  });
  await store.set(key, found, LODESTONE_CACHE_TTL_SECONDS);
  return found;
}

/**
 * 候補を「同じ DC のものを先頭」に並べ替える。
 * 固定メンバーは同じ DC から集まることが多いので、選択の手間を減らす。
 */
export function sortCandidatesByDataCenter(
  candidates: readonly CharacterCandidate[],
  preferred?: string,
): CharacterCandidate[] {
  if (!preferred) return [...candidates];
  return [...candidates].sort((a, b) => {
    const aSame = a.dataCenter === preferred ? 0 : 1;
    const bSame = b.dataCenter === preferred ? 0 : 1;
    return aSame - bSame;
  });
}

const HIDDEN_MESSAGE = "このキャラクターは FFLogs 側でランキング非公開です";

/** ドキュメントから解決結果を作る（hidden の扱いを 1 か所に閉じ込める）。 */
function documentResolution(
  slot: RecruitmentSlot,
  doc: CharacterDocument,
  extra: Pick<CharacterResolution, "candidates" | "autoSelected" | "tierSnapshot"> = {},
): CharacterResolution {
  const resolved = { ...slot, world: doc.world };
  return doc.hidden
    ? { slot: resolved, character: doc, reason: "hidden", message: HIDDEN_MESSAGE, ...extra }
    : { slot: resolved, character: doc, ...extra };
}

function worldsFor(world: string, index: ReadonlyMap<string, WorldRef[]>): WorldRef[] {
  const worlds = lookupWorldCandidates(world, index);
  return worlds.length > 0 ? worlds : [{ name: world, slug: world.toLowerCase(), region: "JP" }];
}

function targetCacheKey(target: CharacterLookupTarget): string {
  if (target.id !== undefined) return `fflogs:charid:${target.id}`;
  if (target.lodestoneID !== undefined) return `fflogs:lodestoneid:${target.lodestoneID}`;
  return characterLookupKey(target.serverRegion ?? "JP", target.serverSlug ?? "", target.name ?? "");
}

/**
 * キャラクター特定をまとめて実行する。
 *
 * 1 件ずつ引くと 1 往復 200ms 程度かかるため、8 人ぶんでは 1.6 秒になる。
 * alias で 1 リクエストにまとめ、キャッシュ済みのものは問い合わせない。
 */
export async function batchLookupCharacters(
  targets: readonly CharacterLookupTarget[],
): Promise<Map<string, FflogsCharacter>> {
  const store = getCacheStore();
  const results = new Map<string, FflogsCharacter>();
  const pending: CharacterLookupTarget[] = [];

  for (const target of targets) {
    const cached = await store.get<FflogsCharacter>(targetCacheKey(target));
    if (cached) {
      results.set(target.key, cached);
      continue;
    }
    pending.push(target);
  }

  if (pending.length === 0) return results;

  const startedAt = performance.now();
  try {
    const { data } = await getClient().query<{ characterData: Record<string, FflogsCharacter | null> }>(
      buildCharacterBatchQuery(pending),
    );
    let found = 0;
    pending.forEach((target, index) => {
      const character = data.characterData[`t${index}`] ?? null;
      if (!character) return;
      found += 1;
      results.set(target.key, character);
      void store.set(targetCacheKey(target), character, LOOKUP_CACHE_TTL_SECONDS);
    });
    logger.debug("character.batch_lookup", {
      requested: pending.length,
      found,
      durationMs: round1(performance.now() - startedAt),
    });
  } catch (error) {
    logger.warn("character.batch_lookup_failed", {
      requested: pending.length,
      durationMs: round1(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

/** FFLogs の応答をキャッシュ済みドキュメントへ反映する（無ければ作る）。 */
async function upsertCharacterDocument(found: FflogsCharacter, fallbackWorld: string): Promise<CharacterDocument> {
  const existing = await getCharacterDocument(found.canonicalID);
  const doc =
    existing ??
    emptyCharacterDocument({
      canonicalId: found.canonicalID,
      name: found.name,
      world: found.server?.name ?? fallbackWorld,
      worldSlug: found.server?.slug ?? fallbackWorld.toLowerCase(),
      region: found.server?.region?.slug ?? "JP",
      hidden: Boolean(found.hidden),
      lodestoneId: found.lodestoneID,
    });

  doc.hidden = Boolean(found.hidden);
  doc.name = found.name;
  doc.world = found.server?.name ?? doc.world;
  doc.worldSlug = found.server?.slug ?? doc.worldSlug;
  doc.region = found.server?.region?.slug ?? doc.region;
  doc.lodestoneId = found.lodestoneID ?? doc.lodestoneId;
  doc.dataCenter = doc.dataCenter ?? dataCenterForWorld(doc.world);
  await saveCharacterDocument(doc);
  return doc;
}

/**
 * 8 人 × 6 Tier をまとめて取得する。
 *
 * 仕様 §24 のとおり alias で 1 リクエストに寄せるが、
 * クエリが大きすぎて FFLogs に弾かれた場合は分割して再試行する。
 * レート制限（points 不足）は分割しても解決しないため即座に諦める。
 */
async function fetchRankingsBatch(
  requests: readonly ZoneRankingsRequest[],
  tiers: readonly Tier[],
  failures: RankingsLoadResult["failures"],
  jobId: JobId,
): Promise<ReturnType<typeof parseZoneRankingsBatch>> {
  if (requests.length === 0) return [];

  try {
    const response = await getClient().query<Parameters<typeof parseZoneRankingsBatch>[0]>(buildZoneRankingsQuery(requests));
    return parseZoneRankingsBatch(response.data, requests, tiers);
  } catch (error) {
    if (error instanceof FflogsError && error.kind === "rate_limit") throw error;

    if (requests.length === 1) {
      failures.push({
        canonicalId: requests[0]!.characterId,
        jobId,
        message: error instanceof FflogsError ? error.message : "取得に失敗しました",
      });
      return [{ character: null, jobData: null }];
    }

    const mid = Math.ceil(requests.length / 2);
    const head = await fetchRankingsBatch(requests.slice(0, mid), tiers, failures, jobId);
    const tail = await fetchRankingsBatch(requests.slice(mid), tiers, failures, jobId);
    return [...head, ...tail];
  }
}

/**
 * DamageDone テーブルから対象キャラクターの行を選ぶ。
 *
 * テーブルには Report に参加した全プレイヤーが入るため、名前で必ず突き合わせる。
 * （"Name@World" のようにサーバ名が付くことがあるので除去して比較する）
 */
export function pickPlayerEntry<T extends { name?: string; type?: string; activeTime?: number }>(
  entries: readonly T[],
  characterName: string,
): T | undefined {
  const normalize = (value: string | undefined): string => (value ?? "").split("@")[0]!.trim().toLowerCase();

  const wanted = normalize(characterName);
  const players = entries.filter((e) => e.type !== "LimitBreak" && normalize(e.name) !== "");

  return (
    players.find((e) => normalize(e.name) === wanted && typeof e.activeTime === "number") ??
    players.find((e) => normalize(e.name) === wanted)
  );
}

/**
 * 募集枠をまとめて FFLogs のキャラクターへ解決する。
 *
 * 1 件ずつ引くと 1 往復 200ms × 人数ぶんかかるため、
 *  - FFLogs のキャラクター特定は alias で 1 リクエストにまとめる
 *  - Lodestone の検索は FFLogs のバッチと並行して走らせる
 * ことで往復回数を最小化する。
 */
export async function resolveSlots(
  slots: readonly RecruitmentSlot[],
  worldIndex?: ReadonlyMap<string, WorldRef[]>,
  options: { region?: string } = {},
): Promise<CharacterResolution[]> {
  const index = worldIndex ?? (await getWorldIndex());
  const tiers = await getTiers();
  const resolutions: Array<CharacterResolution | undefined> = new Array(slots.length);

  // 1) キャッシュ済みドキュメントで解決できる枠
  const needLookup: number[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]!;
    if (!slot.characterId) {
      needLookup.push(i);
      continue;
    }
    const doc = await getCharacterDocument(slot.characterId);
    if (doc) resolutions[i] = documentResolution(slot, doc);
    else needLookup.push(i);
  }

  // 2) FFLogs へ問い合わせる対象を組み立てる
  //    同名ワールドが複数リージョンにある場合に備え、候補ワールドを全部入れて 1 回で引く
  const targets: CharacterLookupTarget[] = [];
  const slotTargets = new Map<number, Array<{ key: string; world?: WorldRef }>>();

  for (const i of needLookup) {
    const slot = slots[i]!;
    const list: Array<{ key: string; world?: WorldRef }> = [];
    if (slot.characterId) {
      const key = `id:${i}`;
      targets.push({ key, id: slot.characterId });
      list.push({ key });
    } else if (slot.lodestoneId) {
      const key = `lds:${i}`;
      targets.push({ key, lodestoneID: slot.lodestoneId });
      list.push({ key });
    } else if (slot.world) {
      worldsFor(slot.world, index).forEach((world, wi) => {
        const key = `w:${i}:${wi}`;
        targets.push({ key, name: slot.name, serverSlug: world.slug, serverRegion: world.region });
        list.push({ key, world });
      });
    }
    slotTargets.set(i, list);
  }

  const nameOnly = needLookup.filter((i) => {
    const slot = slots[i]!;
    return !slot.characterId && !slot.lodestoneId && !slot.world;
  });

  // 3) 名前だけの枠は、まず「確定済みの対応表」を引く（往復ゼロ）
  const indexedCandidates = new Map<number, CharacterCandidate[]>();
  await Promise.all(
    nameOnly.map(async (i) => {
      const cached = await getNameIndex(slots[i]!.name);
      if (cached) indexedCandidates.set(i, cached);
    }),
  );
  const needLodestone = nameOnly.filter((i) => !indexedCandidates.has(i));

  // 4) FFLogs のバッチと Lodestone 検索を並行実行
  const [lookup, lodestoneEntries] = await Promise.all([
    batchLookupCharacters(targets),
    Promise.all(
      needLodestone.map(async (i): Promise<readonly [number, LodestoneCandidate[]]> => {
        try {
          return [i, await lodestoneCandidates(slots[i]!.name, options.region)] as const;
        } catch (error) {
          logger.warn("lodestone.search_failed", {
            name: slots[i]!.name,
            error: error instanceof Error ? error.message : String(error),
          });
          return [i, []] as const;
        }
      }),
    ),
  ]);

  const lodestoneBySlot = new Map(lodestoneEntries);

  // 4) World / Lodestone ID / ID で解決できた枠を確定
  for (const i of needLookup) {
    if (lodestoneBySlot.has(i)) continue;
    const slot = slots[i]!;
    for (const entry of slotTargets.get(i) ?? []) {
      const found = lookup.get(entry.key);
      if (!found) continue;
      const doc = await upsertCharacterDocument(found, entry.world?.name ?? slot.world ?? "");
      doc.dataCenter = doc.dataCenter ?? dataCenterForWorld(doc.world);
      await saveCharacterDocument(doc);
      resolutions[i] = documentResolution({ ...slot, world: doc.world }, doc);
      break;
    }
  }

  // 4-b) 名のみの枠の候補（Lodestone → FFLogs の実在確認）をまとめて引く
  const dcCounts = new Map<string, number>();
  for (const resolution of resolutions) {
    const dc = resolution?.character?.dataCenter;
    if (dc) dcCounts.set(dc, (dcCounts.get(dc) ?? 0) + 1);
  }

  const candidateTargets: CharacterLookupTarget[] = [];
  const slotCandidates = new Map<
    number,
    Array<{ key: string; candidate: LodestoneCandidate; world: WorldRef }>
  >();

  for (const i of nameOnly) {
    if (indexedCandidates.has(i)) continue;
    const withWorld = (lodestoneBySlot.get(i) ?? [])
      .filter((c) => c.world !== "")
      .map((candidate) => ({ candidate, world: worldRefFor(candidate, index) }));
    if (withWorld.length === 0) {
      slotCandidates.set(i, []);
      continue;
    }

    // 一致度の高いグループだけを確認する（exact があれば prefix は見ない）
    const bestTier = withWorld[0]!.candidate.match;
    const group = withWorld.filter((x) => x.candidate.match === bestTier).slice(0, MAX_NAME_CANDIDATES);

    const entries = group.map((x, ci) => {
      const key = `c:${i}:${ci}`;
      candidateTargets.push({ key, name: x.candidate.name, serverSlug: x.world.slug, serverRegion: x.world.region });
      return { key, candidate: x.candidate, world: x.world };
    });
    slotCandidates.set(i, entries);
  }

  const candidateLookup = await batchLookupCharacters(candidateTargets);

  // 5) 名のみの枠: 候補を確定させてから DC を決める
  //
  //    World 表記が 1 つも無い募集文では、pass 1 では DC の手掛かりが得られない。
  //    そこで「候補が 1 件に絞れた枠」を先に解決し、そこで判明した DC を多数派として
  //    残りの曖昧な枠の並び順に使う。
  const confirmedBySlot = new Map<number, CharacterCandidate[]>();

  for (const i of nameOnly) {
    const indexed = indexedCandidates.get(i);
    if (indexed && indexed.length > 0) {
      confirmedBySlot.set(i, indexed);
      continue;
    }

    const found: CharacterCandidate[] = [];
    for (const entry of slotCandidates.get(i) ?? []) {
      const hit = candidateLookup.get(entry.key);
      if (!hit) continue;
      found.push({
        canonicalId: hit.canonicalID,
        name: hit.name,
        world: hit.server?.name ?? entry.world.name,
        worldSlug: hit.server?.slug ?? entry.world.slug,
        region: hit.server?.region?.slug ?? entry.world.region,
        dataCenter: entry.candidate.dataCenter,
        lodestoneId: entry.candidate.lodestoneId,
        avatarUrl: entry.candidate.avatarUrl,
      });
    }

    // 次回のために「名前 -> 確定済み候補」を保存する
    await saveNameIndex(slots[i]!.name, found);
    confirmedBySlot.set(i, found);
  }

  // 5-a) 候補が 1 件の枠を先に解決して DC を集める
  for (const i of nameOnly) {
    const found = confirmedBySlot.get(i) ?? [];
    if (found.length !== 1) continue;
    const doc = await upsertCandidateDocument(found[0]!);
    resolutions[i] = documentResolution(
      { ...slots[i]!, world: doc.world, lodestoneId: found[0]!.lodestoneId },
      doc,
    );
    const dc = doc.dataCenter;
    if (dc) dcCounts.set(dc, (dcCounts.get(dc) ?? 0) + 1);
  }

  // 5-b) その DC を優先して、残りの曖昧な枠を並べる
  const preferredAfterSingles = [...dcCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const i of nameOnly) {
    if (resolutions[i]) continue;
    const slot = slots[i]!;
    const found = confirmedBySlot.get(i) ?? [];

    if (found.length === 0) {
      resolutions[i] = {
        slot,
        character: null,
        reason: "not_found",
        message: "World 表記が無く、Lodestone / FFLogs でも一致するキャラクターが見つかりませんでした",
      };
      continue;
    }

    // 候補が複数でも、先頭を「推定」として採用して解決する。
    // 未選択のままにすると、優先 DC を表示しているのに何も出ない状態になって分かりにくい。
    // ただしログが無いキャラを選ぶと何も表示できないため、軽い確認をして
    // 「DC 優先 かつ ログあり」を最優先にする。
    const ordered = sortCandidatesByDataCenter(found, preferredAfterSingles);
    const { candidate: guess, snapshot } = await pickBestCandidate(ordered, tiers);
    const doc = await upsertCandidateDocument(guess);
    // 候補選定で得たスナップショットは文書が無い時点のものなので、ここで保存しておく。
    // ただし**実際に確認できたものだけ**（レート制限時のフォールバックを固定しない）。
    if (snapshot?.verified && doc.tierSnapshot?.expansion !== snapshot.expansion) {
      doc.tierSnapshot = snapshot;
      await saveCharacterDocument(doc);
    }
    resolutions[i] = documentResolution(
      { ...slot, world: doc.world, lodestoneId: guess.lodestoneId },
      doc,
      { candidates: ordered, autoSelected: true, tierSnapshot: snapshot },
    );
  }

  // 6) 最後まで解決できなかった枠
  for (let i = 0; i < slots.length; i += 1) {
    if (resolutions[i]) continue;
    const slot = slots[i]!;
    const worlds = slot.world ? worldsFor(slot.world, index) : [];
    resolutions[i] = {
      slot,
      character: null,
      reason: "not_found",
      message:
        worlds.length > 1
          ? `キャラクターを特定できませんでした（${worlds.map((w) => w.region).join(" / ")} を確認）`
          : "キャラクターを特定できませんでした",
    };
  }

  // 7) 募集文にジョブが無い枠は、ログのあるジョブを調べて「推定」で採用する。
  //    未確定のままにすると、せっかく見つかるログがあるのに「？」のまま何も表示されない。
  await autoResolveUnknownJobs(resolutions as CharacterResolution[]);

  const resolvedCount = resolutions.filter((r) => r?.character).length;
  logger.debug("resolve.done", {
    slots: slots.length,
    resolved: resolvedCount,
    ambiguous: resolutions.filter((r) => r?.reason === "ambiguous").length,
    autoJobs: resolutions.filter((r) => r?.autoSelectedJob).length,
  });

  return resolutions as CharacterResolution[];
}

/** ジョブ不明の枠にログのあるジョブを探して当てるか（points を使うため環境変数で切替可能）。 */
function autoResolveUnknownJobsEnabled(): boolean {
  return process.env.AUTO_RESOLVE_UNKNOWN_JOBS !== "0";
}

/**
 * 募集文にジョブが無い枠の初期表示を決める。
 *
 * 方針（コスト優先）:
 *  1. まず安い 1 クエリで「対象 Tier の encounter ごとの代表ジョブ」を取る（1 キャラ 約 1 point）。
 *     これが**メインジョブの手掛かり**になる。
 *  2. ポジションに合うロールがあればそれを、無ければメインジョブをそのまま初期表示にする。
 *  3. 全ジョブを探すのは**ユーザーが「他のジョブを探す」を押したときだけ**。
 *
 * 全ジョブ探索（数十 points）を初回から走らせないことで、
 * 多くの場合 1 + 成績取得 30 points 程度で済む。
 */
async function autoResolveUnknownJobs(resolutions: CharacterResolution[]): Promise<void> {
  const targets = resolutions.filter(
    (resolution) => resolution?.character && !resolution.slot.recruitmentJob && !resolution.character.hidden,
  );
  if (targets.length === 0) return;

  const tiers = await getTiers();
  if (!currentExpansionZones(tiers)) return;

  await Promise.all(
    targets.map(async (resolution) => {
      const doc = resolution.character!;

      // すでに全ジョブ探索済みならその結果を使う。
      // ただし **メインジョブ（kill 数で並んだもの）を先頭**にする。
      // knownJobs は探索で見つかった順なので、そのまま使うと
      // 「最初に見つかった別ジョブ」が初期表示になってしまう。
      if (doc.knownJobs && doc.knownJobs.length > 0) {
        const ordered = [
          ...new Set<JobId>([...(doc.tierSnapshot?.mainJobs ?? []), ...doc.knownJobs]),
        ];
        applyAutoJob(resolution, ordered, doc.probedJobs ?? []);
        return;
      }
      if (!autoResolveUnknownJobsEnabled()) return;

      // メインジョブの手掛かりを得る。候補選定で取得済みならそれを再利用する（再問い合わせしない）
      const scope = currentExpansionZones(tiers);
      const snapshot =
        resolution.tierSnapshot ??
        (scope
          ? (await getTierSnapshots([doc.canonicalId], scope.zoneIds, scope.expansion)).get(doc.canonicalId)
          : undefined);

      if (!snapshot?.hasLogs || snapshot.mainJobs.length === 0) {
        resolution.availableJobs = [];
        resolution.jobsScanned = [];
        resolution.jobsFullyScanned = false;
        resolution.message = "ログが見つかりませんでした";
        return;
      }

      applyAutoJob(resolution, snapshot.mainJobs, []);
    }),
  );
}

/**
 * 見つかっているジョブから初期表示のジョブを決めて当てる。
 * ポジションに合うロールがあればそれを優先し、無ければメインジョブをそのまま使う。
 */
function applyAutoJob(resolution: CharacterResolution, jobs: readonly JobId[], scanned: readonly JobId[]): void {
  const allowedRoles = new Set(positionRoles(resolution.slot.recruitmentPosition));
  const matched = jobs.find((jobId) => allowedRoles.has(getJob(jobId).role));
  const best = matched ?? jobs[0]!;

  resolution.availableJobs = [...jobs];
  resolution.jobsScanned = [...scanned];
  // 「調べた」か「ログがあると分かっている」のどちらかで覆われていれば取り漏らしは無い
  resolution.jobsFullyScanned = isFullyScanned(scanned, jobs);
  resolution.slot = { ...resolution.slot, recruitmentJob: best };
  resolution.autoSelectedJob = true;

  logger.debug("auto_job_selected", {
    canonicalId: resolution.character?.canonicalId,
    position: resolution.slot.recruitmentPosition,
    jobId: best,
    roleMatched: Boolean(matched),
    candidates: jobs,
    scanned: scanned.length,
  });
}

export interface TierSnapshot {
  /** 対象の拡張（大型パッチ）。変わったら取り直す */
  expansion: string;
  /** 対象にした零式（拡張に含まれるもの全部） */
  zoneIds: number[];
  /** 集計方法のバージョン */
  version: number;
  hasLogs: boolean;
  /** 実際にクエリできた結果か（false は「確認できなかった」なので保存しない） */
  verified: boolean;
  /** encounter の代表に選ばれたジョブ（kill 数の多い順） */
  mainJobs: JobId[];
}

/**
 * 対象 Tier のスナップショットをまとめて取得する（キャッシュ付き）。
 *
 * `specName` 無しの `zoneRankings` は **encounter ごとに代表 1 ジョブ**しか返さないので、
 * これは「メインジョブの手掛かり」と「ログの有無」を与える。
 * 全ジョブを列挙するものではない（それはジョブごとの探索が必要）。
 *
 * 安い（1 キャラ = 1 alias、実測 約 1 point）ので、
 *  - World 候補が複数あるときの検証
 *  - ジョブ不明の枠の初期表示（メインジョブ）
 * に使う。
 */
export async function getTierSnapshots(
  characterIds: readonly number[],
  zoneIds: readonly number[],
  expansion: string,
): Promise<Map<number, TierSnapshot>> {
  const result = new Map<number, TierSnapshot>();
  const pending: number[] = [];

  for (const id of characterIds) {
    const doc = await getCharacterDocument(id);
    // 拡張（大型パッチ）が変わったら取り直す。ジョブは拡張をまたいで変わるのが普通なので、
    // 同じ拡張の中では前の零式も含めて見る。
    if (
      doc?.tierSnapshot?.expansion === expansion &&
      doc.tierSnapshot.version === SNAPSHOT_VERSION &&
      doc.tierSnapshot.verified
    ) {
      result.set(id, doc.tierSnapshot);
      continue;
    }
    pending.push(id);
  }

  if (pending.length === 0) return result;

  const startedAt = performance.now();
  try {
    const { data } = await getClient().query<{
      characterData: Record<string, Record<string, ZoneRankings | null> | null>;
    }>(buildHasLogsQuery(pending, zoneIds));

    for (const [index, id] of pending.entries()) {
      const character = data.characterData[`h${index}`] ?? null;

      // 拡張内の全零式をまたいで「encounter ごとの代表ジョブ」を kill 数で集計する。
      //
      // **新しい零式ほど重く見る**（1 つ前は半分）。
      // ジョブは零式ごとに変わるのが普通なので、古い零式のキル数だけで
      // メインジョブを決めると実態とずれる。
      const killsBySpec = new Map<JobId, number>();
      let hasLogs = false;
      for (const [zi] of zoneIds.entries()) {
        const weight = 2 ** (zoneIds.length - 1 - zi);
        const rankings = character?.[`z${zi}`] ?? null;
        for (const entry of rankings?.rankings ?? []) {
          const kills = entry.totalKills ?? 0;
          if (kills <= 0) continue;
          hasLogs = true;
          const job = jobFromSpecName(entry.spec);
          if (job) killsBySpec.set(job.id, (killsBySpec.get(job.id) ?? 0) + kills * weight);
        }
      }

      const snapshot: TierSnapshot = {
        expansion,
        zoneIds: [...zoneIds],
        version: SNAPSHOT_VERSION,
        hasLogs,
        verified: true,
        mainJobs: [...killsBySpec.entries()].sort((a, b) => b[1] - a[1]).map(([jobId]) => jobId),
      };
      result.set(id, snapshot);

      const doc = await getCharacterDocument(id);
      if (doc) {
        doc.tierSnapshot = snapshot;
        await saveCharacterDocument(doc);
      }
    }

    logger.debug("tier_snapshot.checked", {
      characters: pending.length,
      withLogs: [...result.values()].filter((snap) => snap.hasLogs).length,
      durationMs: round1(performance.now() - startedAt),
    });
  } catch (error) {
    logger.warn("tier_snapshot.failed", {
      characters: pending.length,
      error: error instanceof Error ? error.message : String(error),
    });
    // 「確認できなかった」を「ログあり」として固定しない。
    // ここで返す値は今回の判断にだけ使い、キャッシュには保存しない。
    for (const id of pending) {
      if (!result.has(id)) {
        result.set(id, {
          expansion,
          zoneIds: [...zoneIds],
          version: SNAPSHOT_VERSION,
          hasLogs: true,
          verified: false,
          mainJobs: [],
        });
      }
    }
  }

  return result;
}

/**
 * スナップショットの集計方法のバージョン。
 * 重み付けなどを見直したら上げる（古いキャッシュを捨てて取り直す）。
 */
const SNAPSHOT_VERSION = 2;

/**
 * 現在の拡張（大型パッチ）に含まれる零式の zoneId を、新しい順に返す。
 *
 * メインジョブの推定は**拡張単位**で行う。零式 1 つぶんだけ見ると、
 * その零式だけ別ジョブで遊んでいた場合に誤る（ジョブは拡張をまたいで変わるのが普通）。
 */
function currentExpansionZones(tiers: readonly Tier[]): { expansion: string; zoneIds: number[] } | null {
  const latest = tiers[0];
  if (!latest) return null;
  return {
    expansion: latest.expansion,
    zoneIds: tiers.filter((tier) => tier.expansion === latest.expansion).map((tier) => tier.zoneId),
  };
}

/** 対象 Tier にログがあるかだけを返す（World 候補の検証用）。 */
export async function checkHasLogs(characterIds: readonly number[], tiers: readonly Tier[]): Promise<Map<number, boolean>> {
  const scope = currentExpansionZones(tiers);
  if (!scope) return new Map(characterIds.map((id) => [id, false]));
  const snapshots = await getTierSnapshots(characterIds, scope.zoneIds, scope.expansion);
  return new Map([...snapshots].map(([id, snapshot]) => [id, snapshot.hasLogs]));
}

/**
 * 複数候補から「推定」で採用する 1 件を選ぶ。
 *
 * 優先順:
 *  1. DC 優先の並びで、かつ対象 Tier にログがある
 *  2. ログがある中で並びが先頭のもの
 *  3. どれもログが無ければ並びの先頭（DC 優先を尊重）
 */
async function pickBestCandidate(
  ordered: readonly CharacterCandidate[],
  tiers: readonly Tier[],
): Promise<{ candidate: CharacterCandidate; snapshot?: TierSnapshot }> {
  const head = ordered[0]!;
  if (ordered.length === 1) return { candidate: head };

  const scope = currentExpansionZones(tiers);
  if (!scope) return { candidate: head };

  // 候補全員のスナップショットを 1 リクエストで取る（1 キャラ × 拡張内の零式数）。
  // ここで得た結果は解決結果に持たせ、ジョブ初期表示で同じクエリを投げ直さないようにする。
  const snapshots = await getTierSnapshots(
    ordered.map((candidate) => candidate.canonicalId),
    scope.zoneIds,
    scope.expansion,
  );

  // 「確認できてログがある」→「確認できてログが無い」→「確認できなかった」の順。
  // 未確認を「ログあり」と同列に扱うと、ログが無いキャラを選んでしまう。
  const verifiedWithLogs = ordered.find((c) => {
    const snap = snapshots.get(c.canonicalId);
    return snap?.verified && snap.hasLogs;
  });
  const verifiedAny = ordered.find((c) => snapshots.get(c.canonicalId)?.verified);
  const chosen = verifiedWithLogs ?? verifiedAny ?? head;
  return { candidate: chosen, snapshot: snapshots.get(chosen.canonicalId) };
}

/** 確認済みの候補からドキュメントを作る／更新する。 */
async function upsertCandidateDocument(candidate: CharacterCandidate): Promise<CharacterDocument> {
  const existing = await getCharacterDocument(candidate.canonicalId);
  const doc =
    existing ??
    emptyCharacterDocument({
      canonicalId: candidate.canonicalId,
      name: candidate.name,
      world: candidate.world,
      worldSlug: candidate.worldSlug,
      region: candidate.region,
      hidden: false,
    });
  doc.name = candidate.name;
  doc.world = candidate.world;
  doc.worldSlug = candidate.worldSlug;
  doc.region = candidate.region;
  doc.dataCenter = candidate.dataCenter ?? doc.dataCenter ?? dataCenterForWorld(candidate.world);
  doc.lodestoneId = candidate.lodestoneId ?? doc.lodestoneId;
  await saveCharacterDocument(doc);
  return doc;
}

/** DC 優先で並べ替える（LodestoneCandidate 版）。 */
function sortByDataCenter<T extends { candidate: LodestoneCandidate }>(list: T[], preferred?: string): T[] {
  if (!preferred) return [...list];
  return [...list].sort((a, b) => {
    const aSame = a.candidate.dataCenter === preferred ? 0 : 1;
    const bSame = b.candidate.dataCenter === preferred ? 0 : 1;
    return aSame - bSame;
  });
}

/** 単一の募集枠を解決する（内部で resolveSlots を 1 件で呼ぶ）。 */
export async function resolveSlot(
  slot: RecruitmentSlot,
  worldIndex?: ReadonlyMap<string, WorldRef[]>,
  options: { region?: string } = {},
): Promise<CharacterResolution> {
  const [resolution] = await resolveSlots([slot], worldIndex, { region: options.region });
  return resolution!;
}

/**
 * その Tier のデータを再取得すべきか。
 *
 * `force` は無条件、`maxAgeDays` は「最終取得からその日数より古いものだけ」。
 * どちらも未指定なら既存キャッシュをそのまま使う（API points を消費しない）。
 */
export function isStale(tier: TierJobData | undefined, options: { force?: boolean; maxAgeDays?: number }): boolean {
  if (!tier) return true;
  if (options.force) return true;
  if (options.maxAgeDays === undefined) return false;
  const fetchedAt = Date.parse(tier.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > options.maxAgeDays * 86_400_000;
}

export interface RankingsLoadResult {
  /** canonicalId -> job data */
  loaded: Map<number, CharacterJobData>;
  fetchedCharacters: number;
  fetchedTiers: number;
  /** 鮮度が十分で再取得を見送った Tier 数 */
  skippedFreshTiers: number;
  rateLimit?: { limitPerHour: number; pointsSpentThisHour: number; pointsResetIn: number };
  /** 取得に失敗した対象 */
  failures: Array<{ canonicalId: number; jobId: JobId; message: string }>;
}

/**
 * 指定キャラクター群について、指定ジョブ × 対象 Tier の成績を取得する。
 * キャッシュに無い組み合わせだけを 1 リクエストにまとめて取得する。
 */
export async function loadRankings(
  characterIds: readonly number[],
  jobId: JobId,
  options: { force?: boolean; maxAgeDays?: number; tiers?: readonly Tier[] } = {},
): Promise<RankingsLoadResult> {
  const tiers = options.tiers ?? (await getTiers());
  const loaded = new Map<number, CharacterJobData>();
  const failures: RankingsLoadResult["failures"] = [];
  let skippedFreshTiers = 0;

  const pending: Array<{ characterId: number; zoneIds: number[] }> = [];

  for (const characterId of characterIds) {
    const doc = await getCharacterDocument(characterId);
    if (!doc) {
      failures.push({ canonicalId: characterId, jobId, message: "キャッシュにキャラクター情報がありません" });
      continue;
    }
    if (doc.hidden) {
      failures.push({ canonicalId: characterId, jobId, message: "FFLogs 側でランキング非公開です" });
      continue;
    }

    const cached = doc.jobs[jobId];
    const missing: number[] = [];
    for (const tier of tiers) {
      if (isStale(cached?.tiers[String(tier.zoneId)], options)) missing.push(tier.zoneId);
      else skippedFreshTiers += 1;
    }

    if (cached) loaded.set(characterId, cached);

    if (missing.length > 0) {
      pending.push({ characterId, zoneIds: missing });
    }
  }

  if (pending.length === 0) {
    return { loaded, fetchedCharacters: 0, fetchedTiers: 0, skippedFreshTiers, failures };
  }

  const requests: ZoneRankingsRequest[] = pending.map((p) => ({ characterId: p.characterId, jobId, zoneIds: p.zoneIds }));

  let parsed: ReturnType<typeof parseZoneRankingsBatch>;
  try {
    parsed = await fetchRankingsBatch(requests, tiers, failures, jobId);
  } catch (error) {
    const message = error instanceof FflogsError ? error.message : "FFLogs からの取得に失敗しました";
    for (const p of pending) failures.push({ canonicalId: p.characterId, jobId, message });
    throw Object.assign(error instanceof Error ? error : new Error(message), { partial: { loaded, failures } });
  }
  let fetchedTiers = 0;

  for (const [index, entry] of parsed.entries()) {
    const request = requests[index]!;
    const doc = await getCharacterDocument(request.characterId);
    if (!doc) continue;

    if (!entry.jobData) {
      failures.push({ canonicalId: request.characterId, jobId, message: "キャラクターを取得できませんでした" });
      continue;
    }

    const merged: CharacterJobData = doc.jobs[jobId] ?? {
      jobId,
      specName: getJob(jobId).specName,
      tiers: {},
      fetchedAt: entry.jobData.fetchedAt,
    };
    merged.tiers = { ...merged.tiers, ...entry.jobData.tiers };
    merged.fetchedAt = entry.jobData.fetchedAt;
    doc.jobs[jobId] = merged;
    if (entry.character) {
      doc.hidden = Boolean(entry.character.hidden);
      doc.lodestoneId = entry.character.lodestoneID ?? doc.lodestoneId;
    }
    await saveCharacterDocument(doc);

    loaded.set(request.characterId, merged);
    fetchedTiers += Object.keys(entry.jobData.tiers).length;
  }

  const rate = getClient().lastRateLimitSnapshot;
  logger.info("rankings.loaded", {
    jobId,
    characters: characterIds.length,
    fetchedCharacters: pending.length,
    fetchedTiers,
    skippedFreshTiers,
    failures: failures.length,
  });
  return {
    loaded,
    fetchedCharacters: pending.length,
    fetchedTiers,
    skippedFreshTiers,
    rateLimit: rate
      ? { limitPerHour: rate.limitPerHour, pointsSpentThisHour: rate.pointsSpentThisHour, pointsResetIn: rate.pointsResetIn }
      : undefined,
    failures,
  };
}

/**
 * 「他ジョブのログが存在するか」を 1 リクエストで調べる（仕様 §20 / §22）。
 * 直近 Tier のみを対象にする。結果はキャッシュに残す。
 */
export async function probeAvailableJobs(
  characterId: number,
  jobGroups: readonly (readonly JobId[])[],
  options: {
    /**
     * true なら全グループを最後まで調べる（＝取り漏らしが無くなる）。
     * false なら最初に見つかったグループで打ち切る（安いが、他にログがあるかは分からない）。
     */
    exhaustive?: boolean;
  } = {},
): Promise<{
  jobIds: JobId[];
  /** これまでにログの有無を調べたジョブ（結果が無かったものも含む） */
  probedJobs: JobId[];
  probedGroups: number;
  exhaustive: boolean;
  rateLimit?: RankingsLoadResult["rateLimit"];
}> {
  const tiers = await getTiers();
  const latestTier = tiers[0];
  const zoneId = latestTier?.zoneId;
  if (!latestTier || !zoneId) return { jobIds: [], probedJobs: [], probedGroups: 0, exhaustive: false };

  /**
   * 1 リクエストで指定ジョブのログ有無を調べる。
   *
   * 探索クエリは成績取得クエリと**同じ引数**（difficulty / metric / partition なし）なので、
   * 返ってきた zoneRankings はそのまま最新 Tier の成績として使える。
   * 捨てずに保存しておくと、そのジョブが選ばれたときに 1 alias（5 points）節約できる。
   */
  const probe = async (jobIds: readonly JobId[]): Promise<JobId[]> => {
    if (jobIds.length === 0) return [];
    const { data } = await getClient().query<{
      characterData: { character: (FflogsCharacter & Record<string, ZoneRankings | null>) | null };
    }>(buildJobProbeQuery(characterId, zoneId, jobIds));

    const character = data.characterData.character;
    const found: JobId[] = [];
    if (!character) return found;
    const probedAt = new Date().toISOString();
    jobIds.forEach((jobId, index) => {
      const rankings = character[`j${index}`];
      if (!rankings) return;
      // FFLogs はログが無いジョブでも rankings を返すため、kill 数で判定する
      if (!(rankings.rankings ?? []).some((r) => (r.totalKills ?? 0) > 0)) return;
      found.push(jobId);
      harvested.set(jobId, mapTierJobData(latestTier, rankings, probedAt));
    });
    return found;
  };
  const harvested = new Map<JobId, TierJobData>();

  // 近いロールのグループから順に試し、最初に見つかったところで打ち切る。
  // 例: ST はタンク 4 → 近接 6 → ヒラ 4 → 遠隔 3 → キャス 4 の順。
  const groups = jobGroups.filter((group) => group.length > 0);
  const found: JobId[] = [];
  const probed = new Set<JobId>();
  let probedGroups = 0;

  for (const group of groups) {
    probedGroups += 1;
    const unique = [...new Set(group)];
    const hits = await probe(unique);
    for (const jobId of unique) probed.add(jobId);
    for (const jobId of hits) if (!found.includes(jobId)) found.push(jobId);
    // 「取り漏らしを無くす」モードでなければ、見つかった時点で打ち切る
    if (hits.length > 0 && !options.exhaustive) break;
  }

  // 調べた結果をキャラクター文書に残す（次回は問い合わせない）
  const doc = await getCharacterDocument(characterId);
  if (doc) {
    // 見つかったジョブは積み上げる（部分探索を繰り返しても消えないように）
    doc.knownJobs = [...new Set([...(doc.knownJobs ?? []), ...found])];
    doc.knownJobsProbedAt = new Date().toISOString();
    // 結果が無かったジョブも「調べ済み」として記録する
    doc.probedJobs = [...new Set([...(doc.probedJobs ?? []), ...probed])];

    // 探索で得た最新 Tier の成績を捨てずに保存する。
    // このジョブが選ばれたとき、loadRankings が「取得済み」と見なして 1 alias ぶん節約する。
    for (const [jobId, tierData] of harvested) {
      const existing = doc.jobs[jobId];
      doc.jobs[jobId] = existing
        ? { ...existing, tiers: { ...existing.tiers, [String(zoneId)]: tierData }, fetchedAt: tierData.fetchedAt }
        : {
            jobId,
            specName: getJob(jobId).specName,
            tiers: { [String(zoneId)]: tierData },
            fetchedAt: tierData.fetchedAt,
          };
    }
    await saveCharacterDocument(doc);
  }

  logger.debug("job_probe.done", {
    canonicalId: characterId,
    probedGroups,
    groups: groups.length,
    exhaustive: options.exhaustive === true,
    newlyProbed: probed.size,
    found: found.length,
    harvestedTiers: harvested.size,
  });

  const rate = getClient().lastRateLimitSnapshot;
  return {
    jobIds: found,
    probedJobs: doc?.probedJobs ?? [...probed],
    probedGroups,
    exhaustive: options.exhaustive === true,
    rateLimit: rate
      ? { limitPerHour: rate.limitPerHour, pointsSpentThisHour: rate.pointsSpentThisHour, pointsResetIn: rate.pointsResetIn }
      : undefined,
  };
}

/**
 * 1 セルの Active を取得する（仕様 §14 / §16）。
 *
 * FFLogs の character 系エンドポイントに Active は存在しないため、
 * Best Perf の fight を特定し、DamageDone テーブルの `activeTime`（FFLogs の "Active" 列）を読む。
 * 自前で GCD uptime を計算しない（仕様 §16）。
 */
export async function loadActivePercent(
  characterId: number,
  jobId: JobId,
  zoneId: number,
  floorIndex: number,
): Promise<{ activePercent: number | null; reason?: string; rateLimit?: RankingsLoadResult["rateLimit"] }> {
  const doc = await getCharacterDocument(characterId);
  if (!doc) return { activePercent: null, reason: "キャラクター情報がありません" };

  const tiers = await getTiers();
  const tier = tiers.find((t) => t.zoneId === zoneId);
  const floor = tier?.floors.find((f) => f.index === floorIndex);
  if (!floor) return { activePercent: null, reason: "対象の層が見つかりません" };

  for (const encounterId of floor.encounterIds) {
    try {
      const { data } = await getClient().query<{
        characterData: { character: { encounterRankings: EncounterRankings | null } | null };
      }>(buildEncounterRankingsQuery(characterId, encounterId, jobId));

      const best = extractBestFight(data.characterData.character?.encounterRankings);
      if (!best) continue;

      const table = await getClient().query<{ reportData: { report: { table: DamageDoneTable | null } | null } }>(
        buildDamageDoneQuery(best.reportCode, [best.fightId]),
      );

      const tableData = table.data.reportData.report?.table?.data;
      const entries = tableData?.entries ?? [];
      const target = pickPlayerEntry(entries, doc.name);
      if (!target || typeof target.activeTime !== "number") {
        return { activePercent: null, reason: "FFLogs の Active 値を取得できませんでした" };
      }

      // activeTime は**ミリ秒**。FFLogs の Active 列（%）は
      // activeTime / totalTime × 100 で求める。
      // 実測例: activeTime=507225ms / totalTime=508871ms = 99.68%
      const duration = tableData?.totalTime ?? tableData?.combatTime ?? 0;
      if (!duration) {
        return { activePercent: null, reason: "戦闘時間が取得できなかったため Active を計算できません" };
      }
      const percent = Math.max(0, Math.min(100, (target.activeTime / duration) * 100));
      const activePercent = Math.round(percent * 100) / 100;

      const rate = getClient().lastRateLimitSnapshot;
      return {
        activePercent,
        rateLimit: rate ? { limitPerHour: rate.limitPerHour, pointsSpentThisHour: rate.pointsSpentThisHour, pointsResetIn: rate.pointsResetIn } : undefined,
      };
    } catch (error) {
      if (error instanceof FflogsError && error.kind === "archived") {
        return { activePercent: null, reason: "この Report はアーカイブ済みで、クライアント資格情報では参照できません" };
      }
      const message = error instanceof FflogsError ? error.message : "Active の取得に失敗しました";
      return { activePercent: null, reason: message };
    }
  }

  return { activePercent: null, reason: "Best Perf の fight を特定できませんでした" };
}

export interface CompareLoadResult {
  tiers: Tier[];
  resolutions: CharacterResolution[];
  /** canonicalId -> jobId -> tier data */
  rankings: Map<number, CharacterJobData>;
  failures: RankingsLoadResult["failures"];
  rateLimit?: RankingsLoadResult["rateLimit"];
  cacheStoreKind: string;
  credentialsConfigured: boolean;
  fetched: { characters: number; tiers: number };
  /** 鮮度が十分で再取得を見送った Tier 数 */
  skippedFreshTiers: number;
  /** キャッシュのみで応答したか（= FFLogs へ問い合わせていない） */
  servedFromCache: boolean;
  /**
   * この compare で FFLogs へ投げたリクエスト数。
   * 0 ならキャッシュだけで応答したので、レート制限を読み直す必要はない。
   */
  fflogsRequests: number;
  /** FFLogs への問い合わせに失敗し、キャッシュのみで応答したか */
  degraded: boolean;
  degradedReason?: string;
  /** どこに時間がかかったか（ms） */
  timings: { resolveMs: number; rankingsMs: number; totalMs: number };
}

/** 比較画面のデータをまとめて読み込む。 */
export async function loadCompare(
  slots: readonly RecruitmentSlot[],
  options: { force?: boolean; maxAgeDays?: number; region?: string } = {},
): Promise<CompareLoadResult> {
  const totalStartedAt = performance.now();
  const store = getCacheStore();
  // この compare で実際に FFLogs を叩いた回数（キャッシュ利用時は 0 になる）
  const requestsBefore = getClient().requestCount;
  const credentialsConfigured = hasCredentials();
  const tiers = await getTiers();
  const worldIndex = await getWorldIndex();

  // キャラクター特定は「まとめて 1 往復」で行う（1 件ずつ引くと 8 人で 1.6 秒かかる）
  const resolutions: CharacterResolution[] = await resolveSlots(slots, worldIndex, { region: options.region });

  const resolveMs = round1(performance.now() - totalStartedAt);

  const byJob = new Map<JobId, number[]>();
  for (const resolution of resolutions) {
    const jobId = resolution.slot.recruitmentJob;
    if (!jobId || !resolution.character) continue;
    const list = byJob.get(jobId) ?? [];
    list.push(resolution.character.canonicalId);
    byJob.set(jobId, list);
  }

  const rankings = new Map<number, CharacterJobData>();
  const failures: RankingsLoadResult["failures"] = [];
  let rateLimit: RankingsLoadResult["rateLimit"];
  let fetchedCharacters = 0;
  let fetchedTiers = 0;
  let skippedFreshTiers = 0;

  let degraded = false;
  let degradedReason: string | undefined;

  for (const [jobId, characterIds] of byJob) {
    try {
      const result = await loadRankings(characterIds, jobId, { force: options.force, maxAgeDays: options.maxAgeDays, tiers });
      for (const [id, data] of result.loaded) rankings.set(id, data);
      failures.push(...result.failures);
      fetchedCharacters += result.fetchedCharacters;
      fetchedTiers += result.fetchedTiers;
      skippedFreshTiers += result.skippedFreshTiers;
      rateLimit = result.rateLimit ?? rateLimit;
    } catch (error) {
      // API 制限・timeout 時は、取れている分だけでも返す（仕様 §34）
      const partial = (error as { partial?: { loaded: Map<number, CharacterJobData>; failures: RankingsLoadResult["failures"] } }).partial;
      if (partial) {
        for (const [id, data] of partial.loaded) rankings.set(id, data);
        failures.push(...partial.failures);
      }
      degraded = true;
      degradedReason = error instanceof FflogsError ? error.message : "FFLogs からの取得に失敗しました";
    }
  }

  const timings = {
    resolveMs,
    rankingsMs: round1(performance.now() - totalStartedAt - resolveMs),
    totalMs: round1(performance.now() - totalStartedAt),
  };
  logger.info("compare.done", {
    slots: slots.length,
    resolved: resolutions.filter((r) => r.character).length,
    ...timings,
    servedFromCache: fetchedCharacters === 0,
  });

  // キャッシュのみで応答した場合でも、直近に観測したレート制限を返す
  // （UI の残ポイント表示が消えないようにする）
  if (!rateLimit) {
    const snapshot = getClient().lastRateLimitSnapshot;
    if (snapshot) {
      rateLimit = {
        limitPerHour: snapshot.limitPerHour,
        pointsSpentThisHour: snapshot.pointsSpentThisHour,
        pointsResetIn: snapshot.pointsResetIn,
      };
    }
  }

  return {
    tiers,
    resolutions,
    rankings,
    failures,
    rateLimit,
    cacheStoreKind: store.kind,
    credentialsConfigured,
    fetched: { characters: fetchedCharacters, tiers: fetchedTiers },
    skippedFreshTiers,
    fflogsRequests: getClient().requestCount - requestsBefore,
    servedFromCache: fetchedCharacters === 0 && getClient().requestCount === requestsBefore,
    degraded,
    degradedReason,
    timings,
  };
}

/** Active の取得結果をキャッシュに書き戻す。 */
export async function updateCellActive(
  canonicalId: number,
  jobId: JobId,
  zoneId: number,
  floorIndex: number,
  activePercent: number | null,
  reason?: string,
): Promise<void> {
  const doc = await getCharacterDocument(canonicalId);
  const tier = doc?.jobs[jobId]?.tiers[String(zoneId)];
  if (!doc || !tier) return;
  const encounter = tier.encounters[floorIndex - 1];
  if (!encounter) return;
  encounter.activePercent = activePercent;
  encounter.activeUnavailableReason = reason;
  await saveCharacterDocument(doc);
}

/** Tier ごとの表示用データを取り出す。 */
export function tierDataFor(doc: CharacterDocument | null, jobId: JobId | undefined, zoneId: number): TierJobData | undefined {
  if (!doc || !jobId) return undefined;
  return doc.jobs[jobId]?.tiers[String(zoneId)];
}
