import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cached } from '../../src/http/cache.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('cached', () => {
  it('loads once while the value is fresh', async () => {
    const load = vi.fn().mockResolvedValue(['a']);
    const cache = cached(load, 1000);

    await expect(cache.get()).resolves.toEqual(['a']);
    vi.advanceTimersByTime(999);
    await expect(cache.get()).resolves.toEqual(['a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once the ttl has passed', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new']);
    const cache = cached(load, 1000);

    await cache.get();
    vi.advanceTimersByTime(1000);
    await expect(cache.get()).resolves.toEqual(['new']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const pending = deferred<string[]>();
    const load = vi.fn().mockReturnValue(pending.promise);
    const cache = cached(load, 1000);

    const first = cache.get();
    const second = cache.get();
    pending.resolve(['a']);

    await expect(Promise.all([first, second])).resolves.toEqual([['a'], ['a']]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(['a']);
    const cache = cached(load, 1000);

    await expect(cache.get()).rejects.toThrow('down');
    await expect(cache.get()).resolves.toEqual(['a']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads again after invalidate', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new']);
    const cache = cached(load, 1000);

    await cache.get();
    cache.invalidate();
    await expect(cache.get()).resolves.toEqual(['new']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a load that started before invalidate fill the cache', async () => {
    const stale = deferred<string[]>();
    const load = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(['fresh'])
      .mockResolvedValueOnce(['later']);
    const cache = cached(load, 1000);

    const before = cache.get();
    cache.invalidate();
    const after = cache.get();
    stale.resolve(['stale']);

    await expect(before).resolves.toEqual(['stale']);
    await expect(after).resolves.toEqual(['fresh']);
    await expect(cache.get()).resolves.toEqual(['fresh']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('counts the ttl from when the load finished', async () => {
    const pending = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(['new']);
    const cache = cached(load, 1000);

    const first = cache.get();
    vi.advanceTimersByTime(5000);
    pending.resolve(['old']);
    await first;
    vi.advanceTimersByTime(999);
    await expect(cache.get()).resolves.toEqual(['old']);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
