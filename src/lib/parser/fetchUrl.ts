/**
 * URL 入力の本文取得（仕様 §3 B）。
 *
 * Lodestone の日記・募集ページなど、本文を取得可能な URL が入力された場合に
 * 本文だけを取り出して通常のテキスト parser へ流す。
 *
 * セキュリティ:
 *  - https のみ
 *  - 取得先ホストを allowlist で制限する（SSRF 対策）。既定は FF14 公式ドメインのみ。
 *  - レスポンスサイズとタイムアウトに上限を設ける
 */

export interface FetchUrlResult {
  url: string;
  title?: string;
  text: string;
  /** 本文が上限で切り詰められたか */
  truncated: boolean;
}

export class UrlFetchError extends Error {
  readonly kind: "invalid_url" | "host_not_allowed" | "network" | "too_large" | "empty";

  constructor(kind: UrlFetchError["kind"], message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "UrlFetchError";
    this.kind = kind;
  }
}

const DEFAULT_ALLOWED_HOSTS = ["finalfantasyxiv.com", "square-enix.com"];

const MAX_BYTES = 3_000_000;
const MAX_TEXT_LENGTH = 20_000;
const TIMEOUT_MS = 15_000;

function allowedHosts(): string[] {
  const extra = process.env.URL_FETCH_ALLOWED_HOSTS;
  const list = extra ? extra.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  return [...DEFAULT_ALLOWED_HOSTS, ...list];
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/** 入力全体が URL 1 つだけかどうか。 */
export function parseSingleUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) return undefined;
  if (!/^https:\/\/\S+$/.test(trimmed)) return undefined;
  return trimmed;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      return whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** HTML をプレーンテキストへ落とす。 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|head|iframe)\b[\s\S]*?<\/\1>/gi, " ");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n・")
    .replace(/<(p|div|tr|h[1-6]|section|article|blockquote|dd|dt|ul|ol|table|pre)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|dd|dt|ul|ol|table|pre)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text);

  return text
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 指定クラスを持つ要素の中身を取り出す（ネストした同名タグを数えて閉じ位置を探す）。
 * Lodestone の日記本文は `div.txt_selfintroduction` に入っている。
 */
export function extractElementByClass(html: string, className: string): string | undefined {
  const openRe = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "i");
  const match = openRe.exec(html);
  if (!match) return undefined;

  const tag = match[1]!.toLowerCase();
  const start = match.index + match[0].length;
  const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tagRe.lastIndex = start;

  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index);
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]!).trim() || undefined : undefined;
}

/** 本文らしき領域を優先度順に探す。 */
export function extractBodyText(html: string): string {
  const candidates = [
    "txt_selfintroduction", // Lodestone の日記・募集本文
    "entry__body",
    "ldst__entry__body",
    "news__body",
  ];
  for (const className of candidates) {
    const inner = extractElementByClass(html, className);
    if (inner && htmlToText(inner).length > 0) return htmlToText(inner);
  }

  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main) return htmlToText(main[1]!);

  return htmlToText(html);
}

/** URL を取得して本文テキストを返す。 */
export async function fetchUrlText(url: string): Promise<FetchUrlResult> {
  if (!isAllowedUrl(url)) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();
    throw new UrlFetchError(
      /^https:/.test(url) ? "host_not_allowed" : "invalid_url",
      `この URL からは本文を取得できません（${host}）。募集文をそのまま貼り付けてください。`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; fflogs-finder/0.1; +https://github.com/)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new UrlFetchError("network", "URL の本文を取得できませんでした。募集文をそのまま貼り付けてください。", { cause: error });
  }

  if (!response.ok) {
    throw new UrlFetchError("network", `URL の取得に失敗しました (HTTP ${response.status})。募集文をそのまま貼り付けてください。`);
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    throw new UrlFetchError("too_large", "ページが大きすぎるため本文を取得できませんでした。募集文をそのまま貼り付けてください。");
  }

  const html = await response.text();
  if (html.length > MAX_BYTES) {
    throw new UrlFetchError("too_large", "ページが大きすぎるため本文を取得できませんでした。募集文をそのまま貼り付けてください。");
  }

  const full = extractBodyText(html);
  if (full.trim() === "") {
    throw new UrlFetchError("empty", "ページから本文を抽出できませんでした。募集文をそのまま貼り付けてください。");
  }

  const truncated = full.length > MAX_TEXT_LENGTH;
  return {
    url,
    title: extractTitle(html),
    text: truncated ? full.slice(0, MAX_TEXT_LENGTH) : full,
    truncated,
  };
}
