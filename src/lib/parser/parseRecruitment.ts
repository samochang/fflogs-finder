import { findJobChain, scanJobMentions, stripJobMentions, type Confidence, type JobMention } from "../jobs/match.ts";
import type { JobId } from "../jobs/jobs.ts";
import { lookupWorldStatic, type WorldRef } from "./worlds.ts";

/**
 * 固定募集文のパーサ（仕様 §4〜§9）。
 *
 * 方針:
 *  - 完全な自然言語解析はしない。辞書 + 募集枠らしい構造で判定する。
 *  - キャラクター情報と募集情報を分離して保持する（仕様 §9）。
 *  - ジョブ判定が曖昧な場合は confidence を下げ、UI で確定/曖昧を区別できるようにする（仕様 §8）。
 *
 * 実際の募集文はフォーマットが毎回異なるため、キーワードで行を捨てるのではなく
 * 「キャラクター名らしい英字トークンが取れるか」で最終判定する。
 *
 * 対応する実例:
 *   `✒MT：暗 Raye Skystriker：絶テマ/アレキ/エデン(学)済`
 *   `・D1orD2　竜orヴ：Vega XIII　6絶（最初から）※固定主`
 *   `MT：Ameya Candy 暗＞ナ（7絶）`
 *   `H2：Mikna Cotrne 学＞賢（4絶　アレキ、アルテマ、バハ、ケフカ）`
 *   `DPS：Rike Nerisiso モ＞竜（4絶　...）`
 *   `ST： Wata Gasi(6絶　ケフカ以外済)`
 */

/** MT/ST/H1/H2/D1〜D4 と、その「or」複合表記。 */
const POSITION_ATOM = "MT|ST|OT|H[12]|D[1-4]|T[12]|PH|BH|DPS|TANK|HEAL|HEALER";
const POSITION_JOIN = "\\s*(?:or|OR|または|もしくは|／|/|＞|>|≧)\\s*";
const POSITION_HEAD_RE = new RegExp(`^(?:${POSITION_ATOM})(?:${POSITION_JOIN}(?:${POSITION_ATOM}))*$`, "i");
const POSITION_SPACE_RE = new RegExp(`^((?:${POSITION_ATOM})(?:${POSITION_JOIN}(?:${POSITION_ATOM}))*)\\s+`, "i");

export interface ParsedCharacter {
  /** 表示用キャラクター名（正規化後） */
  name: string;
  world?: string;
  /** FFLogs の serverSlug に解決できた場合 */
  worldSlug?: string;
  worldRegion?: string;
  /** 募集で指定されたジョブ。キャラのメインジョブではない（仕様 §9） */
  recruitmentJob?: JobId;
  recruitmentJobAlias?: string;
  recruitmentJobConfidence?: Confidence;
  /**
   * 「モ＞竜」「竜orヴ」のように着替え可として併記されたジョブ。
   * 表示には使わないが、パース結果として保持する。
   */
  recruitmentJobAlternates?: JobId[];
  /** 判定が曖昧 → UI でユーザーに確認させる候補 */
  recruitmentJobAmbiguous: boolean;
  recruitmentPosition?: string;
  /** 募集文に Lodestone のキャラクター URL があればその ID */
  lodestoneId?: number;
  /** 元の行（正規化前のプレーンテキスト） */
  rawLine: string;
  lineNumber: number;
}

export interface ParseWarning {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface ParseResult {
  characters: ParsedCharacter[];
  warnings: ParseWarning[];
  /** 認識した行数 / 全体行数 */
  stats: { totalLines: number; candidateLines: number; dropped: number };
}

const MAX_CHARACTERS = 8;

/** 区切り文字。ASCII スペースは名前の区切りに使われるため含めない。 */
const SEGMENT_SPLIT_RE = /[\/／|｜,、:：\t　]+|@|＠/;

/** URL はキャラクター名ではないので、名前抽出の前に取り除く。 */
const URL_RE = /https?:\/\/\S+/g;

/** 全角・半角の括弧で囲まれた注記（クリア済コンテンツなど）。 */
const PAREN_RE = /[（(][^（()）]*[）)]/g;

/** ここから末尾までは注記（固定主・相談事項など）。 */
const NOTE_MARKERS = /[※＊*✎]/;

const PLACEHOLDER_RE = /^[○◯△▲□■×✕✖●◎◇◆▽▼\s]+$/;

/** FF14 のキャラクター名は英字（+ ハイフン/アポストロフィ）。 */
const NAME_RE = /^[A-Za-z][A-Za-z'\-]{0,14}(?:\s+[A-Za-z][A-Za-z'\-]{0,14}){1,2}$/;
/** ポジション表記を伴う募集枠では 1 語の名前も許容する（例: "MT AAAA"）。 */
const SINGLE_WORD_NAME_RE = /^[A-Za-z][A-Za-z'\-]{2,14}$/;

/** 名前ではないと分かっている語（募集状態の説明）。 */
const NOT_A_NAME = /^(募集中|対応中|未定|調整中|相談|検討中)$/;

export interface ParseOptions {
  /** FFLogs から動的解決したワールドインデックス（任意） */
  worldIndex?: ReadonlyMap<string, WorldRef[]>;
  max?: number;
}

function isNameLike(text: string, allowSingleWord = false): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 32) return false;
  if (PLACEHOLDER_RE.test(t)) return false;
  if (NOT_A_NAME.test(t)) return false;
  if (NAME_RE.test(t)) return true;
  return allowSingleWord && SINGLE_WORD_NAME_RE.test(t);
}

function resolveWorld(text: string, options: ParseOptions): WorldRef | undefined {
  const trimmed = text.trim().replace(/^[<【\[]+|[>】\]]+$/g, "").trim();
  if (trimmed === "") return undefined;
  if (options.worldIndex) {
    const key = trimmed.normalize("NFKC").toLowerCase().replace(/[\s\-'’.·]/g, "");
    const fromDynamic = options.worldIndex.get(key);
    if (fromDynamic && fromDynamic.length > 0) return fromDynamic[0];
  }
  return lookupWorldStatic(trimmed);
}

/** 行頭の装飾記号・絵文字を落とす。 */
export function stripDecoration(line: string): string {
  return line.replace(/^[^\p{L}\p{N}（(【\[]+/u, "").trim();
}

/**
 * 注記部分を落とす。
 *  - `※...` 以降を削除
 *  - `（...）` / `(...)` を削除（クリア済コンテンツや「D2も可」などの補足）
 */
export function stripNotes(line: string): string {
  const cut = line.search(NOTE_MARKERS);
  const head = cut >= 0 ? line.slice(0, cut) : line;
  return head.replace(PAREN_RE, " ").replace(/\s+/g, " ").trim();
}

/** 先頭のポジション表記を取り出す。 */
export function stripPosition(line: string): { position?: string; rest: string } {
  // 「MT：...」「・D1orD2　...」のようなコロン区切り
  const sep = line.search(/[:：]/);
  if (sep > 0) {
    const head = line.slice(0, sep).trim();
    if (POSITION_HEAD_RE.test(head)) {
      return { position: formatPosition(head), rest: line.slice(sep + 1).trim() };
    }
  }

  // 「MT Rion Aster / ...」のような空白区切り
  const m = POSITION_SPACE_RE.exec(line);
  if (m) {
    return { position: formatPosition(m[1]!), rest: line.slice(m[0].length).trim() };
  }

  // ポジション表記だけの行（例: URL だけの行から URL を除いた結果）
  const trimmed = line.trim();
  if (POSITION_HEAD_RE.test(trimmed)) {
    return { position: formatPosition(trimmed), rest: "" };
  }

  return { rest: line };
}

/**
 * 「MTorST」「D1orD2」のような併記ポジションを表示用に整える。
 * 例: `MTORST` -> `MT / ST`
 */
export function formatPosition(raw: string): string {
  return raw
    .toUpperCase()
    .split(/\s*(?:OR|または|もしくは|／|\/|＞|>|≧)\s*/)
    .filter((part) => part !== "")
    .join(" / ");
}

function splitSegments(text: string): string[] {
  return text
    .split(SEGMENT_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** 行全体からジョブ（と着替え候補）を取り出す。最も左の表記を募集ジョブとする。 */
function findJob(text: string): { primary: JobMention; alternates: JobMention[] } | undefined {
  const mentions = scanJobMentions(text);
  if (mentions.length === 0) return undefined;
  const chain = findJobChain(text, mentions);
  if (!chain) return undefined;
  return { primary: chain.primary, alternates: chain.alternates };
}

/** ジョブ表記と注記を取り除いた残りから、キャラクター名らしい断片を探す。 */
function extractName(text: string, allowSingleWord: boolean): string | undefined {
  const mentions = scanJobMentions(text);
  const stripped = stripJobMentions(text, mentions);
  const candidates = splitSegments(stripped);
  for (const candidate of candidates.length > 0 ? candidates : [stripped]) {
    const name = nameFromFragment(candidate, allowSingleWord);
    if (name) return name;
  }
  return undefined;
}

/**
 * 英字で始まる名前候補の最長プレフィックスを取り出す。
 *
 * 「Tama Tamax 2絶」「Yoyo Micro 5絶」のように、名前の直後に区切り無しで
 * クリア済コンテンツの注記が続く書き方が実際に多いため、
 * 「後ろに英字が残らない最長の名前」を採用する。
 */
const NAME_PREFIX_RE = /^([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2})/;

function nameFromFragment(text: string, allowSingleWord: boolean): string | undefined {
  const trimmed = text.trim();
  if (isNameLike(trimmed, allowSingleWord)) return trimmed;

  const match = NAME_PREFIX_RE.exec(trimmed);
  if (!match) return undefined;

  const words = match[1]!.split(/\s+/);
  const candidate = words.join(" ");
  const remainder = trimmed.slice(candidate.length);
  // 後ろに英字が残るなら名前を途中で切ってしまう恐れがあるため採用しない
  if (/[A-Za-z]/.test(remainder)) return undefined;
  return isNameLike(candidate, allowSingleWord) ? candidate : undefined;
}

/**
 * 行中に Lodestone のキャラクター URL があればその ID を取り出す。
 * 例: https://jp.finalfantasyxiv.com/lodestone/character/23691783/
 */
export function extractLodestoneId(line: string): number | undefined {
  const m = /lodestone\/character\/(\d+)/.exec(line);
  return m ? Number(m[1]) : undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 1行を解析して 1 人分の募集枠を取り出す。
 */
function parseLine(rawLine: string, lineNumber: number, options: ParseOptions): ParsedCharacter | undefined {
  const decorated = stripDecoration(rawLine.normalize("NFKC"));
  if (decorated === "") return undefined;

  const cleaned = stripNotes(decorated);
  if (cleaned === "") return undefined;

  const lodestoneId = extractLodestoneId(rawLine);
  // URL は名前として解釈しない（Lodestone のキャラクター URL は lodestoneId として別途扱う）
  const withoutUrl = cleaned.replace(URL_RE, " ").replace(/\s+/g, " ").trim();

  const { position, rest } = stripPosition(withoutUrl);
  if (rest.trim() === "") {
    // URL だけの行でも Lodestone ID があればキャラクターとして扱う（名前は後段で解決）
    if (lodestoneId) {
      return {
        name: "",
        lodestoneId,
        recruitmentJob: undefined,
        recruitmentJobAmbiguous: false,
        recruitmentPosition: position,
        rawLine,
        lineNumber,
      };
    }
    return undefined;
  }

  const allowSingleWord = Boolean(position);
  const job = findJob(rest);

  // ワールドはセグメント単位で探す（"Name / 鎌 / World" のような形）
  let world: WorldRef | undefined;
  for (const segment of splitSegments(rest)) {
    const w = resolveWorld(segment, options);
    if (w) {
      world = w;
      break;
    }
  }

  let name = extractName(rest, allowSingleWord);
  // ワールド名そのものを名前として拾ってしまった場合は無効化する
  if (name && resolveWorld(name, options)) name = undefined;

  if (!name && world) {
    const remaining = rest.replace(new RegExp(escapeRegExp(world.name), "gi"), " ");
    name = extractName(remaining, allowSingleWord);
  }

  if (!name) {
    // Lodestone のキャラクター URL があれば、名前は後段（/api/parse）で解決できる
    if (lodestoneId) {
      return {
        name: "",
        lodestoneId,
        recruitmentJob: job?.primary.jobId,
        recruitmentJobAlias: job?.primary.alias,
        recruitmentJobConfidence: job?.primary.confidence,
        recruitmentJobAlternates: job?.alternates.map((a) => a.jobId),
        recruitmentJobAmbiguous: false,
        recruitmentPosition: position,
        rawLine,
        lineNumber,
      };
    }
    return undefined;
  }

  return {
    name,
    lodestoneId,
    world: world?.name,
    worldSlug: world?.slug,
    worldRegion: world?.region,
    recruitmentJob: job?.primary.jobId,
    recruitmentJobAlias: job?.primary.alias,
    recruitmentJobConfidence: job?.primary.confidence,
    recruitmentJobAlternates: job?.alternates.map((a) => a.jobId),
    recruitmentJobAmbiguous: job ? job.primary.confidence === "low" : false,
    recruitmentPosition: position,
    rawLine,
    lineNumber,
  };
}

/**
 * 重複判定キー。
 *
 * 1 つの募集文の中で同名が 2 回出てくる場合は同一人物の再記載とみなす
 * （ワールド表記が片方にしか無い行をマージするため、意図的に world を含めない）。
 */
function dedupeKey(character: ParsedCharacter): string {
  if (character.name === "" && character.lodestoneId) return `lodestone:${character.lodestoneId}`;
  return character.name.toLowerCase();
}

/**
 * 募集文テキストを解析して最大 8 人の募集枠を返す。
 * 入力は NFKC 正規化してから処理する（全角英数・半角カナのゆれ対策）。
 */
export function parseRecruitmentText(input: string, options: ParseOptions = {}): ParseResult {
  const max = options.max ?? MAX_CHARACTERS;
  const rawLines = input.replace(/\r\n?/g, "\n").split("\n");
  const characters: ParsedCharacter[] = [];
  const warnings: ParseWarning[] = [];
  const seen = new Map<string, ParsedCharacter>();
  let candidateLines = 0;
  let dropped = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i]!;
    if (rawLine.trim() === "") continue;

    const parsed = parseLine(rawLine, i + 1, options);
    if (!parsed) continue;
    candidateLines += 1;

    const key = dedupeKey(parsed);
    const existing = seen.get(key);
    if (existing) {
      // 同一人物の重複記載は、欠けている情報だけマージする
      existing.world ??= parsed.world;
      existing.worldSlug ??= parsed.worldSlug;
      existing.worldRegion ??= parsed.worldRegion;
      existing.recruitmentJob ??= parsed.recruitmentJob;
      existing.recruitmentJobAlias ??= parsed.recruitmentJobAlias;
      existing.recruitmentPosition ??= parsed.recruitmentPosition;
      continue;
    }

    if (characters.length >= max) {
      dropped += 1;
      continue;
    }

    seen.set(key, parsed);
    characters.push(parsed);

    if (!parsed.recruitmentJob) {
      warnings.push({ lineNumber: i + 1, line: rawLine, reason: "ジョブ表記を認識できませんでした" });
    } else if (parsed.recruitmentJobAmbiguous) {
      warnings.push({
        lineNumber: i + 1,
        line: rawLine,
        reason: `ジョブ判定が曖昧です（${parsed.recruitmentJobAlias} → ${parsed.recruitmentJob}）`,
      });
    }
  }

  if (dropped > 0) {
    warnings.push({
      lineNumber: 0,
      line: "",
      reason: `9人目以降の ${dropped} 件は表示対象外です（最大 ${max} 人）`,
    });
  }

  return {
    characters,
    warnings,
    stats: { totalLines: rawLines.length, candidateLines, dropped },
  };
}

/**
 * 入力が URL かどうかを判定する。
 * Lodestone の日記・募集ページなら本文を取得してテキスト解析に流す（仕様 §3 B）。
 */
export function extractFirstUrl(input: string): string | undefined {
  const m = /https?:\/\/[^\s"'<>）)]+/.exec(input);
  return m?.[0];
}

