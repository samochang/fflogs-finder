/**
 * Lodestone のワールドステータスページから「ワールド → 論理データセンター」を取得し、
 * `src/lib/parser/world-dc.generated.ts` を生成する。
 *
 *   npm run fetch:world-dc
 *
 * FFLogs は region（JP/NA/EU…）しか返さないため、DC は Lodestone から補う。
 * 候補選択の初期表示を「募集主と同じ DC」に寄せるために使う。
 */
import { writeFile } from "node:fs/promises";

const PAGE_URL = "https://jp.finalfantasyxiv.com/lodestone/worldstatus/";

const response = await fetch(PAGE_URL, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; fflogs-finder/0.1)", Accept: "text/html", "Accept-Language": "ja" },
});
if (!response.ok) throw new Error(`Lodestone の取得に失敗しました (HTTP ${response.status})`);
const html = await response.text();

/** `world-dcgroup__item`（DC ごとのブロック）を取り出す。 */
export function parseWorldDataCenters(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const blocks = source.split(/<li class="world-dcgroup__item">/).slice(1);

  for (const block of blocks) {
    const header = /<h2 class="world-dcgroup__header">([^<]+)<\/h2>/.exec(block);
    if (!header) continue;
    const dataCenter = header[1]!.trim();
    for (const m of block.matchAll(/<div class="world-list__world_name">[\s\S]*?<p>([^<]+)<\/p>/g)) {
      map.set(m[1]!.trim(), dataCenter);
    }
  }

  return map;
}

const map = parseWorldDataCenters(html);
if (map.size === 0) throw new Error("ワールド / DC を 1 件も抽出できませんでした（ページ構造が変わった可能性）");

const byDc = new Map<string, string[]>();
for (const [world, dc] of map) {
  byDc.set(dc, [...(byDc.get(dc) ?? []), world]);
}
for (const [dc, worlds] of [...byDc].sort()) {
  console.log(`  ${dc.padEnd(12)} ${worlds.length} ワールド: ${worlds.join(", ")}`);
}

const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const body = `/**
 * ワールド → 論理データセンター。
 *
 * このファイルは自動生成される。編集しないこと。
 *   npm run fetch:world-dc
 *
 * 出典: Lodestone ワールドステータス（${PAGE_URL}）
 * 取得日: ${new Date().toISOString().slice(0, 10)}
 */

export const WORLD_TO_DATA_CENTER: Readonly<Record<string, string>> = {
${entries.map(([world, dc]) => `  ${JSON.stringify(world)}: ${JSON.stringify(dc)},`).join("\n")}
};
`;

await writeFile(new URL("../src/lib/parser/world-dc.generated.ts", import.meta.url), body);
console.log(`\n${entries.length} ワールドを src/lib/parser/world-dc.generated.ts に書き出しました。`);
