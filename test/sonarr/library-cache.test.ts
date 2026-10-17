import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_TTL_MS } from '../../src/http/cache.js';
import { createSonarrClient, type SonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';
import type { Series } from '../../src/sonarr/types.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://sonarr.test:8989';
const url = (path: string) => `${base}/api/v3${path}`;

const series = (id: number): Series => ({
  id,
  title: `Show ${id}`,
  status: 'continuing',
  year: 2000 + id,
  monitored: true,
  qualityProfileId: 1,
  rootFolderPath: '/tv',
  path: `/tv/Show ${id}`,
  tvdbId: 100 + id,
  tags: [],
  seasons: [],
});

let seriesGets = 0;
let client: SonarrClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  seriesGets = 0;
  client = createSonarrClient({ baseUrl: base, apiKey: 'k' });
  server.use(
    http.get(url('/series'), () => {
      seriesGets += 1;
      return HttpResponse.json([series(1), series(2), series(3)]);
    }),
  );
});
afterEach(() => vi.useRealTimers());

function tool(name: string) {
  const found = createSonarrTools(client).find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

describe('Sonarr library cache', () => {
  it('serves two sonarr_list_series pages and sonarr_find_duplicate_series from one GET /series', async () => {
    const list = tool('sonarr_list_series');
    const first = (await list.handler({ limit: 2, offset: 0 })) as { series: unknown[] };
    const second = (await list.handler({ limit: 2, offset: 2 })) as { series: unknown[] };
    const duplicates = (await tool('sonarr_find_duplicate_series').handler({})) as { total: number };

    expect(first.series).toHaveLength(2);
    expect(second.series).toHaveLength(1);
    expect(duplicates.total).toBe(3);
    expect(seriesGets).toBe(1);
  });

  it('downloads again once the ttl has passed', async () => {
    await client.listSeries();
    vi.advanceTimersByTime(LIBRARY_TTL_MS - 1);
    await client.listSeries();
    expect(seriesGets).toBe(1);
    vi.advanceTimersByTime(1);
    await client.listSeries();
    expect(seriesGets).toBe(2);
  });

  it('downloads again when a list or duplicate tool passes refresh: true', async () => {
    await tool('sonarr_list_series').handler({});
    await tool('sonarr_list_series').handler({ refresh: true });
    await tool('sonarr_find_duplicate_series').handler({ refresh: true });
    expect(seriesGets).toBe(3);
  });

  it('shares one GET /series between concurrent calls', async () => {
    await Promise.all([client.listSeries(), client.listSeries(), client.listSeries()]);
    expect(seriesGets).toBe(1);
  });

  it('does not cache a failed download', async () => {
    server.use(
      http.get(url('/series'), () => {
        seriesGets += 1;
        return new HttpResponse('boom', { status: 500 });
      }, { once: true }),
    );
    await expect(client.listSeries()).rejects.toThrow();
    await expect(client.listSeries()).resolves.toHaveLength(3);
    expect(seriesGets).toBe(2);
  });

  describe('every write invalidates the cached list', () => {
    const writes: Array<[string, (c: SonarrClient) => Promise<unknown>]> = [
      ['addSeries', (c) => c.addSeries({ title: 'New', tvdbId: 9 } as never)],
      ['updateSeries', (c) => c.updateSeries(1, series(1))],
      ['bulkEditSeries', (c) => c.bulkEditSeries({ seriesIds: [1], monitored: false } as never)],
      ['deleteSeries', (c) => c.deleteSeries(1)],
      ['deleteEpisodeFile', (c) => c.deleteEpisodeFile(1)],
      ['monitorEpisodes', (c) => c.monitorEpisodes([1], false)],
      ...(['RefreshSeries', 'RescanSeries', 'RenameFiles', 'DownloadedEpisodesScan'] as const).map(
        (name): [string, (c: SonarrClient) => Promise<unknown>] => [
          `runCommand ${name}`,
          (c) => c.runCommand({ name, seriesId: 1 }),
        ],
      ),
    ];

    beforeEach(() => {
      server.use(
        http.post(url('/series'), () => HttpResponse.json(series(9))),
        http.put(url('/series/editor'), () => HttpResponse.json([series(1)])),
        http.put(url('/series/1'), () => HttpResponse.json(series(1))),
        http.delete(url('/series/1'), () => new HttpResponse(null, { status: 200 })),
        http.delete(url('/episodefile/1'), () => new HttpResponse(null, { status: 200 })),
        http.put(url('/episode/monitor'), () => HttpResponse.json([])),
        http.post(url('/command'), async ({ request }) => {
          const body = (await request.json()) as { name: string };
          return HttpResponse.json({ id: 7, name: body.name, status: 'queued' });
        }),
      );
    });

    it.each(writes)('%s', async (_name, write) => {
      await client.listSeries();
      await write(client);
      await client.listSeries();
      expect(seriesGets).toBe(2);
    });

    it('a write that fails still invalidates, since it may have reached Sonarr', async () => {
      server.use(http.delete(url('/series/1'), () => new HttpResponse('nope', { status: 500 })));
      await client.listSeries();
      await expect(client.deleteSeries(1)).rejects.toThrow();
      await client.listSeries();
      expect(seriesGets).toBe(2);
    });

    it('sonarr_import_folder', async () => {
      await client.listSeries();
      await tool('sonarr_import_folder').handler({ path: '/downloads/Show 9' });
      await client.listSeries();
      expect(seriesGets).toBe(2);
    });

    it('a search command does not invalidate', async () => {
      await client.listSeries();
      await client.runCommand({ name: 'SeriesSearch', seriesId: 1 });
      await client.listSeries();
      expect(seriesGets).toBe(1);
    });

    it('polling a library command that has completed invalidates', async () => {
      server.use(
        http.get(url('/command/7'), () =>
          HttpResponse.json({ id: 7, name: 'RescanSeries', status: 'completed' }),
        ),
      );
      await client.listSeries();
      await client.getCommand(7);
      await client.listSeries();
      expect(seriesGets).toBe(2);
    });
  });
});
