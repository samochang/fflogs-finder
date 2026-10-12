import type { JobId } from "./jobs.ts";

/**
 * ジョブ表記の別名辞書。
 *
 * 日本語圏の固定募集で実際に使われる表記を主軸にし、英略称は補助として扱う（仕様 §4.2 / §5）。
 * ジョブごとに配列を分けてあるので表記ゆれの追加は該当行に足すだけでよい。
 */

export type AliasKind =
  /** 正式名称・明確なジョブ名（仕様 §8 優先度2） */
  | "fullName"
  /** 日本語の略称・俗称（優先度3） */
  | "jaShort"
  /** 英略称（優先度4） */
  | "enAbbrev";

export interface JobAlias {
  /** 正規化後の比較文字列（NFKC + 小文字化） */
  text: string;
  jobId: JobId;
  kind: AliasKind;
  /**
   * 1文字略称など、通常の文章にも出現しうる表記。
   * true の別名は「募集枠らしい構造」の中でのみ採用する（仕様 §6）。
   */
  ambiguous: boolean;
}

interface AliasSpec {
  jobId: JobId;
  fullName?: string[];
  jaShort?: string[];
  enAbbrev?: string[];
}

const SPECS: readonly AliasSpec[] = [
  { jobId: "paladin", fullName: ["ナイト"], jaShort: ["ナ", "パラ"], enAbbrev: ["PLD"] },
  { jobId: "warrior", fullName: ["戦士"], jaShort: ["戦", "ウォ"], enAbbrev: ["WAR"] },
  { jobId: "darkKnight", fullName: ["暗黒騎士", "暗黒"], jaShort: ["暗"], enAbbrev: ["DRK"] },
  { jobId: "gunbreaker", fullName: ["ガンブレイカー"], jaShort: ["ガンブレ", "ガン", "ガ"], enAbbrev: ["GNB"] },

  { jobId: "whiteMage", fullName: ["白魔道士", "白魔"], jaShort: ["白"], enAbbrev: ["WHM"] },
  { jobId: "scholar", fullName: ["学者"], jaShort: ["学"], enAbbrev: ["SCH"] },
  { jobId: "astrologian", fullName: ["占星術師", "占星"], jaShort: ["占"], enAbbrev: ["AST"] },
  { jobId: "sage", fullName: ["賢者"], jaShort: ["賢"], enAbbrev: ["SGE", "SAG"] },

  { jobId: "monk", fullName: ["モンク"], jaShort: ["モ"], enAbbrev: ["MNK"] },
  { jobId: "dragoon", fullName: ["竜騎士"], jaShort: ["竜"], enAbbrev: ["DRG"] },
  { jobId: "ninja", fullName: ["忍者"], jaShort: ["忍"], enAbbrev: ["NIN"] },
  { jobId: "samurai", fullName: ["侍"], enAbbrev: ["SAM"] },
  { jobId: "reaper", fullName: ["リーパー"], jaShort: ["鎌", "リ"], enAbbrev: ["RPR"] },
  { jobId: "viper", fullName: ["ヴァイパー"], jaShort: ["ヴァ", "ヴィ", "ヴ"], enAbbrev: ["VPR"] },

  { jobId: "bard", fullName: ["吟遊詩人", "吟遊", "詩人"], jaShort: ["詩"], enAbbrev: ["BRD"] },
  { jobId: "machinist", fullName: ["機工士", "機工"], jaShort: ["機"], enAbbrev: ["MCH"] },
  { jobId: "dancer", fullName: ["踊り子", "踊り"], jaShort: ["踊"], enAbbrev: ["DNC"] },

  { jobId: "blackMage", fullName: ["黒魔道士", "黒魔"], jaShort: ["黒"], enAbbrev: ["BLM"] },
  { jobId: "summoner", fullName: ["召喚士", "召喚"], jaShort: ["召"], enAbbrev: ["SMN"] },
  { jobId: "redMage", fullName: ["赤魔道士", "赤魔"], jaShort: ["赤"], enAbbrev: ["RDM"] },
  { jobId: "pictomancer", fullName: ["ピクトマンサー", "ピクト"], jaShort: ["筆", "ピ"], enAbbrev: ["PCT"] },
];

/** 1文字の別名はすべて ambiguous として扱う（仕様 §6）。 */
function isAmbiguous(text: string, kind: AliasKind): boolean {
  if (kind === "enAbbrev") return false;
  return [...text].length <= 1;
}

/** NFKC 正規化 + 小文字化。全角英数・半角カナのゆれを吸収する。 */
export function normalizeAliasText(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}

export const JOB_ALIASES: readonly JobAlias[] = SPECS.flatMap((spec) => {
  const out: JobAlias[] = [];
  for (const [kind, list] of [
    ["fullName", spec.fullName],
    ["jaShort", spec.jaShort],
    ["enAbbrev", spec.enAbbrev],
  ] as const) {
    for (const raw of list ?? []) {
      const text = normalizeAliasText(raw);
      out.push({ text, jobId: spec.jobId, kind, ambiguous: isAmbiguous(text, kind) });
    }
  }
  return out;
});

/**
 * 最長一致で走査するためのインデックス。
 * 例: "リーパー" は "リ" より先に一致させる必要がある。
 */
export interface AliasIndex {
  /** 先頭文字 -> その文字で始まる別名（長い順） */
  byFirstChar: Map<string, JobAlias[]>;
  /** 最長の別名長（文字数） */
  maxLength: number;
}

/** コードポイント単位の文字数。 */
export function charLength(text: string): number {
  return [...text].length;
}

export function buildAliasIndex(aliases: readonly JobAlias[] = JOB_ALIASES): AliasIndex {
  const byFirstChar = new Map<string, JobAlias[]>();
  for (const alias of aliases) {
    const first = [...alias.text][0];
    if (!first) continue;
    const list = byFirstChar.get(first) ?? [];
    list.push(alias);
    byFirstChar.set(first, list);
  }
  let maxLength = 0;
  for (const list of byFirstChar.values()) {
    list.sort((a, b) => charLength(b.text) - charLength(a.text));
    maxLength = Math.max(maxLength, charLength(list[0]?.text ?? ""));
  }
  return { byFirstChar, maxLength };
}

/**
 * 同一文字列が複数ジョブに割り当てられていないか検証する。
 * 辞書を編集したときに取り違えを早期検出するためのガード。
 */
export function findAliasConflicts(aliases: readonly JobAlias[] = JOB_ALIASES): Map<string, JobId[]> {
  const byText = new Map<string, Set<JobId>>();
  for (const alias of aliases) {
    const set = byText.get(alias.text) ?? new Set<JobId>();
    set.add(alias.jobId);
    byText.set(alias.text, set);
  }
  const conflicts = new Map<string, JobId[]>();
  for (const [text, jobs] of byText) {
    if (jobs.size > 1) conflicts.set(text, [...jobs]);
  }
  return conflicts;
}
