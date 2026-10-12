import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickPlayerEntry } from "../src/lib/fflogs/repository.ts";
import { isRefreshLocked, withRefreshLock } from "../src/lib/cache/refreshLock.ts";
import { resetCacheStore } from "../src/lib/cache/store.ts";

/**
 * DamageDone テーブルから対象キャラクターの行を選ぶ処理。
 * テーブルには Report 参加者全員が入るため、名前で取り違えないことを保証する。
 */
describe("pickPlayerEntry", () => {
  const entries = [
    { name: "Someone Else", type: "Player", activeTime: 91.5 },
    { name: "Rion Aster", type: "Player", activeTime: 98.4 },
    { name: "Rion Aster", type: "Pet", activeTime: 12.0 },
    { name: "Limit Break", type: "LimitBreak", activeTime: 0 },
  ];

  it("キャラクター名と一致する行を選ぶ（先頭の他プレイヤーを拾わない）", () => {
    assert.equal(pickPlayerEntry(entries, "Rion Aster")?.activeTime, 98.4);
  });

  it("大文字小文字を区別しない", () => {
    assert.equal(pickPlayerEntry(entries, "rion aster")?.activeTime, 98.4);
  });

  it("名前が一致しなければ undefined", () => {
    assert.equal(pickPlayerEntry(entries, "Nobody Here"), undefined);
  });

  it("テーブル側に World が付いていても一致させる", () => {
    const withWorld = [{ name: "Rion Aster@Chocobo", type: "Player", activeTime: 97.1 }];
    assert.equal(pickPlayerEntry(withWorld, "Rion Aster")?.activeTime, 97.1);
  });

  it("LimitBreak 行は選ばない", () => {
    const onlyLb = [{ name: "Rion Aster", type: "LimitBreak", activeTime: 5 }];
    assert.equal(pickPlayerEntry(onlyLb, "Rion Aster"), undefined);
  });
});

/**
 * refresh lock（仕様 §28）。
 * UPSTASH_* が未設定のテスト環境ではプロセス内メモリストアが使われる。
 */
describe("refresh lock", () => {
  it("同じ scope の同時実行を 1 本に制限する", async () => {
    resetCacheStore();
    let running = 0;
    let maxConcurrent = 0;

    const task = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return "done";
    };

    const results = await Promise.all(Array.from({ length: 5 }, () => withRefreshLock("char:1:gunbreaker", task)));
    const acquired = results.filter((r) => r.ok).length;
    assert.equal(acquired, 1, "同時実行では 1 本だけがロックを取れる");
    assert.equal(maxConcurrent, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === "locked").length, 4);
  });

  it("処理が終わればロックは解放される", async () => {
    resetCacheStore();
    assert.equal(await isRefreshLocked("char:2:warrior"), false);
    await withRefreshLock("char:2:warrior", async () => {
      assert.equal(await isRefreshLocked("char:2:warrior"), true);
    });
    assert.equal(await isRefreshLocked("char:2:warrior"), false);
  });

  it("例外が出てもロックは解放される", async () => {
    resetCacheStore();
    await assert.rejects(
      withRefreshLock("char:3:whiteMage", async () => {
        throw new Error("boom");
      }),
    );
    assert.equal(await isRefreshLocked("char:3:whiteMage"), false);
  });

  it("scope が違えば別々にロックできる", async () => {
    resetCacheStore();
    const [a, b] = await Promise.all([
      withRefreshLock("char:4:monk", async () => "a"),
      withRefreshLock("char:4:dragoon", async () => "b"),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });
});

describe("名前インデックス（名前 -> 確定済み候補）", () => {
  it("保存した候補を Lodestone も FFLogs も呼ばずに引ける", async () => {
    const { getNameIndex, batchLookupCharacters } = await import("../src/lib/fflogs/repository.ts");
    const { characterNameIndexKey } = await import("../src/lib/cache/keys.ts");
    const { getCacheStore, resetCacheStore } = await import("../src/lib/cache/store.ts");

    resetCacheStore();
    const store = getCacheStore();
    const candidates = [
      { canonicalId: 43123305, name: "Raye Skystriker", world: "Kujata", worldSlug: "kujata", region: "JP", dataCenter: "Elemental" },
      { canonicalId: 27882677, name: "Raye Skystriker", world: "Anima", worldSlug: "anima", region: "JP", dataCenter: "Mana" },
    ];
    await store.set(characterNameIndexKey("Raye Skystriker"), { candidates, updatedAt: new Date().toISOString() }, 60);

    const hit = await getNameIndex("raye  skystriker");
    assert.equal(hit?.length, 2);
    assert.equal(hit?.[0]!.world, "Kujata");

    // 大文字小文字・空白のゆれを吸収する
    assert.ok(await getNameIndex("RAYE SKYSTRIKER"));

    // 空のターゲットは 1 件も FFLogs を呼ばない
    const empty = await batchLookupCharacters([]);
    assert.equal(empty.size, 0);
  });

  it("未登録の名前は undefined", async () => {
    const { getNameIndex } = await import("../src/lib/fflogs/repository.ts");
    const { resetCacheStore } = await import("../src/lib/cache/store.ts");
    resetCacheStore();
    assert.equal(await getNameIndex("Never Seen Before"), undefined);
  });
});
