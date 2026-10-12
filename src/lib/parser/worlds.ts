/**
 * ワールド（サーバ）名の解決。
 *
 * 全 125 ワールド（NA/EU/JP/OC/CN/KR）の一覧は `worlds.generated.ts` に静的に持つ。
 * `worldData.regions.servers` を実行時に引くと実測 31 points かかるため、
 * 通常は生成済みの一覧だけを使う（`npm run fetch:worlds` で更新）。
 *
 * ワールドは拡張のタイミングでしか増えないので、これで実用上困らない。
 */

import { ALL_WORLDS } from "./worlds.generated.ts";
import { WORLD_TO_DATA_CENTER } from "./world-dc.generated.ts";

export interface WorldRef {
  name: string;
  slug: string;
  /** FFLogs の region slug（JP / NA / EU / OC / CN / KR） */
  region: string;
}

export { ALL_WORLDS, WORLD_TO_DATA_CENTER };

/** JP の 32 ワールド（テスト・表示用）。 */
export const JP_WORLDS: readonly WorldRef[] = ALL_WORLDS.filter((w) => w.region === "JP");

/**
 * 日本語圏の募集で使われるワールド表記のゆれ。
 * 例: 「チョコボ」のようなカタカナ表記。
 */
export const WORLD_NAME_ALIASES: Readonly<Record<string, string>> = {
  アイギス: "Aegis",
  アトモス: "Atomos",
  カーバンクル: "Carbuncle",
  ガルーダ: "Garuda",
  グングニル: "Gungnir",
  クジャタ: "Kujata",
  ラムウ: "Ramuh",
  トンベリ: "Tonberry",
  テュポーン: "Typhon",
  ユニコーン: "Unicorn",
  アニマ: "Anima",
  アスラ: "Asura",
  ベリアス: "Belias",
  チョコボ: "Chocobo",
  ハーデス: "Hades",
  イクシオン: "Ixion",
  マンドラゴラ: "Mandragora",
  マサムネ: "Masamune",
  パンデモニウム: "Pandaemonium",
  シンリュウ: "Shinryu",
  タイタン: "Titan",
  アレクサンダー: "Alexander",
  バハムート: "Bahamut",
  デュランダル: "Durandal",
  フェンリル: "Fenrir",
  イフリート: "Ifrit",
  リディル: "Ridill",
  ティアマット: "Tiamat",
  アルテマ: "Ultima",
  ヴァレフォル: "Valefor",
  ヨウジンボウ: "Yojimbo",
  ゼロムス: "Zeromus",
};

/**
 * ワールドから論理データセンターを引く。
 * FFLogs は region しか返さないため、DC は Lodestone のワールド一覧から補う。
 */
export function dataCenterForWorld(world: string): string | undefined {
  const trimmed = world.trim();
  if (trimmed === "") return undefined;
  if (WORLD_TO_DATA_CENTER[trimmed]) return WORLD_TO_DATA_CENTER[trimmed];
  const lower = trimmed.toLowerCase();
  for (const [name, dc] of Object.entries(WORLD_TO_DATA_CENTER)) {
    if (name.toLowerCase() === lower) return dc;
  }
  return undefined;
}

/** ワールド名の比較キー。空白・ハイフン・アポストロフィを除去して小文字化する。 */
export function normalizeWorldKey(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-'’·.]/g, "");
}

/**
 * 同名ワールドが複数リージョンに存在する場合の優先順位。
 *
 * 実データで KR の Carbuncle / Chocobo / Fenrir / Tonberry が JP と、
 * KR の Moogle が EU と衝突する。日本語の募集文を扱うツールなので JP を最優先にする。
 */
const REGION_PRIORITY: readonly string[] = ["JP", "NA", "EU", "OC", "CN", "KR"];

function regionRank(region: string): number {
  const index = REGION_PRIORITY.indexOf(region);
  return index === -1 ? REGION_PRIORITY.length : index;
}

const STATIC_INDEX: ReadonlyMap<string, WorldRef[]> = (() => {
  const map = new Map<string, WorldRef[]>();
  const push = (key: string, world: WorldRef) => {
    const list = map.get(key) ?? [];
    if (!list.some((w) => w.slug === world.slug && w.region === world.region)) list.push(world);
    map.set(key, list);
  };

  for (const world of ALL_WORLDS) {
    push(normalizeWorldKey(world.name), world);
    push(normalizeWorldKey(world.slug), world);
  }
  for (const [alias, canonical] of Object.entries(WORLD_NAME_ALIASES)) {
    for (const ref of map.get(normalizeWorldKey(canonical)) ?? []) push(normalizeWorldKey(alias), ref);
  }

  for (const list of map.values()) list.sort((a, b) => regionRank(a.region) - regionRank(b.region));
  return map;
})();

/**
 * 入力に一致するワールドを優先順に返す。
 * 同名ワールドが複数リージョンにある場合は複数返るので、呼び出し側が順に試す。
 */
export function lookupWorldCandidates(input: string, dynamic?: ReadonlyMap<string, WorldRef[]>): WorldRef[] {
  const key = normalizeWorldKey(input);
  const fromDynamic = dynamic?.get(key);
  if (fromDynamic && fromDynamic.length > 0) return fromDynamic;
  return STATIC_INDEX.get(key) ?? [];
}

/** 静的に解決できるワールドを 1 つ返す（優先順位の最上位）。 */
export function lookupWorldStatic(input: string, dynamic?: ReadonlyMap<string, WorldRef>): WorldRef | undefined {
  const key = normalizeWorldKey(input);
  return dynamic?.get(key) ?? STATIC_INDEX.get(key)?.[0];
}

/** 静的に解決できる全ワールド（キーは正規化済み、優先順に並ぶ）。 */
export function staticWorldIndex(): ReadonlyMap<string, WorldRef[]> {
  return STATIC_INDEX;
}

/** 単一値のインデックス（後方互換・テスト用）。 */
export function makeWorldIndex(worlds: readonly WorldRef[]): ReadonlyMap<string, WorldRef> {
  const map = new Map<string, WorldRef>();
  for (const w of worlds) {
    map.set(normalizeWorldKey(w.name), w);
    map.set(normalizeWorldKey(w.slug), w);
  }
  return map;
}

/** 同名ワールドを保持できるマルチインデックスを作る。 */
export function makeWorldMultiIndex(worlds: readonly WorldRef[]): ReadonlyMap<string, WorldRef[]> {
  const map = new Map<string, WorldRef[]>();
  const push = (key: string, world: WorldRef) => {
    const list = map.get(key) ?? [];
    if (!list.some((w) => w.slug === world.slug && w.region === world.region)) list.push(world);
    map.set(key, list);
  };
  for (const world of worlds) {
    push(normalizeWorldKey(world.name), world);
    push(normalizeWorldKey(world.slug), world);
  }
  for (const list of map.values()) list.sort((a, b) => regionRank(a.region) - regionRank(b.region));
  return map;
}
