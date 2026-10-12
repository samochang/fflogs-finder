import { NextResponse } from "next/server";
import { withRefreshLock } from "@/lib/cache/refreshLock.ts";
import { refreshScope } from "@/lib/cache/keys.ts";
import { getClient, getCharacterDocument, loadCompare } from "@/lib/fflogs/repository.ts";
import { FflogsError, isRateLimitError } from "@/lib/fflogs/client.ts";
import { dataMaxAgeDays } from "@/lib/fflogs/config.ts";
import { startRequest } from "@/lib/logger.ts";
import { buildCompareResponse, type ApiWarning } from "@/lib/api/dto.ts";
import type { RecruitmentSlot } from "@/lib/fflogs/model.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 「最新データを確認」ボタン（仕様 §27 / §28）。
 *
 * refresh lock を取れた場合のみ FFLogs へ問い合わせる。
 * 取れなかった場合は既存キャッシュを返し、`meta.locked = true` を立てる。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const req = startRequest("api.refresh");
  const body = (await request.json().catch(() => ({}))) as {
    slots?: RecruitmentSlot[];
    warnings?: ApiWarning[];
    /** 鮮度チェックを無視して必ず取り直す（開発・検証用） */
    ignoreFreshness?: boolean;
    /** Lodestone 検索をどのリージョンで行うか（言語とは別） */
    region?: string;
  };

  const slots = (body.slots ?? []).filter((slot) => slot?.name);
  if (slots.length === 0) {
    return NextResponse.json({ error: "比較対象がありません" }, { status: 400 });
  }

  const scopes = slots.map((slot) => refreshScope(slot.characterId ?? slot.name, slot.recruitmentJob ?? "any"));
  const primaryScope = scopes.join("+").slice(0, 200);

  // 最終取得から DATA_MAX_AGE_DAYS（既定 7 日）以内なら FFLogs へ問い合わせない（points 節約）
  const maxAgeDays = body.ignoreFreshness ? 0 : dataMaxAgeDays();
  req.log.debug("refresh.start", { slots: slots.length, maxAgeDays });
  const outcome = await withRefreshLock(primaryScope, async () => loadCompare(slots, { maxAgeDays, region: body.region }));

  if (!outcome.ok) {
    // 他のリクエストが更新中。キャッシュの内容を返す（仕様 §28）
    req.log.info("refresh.locked", { scope: primaryScope.slice(0, 80) });
    const cached = await loadCompare(slots, { force: false, region: body.region });
    const response = buildCompareResponse(cached, slots, body.warnings ?? []);
    return NextResponse.json({ ...response, meta: { ...response.meta, locked: true } });
  }

  try {
    const response = buildCompareResponse(outcome.value, slots, body.warnings ?? []);
    const t = outcome.value.timings;
    const durationMs = req.done("ok", {
      maxAgeDays,
      fetchedTiers: response.meta.fetched.tiers,
      skippedFreshTiers: response.meta.skippedFreshTiers,
      ...t,
    });
    return NextResponse.json(
      {
        ...response,
        meta: { ...response.meta, locked: false, maxAgeDays, refreshedTiers: response.meta.fetched.tiers },
      },
      { headers: { "X-Request-Id": req.requestId, "Server-Timing": `total;dur=${durationMs}` } },
    );
  } catch (error) {
    if (isRateLimitError(error)) {
      // API 制限時は既存キャッシュを優先する（仕様 §34）
      const cached = await loadCompare(slots, { force: false, region: body.region });
      const response = buildCompareResponse(cached, slots, body.warnings ?? []);
      return NextResponse.json({
        ...response,
        meta: { ...response.meta, rateLimited: true, message: "最新データを確認できませんでした" },
      });
    }
    const message = error instanceof FflogsError ? error.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const characterId = Number(url.searchParams.get("characterId"));
  if (!Number.isFinite(characterId)) {
    return NextResponse.json({ error: "characterId が必要です" }, { status: 400 });
  }
  const doc = await getCharacterDocument(characterId);
  const rate = getClient().lastRateLimitSnapshot;
  return NextResponse.json({
    character: doc,
    rateLimit: rate,
  });
}
