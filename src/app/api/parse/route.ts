import { NextResponse } from "next/server";
import { parseRecruitmentText } from "@/lib/parser/parseRecruitment.ts";
import { UrlFetchError, fetchUrlText, parseSingleUrl } from "@/lib/parser/fetchUrl.ts";
import { fetchLodestoneCharacter } from "@/lib/lodestone/lodestone.ts";
import { getWorldIndex } from "@/lib/fflogs/repository.ts";
import type { JobId } from "@/lib/jobs/jobs.ts";
import type { RecruitmentSlot } from "@/lib/fflogs/model.ts";
import { startRequest } from "@/lib/logger.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 募集文を解析して募集枠（最大 8 人）を返す。
 * ここでは FFLogs API へアクセスしない（仕様 §27）。
 *
 * 入力が Lodestone 等の URL 1 つだけの場合は、本文を取得してから通常の parser に流す（仕様 §3 B）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const req = startRequest("api.parse");
  const body = (await request.json().catch(() => ({}))) as { text?: string; overrides?: Array<{ index: number; jobId?: JobId | null; world?: string }> };

  const raw = (body.text ?? "").trim();
  if (raw === "") {
    req.done("bad_request", { reason: "empty" });
    return NextResponse.json({ error: "募集文が空です" }, { status: 400 });
  }

  let text = raw;
  let source: { url: string; title?: string; truncated: boolean } | undefined;

  const singleUrl = parseSingleUrl(raw);
  if (singleUrl) {
    try {
      const fetched = await fetchUrlText(singleUrl);
      text = fetched.text;
      source = { url: fetched.url, title: fetched.title, truncated: fetched.truncated };
    } catch (error) {
      const message = error instanceof UrlFetchError ? error.message : "URL の本文を取得できませんでした。募集文をそのまま貼り付けてください。";
      req.done("url_fetch_failed", { url: singleUrl });
      return NextResponse.json({ error: message, kind: "url_fetch_failed" }, { status: 422 });
    }
  }

  // JP 以外のワールド表記にも対応するため、動的インデックスが取れれば使う（失敗しても静的シードで動く）
  let worldIndex;
  try {
    worldIndex = await getWorldIndex();
  } catch {
    worldIndex = undefined;
  }

  const parsed = parseRecruitmentText(text, { worldIndex });

  const slots: RecruitmentSlot[] = parsed.characters.map((character) => ({
    characterId: null,
    name: character.name,
    world: character.world,
    recruitmentJob: character.recruitmentJob,
    alternativeJobs: character.recruitmentJobAlternates,
    recruitmentPosition: character.recruitmentPosition,
    jobConfidence: character.recruitmentJobConfidence,
    lodestoneId: character.lodestoneId,
  }));

  // 募集文に Lodestone のキャラクター URL がある行は、ページから名前とワールドを確定させる
  // （FFLogs は名前だけでは引けず、World が分かると 1 発で特定できる）
  await Promise.all(
    slots.map(async (slot) => {
      if (!slot.lodestoneId) return;
      if (slot.name !== "" && slot.world) return;
      const character = await fetchLodestoneCharacter(slot.lodestoneId);
      if (!character) return;
      slot.name = character.name;
      slot.world = character.world || slot.world;
    }),
  );

  // 名前もワールドも確定できなかった枠は落とす
  const usableSlots = slots.filter((slot) => slot.name.trim() !== "");

  // UI 上でのユーザー修正を反映する（仕様 §8 / §34 の「ジョブ判定曖昧」対応）
  for (const override of body.overrides ?? []) {
    const slot = usableSlots[override.index];
    if (!slot) continue;
    if (override.jobId !== undefined) slot.recruitmentJob = override.jobId ?? undefined;
    if (override.world !== undefined) slot.world = override.world;
  }

  req.done("ok", {
    slots: usableSlots.length,
    candidateLines: parsed.stats.candidateLines,
    withJob: usableSlots.filter((s) => s.recruitmentJob).length,
    withWorld: usableSlots.filter((s) => s.world).length,
    source: source?.url,
  });

  return NextResponse.json({
    slots: usableSlots,
    warnings: parsed.warnings,
    stats: parsed.stats,
    detectedWorlds: usableSlots.filter((s) => s.world).length,
    source,
  });
}
