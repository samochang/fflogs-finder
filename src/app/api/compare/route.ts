import { NextResponse } from "next/server";
import { buildCompareResponse, type ApiWarning } from "@/lib/api/dto.ts";
import { loadCompare } from "@/lib/fflogs/repository.ts";
import { FflogsError } from "@/lib/fflogs/client.ts";
import type { RecruitmentSlot } from "@/lib/fflogs/model.ts";
import { startRequest } from "@/lib/logger.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 比較データを返す。
 *
 * 既定ではキャッシュにある分だけを返し、足りない分だけ FFLogs へ問い合わせる（仕様 §27）。
 * `refresh: true` を指定すると対象を再取得する（refresh lock は /api/refresh 側で扱う）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const req = startRequest("api.compare");
  const body = (await request.json().catch(() => ({}))) as {
    /** Lodestone 検索をどのリージョンで行うか（言語とは別） */
    region?: string;
    slots?: RecruitmentSlot[];
    warnings?: ApiWarning[];
    force?: boolean;
  };

  const slots = (body.slots ?? []).filter((slot) => slot?.name);
  if (slots.length === 0) {
    req.done("bad_request", { reason: "no_slots" });
    return NextResponse.json({ error: "比較対象がありません" }, { status: 400 });
  }
  req.log.debug("compare.slots", { slots: slots.length });

  try {
    const result = await loadCompare(slots, { force: Boolean(body.force), region: body.region });
    const response = buildCompareResponse(result, slots, body.warnings ?? []);
    const t = result.timings;
    const durationMs = req.done("ok", {
      slots: slots.length,
      ...t,
      fetchedCharacters: result.fetched.characters,
      fetchedTiers: result.fetched.tiers,
      skippedFreshTiers: result.skippedFreshTiers,
      servedFromCache: result.servedFromCache,
      fflogsRequests: result.fflogsRequests,
    });
    return NextResponse.json(response, {
      headers: {
        "X-Request-Id": req.requestId,
        // ブラウザの DevTools の Timing タブで内訳が見える
        "Server-Timing": `resolve;dur=${t.resolveMs}, rankings;dur=${t.rankingsMs}, total;dur=${durationMs}`,
      },
    });
  } catch (error) {
    if (error instanceof FflogsError) {
      req.done("error", { kind: error.kind, message: error.message });
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "rate_limit" ? 429 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "不明なエラー";
    req.done("error", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
