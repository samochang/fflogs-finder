import { buildAliasIndex, normalizeAliasText, type AliasKind, type JobAlias } from "./aliases.ts";
import type { JobId } from "./jobs.ts";

/**
 * 文字列中からジョブ表記を検出する。
 *
 * 仕様 §6 のとおり、1文字略称の全文検索は禁止。
 * 検出した別名が「募集枠らしい構造」の中にあるかを必ず判定し、
 * 曖昧な別名はその構造の中でのみ採用する。
 *
 * 実際の募集文では「モ＞竜」「竜orヴ」「黒>ピ」のように
 * 「メインジョブ ＞ 着替え可能ジョブ」の連鎖が書かれるため、
 * 連鎖の区切りも「トークンの境界」として扱う。
 */

export type Confidence = "high" | "medium" | "low";

export interface JobMention {
  jobId: JobId;
  /** 一致した表記（正規化後） */
  alias: string;
  start: number;
  /** 半開区間 [start, end) */
  end: number;
  kind: AliasKind;
  ambiguous: boolean;
  /** 募集枠らしい構造（行頭 / ポジション隣接 / 名前と対）の中にあったか */
  slotContext: boolean;
  confidence: Confidence;
}

const INDEX = buildAliasIndex();

/** 単語境界が必要な別名（英略称）の前後判定。 */
const WORD_CHAR = /[A-Za-z0-9_]/;

/** ジョブ連鎖の区切り。着替え可を示す表現を含む。 */
const CHAIN_CONNECTOR = /^(?:or|OR|Or|または|もしくは|＞|>|≧|→|⇒)/;
const CHAIN_CONNECTOR_BEFORE = /(?:or|OR|Or|または|もしくは|＞|>|≧|→|⇒)$/;

/** 「モ＞竜」のような連鎖の隙間として許される文字列。 */
const CHAIN_GAP = /^[\s,、/／|｜・]*(?:(?:or|OR|Or|または|もしくは|＞|>|≧|→|⇒)[\s,、/／|｜・]*)*$/;

function isWordBoundaryBefore(text: string, index: number): boolean {
  if (index === 0) return true;
  return !WORD_CHAR.test(text[index - 1]!);
}

function isWordBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !WORD_CHAR.test(text[index]!);
}

const SEPARATORS = new Set([
  " ", "\t", "/", "／", "|", "｜", ",", "、", ":", "：", "(", ")", "（", "）",
  "[", "]", "【", "】", "・", "･", ">", "＞", "<", "＜", "-", "ー", "ｰ", "!", "！",
  "※", "★", "☆", "●", "○", "■", "□", "◆", "◇", "▲", "△", "▼", "▽", "✒", "✎",
]);

function isSeparator(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return SEPARATORS.has(ch) || /\s/.test(ch);
}

/** 直前がトークン境界か（区切り文字 or 連鎖コネクタの直後）。 */
function isBoundaryBefore(text: string, start: number): boolean {
  if (start === 0) return true;
  const ch = text[start - 1]!;
  if (isSeparator(ch)) return true;
  return CHAIN_CONNECTOR_BEFORE.test(text.slice(Math.max(0, start - 6), start));
}

/** 直後がトークン境界か（区切り文字 or 連鎖コネクタの直前）。 */
function isBoundaryAfter(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const ch = text[end]!;
  if (isSeparator(ch)) return true;
  return CHAIN_CONNECTOR.test(text.slice(end, end + 6));
}

/**
 * 1文字略称が「独立したトークン」として現れているか。
 * 例: 「赤 ○○○○」の赤は OK、「赤魔道士」の中の赤は NG、「竜orヴ」の竜は OK。
 */
function isStandaloneToken(text: string, start: number, end: number): boolean {
  return isBoundaryBefore(text, start) && isBoundaryAfter(text, end);
}

const NAME_LIKE = /[A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)*/;

/**
 * 一致位置が募集枠らしいかどうかを判定する。
 *
 * 手掛かり:
 *  - 別名の直前/直後に区切りがある（トークンとして独立している）
 *  - ポジション表記（MT/ST/H1/H2/D1〜D4）が直前に並んでいる
 *  - 直後にキャラクター名らしい文字列が続く / 直前に名前らしい文字列がある
 *  - 行全体がほぼジョブ表記だけ
 */
export function isSlotContext(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndIdx = text.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const relStart = start - lineStart;
  const relEnd = end - lineStart;

  const before = line.slice(0, relStart);
  const after = line.slice(relEnd);

  // 行全体がジョブ表記（前後の空白のみ）
  if (before.trim() === "" && after.trim() === "") return true;

  const standalone = isStandaloneToken(text, start, end);
  if (!standalone) return false;

  // 直前にポジション表記（MT / ST: / D4 / MTorST 等）
  if (/(?:^|[\s/／|｜,、:：])?(?:MT|ST|OT|H[12]|D[1-4]|T[12]|PH|BH|DPS)(?:\s*(?:or|OR|または|／|\/|＞|>)\s*(?:MT|ST|OT|H[12]|D[1-4]|DPS))*\s*[:：]?\s*$/i.test(before)) {
    return true;
  }

  // 直後に名前らしい文字列
  if (new RegExp(`^\\s*(?:[:：>＞≧→⇒]|or|OR)?\\s*${NAME_LIKE.source}\\s*$`).test(after)) return true;

  // 直前に名前らしい文字列
  if (new RegExp(`(?:^|\\s)${NAME_LIKE.source}\\s*$`).test(before)) return true;

  // 区切りで囲まれた独立トークン（例: "Name / 鎌 / World"）
  const segBefore = before.split(/[./／|｜,、:：\t]/).pop() ?? "";
  const segAfter = after.split(/[/／|｜,、:：\t]/)[0] ?? "";
  if (segBefore.trim() === "" || segAfter.trim() === "") return true;

  return false;
}

function scoreConfidence(alias: JobAlias, slotContext: boolean): Confidence {
  if (!slotContext) return "low";
  if (alias.kind === "fullName" && !alias.ambiguous) return "high";
  if (!alias.ambiguous) return "medium";
  return "medium";
}

/**
 * 文字列からジョブ表記を検出する（最長一致）。
 * `text` は NFKC 正規化済みであることを前提とする。
 */
export function scanJobMentions(text: string, options: { requireSlotContext?: boolean } = {}): JobMention[] {
  const normalized = normalizeAliasText(text);
  const mentions: JobMention[] = [];

  let i = 0;
  while (i < normalized.length) {
    const candidates = INDEX.byFirstChar.get(normalized[i]!);
    if (!candidates) {
      i += 1;
      continue;
    }

    let matched: JobAlias | undefined;
    for (const alias of candidates) {
      if (normalized.startsWith(alias.text, i)) {
        matched = alias;
        break;
      }
    }
    if (!matched) {
      i += 1;
      continue;
    }

    const end = i + matched.text.length;

    // 英略称は「単語境界」かつ「大文字表記」を要求する。
    // 例: "SAM" は OK だが、キャラクター名 "Sam Fisher" は一致させない。
    if (matched.kind === "enAbbrev") {
      if (!(isWordBoundaryBefore(normalized, i) && isWordBoundaryAfter(normalized, end))) {
        i += 1;
        continue;
      }
      const raw = text.slice(i, end);
      if (raw !== raw.toUpperCase()) {
        i += 1;
        continue;
      }
    }

    // 1文字略称は独立トークンであることを要求する
    if (matched.ambiguous && !isStandaloneToken(normalized, i, end)) {
      i += 1;
      continue;
    }

    const slotContext = isSlotContext(normalized, i, end);
    if (options.requireSlotContext && !slotContext && matched.ambiguous) {
      i += 1;
      continue;
    }

    mentions.push({
      jobId: matched.jobId,
      alias: matched.text,
      start: i,
      end,
      kind: matched.kind,
      ambiguous: matched.ambiguous,
      slotContext,
      confidence: scoreConfidence(matched, slotContext),
    });

    i = end;
  }

  return mentions;
}

export interface JobChain {
  /** 連鎖の先頭 = メイン（募集）ジョブ */
  primary: JobMention;
  /** 「モ＞竜」の竜など、着替え可能として併記されたジョブ */
  alternates: JobMention[];
  /** 連鎖全体が占める範囲（名前抽出時に取り除く） */
  span: { start: number; end: number };
}

/**
 * 「モ＞竜」「竜orヴ」のようなジョブ連鎖を、最も左にあるものから 1 つ取り出す。
 * 連鎖の先頭を募集ジョブとして扱う（仕様 §10: ランキング取得の基準は募集ジョブ）。
 */
export function findJobChain(text: string, mentions: readonly JobMention[]): JobChain | undefined {
  if (mentions.length === 0) return undefined;

  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const primary = sorted[0]!;
  const chain: JobMention[] = [primary];
  let end = primary.end;

  for (const next of sorted.slice(1)) {
    const gap = text.slice(end, next.start);
    if (!CHAIN_GAP.test(gap)) break;
    chain.push(next);
    end = next.end;
  }

  return {
    primary,
    alternates: chain.slice(1),
    span: { start: primary.start, end },
  };
}

/** ジョブ表記とその連鎖コネクタを文字列から取り除く。 */
export function stripJobMentions(text: string, mentions: readonly JobMention[]): string {
  if (mentions.length === 0) return text;
  const sorted = [...mentions].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of sorted) {
    out = `${out.slice(0, m.start)} ${out.slice(m.end)}`;
  }
  return out
    .replace(/(?:^|[\s,、/／|｜・])(?:or|OR|または|もしくは)(?=[\s,、/／|｜・]|$)/g, " ")
    .replace(/[>＞≧→⇒]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
