/**
 * FFLogs の parse color（仕様 §23）。
 *
 * FFLogs の一般的なしきい値:
 *   gold   100
 *   pink   99
 *   orange 95–98
 *   purple 75–94
 *   blue   50–74
 *   green  25–49
 *   gray   0–24
 *
 * 色は CSS 変数（--perf-*）として `globals.css` に定義し、ライト / ダークで出し分ける。
 * FFLogs 標準の green (#1eff00) はライトモードの白背景ではコントラストが低いため、
 * ライトモードのみ暗めの緑を使う。
 */

export type PerfColor = "gray" | "green" | "blue" | "purple" | "orange" | "pink" | "gold";

/** FFLogs 標準のパレット（ダークモードの基準値）。 */
export const PERF_COLORS: Record<PerfColor, string> = {
  gray: "#9aa4b2",
  green: "#1eff00",
  blue: "#0070ff",
  purple: "#a335ee",
  orange: "#ff8000",
  pink: "#e268a8",
  gold: "#e5cc80",
};

/**
 * ライトモード用のパレット。
 * 明るい緑・金は白背景で読みにくいため、緑は特に暗くしている。
 */
export const PERF_COLORS_LIGHT: Record<PerfColor, string> = {
  gray: "#6b7280",
  green: "#1a9e00",
  blue: "#0060dd",
  purple: "#8f2fd0",
  orange: "#d96700",
  pink: "#c2417f",
  gold: "#a8892c",
};

/**
 * Perf 色に対応する Tailwind クラス。
 *
 * Tailwind は静的な文字列しか拾えないため、`text-perf-${color}` のような
 * 動的生成はしない。ここにリテラルで並べておく。
 */
export const PERF_COLOR_CLASS: Record<PerfColor, string> = {
  gray: "text-perf-gray",
  green: "text-perf-green",
  blue: "text-perf-blue",
  purple: "text-perf-purple",
  orange: "text-perf-orange",
  pink: "text-perf-pink",
  gold: "text-perf-gold",
};

export const PERF_LABELS: Record<PerfColor, string> = {
  gray: "gray (0–24)",
  green: "green (25–49)",
  blue: "blue (50–74)",
  purple: "purple (75–94)",
  orange: "orange (95–98)",
  pink: "pink (99)",
  gold: "gold (100)",
};

export function perfColor(value: number | null | undefined): PerfColor {
  if (value === null || value === undefined || Number.isNaN(value)) return "gray";
  if (value >= 100) return "gold";
  if (value >= 99) return "pink";
  if (value >= 95) return "orange";
  if (value >= 75) return "purple";
  if (value >= 50) return "blue";
  if (value >= 25) return "green";
  return "gray";
}

/** 表示用に丸める（FFLogs UI と同じく整数表示）。 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return String(Math.round(value));
}

/**
 * 下段（Median）用の整形。
 *
 * 上段 Best と見分けが付くよう、値があるときだけ括弧で囲む。
 * 欠損は括弧を付けず「–」のままにする。
 */
export function formatPercentParenthesized(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return `(${Math.round(value)})`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) return "–";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "–";
  return Math.round(value).toLocaleString("ja-JP");
}
