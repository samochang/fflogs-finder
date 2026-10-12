/**
 * 構造化ロガー。
 *
 * 1 行 1 JSON で stdout に出す（Vercel のログでもそのまま検索できる）。
 *   {"ts":"2026-10-09T12:00:00.000Z","level":"info","msg":"fflogs.request","operation":"ZoneRankingsBatch","durationMs":812,...}
 *
 * 環境変数:
 *   LOG_LEVEL=debug|info|warn|error|silent   （既定: 開発は debug、本番は info）
 *   LOG_FORMAT=json|pretty                   （既定: json）
 *
 * 秘匿情報は絶対に出さない。フィールドは redact() を通す。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function resolveLevel(): LogLevel | "silent" {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in LEVEL_ORDER) return raw as LogLevel | "silent";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const FORBIDDEN_KEYS = /secret|token|authorization|password|apikey|api_key/i;

/** 秘匿情報を落とす。深さは 4 まで。 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = FORBIDDEN_KEYS.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** 共通フィールドを引き継いだ子ロガーを作る（リクエスト ID など）。 */
  child(fields: Record<string, unknown>): Logger;
}

function emit(level: LogLevel, base: Record<string, unknown>, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveLevel()]) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(base) as Record<string, unknown>),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };

  const line =
    process.env.LOG_FORMAT === "pretty"
      ? `${payload.ts} ${level.toUpperCase().padEnd(5)} ${message} ${JSON.stringify({ ...payload, ts: undefined, level: undefined, msg: undefined })}`
      : JSON.stringify(payload);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, fields) => emit("debug", base, message, fields),
    info: (message, fields) => emit("info", base, message, fields),
    warn: (message, fields) => emit("warn", base, message, fields),
    error: (message, fields) => emit("error", base, message, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

export const logger = createLogger({ app: "fflogs-finder" });

/** リクエスト単位のロガーと所要時間計測。 */
export function startRequest(name: string, fields: Record<string, unknown> = {}) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = performance.now();
  const log = logger.child({ requestId, req: name, ...fields });
  log.debug("request.start");

  return {
    log,
    requestId,
    /** 途中経過の計測（`mark()` を呼んだ区間の所要時間を返す） */
    mark(label: string): number {
      const now = performance.now();
      const durationMs = Math.round((now - startedAt) * 10) / 10;
      log.debug("request.mark", { mark: label, durationMs });
      return durationMs;
    },
    done(outcome: string, extra: Record<string, unknown> = {}): number {
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      log.info("request.done", { outcome, durationMs, ...extra });
      return durationMs;
    },
  };
}
