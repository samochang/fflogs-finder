import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRecruitmentText } from "../src/lib/parser/parseRecruitment.ts";

/** 仕様書 §3 の入力例 + mock.png の募集文をもとにしたテスト。 */

describe("parseRecruitmentText", () => {
  it("mock.png の募集文を 8 人ぶん解析する", () => {
    const input = [
      "MT Rion Aster / ガンブレイカー / Chocobo",
      "ST Kai Vesper / 暗黒騎士 / Chocobo",
      "H1 Yuna Bloom / 白魔道士 / Tonberry",
      "H2 Sena Lune / 学者 / Carbuncle",
      "D1 Nagi Kisaragi / 忍者 / Chocobo",
      "D2 Ren Ashford / 竜騎士 / Masamune",
      "D3 Mio Faye / 踊り子 / Tonberry",
      "D4 Luca Noct / 黒魔道士 / Carbuncle",
    ].join("\n");

    const result = parseRecruitmentText(input);
    assert.equal(result.characters.length, 8);

    assert.deepEqual(
      result.characters.map((c) => [c.recruitmentPosition, c.name, c.recruitmentJob, c.world]),
      [
        ["MT", "Rion Aster", "gunbreaker", "Chocobo"],
        ["ST", "Kai Vesper", "darkKnight", "Chocobo"],
        ["H1", "Yuna Bloom", "whiteMage", "Tonberry"],
        ["H2", "Sena Lune", "scholar", "Carbuncle"],
        ["D1", "Nagi Kisaragi", "ninja", "Chocobo"],
        ["D2", "Ren Ashford", "dragoon", "Masamune"],
        ["D3", "Mio Faye", "dancer", "Tonberry"],
        ["D4", "Luca Noct", "blackMage", "Carbuncle"],
      ],
    );
  });

  it("仕様書 §4.2 のフォーマット（ジョブ略称のみ + ポジション）を解析する", () => {
    const input = [
      "MT ○○○○",
      "ST △△△△",
      "H1 □□□□",
      "H2 ××××",
      "D1 AAAA",
      "D2 BBBB",
      "D3 CCCC",
      "D4 DDDD",
      "",
      "募集条件：",
      "零式6週目",
      "過去絶経験者",
    ].join("\n");

    const result = parseRecruitmentText(input);
    // ○○○○ 等はプレースホルダなので名前として採用しない
    assert.equal(result.characters.length, 4);
    assert.deepEqual(result.characters.map((c) => c.name), ["AAAA", "BBBB", "CCCC", "DDDD"]);
  });

  it("ジョブが名前の前に来る形式を解析する", () => {
    const result = parseRecruitmentText("赤 ○○○○\nピ △△△△\n鎌 □□□□");
    // 1文字略称は募集枠構造の中でのみ採用し、プレースホルダ名は捨てる
    assert.equal(result.characters.length, 0);
  });

  it("「ジョブ + 名前」形式を解析する", () => {
    const result = parseRecruitmentText(["赤 Alice Vale", "ピ Bob Stone", "鎌 Carol Reed", "D4 白 Dave Crow"].join("\n"));
    assert.deepEqual(
      result.characters.map((c) => [c.name, c.recruitmentJob]),
      [
        ["Alice Vale", "redMage"],
        ["Bob Stone", "pictomancer"],
        ["Carol Reed", "reaper"],
        ["Dave Crow", "whiteMage"],
      ],
    );
  });

  it("「名前 + ジョブ」形式を解析する", () => {
    const result = parseRecruitmentText(["Alice Vale 赤", "Bob Stone 鎌"].join("\n"));
    assert.deepEqual(
      result.characters.map((c) => [c.name, c.recruitmentJob]),
      [
        ["Alice Vale", "redMage"],
        ["Bob Stone", "reaper"],
      ],
    );
  });

  it("英略称を認識する", () => {
    const result = parseRecruitmentText(["D1 Alice Vale / GNB / Chocobo", "D2 Bob Stone / WHM / Tonberry"].join("\n"));
    assert.deepEqual(
      result.characters.map((c) => [c.recruitmentJob, c.world]),
      [
        ["gunbreaker", "Chocobo"],
        ["whiteMage", "Tonberry"],
      ],
    );
  });

  it("全角英数字・半角カナを正規化する", () => {
    const result = parseRecruitmentText("ＭＴ Rion Aster ／ ガンブレイカー ／ Ｃｈｏｃｏｂｏ");
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.name, "Rion Aster");
    assert.equal(result.characters[0]!.recruitmentJob, "gunbreaker");
    assert.equal(result.characters[0]!.world, "Chocobo");
  });

  it("1文字略称を通常の文章中で誤認識しない（仕様 §6）", () => {
    const input = [
      "MT Rion Aster / ガンブレイカー / Chocobo",
      "赤魔道士の経験者は歓迎します",
      "黒魔道士の募集枠は埋まりました",
      "忍者と侍の人口が増えています",
      "学者は必須ではありません",
    ].join("\n");

    const result = parseRecruitmentText(input);
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.name, "Rion Aster");
  });

  it("「赤」を通常文から誤検出しない", () => {
    const result = parseRecruitmentText("赤ずきんが赤い赤を赤で塗る");
    assert.equal(result.characters.length, 0);
  });

  it("条件行をキャラクターとして採用しない", () => {
    const input = ["募集条件：零式6週目", "過去絶経験者", "discord で連絡", "活動時間 21:00-24:00"].join("\n");
    const result = parseRecruitmentText(input);
    assert.equal(result.characters.length, 0);
  });

  it("最大 8 人で打ち切る", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `D${(i % 4) + 1} Name${String.fromCharCode(65 + i)} Surname / GNB / Chocobo`);
    const result = parseRecruitmentText(lines.join("\n"));
    assert.equal(result.characters.length, 8);
    assert.equal(result.stats.dropped, 2);
  });

  it("同一人物の重複記載をマージする", () => {
    const result = parseRecruitmentText(["MT Alice Vale / GNB", "MT Alice Vale / Chocobo"].join("\n"));
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.world, "Chocobo");
  });

  it("@ 区切りのワールド表記を解析する", () => {
    const result = parseRecruitmentText("MT Alice Vale@Chocobo / GNB");
    assert.equal(result.characters[0]!.world, "Chocobo");
  });

  it("カタカナのワールド表記を解決する", () => {
    const result = parseRecruitmentText("MT Alice Vale / ガンブレイカー / チョコボ");
    assert.equal(result.characters[0]!.world, "Chocobo");
    assert.equal(result.characters[0]!.worldRegion, "JP");
  });

  it("世界名が無い場合は world を未設定のままにする", () => {
    const result = parseRecruitmentText("MT Alice Vale / ガンブレイカー");
    assert.equal(result.characters[0]!.world, undefined);
  });

  it("ジョブが判定できない場合は警告を出す", () => {
    const result = parseRecruitmentText("MT Alice Vale / Chocobo");
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.recruitmentJob, undefined);
    assert.ok(result.warnings.some((w) => w.reason.includes("ジョブ表記")));
  });

  it("長い別名を優先して一致させる（リーパー > リ）", () => {
    const result = parseRecruitmentText("D1 Alice Vale / リーパー / Chocobo");
    assert.equal(result.characters[0]!.recruitmentJob, "reaper");
    assert.equal(result.characters[0]!.recruitmentJobAlias, "リーパー");
  });

  it("英略称が英単語の一部に誤一致しない", () => {
    // "WAR" は "WARRIOR" の中には無いが、"SCH" が "SCHOOL" に一致しないことを確認する
    const result = parseRecruitmentText("MT Alice School / Chocobo");
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.recruitmentJob, undefined);
  });
});

/**
 * 実際に使われていた募集文のサンプル（ユーザー提供）。
 * フォーマットは書き手ごとに毎回変わるため、ここで挙動を固定する。
 */
describe("実募集文サンプル", () => {
  const sample = `✒MT：暗 Raye Skystriker：絶テマ/アレキ/エデン(学)済
✒ST：対応中
✒H1：白 Crowa Lunaduki：絶テマ/アレキ済
✒H2：対応中
✒D1：募集中！(D2も可)
✒D2：忍 Mitsuki Takase：絶テマ/アレキ/エデン(忍)済  ※D1orD2は相談の上決定
✒D3：踊 Amenami Fortune：絶テマ/アレキ済
✒D4：黒 Welle Trabant：絶テマ/アレキ/エデン(ピ)済

・MTorST　 募集中
・MTorST　ナ：Tama Tamax　２絶（エデン・ケフカ済）
・H1　　　募集中
・H2　　　学：Yoyo Micro　5絶（最初から）
・D1orD2　募集中
・D1orD2　竜orヴ：Vega XIII　6絶（最初から）※固定主
・D3　　　踊or詩：Solalia Seven　4絶（最初から）
・D4　　　赤：Mira White　1絶（最初から）

MT：Ameya Candy 暗＞ナ（7絶）
ST： Wata Gasi(6絶　ケフカ以外済)

H1：Palton Platon 占>白>賢（7絶）
H2：Mikna Cotrne 学＞賢（4絶　アレキ、アルテマ、バハ、ケフカ）

DPS：Rike Nerisiso モ＞竜（4絶　アレキ、アルテマ、バハ、ケフカ）
DPS :(メレーorキャス)募集中！
D3：Xion Horo 踊>機（3絶　バハ、エデン、ケフカ）
D4：Garo Shark 黒>ピ（6絶　竜詩以外済）`;

  it("装飾記号・注記・ジョブ連鎖を処理して全員を抽出する", () => {
    const result = parseRecruitmentText(sample, { max: 30 });
    assert.deepEqual(
      result.characters.map((c) => [c.recruitmentPosition, c.recruitmentJob, c.name]),
      [
        ["MT", "darkKnight", "Raye Skystriker"],
        ["H1", "whiteMage", "Crowa Lunaduki"],
        ["D2", "ninja", "Mitsuki Takase"],
        ["D3", "dancer", "Amenami Fortune"],
        ["D4", "blackMage", "Welle Trabant"],
        ["MT / ST", "paladin", "Tama Tamax"],
        ["H2", "scholar", "Yoyo Micro"],
        ["D1 / D2", "dragoon", "Vega XIII"],
        ["D3", "dancer", "Solalia Seven"],
        ["D4", "redMage", "Mira White"],
        ["MT", "darkKnight", "Ameya Candy"],
        ["ST", undefined, "Wata Gasi"],
        ["H1", "astrologian", "Palton Platon"],
        ["H2", "scholar", "Mikna Cotrne"],
        ["DPS", "monk", "Rike Nerisiso"],
        ["D3", "dancer", "Xion Horo"],
        ["D4", "blackMage", "Garo Shark"],
      ],
    );
  });

  it("「募集中」「対応中」の行はキャラクターとして扱わない", () => {
    const result = parseRecruitmentText(sample, { max: 30 });
    const names = result.characters.map((c) => c.name);
    assert.ok(!names.includes("募集中"));
    assert.ok(!names.includes("対応中"));
    assert.ok(!names.some((n) => n.includes("募集中")));
  });

  it("「モ＞竜」の連鎖は先頭を募集ジョブ、以降を着替え候補として保持する", () => {
    const result = parseRecruitmentText(sample, { max: 30 });
    const rike = result.characters.find((c) => c.name === "Rike Nerisiso")!;
    assert.equal(rike.recruitmentJob, "monk");
    assert.deepEqual(rike.recruitmentJobAlternates, ["dragoon"]);

    const vega = result.characters.find((c) => c.name === "Vega XIII")!;
    assert.equal(vega.recruitmentJob, "dragoon");
    assert.deepEqual(vega.recruitmentJobAlternates, ["viper"]);
  });

  it("8 人を超える場合は先頭 8 人だけを採用する", () => {
    const result = parseRecruitmentText(sample);
    assert.equal(result.characters.length, 8);
    assert.equal(result.stats.dropped, 9);
    assert.deepEqual(
      result.characters.map((c) => c.name),
      ["Raye Skystriker", "Crowa Lunaduki", "Mitsuki Takase", "Amenami Fortune", "Welle Trabant", "Tama Tamax", "Yoyo Micro", "Vega XIII"],
    );
  });

  it("名前に含まれる英字をジョブ略称と誤認しない", () => {
    // "Sam Fisher" の Sam を SAM(侍) と判定してはいけない
    const result = parseRecruitmentText("MT Sam Fisher / Chocobo");
    assert.equal(result.characters[0]!.recruitmentJob, undefined);
  });

  it("大文字の英略称は認識する", () => {
    const result = parseRecruitmentText("MT Alice Vale / GNB / Chocobo");
    assert.equal(result.characters[0]!.recruitmentJob, "gunbreaker");
  });
});

describe("Lodestone のキャラクター URL", () => {
  it("URL 行から Lodestone ID を取り出し、名前として 'https' を拾わない", () => {
    const result = parseRecruitmentText("ST https://jp.finalfantasyxiv.com/lodestone/character/23691783/");
    assert.equal(result.characters.length, 1);
    assert.equal(result.characters[0]!.lodestoneId, 23691783);
    assert.equal(result.characters[0]!.name, "");
    assert.equal(result.characters[0]!.recruitmentPosition, "ST");
  });

  it("名前と URL が併記されている場合は名前を優先する", () => {
    const result = parseRecruitmentText("ST Circle Princess https://jp.finalfantasyxiv.com/lodestone/character/23691783/");
    assert.equal(result.characters[0]!.name, "Circle Princess");
    assert.equal(result.characters[0]!.lodestoneId, 23691783);
  });

  it("URL だけの行でも Lodestone ID が別なら別枠として扱う", () => {
    const result = parseRecruitmentText(
      "MT https://jp.finalfantasyxiv.com/lodestone/character/1/\nST https://jp.finalfantasyxiv.com/lodestone/character/2/",
    );
    assert.equal(result.characters.length, 2);
  });

  it("URL を含む行でもジョブは認識する", () => {
    const result = parseRecruitmentText("D1 ガ https://jp.finalfantasyxiv.com/lodestone/character/23691783/");
    assert.equal(result.characters[0]!.recruitmentJob, "gunbreaker");
    assert.equal(result.characters[0]!.lodestoneId, 23691783);
  });
});
