import { logger } from "../logger.ts";
import { logUsage, recordUsage } from "./usage.ts";
import type { FflogsConfig } from "./config.ts";

/**
 * FFLogs の API エラー。
 * UI で「API制限」「timeout」等を出し分けるために kind を持たせる（仕様 §34）。
 */
export type FflogsErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "graphql"
  | "not_found"
  | "archived";

export class FflogsError extends Error {
  readonly kind: FflogsErrorKind;
  readonly status?: number;
  readonly details?: unknown;
  /** レート制限のときだけ入る。何秒後に回復するか */
  readonly retryAfterSeconds?: number;

  constructor(
    kind: FflogsErrorKind,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "FflogsError";
    this.kind = kind;
    this.status = options.status;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface GraphQLRequestOptions {
  signal?: AbortSignal;
  /** リトライしない（ユーザー操作起因の単発クエリなど） */
  noRetry?: boolean;
  /** rateLimitData を同梱しない（消費ポイント計測時のみ使う） */
  skipRateLimitTelemetry?: boolean;
}

export interface RateLimitSnapshot {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
  /** このスナップショットを取得した時刻 (epoch ms) */
  observedAt: number;
}

/** 毎回のレスポンスに同梱して points 消費を実測するためのフラグメント（仕様 §25）。 */
export const RATE_LIMIT_FRAGMENT = /* GraphQL */ `
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
`;

export interface GraphQLResult<T> {
  data: T;
  rateLimit?: RateLimitSnapshot;
}

/**
 * クエリ文字列の先頭の selection set に rateLimitData を差し込む。
 *
 * こうしておくと全リクエストの応答に消費ポイントが同梱され、
 * 「points 実測のために追加リクエストを投げる」必要がなくなる（仕様 §25）。
 */
export function injectRateLimit(query: string, fragment: string = RATE_LIMIT_FRAGMENT): string {
  if (/\brateLimitData\s*\{/.test(query)) return query;

  const opMatch = /^\s*(?:query|mutation)\b[^{]*\{/.exec(query);
  if (opMatch) {
    const braceIndex = opMatch[0].length - 1;
    return `${query.slice(0, braceIndex + 1)}\n${fragment}\n${query.slice(braceIndex + 1)}`;
  }

  const shortMatch = /^\s*\{/.exec(query);
  if (shortMatch) {
    const braceIndex = shortMatch[0].length - 1;
    return `${query.slice(0, braceIndex + 1)}\n${fragment}\n${query.slice(braceIndex + 1)}`;
  }

  return query;
}

export class FflogsGraphQLClient {
  private readonly config: FflogsConfig;
  private token?: { value: string; expiresAt: number };
  private lastRateLimit?: RateLimitSnapshot;
  /** リクエスト数の実測用カウンタ（テスト・計測スクリプト向け） */
  requestCount = 0;

  constructor(config: FflogsConfig) {
    this.config = config;
  }

  get lastRateLimitSnapshot(): RateLimitSnapshot | undefined {
    return this.lastRateLimit;
  }

  /** 直近スナップショットから残ポイントを見積もる。未取得なら undefined。 */
  remainingPoints(): number | undefined {
    const snap = this.lastRateLimit;
    if (!snap) return undefined;
    // リセットをまたいでいれば満タンとみなす
    const elapsedSec = (Date.now() - snap.observedAt) / 1000;
    if (elapsedSec >= snap.pointsResetIn) return snap.limitPerHour;
    return Math.max(0, snap.limitPerHour - snap.pointsSpentThisHour);
  }
  /** OAuth クライアントクレデンシャルでアクセストークンを取得する（キャッシュあり）。 */
  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials" });

    let response: Response;
    try {
      response = await fetch(this.config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new FflogsError("network", "FFLogs の認証エンドポイントに接続できませんでした", { cause: error });
    }

    if (!response.ok) {
      throw new FflogsError("auth", `FFLogs の認証に失敗しました (HTTP ${response.status})`, { status: response.status });
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new FflogsError("auth", "FFLogs の認証レスポンスに access_token が含まれていません");
    }

    const ttlSeconds = Math.max(60, (json.expires_in ?? 3600) - 300);
    this.token = { value: json.access_token, expiresAt: Date.now() + ttlSeconds * 1000 };
    return this.token.value;
  }

  /**
   * GraphQL クエリを実行する。
   * レスポンスに rateLimitData が含まれていれば消費ポイントを記録する。
   */
  /**
   * `rateLimitData` だけを読み直して、消費の反映遅れを解消する（1 point）。
   *
   * FFLogs の `pointsSpentThisHour` は**そのリクエストの直前**の値なので、
   * 何もせずに読むと「最後のリクエストぶん」が抜けた値になる。
   * 実際より残量が多く見えて 429 を踏むので、消費した操作のあとに 1 回だけ読み直す。
   */
  async settleRateLimit(): Promise<void> {
    await this.query("query RateLimitSettle { __typename }");
  }

  async query<T = unknown>(query: string, options: GraphQLRequestOptions = {}): Promise<GraphQLResult<T>> {
    const withTelemetry = options.skipRateLimitTelemetry ? query : injectRateLimit(query);
    const attempts = options.noRetry ? 1 : this.config.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.execute<T>(withTelemetry, options.signal);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof FflogsError && (error.kind === "network" || error.kind === "timeout" || (error.status ?? 0) >= 500);
        if (!retryable || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new FflogsError("network", "不明なエラー");
  }

  private async execute<T>(query: string, signal?: AbortSignal): Promise<GraphQLResult<T>> {
    const operation = extractOperationName(query);
    const startedAt = performance.now();
    const tokenStartedAt = performance.now();
    const token = await this.getAccessToken();
    const tokenMs = Math.round((performance.now() - tokenStartedAt) * 10) / 10;
    this.requestCount += 1;

    logger.debug("fflogs.request.start", { operation, seq: this.requestCount, tokenMs, bytes: query.length });

    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
        signal: combined,
      });
    } catch (error) {
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        logger.warn("fflogs.request.timeout", { operation, durationMs, timeoutMs: this.config.timeoutMs });
        throw new FflogsError("timeout", "FFLogs API がタイムアウトしました", { cause: error });
      }
      logger.warn("fflogs.request.network_error", { operation, durationMs, error: error instanceof Error ? error.message : String(error) });
      throw new FflogsError("network", "FFLogs API に接続できませんでした", { cause: error });
    }

    if (response.status === 401 || response.status === 403) {
      // トークンが失効している可能性があるので 1 度だけ取り直す
      this.token = undefined;
      throw new FflogsError("auth", `FFLogs API の認証に失敗しました (HTTP ${response.status})`, { status: response.status });
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      logger.warn("fflogs.request.rate_limited", { operation, retryAfter, limit: response.headers.get("x-ratelimit-limit") });
      const seconds = retryAfter ? Number(retryAfter) : undefined;
      throw new FflogsError(
        "rate_limit",
        Number.isFinite(seconds)
          ? `FFLogs の時間あたり上限に達しました（約 ${Math.ceil((seconds as number) / 60)} 分後に回復）`
          : "FFLogs の時間あたり上限に達しました",
        { status: 429, retryAfterSeconds: Number.isFinite(seconds) ? (seconds as number) : undefined },
      );
    }

    if (!response.ok) {
      throw new FflogsError("network", `FFLogs API が HTTP ${response.status} を返しました`, { status: response.status });
    }

    let json: { data?: T; errors?: Array<{ message: string; path?: unknown[] }> };
    try {
      json = (await response.json()) as typeof json;
    } catch (error) {
      throw new FflogsError("network", "FFLogs API のレスポンスを JSON として解釈できませんでした", { cause: error });
    }

    // rateLimitData はリクエストに含めたときだけ返る
    const rateLimit = this.extractRateLimit(json.data);
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;

    // 消費ポイントと所要時間を記録する（points は 1 リクエスト分遅れて反映される点に注意）
    const usage = {
      operation,
      pointsSpentThisHour: rateLimit?.pointsSpentThisHour,
      limitPerHour: rateLimit?.limitPerHour,
      pointsResetIn: rateLimit?.pointsResetIn,
      durationMs,
    };
    logUsage(usage, { seq: this.requestCount, rows: countCharacters(json.data) });
    void recordUsage(usage).catch((error: unknown) => {
      logger.warn("fflogs.usage.record_failed", { operation, error: error instanceof Error ? error.message : String(error) });
    });

    if (json.errors && json.errors.length > 0) {
      const message = json.errors.map((e) => e.message).join(" / ");
      logger.warn("fflogs.request.graphql_error", { operation, durationMs, message: message.slice(0, 300) });
      const kind: FflogsErrorKind = /archived/i.test(message)
        ? "archived"
        : /rate limit|points/i.test(message)
          ? "rate_limit"
          : "graphql";
      throw new FflogsError(kind, message, { details: json.errors });
    }

    if (json.data === undefined || json.data === null) {
      throw new FflogsError("not_found", "FFLogs API からデータが返りませんでした", { details: json });
    }

    return { data: json.data, rateLimit };
  }

  private extractRateLimit(data: unknown): RateLimitSnapshot | undefined {
    if (!data || typeof data !== "object") return undefined;
    const raw = (data as Record<string, unknown>).rateLimitData;
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    if (typeof r.limitPerHour !== "number") return undefined;
    const snapshot: RateLimitSnapshot = {
      limitPerHour: r.limitPerHour,
      pointsSpentThisHour: Number(r.pointsSpentThisHour ?? 0),
      pointsResetIn: Number(r.pointsResetIn ?? 0),
      observedAt: Date.now(),
    };
    this.lastRateLimit = snapshot;
    return snapshot;
  }
}

/** クエリ文字列から operation 名を取り出す（ログの集計用）。 */
export function extractOperationName(query: string): string {
  const named = /^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  if (named) return named[1]!;
  // `c0: character(...)` のような alias があればそれを手掛かりにする
  if (/characterData/.test(query)) return "anonymous(characterData)";
  if (/reportData/.test(query)) return "anonymous(reportData)";
  if (/worldData/.test(query)) return "anonymous(worldData)";
  return "anonymous";
}

/** レスポンスに含まれるキャラクター数（ログの把握用）。 */
function countCharacters(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const characterData = (data as Record<string, unknown>).characterData;
  if (!characterData || typeof characterData !== "object") return undefined;
  return Object.keys(characterData as Record<string, unknown>).length;
}

/** 429 / ポイント枯渇を「キャッシュを出しつつ警告」に変換するための判定。 */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof FflogsError && error.kind === "rate_limit";
}

export function isArchivedError(error: unknown): boolean {
  return error instanceof FflogsError && error.kind === "archived";
}
