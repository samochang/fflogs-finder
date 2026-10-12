import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPANSION_LABELS_JA,
  ZONE_FULL_NAMES_JA,
  ZONE_LABELS_JA,
  expansionColor,
  expansionLabel,
  zoneFullName,
  zoneLabel,
} from "../src/lib/fflogs/labels.ts";

/**
 * FFLogs は英語名しか返さないため、日本語名はここで持っている。
 * 正式名称（〜編 / 〜級）になっていることを固定する。
 */
describe("Tier の日本語名", () => {
  it("暁月の零式は「〜編」", () => {
    assert.equal(zoneLabel(44, "Asphodelos"), "辺獄編");
    assert.equal(zoneLabel(49, "Abyssos"), "煉獄編");
    assert.equal(zoneLabel(54, "Anabaseios"), "天獄編");
  });

  it("漆黒の零式は「〜編」", () => {
    assert.equal(zoneLabel(29, "Eden's Gate"), "覚醒編");
    assert.equal(zoneLabel(33, "Eden's Verse"), "共鳴編");
    assert.equal(zoneLabel(38, "Eden's Promise"), "再生編");
  });

  it("黄金の零式は「〜級」", () => {
    assert.equal(zoneLabel(62, "AAC Light-Heavyweight"), "ライトヘビー級");
    assert.equal(zoneLabel(68, "AAC Cruiserweight"), "クルーザー級");
    assert.equal(zoneLabel(73, "AAC Heavyweight"), "ヘビー級");
  });

  it("正式名称は RAID 名つき", () => {
    assert.equal(zoneFullName(54, "Anabaseios"), "万魔殿パンデモニウム零式：天獄編");
    assert.equal(zoneFullName(38, "Eden's Promise"), "希望の園エデン零式：再生編");
    assert.equal(zoneFullName(73, "AAC Heavyweight"), "至天の座アルカディア零式：ヘビー級");
  });

  it("未知の zone は FFLogs の英語名にフォールバックする", () => {
    assert.equal(zoneLabel(999, "Some Future Raid"), "Some Future Raid");
    assert.equal(zoneFullName(999, "Some Future Raid"), "Some Future Raid");
  });

  it("短縮名と正式名称のキーが一致する", () => {
    assert.deepEqual(Object.keys(ZONE_LABELS_JA).sort(), Object.keys(ZONE_FULL_NAMES_JA).sort());
  });

  it("拡張名は日本語 + 英語の並記", () => {
    assert.equal(expansionLabel("Endwalker"), "暁月のフィナーレ ENDWALKER");
    assert.equal(EXPANSION_LABELS_JA.Dawntrail, "黄金のレガシー");
    assert.match(expansionColor("Endwalker").bg, /^#[0-9a-f]{6}$/);
  });
});
