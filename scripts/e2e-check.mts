/**
 * 実際の FFLogs データを使ったエンドツーエンド確認。
 *
 *   node scripts/e2e-check.mts [baseUrl]
 *
 * 事前に `npm run dev`（または `npm run build && npm start`）でアプリを起動しておくこと。
 *
 * 検証内容:
 *   1. /api/parse が募集文から 8 人を認識する
 *   2. /api/compare が FFLogs からデータを取得する（1 回目）
 *   3. 同じ入力で再度呼ぶとキャッシュから返る（FFLogs へ問い合わせない）
 *   4. /api/refresh が refresh lock 越しに更新する
 *
 * 注意: 2 と 4 は FFLogs の API points を消費する。
 */
import { writeFile } from "node:fs/promises";

const BASE_URL = process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

/**
 * FFLogs の公開レポート masterData から取得した実在の JP キャラクター（名前 / World / そのときのジョブ）。
 */
const RECRUITMENT_TEXT = `MT Ucioo Ucioo / 戦士 / Ixion
ST Garahu Baldesion / ナイト / Garuda
H1 Kuna Litorest / 白魔道士 / Aegis
H2 Or Bea / 学者 / Tiamat
D1 Pyor Dameron / リーパー / Kujata
D2 Sheltie Rizen / 忍者 / Chocobo
D3 Alestro Dq / 機工士 / Asura
D4 Aka Accl / ピクトマンサー / Typhon`;

interface Slot {
  name: string;
  world?: string;
  recruitmentJob?: string;
  recruitmentPosition?: string;
  jobConfidence?: string;
  characterId: number | null;
}

interface Cell {
  floorIndex: number;
  bestPercent: number | null;
  medianPercent: number | null;
  kills: number;
  activePercent: number | null;
}

interface Row {
  name: string;
  world?: string;
  canonicalId: number | null;
  recruitmentJob: string | null;
  recruitmentPosition?: string;
  status: string;
  message?: string;
  tiers: Record<string, Cell[]>;
}

interface CompareResponse {
  tiers: Array<{ zoneId: number; name: string; expansion: string; floors: Array<{ index: number; label: string }> }>;
  rows: Row[];
  warnings: Array<{ lineNumber: number; reason: string }>;
  meta: {
    servedFromCache: boolean;
    cacheStoreKind: string;
    credentialsConfigured: boolean;
    rateLimit?: { limitPerHour: number; pointsSpentThisHour: number; pointsResetIn: number };
    fetched: { characters: number; tiers: number };
    failures: Array<{ canonicalId: number; jobId: string; message: string }>;
    degraded?: boolean;
    locked?: boolean;
  };
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

function line(char = "─", width = 78): string {
  return char.repeat(width);
}

const problems: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) problems.push(message);
  console.log(`${condition ? "  OK  " : " FAIL "} ${message}`);
}

// ---------------------------------------------------------------- 1. parse
console.log("1. /api/parse");
const parsed = await post<{ slots: Slot[]; warnings: Array<{ reason: string }>; stats: { candidateLines: number } }>("/api/parse", {
  text: RECRUITMENT_TEXT,
});
check(parsed.status === 200, `HTTP 200（実際: ${parsed.status}）`);
check(parsed.body.slots?.length === 8, `8 人を認識（実際: ${parsed.body.slots?.length}）`);
for (const slot of parsed.body.slots ?? []) {
  console.log(`        ${slot.recruitmentPosition?.padEnd(4)} ${slot.recruitmentJob?.padEnd(14)} ${slot.name} @ ${slot.world}`);
}

const slots = parsed.body.slots ?? [];

// ------------------------------------------------------------- 2. compare
console.log(`\n2. /api/compare（初回・FFLogs へ問い合わせ）`);
const first = await post<CompareResponse>("/api/compare", { slots, warnings: [] });
check(first.status === 200, `HTTP 200（実際: ${first.status}, ${JSON.stringify(first.body).slice(0, 120)}）`);

const compare = first.body;
const resolved = compare.rows?.filter((r) => r.status === "ok") ?? [];
check(compare.tiers?.length === 6, `対象 Tier が 6 件（実際: ${compare.tiers?.length}）`);
check(resolved.length === 8, `8 人が FFLogs 上で特定できた（実際: ${resolved.length}）`);
check(compare.meta?.servedFromCache === false, "初回はキャッシュからではない");
check(compare.meta?.fetched?.characters === 8, `8 キャラクターぶん取得（実際: ${compare.meta?.fetched?.characters}）`);

const withData = resolved.filter((row) =>
  Object.values(row.tiers).some((cells) => cells.some((c) => c.bestPercent !== null || c.kills > 0)),
);
check(withData.length > 0, `ランキングが 1 件以上返っている（実際: ${withData.length} 人）`);

console.log(`\n  Tier: ${compare.tiers.map((t) => `${t.zoneId}:${t.name}`).join(", ")}`);
console.log(`  ${line()}`);
for (const row of compare.rows ?? []) {
  const cells = compare.tiers.flatMap((tier) => row.tiers[String(tier.zoneId)] ?? []);
  const bests = cells.map((c) => (c.bestPercent === null ? " –" : String(Math.round(c.bestPercent)).padStart(3)));
  console.log(
    `  ${(row.recruitmentPosition ?? "").padEnd(5)} ${row.name.padEnd(20)} ${String(row.recruitmentJob ?? "-").padEnd(14)} ${bests.join(" ")}  [${row.status}]`,
  );
}
console.log(`  ${line()}`);
console.log(`  rate limit: ${JSON.stringify(compare.meta?.rateLimit)}`);
if (compare.meta?.failures?.length) console.log(`  failures: ${JSON.stringify(compare.meta.failures)}`);

// ------------------------------------------------------------- 3. キャッシュ
console.log("\n3. /api/compare（2 回目・キャッシュのみ）");
const second = await post<CompareResponse>("/api/compare", { slots, warnings: [] });
check(second.status === 200, `HTTP 200（実際: ${second.status}）`);
check(second.body.meta?.servedFromCache === true, "キャッシュから応答した（FFLogs へ問い合わせていない）");
check(second.body.meta?.fetched?.characters === 0, `追加取得 0 件（実際: ${second.body.meta?.fetched?.characters}）`);
check(
  typeof second.body.meta?.rateLimit?.pointsSpentThisHour === "number",
  "キャッシュ応答でもレート制限情報が返る",
);
check(
  second.body.meta?.rateLimit?.pointsSpentThisHour === first.body.meta?.rateLimit?.pointsSpentThisHour,
  `2 回目で points が増えていない（1 回目 ${first.body.meta?.rateLimit?.pointsSpentThisHour} / 2 回目 ${second.body.meta?.rateLimit?.pointsSpentThisHour}）`,
);

// ------------------------------------------------------------- 4. refresh
console.log("\n4. /api/refresh（refresh lock 越しの更新）");
const refreshed = await post<CompareResponse & { meta: { locked?: boolean; rateLimited?: boolean; message?: string } }>("/api/refresh", {
  slots: slots.map((s) => ({ ...s })),
});
check(refreshed.status === 200, `HTTP 200（実際: ${refreshed.status}）`);
check(refreshed.body.meta?.locked === false, "ロックを取得して更新できた");
check(refreshed.body.meta?.servedFromCache === false, "更新時は FFLogs へ問い合わせた");
console.log(`  rate limit: ${JSON.stringify(refreshed.body.meta?.rateLimit)}`);

await writeFile(
  "scripts/_e2e-result.json",
  JSON.stringify({ parsedAt: new Date().toISOString(), first: compare, refreshed: refreshed.body }, null, 1),
);

console.log(`\n${problems.length === 0 ? "✅ すべての確認項目をパスしました" : `⚠️  ${problems.length} 件の問題:`}`);
for (const p of problems) console.log(`   - ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
