import { refreshLockTtlSeconds } from "../fflogs/config.ts";
import { refreshLockKey } from "./keys.ts";
import { getCacheStore } from "./store.ts";

/**
 * refresh lock（仕様 §28）。
 *
 * 同一キャラクター・同一ジョブを複数ユーザーが同時に更新しても、
 * FFLogs へのリクエストが同時多発しないようにする。
 * Redis の SET NX EX を使い、既定 60 秒で自然解放される。
 */

export interface LockHandle {
  key: string;
  token: string;
  release: () => Promise<void>;
}

/** ロックを取得できた場合のみ handle を返す。取得できなければ null。 */
export async function acquireRefreshLock(scope: string, ttlSeconds = refreshLockTtlSeconds()): Promise<LockHandle | null> {
  const store = getCacheStore();
  const key = refreshLockKey(scope);
  const token = await store.acquireLock(key, ttlSeconds);
  if (!token) return null;
  return {
    key,
    token,
    release: () => store.releaseLock(key, token),
  };
}

/** ロックが現在取られているか（UX 表示用）。 */
export async function isRefreshLocked(scope: string): Promise<boolean> {
  const store = getCacheStore();
  return (await store.get(refreshLockKey(scope))) !== null;
}

/**
 * ロックを取りつつ処理する。ロックが取れなかった場合は `undefined` を返す
 * （呼び出し側は既存キャッシュを表示する）。
 */
export async function withRefreshLock<T>(
  scope: string,
  fn: () => Promise<T>,
  ttlSeconds = refreshLockTtlSeconds(),
): Promise<{ ok: true; value: T } | { ok: false; reason: "locked" }> {
  const lock = await acquireRefreshLock(scope, ttlSeconds);
  if (!lock) return { ok: false, reason: "locked" };
  try {
    return { ok: true, value: await fn() };
  } finally {
    await lock.release();
  }
}
