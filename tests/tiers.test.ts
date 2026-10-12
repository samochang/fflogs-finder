import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupFloors, isSavageRaidTier, selectTiers } from "../src/lib/fflogs/tiers.ts";
import type { FflogsZoneSummary } from "../src/lib/fflogs/types.ts";

function zone(partial: Partial<FflogsZoneSummary> & { id: number; name: string }): FflogsZoneSummary {
  return {
    frozen: true,
    difficulties: [{ id: 101, name: "Savage", sizes: [8] }],
    encounters: [],
    partitions: [],
    ...partial,
  };
}

const encounters = (n: number, startId: number) =>
  Array.from({ length: n }, (_, i) => ({ id: startId + i, name: `Boss${i + 1}` }));

describe("isSavageRaidTier", () => {
  it("Savage 8 人用で 4 層以上ある zone だけを Tier とみなす", () => {
    assert.equal(isSavageRaidTier(zone({ id: 62, name: "AAC Light-Heavyweight", encounters: encounters(4, 93) })), true);
    assert.equal(isSavageRaidTier(zone({ id: 73, name: "AAC Heavyweight", encounters: encounters(5, 101) })), true);
  });

  it("Criterion(4人) や Delubrum(48人) を除外する", () => {
    assert.equal(
      isSavageRaidTier(
        zone({ id: 61, name: "Dungeons (Criterion Legacy)", difficulties: [{ id: 11, name: "Savage", sizes: [4] }], encounters: encounters(3, 1) }),
      ),
      false,
    );
    assert.equal(
      isSavageRaidTier(zone({ id: 77, name: "The Forked Tower: Magic", difficulties: [{ id: 101, name: "Savage", sizes: [48] }], encounters: encounters(4, 1) })),
      false,
    );
  });

  it("Normal しか持たない zone を除外する", () => {
    assert.equal(
      isSavageRaidTier(zone({ id: 17, name: "Omega: Deltascape (Savage)", difficulties: [{ id: 100, name: "Normal", sizes: [8] }], encounters: encounters(5, 1) })),
      false,
    );
  });

  it("encounter が 4 未満の zone を除外する", () => {
    assert.equal(isSavageRaidTier(zone({ id: 99, name: "Trial", encounters: encounters(1, 1) })), false);
  });
});

describe("groupFloors", () => {
  it("4 encounter ならそのまま P1〜P4", () => {
    const floors = groupFloors(zone({ id: 62, name: "AAC Light-Heavyweight", encounters: encounters(4, 93) }));
    assert.deepEqual(
      floors.map((f) => [f.label, f.encounterIds]),
      [
        ["P1", [93]],
        ["P2", [94]],
        ["P3", [95]],
        ["P4", [96]],
      ],
    );
  });

  it("5 encounter なら最終層の 2 フェーズを P4 に統合する", () => {
    const floors = groupFloors(
      zone({
        id: 54,
        name: "Anabaseios",
        encounters: [
          { id: 88, name: "Kokytos" },
          { id: 89, name: "Pandaemonium" },
          { id: 90, name: "Themis" },
          { id: 91, name: "Athena" },
          { id: 92, name: "Pallas Athena" },
        ],
      }),
    );
    assert.equal(floors.length, 4);
    assert.deepEqual(floors[3]!.encounterIds, [91, 92]);
    assert.deepEqual(floors[3]!.encounterNames, ["Athena", "Pallas Athena"]);
  });
});

describe("selectTiers", () => {
  const zones = [
    zone({ id: 44, name: "Asphodelos", encounters: encounters(5, 78) }),
    zone({ id: 49, name: "Abyssos", encounters: encounters(5, 83) }),
    zone({ id: 54, name: "Anabaseios", encounters: encounters(5, 88) }),
    zone({ id: 62, name: "AAC Light-Heavyweight", encounters: encounters(4, 93) }),
    zone({ id: 68, name: "AAC Cruiserweight", encounters: encounters(4, 97) }),
    zone({ id: 73, name: "AAC Heavyweight", encounters: encounters(5, 101) }),
    zone({ id: 77, name: "The Forked Tower: Magic", difficulties: [{ id: 101, name: "Savage", sizes: [48] }], encounters: encounters(4, 110) }),
  ];

  it("新しい順に N 件を選ぶ", () => {
    const tiers = selectTiers(zones, 6);
    assert.deepEqual(
      tiers.map((t) => t.zoneId),
      [73, 68, 62, 54, 49, 44],
    );
  });

  it("既定パーティションを採用する", () => {
    const withPartition = [
      zone({
        id: 54,
        name: "Anabaseios",
        encounters: encounters(5, 88),
        partitions: [
          { id: 7, name: "Standard Comps (6.5)", compactName: "Standard (6.5)", default: true },
          { id: 13, name: "Standard Comps (Echo)", compactName: "Standard (Echo)", default: false },
        ],
      }),
    ];
    assert.equal(selectTiers(withPartition, 1)[0]!.partition?.compactName, "Standard (6.5)");
  });

  it("TIER_ZONE_IDS の上書きを尊重する", () => {
    const tiers = selectTiers(zones, 6, [44, 73]);
    assert.deepEqual(
      tiers.map((t) => t.zoneId),
      [44, 73],
    );
  });
});
