import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POINTS_PER_CHARACTER, POINTS_PER_TIER, TIERS_PER_CHARACTER, peopleFromPoints } from "../src/lib/fflogs/costs.ts";
import { fflogsCharacterUrl } from "../src/lib/fflogs/links.ts";
import { jobAbbr, jobName, messages } from "../src/lib/i18n.ts";
import {
  ACCESSORY_GROUP,
  GEAR_SET,
  JOBS,
  ROLE_COLORS,
  ROLE_SIMILARITY,
  fallbackJobOrder,
  getJob,
  healerPriorityGroups,
  isFullyScanned,
  jobPickerOrder,
  jobProbeGroups,
  jobsSharingGear,
  positionRoles,
  roleColor,
  rolePriorityFor,
  sortJobsForPosition,
  type JobId,
} from "../src/lib/jobs/jobs.ts";
import { expansionColor, EXPANSION_COLORS } from "../src/lib/fflogs/labels.ts";
import { sortCandidatesByDataCenter, isStale, type CharacterCandidate } from "../src/lib/fflogs/repository.ts";
import { PERF_COLORS, formatPercent, formatPercentParenthesized, perfColor } from "../src/lib/perf.ts";

describe("ポジションからジョブ候補を絞る", () => {
  it("ST はタンクだけをガ暗ナ戦の順に出す", () => {
    assert.deepEqual(positionRoles("ST"), ["tank"]);
    assert.deepEqual(jobPickerOrder("ST"), ["gunbreaker", "darkKnight", "paladin", "warrior"]);
  });

  it("MT / MT / ST のような併記でもタンクに絞る", () => {
    assert.deepEqual(jobPickerOrder("MT / ST"), ["gunbreaker", "darkKnight", "paladin", "warrior"]);
    assert.deepEqual(jobPickerOrder("OT"), ["gunbreaker", "darkKnight", "paladin", "warrior"]);
  });

  it("ヒーラー枠はタンクや DPS を出さない", () => {
    const jobs = jobPickerOrder("H1");
    assert.ok(jobs.every((id) => getJob(id).role === "healer"));
    assert.deepEqual([...jobs].sort(), ["astrologian", "sage", "scholar", "whiteMage"]);
  });

  it("DPS 枠はタンクやヒーラーを出さない", () => {
    const jobs = jobPickerOrder("D3");
    assert.ok(jobs.every((id) => ["melee", "ranged", "caster"].includes(getJob(id).role)));
    assert.ok(jobs.length === 13);
  });

  it("ポジション不明なら全ジョブ", () => {
    assert.equal(jobPickerOrder(undefined).length, 21);
    assert.equal(positionRoles(undefined).length, 5);
  });
});

describe("ロール色", () => {
  it("タンク青 / ヒーラー緑 / DPS 赤（mock.png 実測値）", () => {
    assert.equal(ROLE_COLORS.tank, "#316ef5");
    assert.equal(ROLE_COLORS.healer, "#45a23c");
    assert.equal(ROLE_COLORS.melee, "#ef4445");
    assert.equal(ROLE_COLORS.ranged, "#ef4445");
    assert.equal(ROLE_COLORS.caster, "#ef4445");
  });

  it("近接・遠隔・キャスターは同じ赤", () => {
    assert.equal(roleColor("ninja"), "#ef4445");
    assert.equal(roleColor("dancer"), "#ef4445");
    assert.equal(roleColor("blackMage"), "#ef4445");
    assert.equal(roleColor("gunbreaker"), "#316ef5");
    assert.equal(roleColor("scholar"), "#45a23c");
  });
});

describe("拡張の配色", () => {
  it("既知の拡張には個別の色を返す", () => {
    assert.equal(expansionColor("Endwalker").bg, EXPANSION_COLORS.Endwalker!.bg);
    assert.notEqual(expansionColor("Endwalker").bg, expansionColor("Shadowbringers").bg);
  });

  it("未知の拡張でもフォールバックを返す", () => {
    const color = expansionColor("Some Future Expansion");
    assert.match(color.bg, /^#[0-9a-f]{6}$/);
    assert.match(color.accent, /^#[0-9a-f]{6}$/);
  });
});

describe("Perf の色（FFLogs 準拠）", () => {
  it("しきい値ごとに FFLogs の色を返す", () => {
    assert.equal(perfColor(100), "gold");
    assert.equal(perfColor(99), "pink");
    assert.equal(perfColor(98), "orange");
    assert.equal(perfColor(95), "orange");
    assert.equal(perfColor(94), "purple");
    assert.equal(perfColor(75), "purple");
    assert.equal(perfColor(74), "blue");
    assert.equal(perfColor(50), "blue");
    assert.equal(perfColor(49), "green");
    assert.equal(perfColor(25), "green");
    assert.equal(perfColor(24), "gray");
    assert.equal(perfColor(null), "gray");
  });

  it("FFLogs の標準パレットを使う", () => {
    assert.equal(PERF_COLORS.green, "#1eff00");
    assert.equal(PERF_COLORS.blue, "#0070ff");
    assert.equal(PERF_COLORS.purple, "#a335ee");
    assert.equal(PERF_COLORS.orange, "#ff8000");
    assert.equal(PERF_COLORS.pink, "#e268a8");
    assert.equal(PERF_COLORS.gold, "#e5cc80");
  });
});

describe("キャッシュの鮮度", () => {
  const tier = (daysAgo: number) => ({ fetchedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() }) as never;

  it("未取得なら再取得する", () => {
    assert.equal(isStale(undefined, {}), true);
  });

  it("maxAgeDays 未指定なら既存キャッシュを使う（points を消費しない）", () => {
    assert.equal(isStale(tier(400), {}), false);
  });

  it("8 日前のデータは 7 日指定で再取得する", () => {
    assert.equal(isStale(tier(8), { maxAgeDays: 7 }), true);
  });

  it("6 日前のデータは 7 日指定では再取得しない", () => {
    assert.equal(isStale(tier(6), { maxAgeDays: 7 }), false);
  });

  it("force なら常に再取得する", () => {
    assert.equal(isStale(tier(0), { force: true }), true);
    assert.equal(isStale(tier(0), { force: true, maxAgeDays: 7 }), true);
  });
});

describe("候補の DC 優先", () => {
  const candidates: CharacterCandidate[] = [
    { canonicalId: 1, name: "A", world: "Kujata", worldSlug: "kujata", region: "JP", dataCenter: "Elemental" },
    { canonicalId: 2, name: "A", world: "Anima", worldSlug: "anima", region: "JP", dataCenter: "Mana" },
    { canonicalId: 3, name: "A", world: "Belias", worldSlug: "belias", region: "JP", dataCenter: "Meteor" },
  ];

  it("同じ DC の候補を先頭に寄せる", () => {
    assert.deepEqual(sortCandidatesByDataCenter(candidates, "Mana").map((c) => c.canonicalId), [2, 1, 3]);
    assert.deepEqual(sortCandidatesByDataCenter(candidates, "Meteor").map((c) => c.canonicalId), [3, 1, 2]);
  });

  it("DC が分からなければ元の順序を保つ", () => {
    assert.deepEqual(sortCandidatesByDataCenter(candidates, undefined).map((c) => c.canonicalId), [1, 2, 3]);
  });
});

describe("ロールの近さ順", () => {
  it("タンクは タンク > 近接 > ヒラ > 遠隔 > キャス", () => {
    assert.deepEqual(rolePriorityFor("ST"), ["tank", "melee", "healer", "ranged", "caster"]);
  });

  it("D1〜D4 は DPS 3 ロールが先頭、そのあと近い順", () => {
    assert.deepEqual(rolePriorityFor("D1"), ["melee", "ranged", "caster", "tank", "healer"]);
  });

  it("ポジション不明なら全ロールを既定順で", () => {
    assert.deepEqual(rolePriorityFor(undefined), ["tank", "healer", "melee", "ranged", "caster"]);
  });

  it("フォールバックは自分のロールを除いた「近いロール」順", () => {
    const fallback = fallbackJobOrder("ST");
    assert.ok(!fallback.includes("gunbreaker"), "タンクは含まない");
    // 先頭は近接（タンクの次に近い）
    assert.ok(["monk", "dragoon", "ninja", "samurai", "reaper", "viper"].includes(fallback[0]!));
    // ヒラは近接より後ろ
    const firstHealer = fallback.findIndex((id) => getJob(id).role === "healer");
    const firstMelee = fallback.findIndex((id) => getJob(id).role === "melee");
    assert.ok(firstMelee < firstHealer);
  });

  it("探索結果をポジションの近さ順に並べ替える", () => {
    const found = ["whiteMage", "monk", "blackMage", "paladin"] as const;
    assert.deepEqual(sortJobsForPosition([...found], "ST"), ["paladin", "monk", "whiteMage", "blackMage"]);
    assert.deepEqual(sortJobsForPosition([...found], "D4"), ["monk", "blackMage", "paladin", "whiteMage"]);
  });

  it("近さの表は全ロールを 1 回ずつ含む", () => {
    for (const role of ["tank", "healer", "melee", "ranged", "caster"] as const) {
      assert.equal(ROLE_SIMILARITY[role].length, 5, role);
      assert.equal(new Set(ROLE_SIMILARITY[role]).size, 5, role);
      assert.equal(ROLE_SIMILARITY[role][0], role, role);
    }
  });
});

describe("下段（Median）の表示", () => {
  it("値があるときは括弧で囲む", () => {
    assert.equal(formatPercentParenthesized(92.4), "(92)");
    assert.equal(formatPercentParenthesized(100), "(100)");
    assert.equal(formatPercentParenthesized(0), "(0)");
  });

  it("欠損は括弧を付けない", () => {
    assert.equal(formatPercentParenthesized(null), "–");
    assert.equal(formatPercentParenthesized(undefined), "–");
  });

  it("上段 Best は括弧なしのまま", () => {
    assert.equal(formatPercent(92.4), "92");
    assert.equal(formatPercent(null), "–");
  });
});

describe("ジョブ探索のグループ分け（コスト最適化）", () => {
  it("ST はタンク → 近接 → ヒラ → 遠隔 → キャスの順にグループ化される", () => {
    const groups = jobProbeGroups("ST");
    assert.equal(groups.length, 5);
    assert.deepEqual(groups[0], ["gunbreaker", "darkKnight", "paladin", "warrior"]);
    assert.ok(groups[1]!.every((id) => getJob(id).role === "melee"), "2 番目は近接");
    assert.ok(groups[2]!.every((id) => getJob(id).role === "healer"), "3 番目はヒラ");
    assert.ok(groups[3]!.every((id) => getJob(id).role === "ranged"), "4 番目は遠隔");
    assert.ok(groups[4]!.every((id) => getJob(id).role === "caster"), "5 番目はキャス");
  });

  it("最初のグループだけで済めば 4 alias（約 20 points）で止まる", () => {
    // タンクにログがあれば近接以降は調べない
    const groups = jobProbeGroups("ST");
    assert.equal(groups[0]!.length, 4);
  });

  it("タンクにログが無い場合は近接までで止まる想定（4 + 6 = 10 alias ≒ 50 points）", () => {
    const groups = jobProbeGroups("ST");
    const upToMelee = groups[0]!.length + groups[1]!.length;
    assert.equal(upToMelee, 10);
    assert.ok(upToMelee < 21, "全ジョブ 21 alias より少ない");
  });

  it("着替え可の記載があればそれを最優先のグループにする", () => {
    const groups = jobProbeGroups("DPS", ["dragoon"]);
    assert.deepEqual(groups[0], ["dragoon"]);
    assert.ok(groups.length >= 2);
  });

  it("全グループを合わせると 21 ジョブを重複なく覆う", () => {
    const groups = jobProbeGroups("ST");
    const all = groups.flat();
    assert.equal(all.length, 21);
    assert.equal(new Set(all).size, 21);
  });
});

describe("装備が共通のジョブ（着替え候補）", () => {
  it("ヒーラーは 4 ジョブとも同じ装備", () => {
    assert.deepEqual(jobsSharingGear("astrologian"), ["whiteMage", "scholar", "sage"]);
    assert.deepEqual(jobsSharingGear("scholar"), ["whiteMage", "astrologian", "sage"]);
  });

  it("タンクは 4 ジョブとも同じ装備", () => {
    assert.equal(jobsSharingGear("gunbreaker").length, 3);
    assert.ok(jobsSharingGear("gunbreaker").every((id) => getJob(id).role === "tank"));
  });

  it("近接は左装備が分かれる（ヴァイパーと共通なのは忍者だけ）", () => {
    assert.deepEqual(jobsSharingGear("viper"), ["ninja"]);
    assert.deepEqual(jobsSharingGear("reaper"), ["dragoon"]);
  });

  it("アクセサリは近接 6 ジョブで共通", () => {
    const melee = ["monk", "dragoon", "ninja", "samurai", "reaper", "viper"] as const;
    const groups = new Set(melee.map((id) => ACCESSORY_GROUP[id]));
    assert.equal(groups.size, 1);
    assert.equal([...groups][0], "slaying");
  });

  it("全 21 ジョブに装備グループがある", () => {
    for (const job of JOBS) {
      assert.ok(GEAR_SET[job.id], job.id);
      assert.ok(ACCESSORY_GROUP[job.id], job.id);
    }
  });
});

describe("ヒーラー枠のピュア / バリア優先", () => {
  it("H1 / PH はピュアヒーラーが先", () => {
    assert.deepEqual(healerPriorityGroups("H1")![0], ["whiteMage", "astrologian"]);
    assert.deepEqual(healerPriorityGroups("PH")![0], ["whiteMage", "astrologian"]);
  });

  it("H2 / BH はバリアヒーラーが先", () => {
    assert.deepEqual(healerPriorityGroups("H2")![0], ["scholar", "sage"]);
    assert.deepEqual(healerPriorityGroups("BH")![0], ["scholar", "sage"]);
  });

  it("ピュアで見つかれば 2 alias で止まれる（4 alias 不要）", () => {
    const groups = healerPriorityGroups("H1")!;
    assert.equal(groups[0]!.length, 2);
    // 先頭グループだけで済めば合計 2 alias
    assert.equal(groups[0]!.length, 2);
    assert.equal(groups.flat().length, 4);
  });

  it("ヒーラー枠でなければ null", () => {
    assert.equal(healerPriorityGroups("ST"), null);
    assert.equal(healerPriorityGroups("D1"), null);
    assert.equal(healerPriorityGroups(undefined), null);
  });
});

describe("探索グループの組み立て", () => {
  it("既知のジョブと装備が共通のジョブを 2 番目に調べる", () => {
    const groups = jobProbeGroups("ST", undefined, ["astrologian", "whiteMage"]);
    assert.deepEqual(groups[0], ["gunbreaker", "darkKnight", "paladin", "warrior"]);
    // 同じ healing 装備のうち、まだ調べていない 2 つ
    assert.deepEqual(groups[1], ["scholar", "sage"]);
  });

  it("すでに分かっているジョブは調べ直さない", () => {
    const groups = jobProbeGroups("ST", undefined, ["astrologian"]);
    assert.ok(!groups.flat().includes("astrologian"), "既知のジョブを含めない");
  });

  it("既知が無ければ従来どおりロールの近さ順", () => {
    const groups = jobProbeGroups("ST");
    assert.deepEqual(groups[0], ["gunbreaker", "darkKnight", "paladin", "warrior"]);
    assert.ok(groups[1]!.every((id) => getJob(id).role === "melee"));
  });

  it("着替え可の記載があればそれを最優先", () => {
    const groups = jobProbeGroups("DPS", ["dragoon"], []);
    assert.deepEqual(groups[0], ["dragoon"]);
  });
});

describe("取り漏らしの判定", () => {
  const ALL: JobId[] = JOBS.map((j) => j.id);

  it("調べたジョブだけで全 21 を覆えば完了", () => {
    assert.equal(isFullyScanned(ALL, []), true);
  });

  it("ログがあると分かっているジョブも「覆った」と数える", () => {
    const probed: JobId[] = ALL.filter((id) => id !== "whiteMage" && id !== "astrologian");
    assert.equal(isFullyScanned(probed, []), false);
    assert.equal(isFullyScanned(probed, ["whiteMage", "astrologian"] as JobId[]), true);
  });

  it("打ち切った探索だけでは完了にならない（取り漏らしの可能性がある）", () => {
    // ST の優先ロール（タンク 4 + ピュア 2）だけ調べた状態
    const partial: JobId[] = ["gunbreaker", "darkKnight", "paladin", "warrior", "scholar", "sage"];
    assert.equal(isFullyScanned(partial, ["whiteMage", "astrologian"] as JobId[]), false);
  });

  it("何も調べていなければ当然まだ", () => {
    assert.equal(isFullyScanned([], []), false);
  });
});

describe("FFLogs のキャラクターページ URL", () => {
  // 形式は実在リンクで確認済み:
  //   https://www.fflogs.com/character/NA/Midgardsormr/Leonardo%20Yuneli
  //   https://www.fflogs.com/character/na/midgardsormr/ienaga%20uzuka
  it("region / world / name を並べる", () => {
    assert.equal(
      fflogsCharacterUrl({ region: "JP", world: "Ramuh", name: "Wata Gasi" }),
      "https://www.fflogs.com/character/jp/Ramuh/Wata%20Gasi",
    );
  });

  it("region は小文字にする（大文字でも通るが揃える）", () => {
    assert.match(fflogsCharacterUrl({ region: "NA", world: "Midgardsormr", name: "Leonardo Yuneli" })!, /\/character\/na\//);
  });

  it("名前に記号があってもエスケープする", () => {
    assert.equal(
      fflogsCharacterUrl({ region: "jp", world: "Chocobo", name: "A'B C" }),
      "https://www.fflogs.com/character/jp/Chocobo/A'B%20C",
    );
  });

  it("region / world / name が欠けていたらリンクを作らない", () => {
    assert.equal(fflogsCharacterUrl({ region: null, world: "Ramuh", name: "X" }), null);
    assert.equal(fflogsCharacterUrl({ region: "jp", world: "", name: "X" }), null);
    assert.equal(fflogsCharacterUrl({ region: "jp", world: "Ramuh", name: "   " }), null);
  });
});

describe("Active（アクティブ率）の計算", () => {
  // activeTime はミリ秒。% は activeTime / totalTime × 100
  const percent = (activeTime: number, totalTime: number) =>
    Math.round(Math.max(0, Math.min(100, (activeTime / totalTime) * 100)) * 100) / 100;

  it("実測例: 507225ms / 508871ms = 99.68%", () => {
    assert.equal(percent(507225, 508871), 99.68);
  });

  it("ミリ秒をそのまま %にしない（以前のバグ）", () => {
    assert.notEqual(percent(397250, 500000), 397250);
    assert.equal(percent(397250, 500000), 79.45);
  });

  it("100% を超えない", () => {
    assert.equal(percent(600000, 500000), 100);
  });

  it("0 未満にならない", () => {
    assert.equal(percent(0, 500000), 0);
  });
});

describe("消費量の換算（UI 文言の単位）", () => {
  it("1 回 = 1 零式 × 1 ジョブ = 5 points", () => {
    assert.equal(POINTS_PER_TIER, 5);
  });

  it("1 人 = 6 零式 = 30 points（処理で固定）", () => {
    assert.equal(TIERS_PER_CHARACTER, 6);
    assert.equal(POINTS_PER_CHARACTER, 30);
  });

  it("残り points を「何人分」に換算する", () => {
    assert.equal(peopleFromPoints(720), 24);
    assert.equal(peopleFromPoints(160), 5);
    assert.equal(peopleFromPoints(29), 0);
    assert.equal(peopleFromPoints(0), 0);
  });

  it("レート制限の上限ちょうどで 24 人分", () => {
    assert.equal(peopleFromPoints(720), 24);
  });
});

describe("メインジョブの重み付け（拡張全体・新しい零式を重く）", () => {
  // 新しい順に並んだ零式。1 つ前は半分の重み
  const weights = (count: number) => Array.from({ length: count }, (_, i) => 2 ** (count - 1 - i));

  it("零式 3 つなら 4 / 2 / 1", () => {
    assert.deepEqual(weights(3), [4, 2, 1]);
  });

  it("零式 1 つならそのまま", () => {
    assert.deepEqual(weights(1), [1]);
  });

  it("実データ（Wata Gasi / 黄金のレガシー）で占星術師がメインになる", () => {
    // 73(最新): 占星 27 / 白 16, 68: 竜 47, 62: 忍 36
    const latest = { astrologian: 27, whiteMage: 16 };
    const middle = { dragoon: 47 };
    const oldest = { ninja: 36 };
    const score = new Map<string, number>();
    const add = (kills: Record<string, number>, weight: number) => {
      for (const [job, k] of Object.entries(kills)) score.set(job, (score.get(job) ?? 0) + k * weight);
    };
    add(latest, weights(3)[0]!);
    add(middle, weights(3)[1]!);
    add(oldest, weights(3)[2]!);
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
    assert.equal(ranked[0]![0], "astrologian", `実際: ${JSON.stringify(ranked)}`);
    assert.equal(ranked[0]![1], 108);
    assert.equal(ranked[1]![0], "dragoon");
  });

  it("重み無し（全部 1）だと竜騎士になり、重み付けが効いている", () => {
    const flat = { astrologian: 27, whiteMage: 16, dragoon: 47, ninja: 36 };
    const ranked = Object.entries(flat).sort((a, b) => b[1] - a[1]);
    assert.equal(ranked[0]![0], "dragoon");
  });
});


describe("UI の文言（日本語 / English）", () => {
  it("両言語で主要な文言が埋まっている", () => {
    for (const lang of ["ja", "en"] as const) {
      const m = messages(lang);
      for (const [key, value] of Object.entries(m)) {
        if (typeof value === "string") assert.ok(value.length > 0, `${lang}.${key} が空`);
      }
      assert.ok(m.appName.length > 0);
      assert.ok(m.compare.length > 0);
    }
  });

  it("アプリ名", () => {
    assert.equal(messages("ja").appName, "固定募集スカウター");
    assert.equal(messages("en").appName, "Static Recruitment Logs Checker");
  });

  it("ジョブ名は言語ごとに切り替わる", () => {
    assert.equal(jobName("ja", "astrologian"), "占星術師");
    assert.equal(jobName("en", "astrologian"), "Astrologian");
    assert.equal(jobName("ja", "darkKnight"), "暗黒騎士");
  });

  it("アイコンが無いときは 3 文字略称を使う", () => {
    assert.equal(jobAbbr("astrologian"), "AST");
    assert.equal(jobAbbr("darkKnight"), "DRK");
  });

  it("パラメータ付きの文言が数値を埋め込む", () => {
    assert.match(messages("ja").recognised(5), /5/);
    assert.match(messages("en").probeCost(19), /19/);
    assert.equal(messages("ja").rateAvailable(16, "18:02"), "18:02 まであと大体 16 人分取得できます");
    assert.equal(messages("ja").rateAvailable(16), "あと大体 16 人分取得できます");
    assert.equal(messages("ja").rateTooLow("18:02"), "1 人分に足りません（18:02 まで）");
    assert.equal(messages("ja").rateTooLow(), "1 人分に足りません");
    assert.equal(messages("en").rateAvailable(16, "18:02"), "About 16 more players until 18:02");
    assert.equal(messages("en").rateAvailable(16), "About 16 more players available");
  });
});
