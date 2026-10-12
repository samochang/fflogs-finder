import type { JobId } from "./jobs/jobs.ts";
import { getJob } from "./jobs/jobs.ts";

/**
 * UI の言語。
 *
 * 画面に出る文言はここに集約する。翻訳対象は多くないので、
 * ライブラリを入れずに素朴な辞書で切り替える。
 */
export type Lang = "ja" | "en";

export const LANGS: readonly Lang[] = ["ja", "en"];

export const LANG_LABEL: Record<Lang, string> = { ja: "日本語", en: "English" };

/** リージョン。Lodestone の検索がリージョン別なので、言語とは別に指定する。 */
export type Region = "JP" | "NA" | "EU";

export const REGIONS: readonly Region[] = ["JP", "NA", "EU"];

export const REGION_LABEL: Record<Region, string> = {
  JP: "Japan",
  NA: "North America",
  EU: "Europe",
};

interface Messages {
  appName: string;
  inputLabel: string;
  inputPlaceholder: string;
  compare: string;
  recognised: (count: number) => string;
  fetching: string;
  refresh: string;
  refreshCost: string;
  resultTitle: string;
  resultUnit: (count: number) => string;
  legend: string;
  jobColumn: string;
  jobUnknown: string;
  jobEstimated: string;
  switchJob: string;
  probeNear: string;
  probeAll: string;
  probeCost: (calls: number) => string;
  switchWorldCost: (calls: number) => string;
  guessedFromMembers: (dataCenter: string) => string;
  worldCandidates: string;
  jobIconsMissing: string;
  rateLimited: (minutes: number) => string;
  cached: string;
  fetchedOne: (count: number) => string;
  fetchedSome: string;
  close: string;
  kills: string;
  bestAmount: string;
  fastestKill: string;
  active: string;
  fetchActive: string;
  fetchingActive: string;
  activeCost: string;
  unknownError: string;
  langLabel: string;
  regionLabel: string;
  themeLight: string;
  themeDark: string;
  /** 回復時刻が分かるときだけ「〜まで」を付ける（分からないときに付けると日本語が壊れる） */
  rateAvailable: (people: number, until?: string) => string;
  rateTooLow: (until?: string) => string;
  rateUnknown: string;
}

const JA: Messages = {
  appName: "固定募集スカウター",
  inputLabel: "募集文 / ロドストの URL",
  inputPlaceholder: "募集文の名前のあたり、もしくはロドストの URL を貼り付けてください\n例: MT Rion Aster / ガンブレイカー / Chocobo",
  compare: "比較する",
  recognised: (count) => `✓ ${count}人を認識`,
  fetching: "取得中…",
  refresh: "最新のデータを取得する",
  refreshCost: "（右上の残量が減ります）",
  resultTitle: "比較結果",
  resultUnit: (count) => `${count}人`,
  legend: "上段 Best ／ 下段 (Med)",
  jobColumn: "ログのあるジョブ",
  jobUnknown: "ジョブ不明",
  jobEstimated: "推定",
  switchJob: "ジョブ切替",
  probeNear: "近いロールを調べる",
  probeAll: "全ジョブを調べる",
  probeCost: (calls) => `⚠ 全ジョブを調べると ${calls} 回分のポイントを使います`,
  switchWorldCost: (calls) => `⚠ World を切り替えると ${calls} 回分のポイントを使います`,
  guessedFromMembers: (dataCenter) => `メンバーから ${dataCenter} と推測`,
  worldCandidates: "World 候補",
  jobIconsMissing: "ジョブアイコンは未取得です（`npm run fetch:icons`）",
  rateLimited: (minutes) => `FFLogs の時間あたり上限に達しました（約 ${minutes} 分後に回復）`,
  cached: "キャッシュ済みのデータを表示しています。最新の状態にするには「最新のデータを取得する」を押してください。",
  fetchedOne: (count) => `${count} 人の成績を FFLogs から取得しました。次回以降はキャッシュから表示します。`,
  fetchedSome: "FFLogs に問い合わせました。表示中の成績はキャッシュから出しています。",
  close: "詳細を閉じる",
  kills: "Kills",
  bestAmount: "Best Amount",
  fastestKill: "Fastest Kill",
  active: "Active",
  fetchActive: "Active を取得する",
  fetchingActive: "取得中…",
  activeCost: "FFLogs から追加取得します（残量を使います）",
  unknownError: "不明なエラー",
  langLabel: "言語",
  regionLabel: "リージョン",
  themeLight: "ライトモードに切り替え",
  themeDark: "ダークモードに切り替え",
  rateAvailable: (people, until) =>
    until ? `${until} まであと大体 ${people} 人分取得できます` : `あと大体 ${people} 人分取得できます`,
  rateTooLow: (until) => (until ? `1 人分に足りません（${until} まで）` : "1 人分に足りません"),
  rateUnknown: "残量不明",
};

const EN: Messages = {
  appName: "Static Recruitment Logs Checker",
  inputLabel: "Recruitment post / Lodestone URL",
  inputPlaceholder: "Paste the names from a recruitment post, or a Lodestone URL\nExample: MT Rion Aster / Gunbreaker / Chocobo",
  compare: "Compare",
  recognised: (count) => `✓ ${count} recognised`,
  fetching: "Fetching…",
  refresh: "Fetch latest data",
  refreshCost: "(uses points)",
  resultTitle: "Result",
  resultUnit: (count) => `${count} players`,
  legend: "top Best / bottom (Med)",
  jobColumn: "Jobs with logs",
  jobUnknown: "Job unknown",
  jobEstimated: "estimated",
  switchJob: "Switch job",
  probeNear: "Check likely roles",
  probeAll: "Check all jobs",
  probeCost: (calls) => `⚠ Checking all jobs costs ${calls} calls' worth of points`,
  switchWorldCost: (calls) => `⚠ Switching the world costs ${calls} calls' worth of points`,
  guessedFromMembers: (dataCenter) => `Inferred ${dataCenter} from the other members`,
  worldCandidates: "World candidates",
  jobIconsMissing: "Job icons not downloaded yet (`npm run fetch:icons`)",
  rateLimited: (minutes) => `FFLogs hourly limit reached (resets in about ${minutes} min)`,
  cached: "Showing cached data. Press “Fetch latest data” to refresh.",
  fetchedOne: (count) => `Fetched logs for ${count} players from FFLogs. Cached from now on.`,
  fetchedSome: "Queried FFLogs. The logs shown come from cache.",
  close: "Close details",
  kills: "Kills",
  bestAmount: "Best Amount",
  fastestKill: "Fastest Kill",
  active: "Active",
  fetchActive: "Fetch Active",
  fetchingActive: "Fetching…",
  activeCost: "Fetches from FFLogs (uses points)",
  unknownError: "Unknown error",
  langLabel: "Language",
  regionLabel: "Region",
  themeLight: "Switch to light mode",
  themeDark: "Switch to dark mode",
  rateAvailable: (people, until) =>
    until ? `About ${people} more players until ${until}` : `About ${people} more players available`,
  rateTooLow: (until) => (until ? `Not enough for one more player (until ${until})` : "Not enough for one more player"),
  rateUnknown: "Availability unknown",
};

const MESSAGES: Record<Lang, Messages> = { ja: JA, en: EN };

export function messages(lang: Lang): Messages {
  return MESSAGES[lang];
}

/** ジョブ名。日本語 UI では日本語名、英語 UI では英語名。 */
export function jobName(lang: Lang, jobId: JobId): string {
  const job = getJob(jobId);
  return lang === "ja" ? job.nameJa : job.nameEn;
}

/** アイコンが無いときの代替表示（3 文字略称）。 */
export function jobAbbr(jobId: JobId): string {
  return getJob(jobId).abbr;
}
