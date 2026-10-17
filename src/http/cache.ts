/**
 * How long a whole-library download (GET /movie, GET /series) is reused. The arr v3
 * endpoints have no server-side paging, so the list and duplicate tools download the
 * whole library and filter in memory; this keeps a paged exploration to one download.
 */
export const LIBRARY_TTL_MS = 30_000;

export interface Cached<T> {
  /** The cached value while it is fresh, otherwise a new (shared) load. */
  get(): Promise<T>;
  /** Drop the cached value; the next get() loads again. */
  invalidate(): void;
}

interface Entry<T> {
  promise: Promise<T>;
  /** Infinity while the load is in flight; set once it resolves. */
  expiresAt: number;
}

/**
 * A single-flight TTL cache around one load. Concurrent get() calls share one in-flight
 * load, a rejected load is never cached, and a load that was in flight when invalidate()
 * ran does not fill the cache (its callers still get its result).
 */
export function cached<T>(load: () => Promise<T>, ttlMs: number): Cached<T> {
  let entry: Entry<T> | undefined;

  return {
    get() {
      if (entry && Date.now() < entry.expiresAt) return entry.promise;

      const current: Entry<T> = { promise: load(), expiresAt: Infinity };
      entry = current;
      current.promise.then(
        () => {
          if (entry === current) current.expiresAt = Date.now() + ttlMs;
        },
        () => {
          if (entry === current) entry = undefined;
        },
      );
      return current.promise;
    },
    invalidate() {
      entry = undefined;
    },
  };
}

/**
 * Runs a write and then invalidates, whether the write succeeded or failed: a failed or
 * timed-out request may still have changed the library.
 */
export async function invalidating<T>(cache: Cached<unknown>, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    cache.invalidate();
  }
}
