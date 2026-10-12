"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CompareTable, type CellRef } from "@/components/CompareTable.tsx";
import { useMessages, useSettings } from "@/components/settings/settings-provider.tsx";
import { Header } from "@/components/JobIcon.tsx";
import type { RateLimitState } from "@/components/RateLimitBadge.tsx";
import type { ApiWarning, CompareResponse } from "@/lib/api/dto.ts";
import type { RecruitmentSlot } from "@/lib/fflogs/model.ts";
import type { JobId } from "@/lib/jobs/jobs.ts";

export default function HomePage() {
  const t = useMessages();
  const { region } = useSettings();
  const [text, setText] = useState("");
  const [slots, setSlots] = useState<RecruitmentSlot[]>([]);
  const [warnings, setWarnings] = useState<ApiWarning[]>([]);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobOverrides, setJobOverrides] = useState<Record<number, JobId>>({});
  const [availableJobs, setAvailableJobs] = useState<Record<number, JobId[] | "loading" | "unknown">>({});
  const [probingRows, setProbingRows] = useState<Record<number, boolean>>({});
  const [activeLoading, setActiveLoading] = useState<Record<string, boolean>>({});
  /** 遅延取得した Active 値（rowIndex -> zoneId -> floorIndex -> %） */
  const [activeValues, setActiveValues] = useState<Record<string, number | null>>({});
  /** 一度提示した World 候補。解決後も残して選び直せるようにする */
  const [candidateSets, setCandidateSets] = useState<Record<number, NonNullable<CompareResponse["rows"][number]["candidates"]>>>({});
  /** サーバが DC 優先で「推定」採用した行。ユーザーが明示的に選ぶと解除する */
  const [autoSelectedRows, setAutoSelectedRows] = useState<Record<number, boolean>>({});
  /** 全 21 ジョブを調べ終えた行（それまでは取り漏らしの可能性がある） */
  const [fullyScannedRows, setFullyScannedRows] = useState<Record<number, boolean>>({});
  /** すでに調べたジョブ（結果が無かったものも含む） */
  const [scannedJobs, setScannedJobs] = useState<Record<number, JobId[]>>({});
  /** 追加探索に失敗した理由（レート制限など）。候補が無いことと混同しないように出す */
  const [probeErrors, setProbeErrors] = useState<Record<number, string | undefined>>({});
  /** /api/status から取得した API 消費実績 */
  const [usage, setUsage] = useState<{
    current?: RateLimitState;
    today: { requestsTotal: number; pointsObserved: number };
    recent: { days: number; requestsTotal: number; pointsObserved: number };
    cacheStore?: string;
  } | null>(null);

  const recognised = slots.length;

  /**
   * 候補を並べるときに優先する DC。
   *
   * 判明済みメンバーの多数派をそのまま使う（固定は同じ DC に集まりやすい）。
   * 手動選択はさせない（表の中身が切り替わるように見えて分かりにくいため）。
   */
  const preferredDc = useMemo(() => {
    if (!result) return undefined;
    const counts = new Map<string, number>();
    for (const row of result.rows) {
      if (row.dataCenter) counts.set(row.dataCenter, (counts.get(row.dataCenter) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [result]);

  /**
   * 稼働状況を取り直す。
   *
   * `fresh` のときはサーバーが rateLimitData を読み直す（1 point）。
   * pointsSpentThisHour は 1 リクエストぶん遅れて反映されるため、
   * 消費した直後にこれを挟まないと残量が実際より多く見えてしまう。
   */
  const loadStatus = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(fresh ? "/api/status?fresh=1" : "/api/status");
      if (!res.ok) return;
      const body = await res.json();
      setUsage({
        current: body.usage?.current,
        today: body.usage?.today ?? { requestsTotal: 0, pointsObserved: 0 },
        recent: body.usage?.recent ?? { days: 7, requestsTotal: 0, pointsObserved: 0 },
        cacheStore: body.cacheStore,
      });
    } catch {
      // ステータスが取れなくても本体の動作には影響させない
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const applyResponse = useCallback((response: CompareResponse, currentSlots: RecruitmentSlot[]) => {
    setResult(response);
    // 候補が出た行は保持する（解決後も選び直せるように）
    setCandidateSets((prev) => {
      const next = { ...prev };
      response.rows.forEach((row, index) => {
        if (row.candidates?.length) next[index] = row.candidates;
      });
      return next;
    });
    // 「推定」状態はユーザーが明示的に選ぶまで保持する
    setAutoSelectedRows((prev) => {
      const next = { ...prev };
      response.rows.forEach((row, index) => {
        if (row.autoSelected) next[index] = true;
      });
      return next;
    });
    setFullyScannedRows((prev) => {
      const next = { ...prev };
      response.rows.forEach((row, index) => {
        if (row.jobsFullyScanned) next[index] = true;
      });
      return next;
    });
    setScannedJobs((prev) => {
      const next = { ...prev };
      response.rows.forEach((row, index) => {
        if (row.jobsScanned?.length) next[index] = row.jobsScanned;
      });
      return next;
    });
    // 解決済みの canonicalId をスロットに書き戻す（次回はキャラクター特定をスキップできる）
    setSlots(
      currentSlots.map((slot, index) => ({
        ...slot,
        // 解決済みの canonicalId / world を書き戻す（次回は Lodestone 検索も FFLogs 検索も不要）
        characterId: response.rows[index]?.canonicalId ?? slot.characterId ?? null,
        world: response.rows[index]?.world ?? slot.world,
      })),
    );
  }, []);

  const runCompare = useCallback(
    async (inputText: string, overrideSlots?: RecruitmentSlot[]) => {
      setError(null);
      setLoading(true);
      try {
        let currentSlots = overrideSlots;
        let currentWarnings = warnings;

        if (!currentSlots) {
          const parseRes = await fetch("/api/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: inputText, region }),
          });
          const parsed = (await parseRes.json()) as {
            slots?: RecruitmentSlot[];
            warnings?: ApiWarning[];
            error?: string;
          };
          if (!parseRes.ok) throw new Error(parsed.error ?? "募集文の解析に失敗しました");
          currentSlots = parsed.slots ?? [];
          currentWarnings = parsed.warnings ?? [];
          setSlots(currentSlots);
          setWarnings(currentWarnings);
          setJobOverrides({});
          setAvailableJobs({});
          setActiveValues({});
          setCandidateSets({});
          setAutoSelectedRows({});
          setFullyScannedRows({});
          setScannedJobs({});
          setProbeErrors({});
        }

        if (currentSlots.length === 0) {
          setResult(null);
          throw new Error("募集文からキャラクターを認識できませんでした");
        }

        const compareRes = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slots: currentSlots, warnings: currentWarnings, region }),
        });
        const body = (await compareRes.json()) as CompareResponse & { error?: string };
        if (!compareRes.ok) throw new Error(body.error ?? "FFLogs からの取得に失敗しました");
        applyResponse(body, currentSlots);
        // キャッシュだけで応答したならレート制限を読み直す必要はない（1 point の無駄）
        void loadStatus((body.meta?.fflogsRequests ?? 0) > 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      } finally {
        setLoading(false);
      }
    },
    [applyResponse, loadStatus, warnings],
  );

  const handleRefresh = useCallback(async () => {
    if (slots.length === 0) return;
    setError(null);
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots, warnings, region }),
      });
      const body = (await res.json()) as CompareResponse & { error?: string; meta?: { locked?: boolean; message?: string } };
      if (!res.ok) throw new Error(body.error ?? "更新に失敗しました");
      applyResponse(body, slots);
      // FFLogs を叩いたときだけ読み直す（キャッシュ利用なら 1 point の無駄）
      void loadStatus((body.meta?.fflogsRequests ?? 0) > 0);
      if (body.meta?.locked) {
        setError("他のユーザーが同じ対象を更新中のため、キャッシュの内容を表示しています。");
      } else if (body.meta?.message) {
        setError(body.meta.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.unknownError);
    } finally {
      setRefreshing(false);
    }
  }, [applyResponse, loadStatus, region, slots, t, warnings]);

  const handleProbeJobs = useCallback(
    async (
      rowIndex: number,
      canonicalId: number,
      jobGroups?: JobId[][],
      knownJobs?: JobId[],
      options?: { exhaustive?: boolean },
    ) => {
      setProbingRows((prev) => ({ ...prev, [rowIndex]: true }));
      setProbeErrors((prev) => ({ ...prev, [rowIndex]: undefined }));
      try {
        const res = await fetch("/api/cell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "jobs", canonicalId, jobGroups, knownJobs, exhaustive: options?.exhaustive }),
        });
        const body = (await res.json()) as {
          jobIds?: JobId[];
          probedJobs?: JobId[];
          fullyScanned?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "ジョブ一覧の取得に失敗しました");

        // 見つかったジョブは、すでに分かっていた候補に足し込む（置き換えない）
        const merged = [...new Set<JobId>([...(body.jobIds ?? []), ...(knownJobs ?? [])])];
        setAvailableJobs((prev) => ({ ...prev, [rowIndex]: merged }));
        setScannedJobs((prev) => ({
          ...prev,
          [rowIndex]: [...new Set([...(prev[rowIndex] ?? []), ...(body.probedJobs ?? knownJobs ?? [])])],
        }));
        if (body.fullyScanned || options?.exhaustive) setFullyScannedRows((prev) => ({ ...prev, [rowIndex]: true }));
      } catch (error) {
        // 失敗しても、すでに分かっている候補は壊さない。
        // レート制限などで「候補が無い」と誤解させないよう、理由を出す。
        setProbeErrors((prev) => ({
          ...prev,
          [rowIndex]: error instanceof Error ? error.message : t.unknownError,
        }));
      } finally {
        setProbingRows((prev) => ({ ...prev, [rowIndex]: false }));
        // 探索で points を消費するので残量を取り直す（反映遅れを解消するため fresh）
        void loadStatus(true);
      }
    },
    [loadStatus, t],
  );

  const handleJobChange = useCallback(
    (rowIndex: number, jobId: JobId) => {
      setJobOverrides((prev) => ({ ...prev, [rowIndex]: jobId }));
      const nextSlots = slots.map((slot, index) => (index === rowIndex ? { ...slot, recruitmentJob: jobId } : slot));
      setSlots(nextSlots);
      void runCompare(text, nextSlots);
    },
    [region, runCompare, slots, text],
  );

  const handlePickCandidate = useCallback(
    (rowIndex: number, candidate: { canonicalId: number; world: string }) => {
      // **別のキャラクターに切り替わるので、その行のジョブ情報は引き継がない。**
      // ジョブはキャラごとに違うので、残すと「別人のジョブ」を表示してしまう。
      const clearRow = <T,>(prev: Record<number, T>): Record<number, T> => {
        const next = { ...prev };
        delete next[rowIndex];
        return next;
      };
      setAutoSelectedRows((prev) => ({ ...prev, [rowIndex]: false }));
      setJobOverrides(clearRow);
      setAvailableJobs(clearRow);
      setScannedJobs(clearRow);
      setFullyScannedRows(clearRow);
      setProbeErrors(clearRow);
      setProbingRows(clearRow);
      // 遅延取得した Active も別人のものなので捨てる
      setActiveValues((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${rowIndex}-`))),
      );

      const nextSlots = slots.map((slot, index) =>
        index === rowIndex ? { ...slot, characterId: candidate.canonicalId, world: candidate.world } : slot,
      );
      setSlots(nextSlots);
      void runCompare(text, nextSlots);
    },
    [region, runCompare, slots, text],
  );

  const handleRequestActive = useCallback(
    async (ref: CellRef) => {
      const row = result?.rows[ref.rowIndex];
      const jobId = jobOverrides[ref.rowIndex] ?? row?.recruitmentJob;
      if (!row?.canonicalId || !jobId) return;

      const key = `${ref.rowIndex}-${ref.zoneId}-${ref.floorIndex}`;
      setActiveLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const res = await fetch("/api/cell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "active", canonicalId: row.canonicalId, jobId, zoneId: ref.zoneId, floorIndex: ref.floorIndex }),
        });
        const body = (await res.json()) as { activePercent?: number | null; reason?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Active の取得に失敗しました");
        setActiveValues((prev) => ({ ...prev, [key]: body.activePercent ?? null }));
        if (body.reason) setError(`Active を取得できませんでした: ${body.reason}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : t.unknownError);
      } finally {
        setActiveLoading((prev) => ({ ...prev, [key]: false }));
        void loadStatus(true);
      }
    },
    [jobOverrides, result, loadStatus, t],
  );

  // 遅延取得した Active をレスポンスに重ねる
  const rows = useMemo(() => {
    if (!result) return [];
    return result.rows.map((row, rowIndex) => {
      const patched: typeof row = { ...row, tiers: { ...row.tiers } };
      for (const [zoneId, cells] of Object.entries(row.tiers)) {
        patched.tiers[zoneId] = cells.map((cell) => {
          const key = `${rowIndex}-${zoneId}-${cell.floorIndex}`;
          if (key in activeValues) {
            return { ...cell, activePercent: activeValues[key], activeUnavailableReason: undefined };
          }
          return cell;
        });
      }
      return patched;
    });
  }, [activeValues, result]);

  return (
    <>
      <Header rate={usage?.current} />
      <main className="mx-auto max-w-[1800px] px-5 pt-4 pb-16">
        <div className="mb-1.5 text-[13px] font-bold">{t.inputLabel}</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.inputPlaceholder}
          className="min-h-[76px] w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />

        <div className="my-3 flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            onClick={() => void runCompare(text)}
            disabled={loading || text.trim() === ""}
            className="rounded-lg bg-accent px-6 py-2.5 text-[15px] font-bold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <span className="mr-1.5 inline-block animate-spin">◌</span> : null}
            {t.compare}
          </button>
          {recognised > 0 ? <span className="font-bold text-accent">{t.recognised(recognised)}</span> : null}
          {result ? (
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loading}
              className="rounded-lg border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {refreshing ? (
                t.fetching
              ) : (
                <>
                  {t.refresh}
                  <span className="ml-1 text-[11px] font-normal text-ink-muted">{t.refreshCost}</span>
                </>
              )}
            </button>
          ) : null}
          {result?.meta.rateLimit ? (
            <span className="text-[12px] text-ink-muted">
              残り約{" "}
              {Math.max(
                0,
                result.meta.rateLimit.limitPerHour - result.meta.rateLimit.pointsSpentThisHour,
              ).toFixed(0)}{" "}
              / {result.meta.rateLimit.limitPerHour} points（今週の消費 約{usage?.recent.pointsObserved ?? 0} / FFLogs
              呼び出し {usage?.recent.requestsTotal ?? 0} 回）
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="mb-3.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {result && !result.meta.credentialsConfigured ? (
          <Notice tone="warn">FFL_CLIENT_ID / FFL_CLIENT_SECRET が未設定です。.env を用意してから再起動してください。</Notice>
        ) : null}

        {result?.meta.degraded ? (
          <Notice tone="warn">
            {result.meta.degradedReason} — {t.cached}
          </Notice>
        ) : null}

        {result && result.meta.failures.length > 0 ? (
          <Notice tone="warn">
            {result.meta.failures.slice(0, 4).map((f, i) => (
              <div key={`${f.canonicalId}-${i}`}>
                canonicalID {f.canonicalId}: {f.message}
              </div>
            ))}
          </Notice>
        ) : null}

        {warnings.length > 0 ? (
          <Notice tone="warn">
            {warnings.slice(0, 5).map((w, i) => (
              <div key={`${w.lineNumber}-${i}`}>
                {w.lineNumber > 0 ? `${w.lineNumber}行目: ` : ""}
                {w.reason}
              </div>
            ))}
            {warnings.length > 5 ? <div>…ほか {warnings.length - 5} 件</div> : null}
          </Notice>
        ) : null}

        {result ? (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="flex items-center gap-2.5 text-[17px] font-bold">
                {t.resultTitle}
                <span className="rounded-full border border-line bg-surface-subtle px-2.5 py-px text-[12px] font-semibold text-ink-muted">
                  {t.resultUnit(rows.length)}
                </span>
              </div>
              <span className="text-[12px] text-ink-muted">{t.legend}</span>
            </div>

            <Notice tone="info">
              {result.meta.servedFromCache ? (
                <>{t.cached}</>
              ) : result.meta.fetched.tiers > 0 ? (
                <>{t.fetchedOne(result.meta.fetched.characters)}</>
              ) : (
                <>{t.fetchedSome}</>
              )}
            </Notice>

            {result.meta.timings ? (
              <div className="mb-2.5 text-[12px] text-ink-muted tabular">
                処理時間: 合計 {result.meta.timings.totalMs}ms（キャラ特定 {result.meta.timings.resolveMs}ms / 成績取得{" "}
                {result.meta.timings.rankingsMs}ms）
              </div>
            ) : null}

            <CompareTable
              tiers={result.tiers}
              rows={rows}
              jobOverrides={jobOverrides}
              availableJobs={availableJobs}
              probingRows={probingRows}
              onJobChange={handleJobChange}
              onProbeJobs={handleProbeJobs}
              onRequestActive={handleRequestActive}
              onPickCandidate={handlePickCandidate}
              preferredDataCenter={preferredDc}
              candidateSets={candidateSets}
              autoSelectedRows={autoSelectedRows}
              fullyScannedRows={fullyScannedRows}
              scannedJobs={scannedJobs}
              probeErrors={probeErrors}
              activeLoading={activeLoading}
            />
          </>
        ) : null}
      </main>
    </>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "info"
          ? "mb-3.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2.5 text-[12px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
          : "mb-3.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      }
    >
      {children}
    </div>
  );
}
