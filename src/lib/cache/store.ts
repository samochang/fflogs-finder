import { Redis } from "@upstash/redis";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * キャッシュ層（仕様 §26 / §28 / §30）。
 *
 * Upstash Redis が設定されていればそれを使い、無ければプロセス内メモリにフォールバックする。
 * 「14日 TTL のような短い期限で制御する」のではなく、
 * FFLogs への更新問い合わせ頻度を refresh lock で制御するのが主旨（仕様 §26）。
 */

export interface CacheStore {
  readonly kind: "upstash" | "memory" | "file";
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** SET NX EX。true を返した呼び出しだけが処理を実行してよい。 */
  acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
  /** テスト・デバッグ用。 */
  keys(): Promise<string[]>;
}

/** 開発用のインメモリ実装。Next.js の HMR をまたいで保持するため globalThis に置く。 */
class MemoryStore implements CacheStore {
  readonly kind = "memory" as const;

  private data = new Map<string, { value: unknown; expiresAt: number | null }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    // 読み取り〜書き込みの間に await を挟まないこと。
    // 挟むと同一プロセス内でも複数の呼び出しが同時にロックを取れてしまう。
    const entry = this.data.get(key);
    const alive = entry !== undefined && (entry.expiresAt === null || entry.expiresAt > Date.now());
    if (alive) return null;

    const token = crypto.randomUUID();
    this.data.set(key, { value: token, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const current = await this.get<string>(key);
    if (current === token) await this.del(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}

class UpstashStore implements CacheStore {
  readonly kind = "upstash" as const;
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get<T>(key);
    return value ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) await this.redis.set(key, value);
    else await this.redis.set(key, value, { ex: ttlSeconds });
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(key, token, { nx: true, ex: ttlSeconds });
    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    // 自分が取得したロックだけを解放する
    const current = await this.redis.get<string>(key);
    if (current === token) await this.redis.del(key);
  }

  async keys(): Promise<string[]> {
    return this.redis.keys("*");
  }
}

/**
 * 開発用のファイル永続ストア。
 *
 * メモリストアだと `npm run dev` を再起動するたびにキャッシュが消え、
 * 毎回 1 秒以上かかる cold path を踏んでしまう。
 * Upstash を用意しなくても再起動をまたいで残るようにファイルへ書き出す。
 *
 * Vercel（書き込み可能なのは /tmp のみ）では既定で使わない。
 */
class FileBackedStore implements CacheStore {
  readonly kind = "file" as const;
  private readonly memory = new Map<string, { value: unknown; expiresAt: number | null }>();
  private readonly filePath: string;
  private loaded = false;
  private loadPromise?: Promise<void>;
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loadPromise ??= (async () => {
      try {
        const raw = await readFile(this.filePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, { value: unknown; expiresAt: number | null }>;
        const now = Date.now();
        for (const [key, entry] of Object.entries(parsed)) {
          if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
          this.memory.set(key, entry);
        }
      } catch {
        // ファイルが無い・壊れている場合は空で開始する
      }
      this.loaded = true;
    })();
    await this.loadPromise;
  }

  /** 書き込みはまとめて非同期に行う（リクエストを待たせない）。 */
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 250);
  }

  private async flush(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const now = Date.now();
      const out: Record<string, { value: unknown; expiresAt: number | null }> = {};
      for (const [key, entry] of this.memory) {
        if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
        out[key] = entry;
      }
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(out));
      await rename(tmp, this.filePath);
    } catch {
      // 書き込みに失敗しても動作は継続する
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureLoaded();
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureLoaded();
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
    });
    this.scheduleFlush();
  }

  async del(key: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.delete(key);
    this.scheduleFlush();
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    await this.ensureLoaded();
    const entry = this.memory.get(key);
    const alive = entry !== undefined && (entry.expiresAt === null || entry.expiresAt > Date.now());
    if (alive) return null;
    const token = crypto.randomUUID();
    this.memory.set(key, { value: token, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.scheduleFlush();
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const current = await this.get<string>(key);
    if (current === token) await this.del(key);
  }

  async keys(): Promise<string[]> {
    await this.ensureLoaded();
    return [...this.memory.keys()];
  }

  /** テスト・終了時に確実に書き出す。 */
  async persistNow(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __fflogsCacheStore: CacheStore | undefined;
}

export function getCacheStore(): CacheStore {
  if (globalThis.__fflogsCacheStore) return globalThis.__fflogsCacheStore;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  let store: CacheStore;
  if (url && token) {
    store = new UpstashStore(new Redis({ url, token }));
  } else if (process.env.CACHE_PERSIST === "0") {
    store = new MemoryStore();
  } else {
    // 開発ではファイルへ永続化する（再起動してもキャッシュが残る）。
    // Vercel のファイルシステムは /tmp 以外読み取り専用なため、明示された場合のみ使う。
    const filePath = process.env.CACHE_FILE ?? join(process.cwd(), ".cache", "store.json");
    store = process.env.VERCEL && process.env.CACHE_PERSIST !== "1" ? new MemoryStore() : new FileBackedStore(filePath);
  }

  globalThis.__fflogsCacheStore = store;
  return store;
}

/** テスト用にストアを差し替える。 */
export function setCacheStore(store: CacheStore): void {
  globalThis.__fflogsCacheStore = store;
}

export function resetCacheStore(): void {
  globalThis.__fflogsCacheStore = undefined;
}
