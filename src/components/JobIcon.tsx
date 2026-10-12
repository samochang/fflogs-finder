"use client";

import { useState } from "react";
import {
  ROLE_COLORS,
  getJob,
  jobPickerOrder,
  positionRoles,
  roleColor,
  type JobId,
} from "@/lib/jobs/jobs.ts";
import { cn } from "@/lib/utils.ts";
import { useMessages, useSettings } from "./settings/settings-provider.tsx";
import { LANGS, REGIONS, LANG_LABEL, jobName, type Region } from "@/lib/i18n.ts";
import { RateLimitBadge, type RateLimitState } from "./RateLimitBadge.tsx";
import { ThemeToggle } from "./theme/theme-toggle.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  healer: "ヒーラー",
  melee: "近接DPS",
  ranged: "遠隔物理DPS",
  caster: "キャスター",
};

/**
 * ジョブアイコン。
 *
 * アイコン画像は FF14 のゲーム内アセットなので**リポジトリに含めていない**。
 * `npm run fetch:icons` で取得する。無い場合は 3 文字略称を出す。
 */
export function JobIcon({ jobId, size = 30, title }: { jobId: JobId; size?: number; title?: string }) {
  const job = getJob(jobId);
  const { lang } = useSettings();
  const [missing, setMissing] = useState(false);
  const label = title ?? `${jobName(lang, job.id)} (${job.abbr})`;

  if (missing) {
    return (
      <span
        title={label}
        className="inline-grid place-items-center rounded-[5px] font-bold text-white"
        style={{ background: roleColor(jobId), width: size, height: size, fontSize: size * 0.32, lineHeight: 1 }}
      >
        {job.abbr}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/jobs/${job.id}.png`}
      alt={job.abbr}
      title={label}
      width={size}
      height={size}
      onError={() => setMissing(true)}
      className="rounded-[5px] border border-line-strong bg-surface"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * 表の行頭に出すジョブアイコン。
 * mock.png に合わせてロール色の角丸四角に白抜きのアイコンを載せる。
 */
export function RoleJobIcon({ jobId, size = 30 }: { jobId: JobId; size?: number }) {
  const job = getJob(jobId);
  const [missing, setMissing] = useState(false);
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-[6px] font-bold text-white"
      style={{ background: roleColor(jobId), width: size, height: size, fontSize: size * 0.34, lineHeight: 1 }}
    >
      {missing ? (
        job.abbr
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/jobs/${job.id}.png`}
          alt={job.abbr}
          width={size}
          height={size}
          onError={() => setMissing(true)}
          className="brightness-0 invert"
          style={{ width: size * 0.8, height: size * 0.8 }}
        />
      )}
    </span>
  );
}

/**
 * ジョブ不明の枠。
 * ポジションからロールが決まるなら他行と同じサイズ・同じロール色で「？」を出す。
 */
export function UnknownJobIcon({
  position,
  fallbackJob,
  label,
  size = 30,
}: {
  position?: string;
  /** ポジションからロールが決まらないときに色を借りるジョブ（ログがあったもの） */
  fallbackJob?: JobId | null;
  label?: string;
  size?: number;
}) {
  const roles = positionRoles(position);
  // 候補ロールの色がすべて同じならその色を使う（D1〜D4 は近接/遠隔/キャスターだが全て DPS の赤）
  const positionColors = new Set(roles.map((role) => ROLE_COLORS[role]));
  // ポジションで色が決まらないときは、ログがあったジョブの色を借りる
  const color =
    positionColors.size === 1 ? [...positionColors][0]! : fallbackJob ? roleColor(fallbackJob) : "var(--role-unknown)";
  const known = positionColors.size === 1 || Boolean(fallbackJob);
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-[6px] font-bold text-white"
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: size * 0.5,
        lineHeight: 1,
      }}
      title={`${label ?? ""} ${position ?? ""}`.trim()}
    >
      ？
    </span>
  );
}

/**
 * 行頭のジョブアイコン。押すと切り替え候補を出す。
 *
 * 切り替え候補が無い（＝他ジョブのログが無いと分かっている）場合は開かない。
 * ポップオーバーは Portal で body 直下に出るため、表のスクロール領域で切れたり
 * 行の高さが変わったりしない。
 */
export function JobIconButton({
  currentJob,
  position,
  jobs,
  loading,
  estimatedMismatch,
  fullyScanned,
  remainingJobs,
  probeError,
  onProbe,
  onProbeMore,
  onSelect,
}: {
  currentJob: JobId | null;
  position?: string;
  /** ログがあると分かっているジョブ（いま表示しているジョブも含む） */
  jobs?: JobId[];
  loading: boolean;
  /**
   * 募集ポジションと違うロールのジョブを「推定」で当てた状態。
   * 例: ST 募集だがタンクのログが無く、ヴァイパーを推定採用した。
   */
  estimatedMismatch?: boolean;
  /** 全 21 ジョブを調べ終えたか（false なら取り漏らしの可能性がある） */
  fullyScanned?: boolean;
  /** まだ調べていないジョブ数（全ジョブ走査のコスト表示に使う） */
  remainingJobs?: number;
  /** 追加探索に失敗した理由 */
  probeError?: string;
  onProbe: () => void;
  /** 追加探索。exhaustive=true なら残り全部を最後まで調べる */
  onProbeMore: (exhaustive: boolean) => void;
  onSelect: (jobId: JobId) => void;
}) {
  const t = useMessages();
  const { lang } = useSettings();
  const [open, setOpen] = useState(false);

  // 一覧には「いま表示しているジョブ」も含める（選択中として強調される）。
  // ただし切り替え先が無い（= そのジョブしかログが無い）なら開かせない。
  const found = jobs ?? [];
  const hasOther = found.some((id) => id !== currentJob);
  const selectable = currentJob === null ? (found.length > 0 ? found : jobPickerOrder(position)) : found;
  const canOpen = currentJob === null || hasOther;

  return (
    <Popover
      open={open && canOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onProbe();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative shrink-0 rounded-[7px] p-0.5 transition-colors",
            canOpen ? "hover:bg-surface-subtle" : "cursor-default",
          )}
          aria-label={currentJob ? `${getJob(currentJob).nameJa} — 他のジョブに切り替え` : "ジョブを選択"}
        >
          {currentJob ? (
            <RoleJobIcon jobId={currentJob} />
          ) : (
            <UnknownJobIcon position={position} fallbackJob={found[0] ?? null} />
          )}
          {canOpen || loading ? (
            <span className="absolute -right-1.5 -bottom-1 rounded-[3px] border border-line bg-surface px-0.5 text-[9px] leading-tight text-ink-muted">
              {loading ? "…" : "▾"}
            </span>
          ) : null}
          {estimatedMismatch ? (
            <span
              className="absolute -top-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-500 text-[9px] font-bold text-white shadow-sm"
              title={t.jobEstimated}
            >
              ？
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto">
        <div className="mb-1.5 text-[11px] text-ink-muted">{t.switchJob}</div>
        {loading ? (
          <div className="py-1 text-xs text-ink-muted">{t.fetching}</div>
        ) : selectable.length === 0 ? (
          <div className="py-1 text-xs text-ink-muted">—</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectable.map((jobId) => (
              <button
                key={jobId}
                type="button"
                aria-pressed={jobId === currentJob}
                onClick={() => {
                  onSelect(jobId);
                  setOpen(false);
                }}
                className={cn(
                  "rounded-[7px] border-2 p-0 transition-colors",
                  jobId === currentJob ? "border-accent" : "border-transparent hover:border-line-strong",
                )}
              >
                <JobIcon jobId={jobId} size={28} />
              </button>
            ))}
          </div>
        )}

        {probeError ? (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-tight text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {probeError}
          </div>
        ) : null}

        {fullyScanned ? (
          <div className="mt-2 border-t border-line pt-1.5 text-[10px] leading-tight text-ink-muted">
            全ジョブを確認済みです（取り漏らしはありません）
          </div>
        ) : (
          <div className="mt-2 border-t border-line pt-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onProbeMore(false)}
                disabled={loading}
                className="rounded-md border border-line-strong px-2 py-1 text-[11px] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loading ? t.fetching : t.probeNear}
              </button>
              <button
                type="button"
                onClick={() => onProbeMore(true)}
                disabled={loading}
                className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
              >
                {t.probeAll}
              </button>
            </div>
            {remainingJobs ? (
              <div className="mt-1 text-[10px] leading-tight font-bold text-amber-700 dark:text-amber-300">
                {t.probeCost(remainingJobs)}
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Header({ rate }: { rate?: RateLimitState }) {
  const t = useMessages();
  const { lang, region, setLang, setRegion } = useSettings();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-2.5">
      <h1 className="min-w-0 truncate text-[17px] font-bold">{t.appName}</h1>

      <div className="flex shrink-0 items-center gap-3.5">
        <RateLimitBadge rate={rate} />

        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <span className="sr-only">{t.langLabel}</span>
          <select
            value={lang}
            onChange={(event) => setLang(event.target.value as "ja" | "en")}
            aria-label={t.langLabel}
            className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-[11px] text-ink"
          >
            {LANGS.map((value) => (
              <option key={value} value={value}>
                {LANG_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <span className="sr-only">{t.regionLabel}</span>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value as Region)}
            aria-label={t.regionLabel}
            title={t.regionLabel}
            className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-[11px] text-ink"
          >
            {REGIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <ThemeToggle />
      </div>
    </header>
  );
}
