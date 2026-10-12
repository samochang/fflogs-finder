/**
 * API points の実測（仕様 §25 / Phase 7）。
 *
 *   npm run measure:points
 *
 * 計測方法:
 *   FFLogs の pointsSpentThisHour はリクエスト直後には確定しない（1 リクエスト分遅れて見える）ため、
 *   値が安定するまで rateLimitData を読み直してから差分を取る（settle 方式）。
 *   rateLimitData 単体クエリのコストは 1 point と実測済みなので、settle で発生した読み取り分を差し引く。
 *
 * 計測するケース（仕様 §25 の A〜D + 追加）:
 *   A. 1 character × 1 Tier
 *   B. 1 character × 3 Tier
 *   C. 1 character × 6 Tier
 *   D. 8 character × 6 Tier（1 リクエストにまとめる）
 *   E. 8 character × 6 Tier（キャラごとに分割 = C × 8 の確認）
 *   F. last-update 確認用の軽量クエリ（recentReports）
 *   G. rateLimitData 単体
 *   H. report.table(DamageDone) による Active 取得 1 回
 *   + rateLimitData 同梱がコストに影響しないかの確認
 */
import { FflogsGraphQLClient } from "../src/lib/fflogs/client.ts";
import { loadConfig } from "../src/lib/fflogs/config.ts";
import { fetchTiers } from "../src/lib/fflogs/tiers.ts";

const client = new FflogsGraphQLClient(loadConfig());

/** JP の実在キャラクター（FFLogs の公開レポート masterData から取得した実データ）。 */
const CHARACTERS = [
  { name: "Aka Accl", server: "typhon" },
  { name: "Kuna Litorest", server: "aegis" },
  { name: "Pyor Dameron", server: "kujata" },
  { name: "Sheltie Rizen", server: "chocobo" },
  { name: "Ucioo Ucioo", server: "ixion" },
  { name: "Or Bea", server: "tiamat" },
  { name: "Alestro Dq", server: "asura" },
  { name: "Garahu Baldesion", server: "garuda" },
] as const;

const READ_COST = 1;

const tierList = await fetchTiers(client);
const zoneIds = tierList.map((t) => t.zoneId);
console.log("対象 Tier:", tierList.map((t) => `${t.zoneId}:${t.name}`).join(", "));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SettleResult {
  spent: number;
  /** settle 中に実行した rateLimitData クエリの本数（= 消費した points） */
  reads: number;
}

/** pointsSpentThisHour が安定するまで読み直す。 */
async function settle(maxReads = 8): Promise<SettleResult> {
  let prev = Number.NaN;
  let reads = 0;
  for (let i = 0; i < maxReads; i += 1) {
    const res = await client.query<{ rateLimitData: { pointsSpentThisHour: number } }>(
      `query { rateLimitData { pointsSpentThisHour pointsResetIn } }`,
      { skipRateLimitTelemetry: true, noRetry: true },
    );
    reads += 1;
    const spent = res.data.rateLimitData.pointsSpentThisHour;
    if (spent === prev) return { spent, reads };
    prev = spent;
    await sleep(1100);
  }
  return { spent: prev, reads };
}

function characterBlock(name: string, server: string, zones: number[]): string {
  const aliases = zones
    .map((z) => `z${z}: zoneRankings(zoneID: ${z}, difficulty: 101, metric: dps)`)
    .join("\n      ");
  return `    c_${name.replace(/[^A-Za-z0-9]/g, "_")}: character(name: ${JSON.stringify(name)}, serverSlug: ${JSON.stringify(server)}, serverRegion: "JP") {\n      id\n      ${aliases}\n    }`;
}

function queryFor(chars: readonly { name: string; server: string }[], zones: number[]): string {
  return `query Measure {\n  characterData {\n${chars.map((c) => characterBlock(c.name, c.server, zones)).join("\n")}\n  }\n}`;
}

interface Measurement {
  label: string;
  points: number;
  requests: number;
  note?: string;
}

const measurements: Measurement[] = [];

/** ケースを K 回実行し、settle 差分から 1 回あたりのコストを求める。 */
async function measure(label: string, query: string, options: { repetitions?: number; skipTelemetry?: boolean } = {}): Promise<void> {
  const repetitions = options.repetitions ?? 1;
  const before = await settle();
  const requestsBefore = client.requestCount;

  for (let i = 0; i < repetitions; i += 1) {
    await client.query(query, { noRetry: true, skipRateLimitTelemetry: options.skipTelemetry });
  }

  const after = await settle();
  const requests = client.requestCount - requestsBefore;

  if (after.spent < before.spent) {
    measurements.push({ label, points: Number.NaN, requests, note: "レート制限ウィンドウがリセットされたため再計測が必要" });
    return;
  }

  const total = after.spent - before.spent - after.reads * READ_COST;
  measurements.push({ label, points: round(total / repetitions), requests });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const [t0, t1, t2] = [zoneIds[0]!, zoneIds[1]!, zoneIds[2]!];
const six = zoneIds;
const three = [t0, t1, t2];

/** ケース選択: --cases=A,C,D （未指定なら全部）。D は高コストなので最後に回す。 */
const caseArg = process.argv.find((a) => a.startsWith("--cases="));
const selected = caseArg ? new Set(caseArg.slice("--cases=".length).split(",").map((s) => s.trim().toUpperCase())) : undefined;
const wants = (id: string) => !selected || selected.has(id);

if (wants("G")) {
  await measure("G. rateLimitData 単体", `query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`, {
    skipTelemetry: true,
  });
}

if (wants("A")) await measure("A. 1 char × 1 Tier", queryFor([CHARACTERS[0]!], [t0]));
if (wants("B")) await measure("B. 1 char × 3 Tier", queryFor([CHARACTERS[0]!], three));
if (wants("C")) await measure("C. 1 char × 6 Tier", queryFor([CHARACTERS[0]!], six));
if (wants("C'")) {
  await measure("C'. 1 char × 6 Tier（rateLimitData 同梱なし）", queryFor([CHARACTERS[0]!], six), {
    skipTelemetry: true,
  });
}

if (wants("T")) {
  await measure(
    "T. zone カタログ（worldData.expansions.zones）",
    `query { worldData { expansions { id name zones { id name frozen difficulties { id name sizes } encounters { id name } partitions { id name compactName default } } } } }`,
  );
}

if (wants("T2")) {
  await measure(
    "T2. zone カタログ（partitions を除く）",
    `query { worldData { expansions { id name zones { id name frozen difficulties { id name sizes } encounters { id name } } } } }`,
  );
}

if (wants("W")) {
  await measure(
    "W. ワールド一覧（worldData.regions.servers）",
    `query { worldData { regions { id slug servers(limit: 500) { data { name slug region { slug } } } } } }`,
  );
}

if (wants("F")) {
  await measure(
    "F. last-update 確認（recentReports）",
    `query { characterData { character(name: ${JSON.stringify(CHARACTERS[0]!.name)}, serverSlug: ${JSON.stringify(CHARACTERS[0]!.server)}, serverRegion: "JP") { recentReports(limit: 5) { data { code startTime zone { id } } } } } }`,
  );
}

if (wants("H")) {
  const firstEncounter = tierList[0]!.floors[0]!.encounterIds[0]!;
  const probe = await client.query<{
    characterData: { character: { encounterRankings: { ranks: Array<{ report: { code: string; fightID: number } }> } | null } };
  }>(
    `query { characterData { character(name: ${JSON.stringify(CHARACTERS[0]!.name)}, serverSlug: ${JSON.stringify(CHARACTERS[0]!.server)}, serverRegion: "JP") { encounterRankings(encounterID: ${firstEncounter}, difficulty: 101, metric: dps) } } }`,
    { noRetry: true },
  );
  const bestRank = probe.data.characterData.character.encounterRankings?.ranks?.[0];
  if (bestRank) {
    await measure(
      `H. Active 取得（DamageDone, fight ${bestRank.report.fightID}）`,
      `query { reportData { report(code: ${JSON.stringify(bestRank.report.code)}) { table(dataType: DamageDone, fightIDs: [${bestRank.report.fightID}]) } } }`,
    );
  } else {
    measurements.push({ label: "H. Active 取得（DamageDone）", points: Number.NaN, requests: 0, note: "対象 fight が見つからずスキップ" });
  }
}

// E は C が分かれば導出できるので、C が取れていれば省略可
if (wants("E")) {
  await measure("E. 1 char × 6 Tier（別リクエストで 2 回）", queryFor([CHARACTERS[0]!], six), { repetitions: 2 });
}

// D は最も高コストなので最後
if (wants("D")) await measure("D. 8 char × 6 Tier（1 query）", queryFor(CHARACTERS, six));

const width = Math.max(...measurements.map((m) => m.label.length));
console.log("\n" + "ケース".padEnd(width) + " | points | HTTP");
console.log("-".repeat(width + 16));
for (const m of measurements) {
  const value = Number.isFinite(m.points) ? String(m.points).padStart(6) : "   n/a";
  console.log(`${m.label.padEnd(width)} | ${value} | ${String(m.requests).padStart(4)}${m.note ? `   [${m.note}]` : ""}`);
}

console.log("\nrate limit:", JSON.stringify(client.lastRateLimitSnapshot));
console.log(`HTTP リクエスト数: ${client.requestCount}`);
console.log(
  "\n注: E は「1 char × 6 Tier」クエリを独立した HTTP リクエストとして 2 回投げたときの 1 回あたりコスト。" +
    "\n    D が C と同程度なら、8 人分を 1 query にまとめる効果が大きい。",
);
