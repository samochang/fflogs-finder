import { NextResponse } from "next/server";
import { loadActivePercent, probeAvailableJobs, updateCellActive } from "@/lib/fflogs/repository.ts";
import { FflogsError } from "@/lib/fflogs/client.ts";
import { JOBS, isFullyScanned, type JobId } from "@/lib/jobs/jobs.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 遅延取得用エンドポイント（仕様 §22）。
 *
 *  - action: "active"  … 1 セルの Active（FFLogs の DamageDone テーブル activeTime）を取得
 *  - action: "jobs"    … そのキャラがログを持つジョブ一覧をプローブ
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as {
    action?: "active" | "jobs";
    /**
     * 探索するジョブのグループ（近いロール順）。
     * 先頭のグループから順に調べ、見つかった時点で打ち切る。
     */
    jobGroups?: JobId[][];
    /** すでにログが分かっているジョブ（探索し直さない） */
    knownJobs?: JobId[];
    /** すでに調べ済みのジョブ（結果が無かったものも含む。探索し直さない） */
    probedJobs?: JobId[];
    /**
     * true なら全グループを最後まで調べる（取り漏らしが無くなる）。
     * false なら最初に見つかったところで打ち切る（安いが、他にログがあるかは分からない）。
     */
    exhaustive?: boolean;
    canonicalId?: number;
    jobId?: JobId;
    zoneId?: number;
    floorIndex?: number;
  };

  const canonicalId = Number(body.canonicalId);
  if (!Number.isFinite(canonicalId)) {
    return NextResponse.json({ error: "canonicalId が必要です" }, { status: 400 });
  }

  try {
    if (body.action === "jobs") {
      // 指定が無ければ全 21 ジョブを 1 グループとして調べる
      const skip = new Set([...(body.knownJobs ?? []), ...(body.probedJobs ?? [])]);
      const source = body.jobGroups?.length ? body.jobGroups : [JOBS.map((job) => job.id)];
      let groups = source.map((group) => group.filter((id) => !skip.has(id))).filter((group) => group.length > 0);

      // 取り漏らしを無くす場合は、残りを 1 グループにまとめて最後まで調べる
      if (body.exhaustive) groups = groups.length > 0 ? [groups.flat()] : [];

      const result = await probeAvailableJobs(canonicalId, groups, { exhaustive: body.exhaustive });
      // 「調べた」か「ログがあると分かっている」のどちらかで全 21 ジョブを覆ったか。
      // 覆えていれば「他にログのあるジョブは無い」と言い切れる。
      return NextResponse.json({
        ...result,
        fullyScanned: isFullyScanned([...result.probedJobs, ...result.jobIds], body.knownJobs ?? []),
      });
    }

    if (body.action === "active") {
      if (!body.jobId || !body.zoneId || !body.floorIndex) {
        return NextResponse.json({ error: "jobId / zoneId / floorIndex が必要です" }, { status: 400 });
      }
      const result = await loadActivePercent(canonicalId, body.jobId, body.zoneId, body.floorIndex);
      await updateCellActive(canonicalId, body.jobId, body.zoneId, body.floorIndex, result.activePercent, result.reason);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "未知の action です" }, { status: 400 });
  } catch (error) {
    if (error instanceof FflogsError && error.kind === "rate_limit") {
      return NextResponse.json(
        { error: error.message, kind: "rate_limit", retryAfterSeconds: error.retryAfterSeconds },
        { status: 429 },
      );
    }
    const message = error instanceof FflogsError ? error.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
