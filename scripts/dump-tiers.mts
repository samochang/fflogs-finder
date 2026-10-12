/**
 * 対象 Tier の解決結果を確認する（仕様 §12 / §39）。
 *
 *   npm run fetch:tiers
 */
import { FflogsGraphQLClient } from "../src/lib/fflogs/client.ts";
import { loadConfig } from "../src/lib/fflogs/config.ts";
import { fetchTiers, isSavageRaidTier } from "../src/lib/fflogs/tiers.ts";
import type { FflogsZoneSummary } from "../src/lib/fflogs/types.ts";
import { RAID_SIZE, SAVAGE_DIFFICULTY_ID } from "../src/lib/fflogs/types.ts";

const client = new FflogsGraphQLClient(loadConfig());

const { data } = await client.query<{
  worldData: { expansions: Array<{ id: number; name: string; zones: FflogsZoneSummary[] }> };
}>(`query { worldData { expansions { id name zones { id name frozen difficulties { id name sizes } encounters { id name } partitions { id name compactName default } } } } }`);

const all = data.worldData.expansions.flatMap((e) => e.zones);
console.log(`zones total: ${all.length}`);
console.log(
  `savage ${RAID_SIZE}-man zones: ${all.filter(isSavageRaidTier).length} ` +
    `(Savage difficulty id = ${SAVAGE_DIFFICULTY_ID})`,
);
console.log("\n除外された Savage zone（サイズ違い = 零式レイドではない）:");
for (const z of all) {
  const savage = z.difficulties?.find((d) => d.id === SAVAGE_DIFFICULTY_ID);
  if (savage && !isSavageRaidTier(z)) {
    console.log(`  - [${z.id}] ${z.name}: sizes=${JSON.stringify(savage.sizes)} encounters=${z.encounters.length}`);
  }
}

const tiers = await fetchTiers(client);
console.log(`\n選択された Tier (${tiers.length}):`);
for (const t of tiers) {
  console.log(
    `  [${t.zoneId}] ${t.name} (${t.expansion}) frozen=${t.frozen} partition=${t.partition?.compactName ?? "-"}`,
  );
  for (const f of t.floors) {
    console.log(`      ${f.label}: ${f.encounterNames.join(" + ")} (ids: ${f.encounterIds.join(",")})`);
  }
}
console.log("\nrate limit:", JSON.stringify(client.lastRateLimitSnapshot));
