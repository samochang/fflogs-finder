import { NextResponse } from "next/server";
import { getCacheStore } from "@/lib/cache/store.ts";
import { getClient, getTiers } from "@/lib/fflogs/repository.ts";
import { hasCredentials, dataMaxAgeDays } from "@/lib/fflogs/config.ts";
import { getUsageSummary } from "@/lib/fflogs/usage.ts";
import { startRequest } from "@/lib/logger.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 稼働状況・レート制限・API 消費実績の確認用（仕様 §25）。
 *
 *   curl -s localhost:3000/api/status | jq
 */
export async function GET(request: Request): Promise<NextResponse> {
  const req = startRequest("api.status");
  const store = getCacheStore();
  const credentialsConfigured = hasCredentials();

  let tiers: Array<{ zoneId: number; name: string; floors: number; partition?: string }> = [];
  let error: string | undefined;

  if (credentialsConfigured) {
    try {
      tiers = (await getTiers()).map((t) => ({
        zoneId: t.zoneId,
        name: t.name,
        floors: t.floors.length,
        partition: t.partition?.compactName,
      }));
    } catch (e) {
      error = e instanceof Error ? e.message : "Tier の取得に失敗しました";
    }
  }

  // ?fresh=1 のときだけ rateLimitData を読み直す（1 point）。
  // pointsSpentThisHour は 1 リクエストぶん遅れて反映されるため、
  // 消費した直後にこれを挟まないと残量が実際より多く見える。
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (fresh && credentialsConfigured) {
    try {
      await getClient().settleRateLimit();
    } catch (e) {
      error ??= e instanceof Error ? e.message : "レート制限の読み直しに失敗しました";
    }
  }

  const snapshot = credentialsConfigured ? safeSnapshot() : undefined;
  const usage = await getUsageSummary(7);

  const body = {
    credentialsConfigured,
    cacheStore: store.kind,
    dataMaxAgeDays: dataMaxAgeDays(),
    tiers,
    rateLimit: snapshot,
    /** API points / リクエストの消費実績（日次で記録） */
    usage,
    error,
    notes: {
      cacheFallback:
        store.kind === "memory"
          ? "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 未設定のためプロセス内メモリを使用しています（Vercel では永続しません）"
          : undefined,
      pointsLag:
        "FFLogs の pointsSpentThisHour は 1 リクエスト分遅れて反映されるため、usage.pointsObserved は目安です（requests は正確）",
    },
  };

  const durationMs = req.done("ok", { tiers: tiers.length, requestsToday: usage.today.requestsTotal });
  return NextResponse.json(body, { headers: { "X-Request-Id": req.requestId, "Server-Timing": `total;dur=${durationMs}` } });
}

function safeSnapshot() {
  try {
    return getClient().lastRateLimitSnapshot;
  } catch {
    return undefined;
  }
}
