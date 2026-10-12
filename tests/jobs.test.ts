import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_ALIASES, buildAliasIndex, charLength, findAliasConflicts, normalizeAliasText } from "../src/lib/jobs/aliases.ts";
import { scanJobMentions, isSlotContext } from "../src/lib/jobs/match.ts";
import { JOBS, getJob, jobFromClassJobId, jobFromSpecName } from "../src/lib/jobs/jobs.ts";

describe("jobs", () => {
  it("FFLogs の specName / specId が実データと一致する", () => {
    // gameData { classes { specs { id name } } } の応答と対応
    assert.equal(getJob("gunbreaker").specId, 17);
    assert.equal(getJob("whiteMage").specName, "WhiteMage");
    assert.equal(getJob("viper").specId, 20);
    assert.equal(getJob("pictomancer").specId, 21);
    assert.equal(getJob("summoner").specName, "Summoner");
  });

  it("specName から内部 JobId へ戻せる（大文字小文字を問わない）", () => {
    assert.equal(jobFromSpecName("Gunbreaker")?.id, "gunbreaker");
    assert.equal(jobFromSpecName("darkknight")?.id, "darkKnight");
    assert.equal(jobFromSpecName(null), undefined);
  });

  it("FF14 の ClassJob ID から内部 JobId へ戻せる", () => {
    assert.equal(jobFromClassJobId(19)?.id, "paladin");
    assert.equal(jobFromClassJobId(42)?.id, "pictomancer");
    assert.equal(jobFromClassJobId(999), undefined);
  });

  it("21 ジョブすべてに specId / classJobId / abbr が設定されている", () => {
    assert.equal(JOBS.length, 21);
    for (const job of JOBS) {
      assert.ok(job.specId > 0, job.id);
      assert.ok(job.classJobId > 0, job.id);
      assert.match(job.abbr, /^[A-Z]{3}$/, job.id);
    }
    assert.equal(new Set(JOBS.map((j) => j.specId)).size, 21);
  });
});

describe("job aliases", () => {
  it("別名が複数ジョブに割り当てられていない", () => {
    const conflicts = findAliasConflicts();
    assert.deepEqual([...conflicts.entries()], []);
  });

  it("全角英数を正規化する", () => {
    assert.equal(normalizeAliasText("ＧＮＢ"), "gnb");
    assert.equal(normalizeAliasText("ﾘｰﾊﾟｰ"), "リーパー");
  });

  it("最長一致のため長い別名を先に並べる", () => {
    const index = buildAliasIndex();
    const list = index.byFirstChar.get("リ")!;
    assert.equal(list[0]!.text, "リーパー");
    assert.equal(charLength(list[0]!.text), 4);
  });

  it("1 文字の別名は ambiguous として扱う（仕様 §6）", () => {
    const single = JOB_ALIASES.filter((a) => charLength(a.text) === 1);
    assert.ok(single.length > 0);
    assert.ok(single.every((a) => a.ambiguous));
    // 英略称は ambiguous ではない
    assert.equal(JOB_ALIASES.find((a) => a.text === "gnb")?.ambiguous, false);
  });
});

describe("scanJobMentions", () => {
  it("1 文字略称を独立トークンとしてのみ認識する", () => {
    const inside = scanJobMentions("赤魔道士");
    assert.equal(inside.length, 1);
    assert.equal(inside[0]!.jobId, "redMage");
    assert.equal(inside[0]!.alias, "赤魔道士");

    const standalone = scanJobMentions("赤 Alice");
    assert.equal(standalone[0]!.jobId, "redMage");
    assert.equal(standalone[0]!.alias, "赤");
  });

  it("英略称に単語境界を要求する", () => {
    assert.equal(scanJobMentions("SCHOOL").length, 0);
    assert.equal(scanJobMentions("SCH").length, 1);
  });

  it("長い別名を優先する", () => {
    const mentions = scanJobMentions("リーパー");
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0]!.alias, "リーパー");
  });
});

describe("isSlotContext", () => {
  it("行全体がジョブ表記なら募集枠とみなす", () => {
    assert.equal(isSlotContext("鎌", 0, 1), true);
  });

  it("ポジション表記の直後を募集枠とみなす", () => {
    const text = "D4 白 Alice Crow";
    const start = text.indexOf("白");
    assert.equal(isSlotContext(text, start, start + 1), true);
  });

  it("通常の文章中は募集枠とみなさない", () => {
    const text = "赤ずきんが赤い赤";
    const start = text.indexOf("赤");
    assert.equal(isSlotContext(text, start, start + 1), false);
  });
});
