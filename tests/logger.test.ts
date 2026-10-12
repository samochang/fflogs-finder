import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redact, createLogger } from "../src/lib/logger.ts";
import { usageDayKey } from "../src/lib/fflogs/usage.ts";
import { extractOperationName } from "../src/lib/fflogs/client.ts";

describe("ログ", () => {
  it("秘匿情報を落とす", () => {
    const result = redact({
      clientId: "abc",
      clientSecret: "SUPER_SECRET",
      access_token: "tok",
      Authorization: "Bearer x",
      nested: { apiKey: "k", ok: 1 },
    }) as Record<string, unknown>;
    assert.equal(result.clientSecret, "[redacted]");
    assert.equal(result.access_token, "[redacted]");
    assert.equal(result.Authorization, "[redacted]");
    assert.equal((result.nested as Record<string, unknown>).apiKey, "[redacted]");
    assert.equal((result.nested as Record<string, unknown>).ok, 1);
    assert.equal(result.clientId, "abc");
  });

  it("長すぎる文字列を切り詰める", () => {
    const long = "x".repeat(1000);
    assert.ok(String(redact(long)).length < 1000);
  });

  it("子ロガーは共通フィールドを引き継ぐ", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      const child = createLogger({ app: "test" }).child({ requestId: "abc123" });
      child.info("something.happened", { value: 1 });
    } finally {
      console.log = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.msg, "something.happened");
    assert.equal(parsed.app, "test");
    assert.equal(parsed.requestId, "abc123");
    assert.equal(parsed.value, 1);
    assert.equal(parsed.level, "info");
    assert.ok(parsed.ts);
  });
});

describe("FFLogs の operation 名", () => {
  it("名前付きクエリから operation を取り出す", () => {
    assert.equal(extractOperationName("query ZoneRankingsBatch { characterData { } }"), "ZoneRankingsBatch");
    assert.equal(extractOperationName("  query CharacterBatch {\n}"), "CharacterBatch");
  });

  it("無名クエリはルートから推定する", () => {
    assert.equal(extractOperationName("{ characterData { character { id } } }"), "anonymous(characterData)");
    assert.equal(extractOperationName("{ reportData { report { code } } }"), "anonymous(reportData)");
  });
});

describe("利用実績のキー", () => {
  it("日付キーは UTC の YYYY-MM-DD", () => {
    assert.equal(usageDayKey(new Date("2026-10-09T23:59:00Z")), "2026-10-09");
    assert.equal(usageDayKey(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
  });
});
