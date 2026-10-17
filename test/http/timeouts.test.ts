import { describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '../../src/http/client.js';
import type { RequestOptions } from '../../src/http/client.js';

// Record the per-call options every product client passes to its http client.
const calls: Array<{ method: string; path: string; options?: RequestOptions }> = [];

vi.mock('../../src/http/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  const record = (method: string, path: string, options?: RequestOptions) => {
    calls.push({ method, path, options });
    return Promise.resolve([]);
  };
  return {
    ...actual,
    createArrClient: () => ({
      get: (path: string, _query?: unknown, options?: RequestOptions) =>
        record('GET', path, options),
      post: (path: string, _body?: unknown, _query?: unknown, options?: RequestOptions) =>
        record('POST', path, options),
      put: (path: string, _body?: unknown, _query?: unknown, options?: RequestOptions) =>
        record('PUT', path, options),
      del: (path: string, _query?: unknown, options?: RequestOptions) =>
        record('DELETE', path, options),
    }),
  };
});

const { EDITOR_TIMEOUT_MS, SEARCH_TIMEOUT_MS } = await import('../../src/http/client.js');
const { createSonarrClient } = await import('../../src/sonarr/client.js');
const { createRadarrClient } = await import('../../src/radarr/client.js');
const { createProwlarrClient } = await import('../../src/prowlarr/client.js');

const config = { baseUrl: 'http://arr.test', apiKey: 'k' };

function lastCall() {
  return calls.at(-1);
}

describe('slow endpoints get longer timeouts', () => {
  it('release and indexer searches use SEARCH_TIMEOUT_MS', async () => {
    await createSonarrClient(config).searchReleases({ episodeId: 1 });
    expect(lastCall()).toMatchObject({
      path: '/release',
      options: { timeoutMs: SEARCH_TIMEOUT_MS },
    });
    await createRadarrClient(config).searchReleases(1);
    expect(lastCall()).toMatchObject({
      path: '/release',
      options: { timeoutMs: SEARCH_TIMEOUT_MS },
    });
    await createProwlarrClient(config).search({ query: 'x' } as never);
    expect(lastCall()).toMatchObject({
      path: '/search',
      options: { timeoutMs: SEARCH_TIMEOUT_MS },
    });
  });

  it('bulk editor PUTs use EDITOR_TIMEOUT_MS', async () => {
    await createSonarrClient(config).bulkEditSeries({} as never);
    expect(lastCall()).toMatchObject({ method: 'PUT', options: { timeoutMs: EDITOR_TIMEOUT_MS } });
    await createRadarrClient(config).bulkEditMovies({} as never);
    expect(lastCall()).toMatchObject({ method: 'PUT', options: { timeoutMs: EDITOR_TIMEOUT_MS } });
  });

  it('other calls keep the default', async () => {
    await createSonarrClient(config).listTags();
    expect(lastCall()).toMatchObject({ path: '/tag', options: undefined });
  });

  it('timeouts are ordered default < search < editor', () => {
    expect(SEARCH_TIMEOUT_MS).toBe(90_000);
    expect(EDITOR_TIMEOUT_MS).toBe(120_000);
  });
});
