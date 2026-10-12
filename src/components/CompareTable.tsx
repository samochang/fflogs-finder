"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiCell, ApiRow, ApiTier } from "@/lib/api/dto.ts";
import { TIERS_PER_CHARACTER } from "@/lib/fflogs/costs.ts";
import { jobName } from "@/lib/i18n.ts";
import { useMessages, useSettings } from "./settings/settings-provider.tsx";
import { expansionLabel, zoneFullName, zoneLabel } from "@/lib/fflogs/labels.ts";
import {
  JOBS,
  getJob,
  jobPickerOrder,
  jobProbeGroups,
  positionRoles,
  sortJobsForPosition,
  type JobId,
} from "@/lib/jobs/jobs.ts";
import {
  PERF_COLOR_CLASS,
  formatAmount,
  formatDuration,
  formatPercent,
  formatPercentParenthesized,
  perfColor,
} from "@/lib/perf.ts";
import { cn } from "@/lib/utils.ts";
import { JobIconButton } from "./JobIcon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

export interface CellRef {
  rowIndex: number;
  zoneId: number;
  floorIndex: number;
}

interface ExpansionGroup {
  name: string;
  tiers: ApiTier[];
}

/** Tier を拡張ごとにまとめる（新しい順の並びを保つ）。 */
export function groupByExpansion(tiers: readonly ApiTier[]): ExpansionGroup[] {
  const groups: ExpansionGroup[] = [];
  for (const tier of tiers) {
    const last = groups.at(-1);
    if (last && last.name === tier.expansion) last.tiers.push(tier);
    else groups.push({ name: tier.expansion, tiers: [tier] });
  }
  return groups;
}

/** 行頭の幅。切り替え UI の有無で列幅が動かないよう固定する。 */
const ROW_HEAD_WIDTH = "w-[232px] min-w-[232px] max-w-[232px]";

function PerfValue({
  value,
  className,
  parenthesize = false,
}: {
  value: number | null;
  className?: string;
  /** 下段（Median）は括弧で囲んで上段 Best と区別する */
  parenthesize?: boolean;
}) {
  return (
    <div className={cn("tabular font-bold leading-tight", PERF_COLOR_CLASS[perfColor(value)], className)}>
      {parenthesize ? formatPercentParenthesized(value) : formatPercent(value)}
    </div>
  );
}

/**
 * World 候補の選択。
 *
 * ポップオーバー（Portal）なので行の高さ・列幅が変わらない。
 * 選択後も候補が残るため、間違えても押し直せる。
 */
function CandidatePicker({
  row,
  candidates,
  preferredDataCenter,
  estimated,
  onPick,
}: {
  row: ApiRow;
  candidates: NonNullable<ApiRow["candidates"]>;
  preferredDataCenter?: string;
  /** DC 優先で推定採用した状態（ユーザー未確定） */
  estimated: boolean;
  onPick: (candidate: NonNullable<ApiRow["candidates"]>[number]) => void;
}) {
  const t = useMessages();
  const ordered = useMemo(() => {
    if (!preferredDataCenter) return candidates;
    return [...candidates].sort((a, b) => {
      const aSame = a.dataCenter === preferredDataCenter ? 0 : 1;
      const bSame = b.dataCenter === preferredDataCenter ? 0 : 1;
      return aSame - bSame;
    });
  }, [candidates, preferredDataCenter]);

  const current = candidates.find((c) => c.canonicalId === row.canonicalId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] leading-tight transition-colors",
            estimated
              ? "border-dashed border-accent bg-accent/10 text-accent hover:bg-accent/20"
              : "border-line-strong text-ink hover:border-accent hover:text-accent",
          )}
          title={
            estimated
              ? `同じ DC の候補を推定で選択しています（候補 ${candidates.length} 件）。違う場合は押して選び直してください`
              : `World の候補が ${candidates.length} 件あります`
          }
        >
          {estimated ? <span className="font-bold">推定</span> : null}
          <span className="max-w-[120px] truncate">
            {current?.world ?? row.world ?? "World 未確定"}
            {current?.dataCenter ? ` [${current.dataCenter}]` : ""}
          </span>
          <span className="text-ink-muted">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <div className="mb-1.5 text-[11px] text-ink-muted">
          {preferredDataCenter ? t.guessedFromMembers(preferredDataCenter) : t.worldCandidates}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ordered.map((candidate) => (
            <button
              key={candidate.canonicalId}
              type="button"
              onClick={() => onPick(candidate)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                row.canonicalId === candidate.canonicalId
                  ? "border-accent bg-accent font-bold text-accent-ink"
                  : "border-line-strong text-ink hover:border-accent hover:text-accent",
              )}
              title={`${candidate.name} / ${candidate.world} (${candidate.dataCenter ?? candidate.region})`}
            >
              {candidate.world}
              {candidate.dataCenter ? <span className="opacity-70"> [{candidate.dataCenter}]</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-line pt-1.5 text-[10px] leading-tight font-bold text-amber-700 dark:text-amber-300">
          {t.switchWorldCost(TIERS_PER_CHARACTER)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CompareTable({
  tiers,
  rows,
  jobOverrides,
  availableJobs,
  probingRows,
  candidateSets,
  autoSelectedRows,
  fullyScannedRows,
  scannedJobs,
  probeErrors,
  preferredDataCenter,
  onJobChange,
  onProbeJobs,
  onPickCandidate,
  onRequestActive,
  activeLoading,
}: {
  tiers: readonly ApiTier[];
  rows: readonly ApiRow[];
  jobOverrides: Record<number, JobId>;
  availableJobs: Record<number, JobId[] | "loading" | "unknown">;
  probingRows: Record<number, boolean>;
  candidateSets: Record<number, NonNullable<ApiRow["candidates"]>>;
  /** DC 優先で推定採用した行（未確定であることを示す） */
  autoSelectedRows: Record<number, boolean>;
  /** 全 21 ジョブを調べ終えた行 */
  fullyScannedRows: Record<number, boolean>;
  /** すでに調べたジョブ（結果が無かったものも含む） */
  scannedJobs: Record<number, JobId[]>;
  /** 追加探索に失敗した理由（レート制限など） */
  probeErrors: Record<number, string | undefined>;
  preferredDataCenter?: string;
  onJobChange: (rowIndex: number, jobId: JobId) => void;
  onProbeJobs: (
    rowIndex: number,
    canonicalId: number,
    jobGroups?: JobId[][],
    knownJobs?: JobId[],
    options?: { exhaustive?: boolean },
  ) => void;
  onPickCandidate: (rowIndex: number, candidate: NonNullable<ApiRow["candidates"]>[number]) => void;
  onRequestActive: (ref: CellRef) => void;
  activeLoading: Record<string, boolean>;
}) {
  const t = useMessages();
  const { lang } = useSettings();
  const [detail, setDetail] = useState<CellRef | null>(null);

  // 詳細を閉じる操作:
  //  - Esc
  //  - パネルの外を触る（mousedown を監視するだけで、クリックは吸わない）
  // 全画面のバックドロップを置くと 1 回目のクリックを吸ってしまうため使わない。
  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // パネル内・ポップオーバー内（ジョブ切替など）は閉じない
      if (target?.closest("[data-detail-panel],[data-radix-popper-content-wrapper]")) return;
      setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    // capture で拾う。セルやボタン側の処理はそのまま動く
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [detail]);

  const groups = useMemo(() => groupByExpansion(tiers), [tiers]);
  const flatFloors = useMemo(
    () => tiers.flatMap((tier) => tier.floors.map((floor) => ({ zoneId: tier.zoneId, floor }))),
    [tiers],
  );

  const detailData = useMemo(() => {
    if (!detail) return undefined;
    const row = rows[detail.rowIndex];
    const cell = row?.tiers[String(detail.zoneId)]?.find((c) => c.floorIndex === detail.floorIndex);
    const tier = tiers.find((t) => t.zoneId === detail.zoneId);
    return { row, cell, tier };
  }, [detail, rows, tiers]);

  const groupStart = (index: number): boolean => index === 0 || tiers[index - 1]!.expansion !== tiers[index]!.expansion;
  const tierStart = (index: number): boolean =>
    index === 0 || flatFloors[index - 1]!.zoneId !== flatFloors[index]!.zoneId;

  return (
    <>
      <div className="max-h-[72vh] overflow-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th
                rowSpan={3}
                className={cn(
                  "sticky top-0 left-0 z-40 border-r border-b border-line bg-surface-header px-3 py-2 text-left align-bottom text-[12px] font-bold",
                  ROW_HEAD_WIDTH,
                )}
              >
                {t.jobColumn}
              </th>
              {groups.map((group, groupIndex) => (
                <th
                  key={group.name}
                  colSpan={group.tiers.length * 4}
                  data-expansion={group.name}
                  style={{
                    background: "var(--exp-bg)",
                    color: "var(--exp-accent)",
                    borderTop: "3px solid var(--exp-accent)",
                  }}
                  className={cn(
                    "sticky top-0 z-30 border-r border-b border-line px-2 py-1.5 text-center text-[13px] font-bold",
                    groupIndex > 0 && "border-l-2 border-l-line-strong",
                  )}
                >
                  {expansionLabel(group.name)}
                </th>
              ))}
            </tr>
            <tr>
              {tiers.map((tier, index) => (
                <th
                  key={tier.zoneId}
                  colSpan={tier.floors.length}
                  title={zoneFullName(tier.zoneId, tier.name)}
                  className={cn(
                    "sticky top-[30px] z-30 border-r border-b border-line bg-surface-header px-2 py-1 text-center text-[12px] font-bold",
                    groupStart(index) && "border-l-2 border-l-line-strong",
                  )}
                >
                  {zoneLabel(tier.zoneId, tier.name)}
                </th>
              ))}
            </tr>
            <tr>
              {flatFloors.map(({ zoneId, floor }, index) => (
                <th
                  key={`${zoneId}-${floor.index}`}
                  className={cn(
                    "sticky top-[59px] z-30 border-r border-b border-line bg-surface-header px-2 py-1 text-center text-[12px] font-semibold",
                    tierStart(index) && "border-l-2 border-l-line-strong",
                  )}
                >
                  {floor.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => {
              const currentJob = jobOverrides[rowIndex] ?? row.recruitmentJob;
              // クライアントで探索していなければ、サーバーが返した候補（メインジョブの手掛かり）を使う。
              // これを見落とすと、切り替え候補があるのにピッカーが開かない。
              const available = availableJobs[rowIndex] ?? row.availableJobs ?? "unknown";
              // 切り替え候補は、いま表示しているジョブも含めて出す
              // （除外すると「なぜ今のジョブが一覧に無いのか」が分からなくなる）
              const knownJobs = Array.isArray(available)
                ? sortJobsForPosition(available, row.recruitmentPosition)
                : [];
              const otherJobs = knownJobs.filter((id) => id !== currentJob);
              const candidates = candidateSets[rowIndex] ?? row.candidates;
              // 募集ポジションと違うロールのジョブを推定で当てている場合は「？」を出す
              const jobChosenByUser = jobOverrides[rowIndex] !== undefined;
              // 全 21 ジョブを調べ終えるまでは「取り漏らしがあるかもしれない」状態
              const fullyScanned = fullyScannedRows[rowIndex] === true || row.jobsFullyScanned === true;
              // 「調べた」＋「ログがあると分かっている」で覆えていないジョブ数＝残りの探索コスト
              const covered = new Set<JobId>([
                ...(scannedJobs[rowIndex] ?? row.jobsScanned ?? []),
                ...otherJobs,
                ...(currentJob ? [currentJob] : []),
              ]);
              const remainingJobs = Math.max(0, JOBS.length - covered.size);
              const estimatedMismatch =
                row.autoSelectedJob === true &&
                !jobChosenByUser &&
                currentJob !== null &&
                !positionRoles(row.recruitmentPosition).includes(getJob(currentJob).role);

              return (
                <tr key={`${row.name}-${rowIndex}`} className="group">
                  <td
                    className={cn(
                      "sticky left-0 z-20 border-r border-b border-line bg-surface px-2.5 py-2 align-middle group-hover:bg-surface-subtle",
                      ROW_HEAD_WIDTH,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <JobIconButton
                        currentJob={currentJob}
                        position={row.recruitmentPosition}
                        jobs={knownJobs}
                        loading={available === "loading" || probingRows[rowIndex] === true}
                        estimatedMismatch={estimatedMismatch}
                        fullyScanned={fullyScanned}
                        remainingJobs={remainingJobs}
                        probeError={probeErrors[rowIndex]}
                        // 開いただけでは探索しない（points を使うのは明示的な操作のときだけ）
                        onProbe={() => {}}
                        onProbeMore={(exhaustive) => {
                          if (!row.canonicalId) return;
                          // すでに分かっているジョブは渡して、調べ直さないようにする。
                          // exhaustive なら残り全部を最後まで調べる（取り漏らしが無くなる）。
                          onProbeJobs(
                            rowIndex,
                            row.canonicalId,
                            jobProbeGroups(row.recruitmentPosition, row.alternativeJobs, otherJobs),
                            otherJobs,
                            { exhaustive },
                          );
                        }}
                        onSelect={(jobId) => onJobChange(rowIndex, jobId)}
                      />

                      <div className="flex min-w-0 flex-col justify-center">
                        <div className="truncate text-[11px] leading-tight text-ink-muted">
                          {row.recruitmentPosition ? `${row.recruitmentPosition} · ` : ""}
                          {currentJob ? jobName(lang, currentJob) : row.recruitmentJob ? "" : t.jobUnknown}
                          {row.autoSelectedJob && !jobOverrides[rowIndex] ? ` ${t.jobEstimated}` : ""}
                          {row.jobConfidence === "low" ? " ?" : ""}
                        </div>
                        {row.fflogsUrl ? (
                          <a
                            href={row.fflogsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${row.name} の FFLogs を開く`}
                            className="w-fit max-w-full truncate font-bold leading-tight text-ink underline-offset-2 hover:text-accent hover:underline"
                          >
                            {row.name}
                          </a>
                        ) : (
                          <div className="truncate font-bold leading-tight">{row.name}</div>
                        )}
                        {row.world ? (
                          <div className="truncate text-[11px] leading-tight text-ink-muted">{row.world}</div>
                        ) : null}

                        {candidates?.length ? (
                          <div className="mt-1 min-w-0">
                            <CandidatePicker
                              row={row}
                              candidates={candidates}
                              preferredDataCenter={preferredDataCenter}
                              estimated={autoSelectedRows[rowIndex] === true}
                              onPick={(candidate) => onPickCandidate(rowIndex, candidate)}
                            />
                          </div>
                        ) : null}

                        {row.status !== "ok" && row.status !== "ambiguous" ? (
                          <div className="truncate text-[11px] leading-tight text-amber-600 dark:text-amber-400">
                            {row.message ?? t.unknownError}
                          </div>
                        ) : row.message ? (
                          <div className="truncate text-[11px] leading-tight text-ink-muted">{row.message}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  {flatFloors.map(({ zoneId, floor }, cellIndex) => {
                    const cell: ApiCell | undefined = row.tiers[String(zoneId)]?.find(
                      (c) => c.floorIndex === floor.index,
                    );
                    const isSelected =
                      detail?.rowIndex === rowIndex && detail.zoneId === zoneId && detail.floorIndex === floor.index;
                    return (
                      <td
                        key={`${rowIndex}-${zoneId}-${floor.index}`}
                        onClick={() => setDetail(isSelected ? null : { rowIndex, zoneId, floorIndex: floor.index })}
                        className={cn(
                          "cursor-pointer border-r border-b border-line px-1.5 py-1.5 text-center group-hover:bg-surface-subtle",
                          tierStart(cellIndex) && "border-l-2 border-l-line-strong",
                          isSelected && "outline outline-2 -outline-offset-2 outline-accent",
                        )}
                      >
                        <PerfValue value={cell?.bestPercent ?? null} />
                        <PerfValue value={cell?.medianPercent ?? null} className="text-[11px]" parenthesize />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && detailData?.row && detailData.cell ? (
        <div
          data-detail-panel
          className="fixed right-6 bottom-6 z-50 w-80 rounded-xl border border-line-strong bg-surface p-3.5 shadow-2xl"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-[12px] font-bold">
              {detailData.row.name}
              <span className="font-normal text-ink-muted">
                {" "}
                / {zoneLabel(detail.zoneId, detailData.tier?.name ?? "")}{" "}
                {detailData.tier?.floors.find((f) => f.index === detail.floorIndex)?.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              aria-label={t.close}
              className="-mt-0.5 -mr-1 rounded px-1.5 text-[14px] leading-none text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-ink-muted">Best</dt>
              <dd className={cn("tabular text-right font-bold", PERF_COLOR_CLASS[perfColor(detailData.cell.bestPercent)])}>
                {formatPercent(detailData.cell.bestPercent)}
              </dd>
              <dt className="text-ink-muted">Med</dt>
              <dd className={cn("tabular text-right font-bold", PERF_COLOR_CLASS[perfColor(detailData.cell.medianPercent)])}>
                {formatPercent(detailData.cell.medianPercent)}
              </dd>
              <dt className="text-ink-muted">{t.kills}</dt>
              <dd className="tabular text-right">{detailData.cell.kills}</dd>
              <dt className="text-ink-muted">{t.bestAmount}</dt>
              <dd className="tabular text-right">{formatAmount(detailData.cell.bestAmount)}</dd>
              <dt className="text-ink-muted">{t.fastestKill}</dt>
              <dd className="tabular text-right">{formatDuration(detailData.cell.fastestKill)}</dd>
              <dt className="text-ink-muted">{t.active}</dt>
              <dd className="tabular text-right">
                {detailData.cell.activePercent != null ? `${detailData.cell.activePercent.toFixed(2)}%` : "–"}
              </dd>
            </dl>
            <div className="mt-2 text-[11px] text-ink-muted">{detailData.cell.encounterNames.join(" + ")}</div>

            {detailData.cell.activePercent == null ? (
              <div className="mt-2">
                <button
                  type="button"
                  className="rounded-md border border-line-strong px-2.5 py-1 text-xs transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                  disabled={
                    !detailData.row.canonicalId ||
                    !(jobOverrides[detail.rowIndex] ?? detailData.row.recruitmentJob) ||
                    activeLoading[`${detail.rowIndex}-${detail.zoneId}-${detail.floorIndex}`]
                  }
                  onClick={() =>
                    onRequestActive({
                      rowIndex: detail.rowIndex,
                      zoneId: detail.zoneId,
                      floorIndex: detail.floorIndex,
                    })
                  }
                >
                  {activeLoading[`${detail.rowIndex}-${detail.zoneId}-${detail.floorIndex}`]
                    ? t.fetchingActive
                    : t.fetchActive}
                </button>
                <div className="mt-1 text-[11px] text-ink-muted">
                  {detailData.cell.activeUnavailableReason ?? t.activeCost}
                </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
