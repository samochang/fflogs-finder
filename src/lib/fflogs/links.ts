/**
 * 外部リンクの組み立て（クライアントからも使うので副作用を持たせない）。
 */

/**
 * FFLogs のキャラクターページ URL。
 *
 * 形式は実在のリンクで確認済み:
 *   https://www.fflogs.com/character/NA/Midgardsormr/Leonardo%20Yuneli
 *   https://www.fflogs.com/character/na/midgardsormr/ienaga%20uzuka
 * → `character/{region}/{realm}/{name}`（region と realm は大文字小文字どちらでも通る）
 *
 * region / world が分からない場合は null を返す（推測でリンクを張らない）。
 */
export function fflogsCharacterUrl(options: {
  /** "jp" / "na" / "eu" / "oc" / "kr" など（小文字） */
  region?: string | null;
  /** ワールド名。例 "Ramuh" */
  world?: string | null;
  /** キャラクター名。例 "Wata Gasi" */
  name?: string | null;
}): string | null {
  const region = options.region?.trim().toLowerCase();
  const world = options.world?.trim();
  const name = options.name?.trim();
  if (!region || !world || !name) return null;

  // 名前の空白は %20 にする（実在リンクと同じ）
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "%20");
  return `https://www.fflogs.com/character/${encodeURIComponent(region)}/${encode(world)}/${encode(name)}`;
}
