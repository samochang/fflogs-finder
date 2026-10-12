"use client";

import { useEffect, useRef, useState } from "react";
import { POINTS_PER_CHARACTER, peopleFromPoints } from "@/lib/fflogs/costs.ts";
import { cn } from "@/lib/utils.ts";
import { useMessages } from "./settings/settings-provider.tsx";



export interface RateLimitState {
  pointsSpentThisHour: number;
  limitPerHour: number;
  remaining: number;
  /** points を観測した時刻（ISO） */
  observedAt?: string;
  /** 観測時点での回復までの秒数 */
  pointsResetIn?: number;
}

/**
 * レート制限の残量を右上に出す。
 *
 * ユーザーに意味があるのは「いつまでに何人が取れるか」だけなので、
 * 内部の points や単価は出さずに「人分」に換算して見せる。
 */
export function RateLimitBadge({ rate }: { rate?: RateLimitState }) {
  const t = useMessages();
  const [now, setNow] = useState(() => Date.now());
  /** 消費が動いた瞬間に光らせる */
  const [flash, setFlash] = useState(false);
  const previousSpent = useRef<number | undefined>(rate?.pointsSpentThisHour);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const spentNow = rate?.pointsSpentThisHour;
  useEffect(() => {
    if (spentNow === undefined || spentNow === previousSpent.current) return;
    previousSpent.current = spentNow;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1500);
    return () => window.clearTimeout(id);
  }, [spentNow]);

  if (!rate) {
    return <span className="text-[11px] text-ink-muted">{t.rateUnknown}</span>;
  }

  const observedMs = rate.observedAt ? Date.parse(rate.observedAt) : now;
  const elapsedSec = Math.max(0, (now - observedMs) / 1000);
  const resetIn = rate.pointsResetIn !== undefined ? Math.max(0, rate.pointsResetIn - elapsedSec) : undefined;

  // 回復時間を過ぎていれば、この時間枠の消費は無くなっている
  const rolled = resetIn !== undefined && resetIn <= 0;
  const spent = rolled ? 0 : rate.pointsSpentThisHour;
  const remaining = Math.max(0, rate.limitPerHour - spent);
  const ratio = rate.limitPerHour > 0 ? remaining / rate.limitPerHour : 0;

  const characters = peopleFromPoints(remaining);

  const tone =
    ratio > 0.5
      ? { bar: "bg-emerald-500", text: "text-ink-muted" }
      : ratio > 0.2
        ? { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" }
        : { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" };

  // 「HH:MM まであと大体 N 回叩けます」に使う回復時刻
  const resetAt =
    resetIn === undefined || resetIn <= 0
      ? undefined
      : new Date(now + resetIn * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={cn(
        "w-[212px] select-none rounded-md px-1.5 py-1 transition-colors duration-700",
        flash && "bg-accent/10",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
          <div
            className={cn("h-full rounded-full transition-[width,background-color] duration-700 ease-out", tone.bar)}
            style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
          />
        </div>
        <span className={cn("text-[10px] tabular", tone.text)}>{Math.round(ratio * 100)}%</span>
      </div>

      <div className={cn("mt-1 text-[10px] leading-tight whitespace-nowrap", tone.text)}>
        <span className="font-bold tabular">
          {characters > 0 ? t.rateAvailable(characters, resetAt) : t.rateTooLow(resetAt)}
        </span>
      </div>
    </div>
  );
}
