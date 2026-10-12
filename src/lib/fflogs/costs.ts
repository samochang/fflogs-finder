/**
 * FFLogs の消費量（実測値）。
 *
 * 「1 回」= 1 零式 × 1 ジョブ = 1 alias。実測 約 5 points（`docs/API-FINDINGS.md`）。
 * このツールは 1 人について**常に 6 つの零式ぶん**をまとめて取る（処理で固定）ので、
 * 1 人分 = 6 回分 = 約 30 points になる。
 *
 * UI の文言で使う数値はここに集約して、画面ごとにずれないようにする。
 */

/** 1 人について取得する零式の数（処理で固定）。 */
export const TIERS_PER_CHARACTER = 6;

/** 1 零式 × 1 ジョブ（= 1 回）あたりの実測単価。 */
export const POINTS_PER_TIER = 5;

/** 1 人分の取得コスト。 */
export const POINTS_PER_CHARACTER = TIERS_PER_CHARACTER * POINTS_PER_TIER;

/** ポイントを「あと何人分」に換算する。 */
export function peopleFromPoints(points: number): number {
  return Math.floor(points / POINTS_PER_CHARACTER);
}
