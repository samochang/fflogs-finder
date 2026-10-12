/**
 * FFLogs API 接続設定（仕様 §33）。
 *
 * client secret はサーバ側でのみ読む。ブラウザに渡してはいけない。
 */

export interface FflogsConfig {
  clientId: string;
  clientSecret: string;
  /** GraphQL エンドポイント */
  endpoint: string;
  /** OAuth トークンエンドポイント */
  tokenEndpoint: string;
  /** 1 リクエストあたりのタイムアウト (ms) */
  timeoutMs: number;
  /** リクエスト失敗時のリトライ回数 */
  maxRetries: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env を用意してください（.env.example 参照）。`,
    );
  }
  return value.trim();
}

export function loadConfig(): FflogsConfig {
  return {
    clientId: required("FFL_CLIENT_ID"),
    clientSecret: required("FFL_CLIENT_SECRET"),
    endpoint: process.env.FFLOGS_ENDPOINT ?? "https://www.fflogs.com/api/v2/client",
    tokenEndpoint: process.env.FFLOGS_TOKEN_ENDPOINT ?? "https://www.fflogs.com/oauth/token",
    timeoutMs: Number(process.env.FFLOGS_TIMEOUT_MS ?? 25_000),
    maxRetries: Number(process.env.FFLOGS_MAX_RETRIES ?? 2),
  };
}

/** 設定が存在するかだけを確認する（起動時チェック用。throw しない）。 */
export function hasCredentials(): boolean {
  return Boolean(process.env.FFL_CLIENT_ID && process.env.FFL_CLIENT_SECRET);
}

export function tierCount(): number {
  return Number(process.env.TIER_COUNT ?? 6);
}

/** 対象 Tier を固定したい場合の上書き（新しい順の zoneID）。 */
export function tierZoneOverride(): number[] | undefined {
  const raw = process.env.TIER_ZONE_IDS;
  if (!raw) return undefined;
  const ids = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : undefined;
}

/**
 * キャッシュの有効期間（日）。
 *
 * 「最新データを確認」を押しても、最終取得からこの日数以内なら FFLogs へ問い合わせない。
 * API points の節約を最優先するテスト期間向けの設定（既定 7 日）。
 */
export function dataMaxAgeDays(): number {
  const raw = process.env.DATA_MAX_AGE_DAYS;
  if (raw === undefined) return 7;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

export function refreshLockTtlSeconds(): number {
  return Number(process.env.REFRESH_LOCK_TTL_SECONDS ?? 60);
}
