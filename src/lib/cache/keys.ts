/**
 * Redis キー設計（仕様 §28 / §30）。
 *
 * 「1 character = 1 document」に寄せる。
 * refresh lock は問い合わせ単位（character × job）で取り、短時間だけ同一対象の更新を 1 本に絞る。
 */

export const CACHE_PREFIX = "fflogs";

export function characterKey(canonicalId: number): string {
  return `${CACHE_PREFIX}:character:${canonicalId}`;
}

export function characterLookupKey(region: string, serverSlug: string, name: string): string {
  return `${CACHE_PREFIX}:lookup:${region.toLowerCase()}:${serverSlug.toLowerCase()}:${name.toLowerCase()}`;
}

/**
 * 名前から確定済みの FFLogs 候補への対応表。
 *
 * Lodestone 検索と FFLogs の実在確認をやり直さなくて済むようにする（再訪問時は 0 往復）。
 * Lodestone が落ちていても既知の名前は解決できる。
 */
export function characterNameIndexKey(name: string): string {
  return `${CACHE_PREFIX}:nameindex:${normalizeNameKey(name)}`;
}

/** 名前の比較キー（大文字小文字・空白・記号のゆれを吸収）。 */
export function normalizeNameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s'’\-_.]/g, "");
}

/** Lodestone の名前検索結果（名前 -> 候補）。 */
export function lodestoneSearchKey(name: string): string {
  return `${CACHE_PREFIX}:lodestone:${name.normalize("NFKC").toLowerCase()}`;
}

export function tierCatalogueKey(): string {
  return `${CACHE_PREFIX}:tiers`;
}

export function worldIndexKey(): string {
  return `${CACHE_PREFIX}:worlds`;
}

/**
 * refresh lock のキー（仕様 §28）。
 * canonicalID が未確定なうちは「検索クエリのハッシュ」で代用する。
 */
export function refreshLockKey(scope: string): string {
  return `${CACHE_PREFIX}:refresh:${scope}`;
}

export function rateLimitSnapshotKey(): string {
  return `${CACHE_PREFIX}:ratelimit`;
}

/** 問い合わせ単位の scope 文字列。 */
export function refreshScope(canonicalId: number | string, job?: string): string {
  return job ? `${canonicalId}:${job}` : String(canonicalId);
}
