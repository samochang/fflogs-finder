/**
 * Lodestone のキャラクター検索（仕様 §11 の補完）。
 *
 * FFLogs はキャラクター名だけでは特定できない（name + serverSlug + serverRegion が必須。
 * `name` + `serverRegion` や `name` のみでは null が返ることを実測で確認済み）。
 *
 * 募集文に World が書かれていないケースが多いため、
 * Lodestone のキャラクター検索で「名前 → World / データセンター / Lodestone ID」を引き、
 * それを使って FFLogs を引く。
 *
 * 検索結果の HTML は次の形（実測）:
 *   <div class="entry">
 *     <a href="/lodestone/character/52195971/" class="entry__link">
 *       <div class="entry__chara__face"><img src="..."></div>
 *       <div class="entry__box entry__box--world">
 *         <p class="entry__name">Raye Skystrikerace</p>
 *         <p class="entry__world"><i class="..."></i>Durandal [Gaia]</p>
 *         ...
 */

export interface LodestoneCandidate {
  name: string;
  world: string;
  /** データセンター（例: "Gaia"）。Lodestone の表示から取得 */
  dataCenter?: string;
  lodestoneId?: number;
  avatarUrl?: string;
  /** 検索語との一致度。exact > prefix > contains */
  match: "exact" | "prefix" | "contains";
}

/** Lodestone のキャラクターページから取り出した情報。 */
export interface LodestoneCharacter {
  lodestoneId: number;
  name: string;
  world: string;
  dataCenter?: string;
}

export class LodestoneError extends Error {
  readonly kind: "network" | "not_found";

  constructor(kind: LodestoneError["kind"], message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.name = "LodestoneError";
  }
}

/** データセンター → FFLogs の region slug。World が FFLogs の一覧に無い場合の保険。 */
export const DATA_CENTER_REGION: Readonly<Record<string, string>> = {
  Elemental: "JP",
  Gaia: "JP",
  Mana: "JP",
  Meteor: "JP",
  Aether: "NA",
  Primal: "NA",
  Crystal: "NA",
  Dynamis: "NA",
  Chaos: "EU",
  Light: "EU",
  Materia: "OC",
  Shadow: "KR",
  陆行鸟: "CN",
  莫古力: "CN",
  猫小胖: "CN",
  豆豆柴: "CN",
};

/**
 * Lodestone の検索は**リージョン別**で、返ってくるワールドが違う（実測）。
 *
 *   jp. -> Elemental / Gaia / Meteor / Mana
 *   na. -> Aether / Primal / Crystal / Dynamis
 *   eu. -> Chaos / Light
 *
 * そのため名前だけの枠は 3 つとも引いて突き合わせる。
 * 1 つに固定すると他リージョンのキャラが絶対に見つからない。
 */
const SEARCH_ENDPOINTS: Readonly<Record<string, string>> = {
  JP: "https://jp.finalfantasyxiv.com/lodestone/character/",
  NA: "https://na.finalfantasyxiv.com/lodestone/character/",
  EU: "https://eu.finalfantasyxiv.com/lodestone/character/",
};

const SEARCH_ENDPOINT = SEARCH_ENDPOINTS.JP!;
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 2;
/** 1 ページ目で完全一致が出たら追加ページは取りに行かない（レイテンシ半減）。 */
const STOP_ON_EXACT = true;

export function decodeLodestoneEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/** 名前の比較キー（大文字小文字・空白・記号のゆれを吸収）。 */
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s'’\-_.]/g, "");
}

function scoreMatch(query: string, candidate: string): LodestoneCandidate["match"] | undefined {
  const q = nameKey(query);
  const c = nameKey(candidate);
  if (q === "") return undefined;
  if (c === q) return "exact";
  if (c.startsWith(q) || q.startsWith(c)) return "prefix";
  if (c.includes(q) || q.includes(c)) return "contains";
  return undefined;
}

/** 検索結果 HTML から候補を取り出す（純関数・テスト対象）。 */
export function parseSearchResults(html: string, query: string): LodestoneCandidate[] {
  const candidates: LodestoneCandidate[] = [];
  const blocks = html.split(/<div class="entry">/).slice(1);

  for (const block of blocks) {
    const link = /<a href="\/lodestone\/character\/(\d+)\/?" class="entry__link"/.exec(block);
    const name = /<p class="entry__name">([^<]*)<\/p>/.exec(block);
    if (!name) continue;

    const worldRaw = /<p class="entry__world">([\s\S]*?)<\/p>/.exec(block);
    const worldText = worldRaw ? decodeLodestoneEntities(worldRaw[1]!.replace(/<[^>]+>/g, "")).trim() : "";
    // "Durandal [Gaia]" -> world=Durandal, dc=Gaia
    const worldMatch = /^(.+?)\s*(?:\[([^\]]+)\])?$/.exec(worldText);
    const world = worldMatch?.[1]?.trim() ?? "";
    const dataCenter = worldMatch?.[2]?.trim();

    const avatar = /entry__chara__face"><img src="([^"]+)"/.exec(block);
    const decodedName = decodeLodestoneEntities(name[1]!).trim();
    const match = scoreMatch(query, decodedName);
    if (!match) continue;

    candidates.push({
      name: decodedName,
      world,
      dataCenter,
      lodestoneId: link ? Number(link[1]) : undefined,
      avatarUrl: avatar?.[1],
      match,
    });
  }

  return candidates;
}

/** Lodestone のキャラクター検索を実行する。 */
export async function searchLodestoneCharacters(
  query: string,
  options: { pages?: number; signal?: AbortSignal; regions?: readonly string[] } = {},
): Promise<LodestoneCandidate[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  // 既定は全リージョン。World からリージョンが分かっている場合はそこだけ引けばよい。
  const regions = (options.regions?.length ? options.regions : Object.keys(SEARCH_ENDPOINTS))
    .map((region) => region.toUpperCase())
    .filter((region) => region in SEARCH_ENDPOINTS);
  if (regions.length === 0) return [];

  const found: LodestoneCandidate[] = [];
  const seen = new Set<string>();

  await Promise.all(
    regions.map((region) => searchInRegion(region, trimmed, options, found, seen)),
  );

  return sortCandidates(found);
}

/** 1 リージョンぶんの検索。複数リージョンを並列に引くために分けてある。 */
async function searchInRegion(
  region: string,
  trimmed: string,
  options: { pages?: number; signal?: AbortSignal },
  found: LodestoneCandidate[],
  seen: Set<string>,
): Promise<void> {
  const endpoint = SEARCH_ENDPOINTS[region]!;
  const maxPages = options.pages ?? MAX_PAGES;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${endpoint}?q=${encodeURIComponent(trimmed)}&page=${page}`;
    let html: string;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; fflogs-finder/0.1)",
          Accept: "text/html",
          "Accept-Language": "ja,en;q=0.8",
        },
        signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new LodestoneError("network", `Lodestone の検索に失敗しました (HTTP ${response.status})`);
      html = await response.text();
    } catch (error) {
      if (error instanceof LodestoneError) throw error;
      throw new LodestoneError("network", "Lodestone に接続できませんでした", { cause: error });
    }

    const page_results = parseSearchResults(html, trimmed);
    for (const candidate of page_results) {
      const key = `${nameKey(candidate.name)}@${candidate.world.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(candidate);
    }

    if (page_results.length === 0) break;
    if (STOP_ON_EXACT && page_results.some((candidate) => candidate.match === "exact")) {
      // 完全一致が取れていれば十分（2 ページ目を引くと往復が 1 回増える）
      break;
    }
  }

}

/** 一致度の高い順（exact > prefix > contains）に並べる。 */
function sortCandidates(found: LodestoneCandidate[]): LodestoneCandidate[] {
  const order: Record<LodestoneCandidate["match"], number> = { exact: 0, prefix: 1, contains: 2 };
  return found.sort((a, b) => order[a.match] - order[b.match] || a.name.length - b.name.length);
}


/**
 * Lodestone のキャラクターページから名前とワールドを取り出す（純関数）。
 *
 * 実測の HTML:
 *   <p class="frame__chara__name">Circle Princess</p>
 *   <p class="frame__chara__world"><i class="..."></i>Belias [Meteor]</p>
 */
export function parseCharacterPage(html: string, lodestoneId: number): LodestoneCharacter | undefined {
  const nameMatch = /<p class="frame__chara__name">([^<]*)<\/p>/.exec(html);
  if (!nameMatch) return undefined;

  const worldMatch = /<p class="frame__chara__world">([\s\S]*?)<\/p>/.exec(html);
  const worldText = worldMatch ? decodeLodestoneEntities(worldMatch[1]!.replace(/<[^>]+>/g, "")).trim() : "";
  const parts = /^(.+?)\s*(?:\[([^\]]+)\])?$/.exec(worldText);

  return {
    lodestoneId,
    name: decodeLodestoneEntities(nameMatch[1]!).trim(),
    world: parts?.[1]?.trim() ?? "",
    dataCenter: parts?.[2]?.trim(),
  };
}

/** Lodestone のキャラクターページを取得する。 */
export async function fetchLodestoneCharacter(
  lodestoneId: number,
  options: { signal?: AbortSignal } = {},
): Promise<LodestoneCharacter | undefined> {
  const url = `${SEARCH_ENDPOINT}${lodestoneId}/`;
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; fflogs-finder/0.1)",
        Accept: "text/html",
        "Accept-Language": "ja,en;q=0.8",
      },
      signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    html = await response.text();
  } catch {
    return undefined;
  }
  return parseCharacterPage(html, lodestoneId);
}
