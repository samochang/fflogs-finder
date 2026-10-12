import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_WORLDS, JP_WORLDS, lookupWorldCandidates, lookupWorldStatic, normalizeWorldKey } from "../src/lib/parser/worlds.ts";

describe("ワールド一覧", () => {
  it("全リージョンぶんのワールドを持つ", () => {
    assert.equal(ALL_WORLDS.length, 125);
    assert.equal(JP_WORLDS.length, 32);
    for (const region of ["NA", "EU", "JP", "OC", "CN", "KR"]) {
      assert.ok(ALL_WORLDS.some((w) => w.region === region), region);
    }
  });

  it("英語名・カタカナ表記の両方を解決する", () => {
    assert.equal(lookupWorldStatic("Chocobo")?.region, "JP");
    assert.equal(lookupWorldStatic("チョコボ")?.name, "Chocobo");
    assert.equal(lookupWorldStatic("Tonberry")?.slug, "tonberry");
    assert.equal(lookupWorldStatic("存在しないワールド"), undefined);
  });

  it("同名ワールドが複数リージョンにある場合は JP を優先しつつ候補も返す", () => {
    const candidates = lookupWorldCandidates("チョコボ");
    assert.ok(candidates.length >= 2, "KR の Chocobo も候補に含まれる");
    assert.equal(candidates[0]!.region, "JP");
    assert.deepEqual(
      candidates.map((w) => w.region),
      ["JP", "KR"],
    );
  });

  it("KR と EU で衝突する Moogle も JP 以外を含めて解決できる", () => {
    const regions = lookupWorldCandidates("Moogle").map((w) => w.region);
    assert.ok(regions.includes("EU"));
    assert.ok(regions.includes("KR"));
  });

  it("比較キーは空白・記号のゆれを吸収する", () => {
    assert.equal(normalizeWorldKey("  Cho co-bo "), "chocobo");
    assert.equal(normalizeWorldKey("Siren's  Lair"), "sirenslair");
  });
});
