/**
 * 全リージョンのワールド一覧を FFLogs から取得して
 * `src/lib/parser/worlds.generated.ts` を生成する。
 *
 *   npm run fetch:worlds
 *
 * ワールドは拡張のタイミングでしか増えないため、実行時に API を叩かず
 * 生成済みの一覧を使う（`worldData.regions.servers` は実測 31 points かかる）。
 */
import { writeFile } from "node:fs/promises";
import { FflogsGraphQLClient } from "../src/lib/fflogs/client.ts";
import { loadConfig } from "../src/lib/fflogs/config.ts";

interface RegionResponse {
  worldData: {
    regions: Array<{
      id: number;
      name: string;
      slug: string;
      servers: { total: number; data: Array<{ name: string; slug: string }> };
    }>;
  };
}

const client = new FflogsGraphQLClient(loadConfig());
const { data } = await client.query<RegionResponse>(
  `query { worldData { regions { id name slug servers(limit: 500) { total data { name slug } } } } }`,
);

const rows: Array<{ name: string; slug: string; region: string }> = [];
for (const region of data.worldData.regions) {
  for (const server of region.servers.data) {
    rows.push({ name: server.name, slug: server.slug, region: region.slug });
  }
  console.log(`  ${region.slug.padEnd(3)} ${region.name.padEnd(15)} ${region.servers.data.length} / ${region.servers.total}`);
}

rows.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));

const body = `/**
 * 全リージョンのワールド一覧。
 *
 * このファイルは自動生成される。編集しないこと。
 *   npm run fetch:worlds
 *
 * 出典: FFLogs \`worldData { regions { slug servers { data { name slug } } } }\`
 * 取得日: ${new Date().toISOString().slice(0, 10)}
 */

import type { WorldRef } from "./worlds.ts";

export const ALL_WORLDS: readonly WorldRef[] = [
${rows.map((r) => `  { name: ${JSON.stringify(r.name)}, slug: ${JSON.stringify(r.slug)}, region: ${JSON.stringify(r.region)} },`).join("\n")}
];
`;

const out = new URL("../src/lib/parser/worlds.generated.ts", import.meta.url);
await writeFile(out, body);
console.log(`\n${rows.length} ワールドを src/lib/parser/worlds.generated.ts に書き出しました。`);
console.log("rate limit:", JSON.stringify(client.lastRateLimitSnapshot));
