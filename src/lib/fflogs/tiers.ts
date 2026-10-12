import type { FflogsGraphQLClient } from "./client.ts";
import { tierCount, tierZoneOverride } from "./config.ts";
import { RAID_SIZE, SAVAGE_DIFFICULTY_ID, type FflogsZoneSummary } from "./types.ts";

/**
 * 対象 Tier（零式レイド）の解決（仕様 §12）。
 *
 * レイド ID はハードコードせず、FFLogs 側の zone 情報から判定する。
 *  - Savage difficulty を持ち、そのサイズが 8 人
 *  - encounter を 4 つ以上持つ（零式は 4 層。最終層が 2 フェーズに分かれると 5 になる）
 * を満たす zone を新しい順に N 件採用する。
 */

export interface TierFloor {
  /** P1〜P4 */
  index: number;
  label: string;
  /** 1 層が複数 encounter に分かれる場合がある（例: P12S = Athena + Pallas Athena） */
  encounterIds: number[];
  encounterNames: string[];
}

export interface Tier {
  zoneId: number;
  /** FFLogs の zone 名（例: "AAC Light-Heavyweight"） */
  name: string;
  expansion: string;
  frozen: boolean;
  /** 既定パーティション（FFLogs UI が既定で表示するもの） */
  partition?: { id: number; name: string; compactName: string };
  floors: TierFloor[];
}

const ZONES_QUERY = /* GraphQL */ `
  query ZoneCatalogue {
    worldData {
      expansions {
        id
        name
        zones {
          id
          name
          frozen
          difficulties {
            id
            name
            sizes
          }
          encounters {
            id
            name
          }
          partitions {
            id
            name
            compactName
            default
          }
        }
      }
    }
  }
`;

interface ZoneCatalogueResponse {
  worldData: {
    expansions: Array<{
      id: number;
      name: string;
      zones: FflogsZoneSummary[];
    }>;
  };
}

/** 零式レイド Tier として妥当か。 */
export function isSavageRaidTier(zone: FflogsZoneSummary): boolean {
  const savage = zone.difficulties?.find((d) => d.id === SAVAGE_DIFFICULTY_ID);
  if (!savage) return false;
  if (!(savage.sizes ?? []).includes(RAID_SIZE)) return false;
  return (zone.encounters?.length ?? 0) >= 4;
}

/**
 * encounter の並びを P1〜P4 の層にまとめる。
 * 零式の最終層は 2 フェーズ構成で encounter が 2 つに分かれるため、5 つあるときは末尾 2 つを統合する。
 */
export function groupFloors(zone: FflogsZoneSummary): TierFloor[] {
  const encounters = [...(zone.encounters ?? [])].sort((a, b) => a.id - b.id);
  const floors: TierFloor[] = [];

  const mergeLastTwo = encounters.length === 5;
  const head = mergeLastTwo ? encounters.slice(0, 4) : encounters;

  head.forEach((enc, i) => {
    floors.push({ index: i + 1, label: `P${i + 1}`, encounterIds: [enc.id], encounterNames: [enc.name] });
  });

  if (mergeLastTwo) {
    const lastTwo = encounters.slice(3);
    floors[3] = {
      index: 4,
      label: "P4",
      encounterIds: lastTwo.map((e) => e.id),
      encounterNames: lastTwo.map((e) => e.name),
    };
  }

  return floors;
}

function toTier(zone: FflogsZoneSummary, expansionName: string): Tier {
  const partition = (zone.partitions ?? []).find((p) => p.default) ?? (zone.partitions ?? []).at(-1);
  return {
    zoneId: zone.id,
    name: zone.name,
    expansion: expansionName,
    frozen: Boolean(zone.frozen),
    partition: partition ? { id: partition.id, name: partition.name, compactName: partition.compactName } : undefined,
    floors: groupFloors(zone),
  };
}

/** カタログから対象 Tier を選ぶ（純関数。テストしやすいよう分離）。 */
export function selectTiers(zones: FflogsZoneSummary[], count: number, override?: number[]): Tier[] {
  const byId = new Map(zones.map((z) => [z.id, z]));

  if (override && override.length > 0) {
    return override
      .map((id) => byId.get(id))
      .filter((z): z is FflogsZoneSummary => Boolean(z))
      .map((z) => toTier(z, ""));
  }

  return zones
    .filter(isSavageRaidTier)
    .sort((a, b) => b.id - a.id)
    .slice(0, count)
    .map((z) => toTier(z, ""));
}

/** FFLogs から zone カタログを取得して対象 Tier を返す。 */
export async function fetchTiers(client: FflogsGraphQLClient): Promise<Tier[]> {
  const { data } = await client.query<ZoneCatalogueResponse>(ZONES_QUERY);
  const zones: FflogsZoneSummary[] = [];
  const expansionOf = new Map<number, string>();

  for (const expansion of data.worldData.expansions) {
    for (const zone of expansion.zones) {
      zones.push(zone);
      expansionOf.set(zone.id, expansion.name);
    }
  }

  const tiers = selectTiers(zones, tierCount(), tierZoneOverride());
  return tiers.map((tier) => ({ ...tier, expansion: expansionOf.get(tier.zoneId) ?? tier.expansion }));
}
