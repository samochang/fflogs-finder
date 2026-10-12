import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATA_CENTER_REGION, decodeLodestoneEntities, parseSearchResults } from "../src/lib/lodestone/lodestone.ts";

/**
 * Lodestone のキャラクター検索結果 HTML（実際のレスポンスから必要部分を抜き出したもの）。
 * FFLogs は名前だけでは特定できないため、ここで World を解決する。
 */
const SAMPLE_HTML = `
<ul class="btn__pager">...</ul>
<div class="entry"><a href="/lodestone/character/43123305/" class="entry__link"><div class="entry__chara__face"><img src="https://img2.finalfantasyxiv.com/f/aaa.jpg"></div><div class="entry__box entry__box--world"><p class="entry__name">Raye Skystriker</p><p class="entry__world"><i class="xiv-lds xiv-lds-home-world js__tooltip" data-tooltip="ホームワールド"></i>Kujata [Elemental]</p><ul class="entry__chara_info"><li>10</li></ul></div><div class="entry__chara__lang">JA</div></div></a></div>
<div class="entry"><a href="/lodestone/character/27882677/" class="entry__link"><div class="entry__chara__face"><img src="https://img2.finalfantasyxiv.com/f/bbb.jpg"></div><div class="entry__box entry__box--world"><p class="entry__name">Raye Skystriker</p><p class="entry__world"><i class="xiv-lds"></i>Anima [Mana]</p></div><div class="entry__chara__lang">JA</div></div></a></div>
<div class="entry"><a href="/lodestone/character/52195971/" class="entry__link"><div class="entry__chara__face"><img src="https://img2.finalfantasyxiv.com/f/ccc.jpg"></div><div class="entry__box entry__box--world"><p class="entry__name">Raye Skystrikerace</p><p class="entry__world"><i class="xiv-lds"></i>Durandal [Gaia]</p></div></div></a></div>
`;

describe("Lodestone 検索結果の解析", () => {
  it("名前 / World / DC / Lodestone ID を取り出す", () => {
    const results = parseSearchResults(SAMPLE_HTML, "Raye Skystriker");
    assert.equal(results.length, 3);
    assert.deepEqual(
      results.map((r) => [r.name, r.world, r.dataCenter, r.lodestoneId]),
      [
        ["Raye Skystriker", "Kujata", "Elemental", 43123305],
        ["Raye Skystriker", "Anima", "Mana", 27882677],
        ["Raye Skystrikerace", "Durandal", "Gaia", 52195971],
      ],
    );
  });

  it("完全一致を前方一致より先に並べる", () => {
    const results = parseSearchResults(SAMPLE_HTML, "Raye Skystriker");
    assert.deepEqual(results.map((r) => r.match), ["exact", "exact", "prefix"]);
  });

  it("クエリと無関係な結果は捨てる", () => {
    const results = parseSearchResults(SAMPLE_HTML, "Vega XIII");
    assert.equal(results.length, 0);
  });

  it("大文字小文字・空白のゆれを吸収する", () => {
    const results = parseSearchResults(SAMPLE_HTML, "raye  skystriker");
    assert.equal(results.filter((r) => r.match === "exact").length, 2);
  });

  it("検索結果が無い HTML では空配列", () => {
    assert.deepEqual(parseSearchResults("<html><body>該当するキャラクターが見つかりません</body></html>", "Nobody"), []);
  });

  it("HTML 実体参照をデコードする", () => {
    assert.equal(decodeLodestoneEntities("A &amp; B &#x3010;C&#x3011;"), "A & B 【C】");
  });
});

describe("DC → region", () => {
  it("主要データセンターを FFLogs の region に変換できる", () => {
    assert.equal(DATA_CENTER_REGION.Gaia, "JP");
    assert.equal(DATA_CENTER_REGION.Meteor, "JP");
    assert.equal(DATA_CENTER_REGION.Aether, "NA");
    assert.equal(DATA_CENTER_REGION.Chaos, "EU");
    assert.equal(DATA_CENTER_REGION.Materia, "OC");
  });
});

describe("Lodestone キャラクターページ", () => {
  const PAGE = `
    <div class="frame__chara">
      <div class="frame__chara__box">
        <p class="frame__chara__title">Good Samaritan</p>
        <p class="frame__chara__name">Circle Princess</p>
        <p class="frame__chara__world"><i class="xiv-lds xiv-lds-home-world js__tooltip" data-tooltip="ホームワールド"></i>Belias [Meteor]</p>
      </div>
    </div>`;

  it("名前とワールド（DC 付き）を取り出す", async () => {
    const { parseCharacterPage } = await import("../src/lib/lodestone/lodestone.ts");
    assert.deepEqual(parseCharacterPage(PAGE, 23691783), {
      lodestoneId: 23691783,
      name: "Circle Princess",
      world: "Belias",
      dataCenter: "Meteor",
    });
  });

  it("ページ構造が違う場合は undefined", async () => {
    const { parseCharacterPage } = await import("../src/lib/lodestone/lodestone.ts");
    assert.equal(parseCharacterPage("<html><body>...</body></html>", 1), undefined);
  });
});
