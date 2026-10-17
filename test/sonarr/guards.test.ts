import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

// The guarded wide-reaching tools wired to the real client: what is asserted is whether a
// request reaches the server at all, and what it carries when it does.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface WireRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

// Every request msw sees, handled or not, so an extra or misrouted call shows up too.
let wire: WireRequest[] = [];
beforeEach(() => {
  wire = [];
});
server.events.on('request:start', ({ request }) => {
  const target = new URL(request.url);
  wire.push({
    method: request.method,
    path: target.pathname,
    query: Object.fromEntries(target.searchParams),
  });
});

const base = 'http://sonarr.test:8989/api/v3';
const tools = createSonarrTools(
  createSonarrClient({ baseUrl: 'http://sonarr.test:8989', apiKey: 'k' }),
);

/** Calls a tool the way the MCP server does: arguments validated against its input schema first. */
function call(name: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.handler(z.object(tool.inputSchema).parse(args));
}

const series = { id: 3, title: 'Show', path: '/tv/Show', rootFolderPath: '/tv', folder: 'Show' };

describe('sonarr_run_command library-wide missing search', () => {
  it('without confirm, previews the missing count and sends no command', async () => {
    server.use(
      http.get(`${base}/wanted/missing`, () =>
        HttpResponse.json({ page: 1, pageSize: 1, totalRecords: 42, records: [] }),
      ),
    );
    const result = await call('sonarr_run_command', { name: 'MissingEpisodeSearch' });
    expect(result).toEqual({
      wouldRun: { command: 'MissingEpisodeSearch', missingCount: 42 },
      confirmRequired: true,
    });
    expect(wire).toEqual([
      { method: 'GET', path: '/api/v3/wanted/missing', query: { page: '1', pageSize: '1' } },
    ]);
  });

  it('with confirm: false, still previews and sends no command', async () => {
    server.use(
      http.get(`${base}/wanted/missing`, () =>
        HttpResponse.json({ page: 1, pageSize: 1, totalRecords: 0, records: [] }),
      ),
    );
    const result = await call('sonarr_run_command', {
      name: 'MissingEpisodeSearch',
      confirm: false,
    });
    expect(result).toMatchObject({ confirmRequired: true });
    expect(wire.filter((r) => r.path === '/api/v3/command')).toEqual([]);
  });

  it('with confirm: true, posts the command once without a confirm key', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${base}/command`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: 7, name: 'MissingEpisodeSearch', status: 'queued' });
      }),
    );
    await call('sonarr_run_command', { name: 'MissingEpisodeSearch', confirm: true });
    expect(wire).toEqual([{ method: 'POST', path: '/api/v3/command', query: {} }]);
    expect(bodies).toEqual([{ name: 'MissingEpisodeSearch' }]);
  });

  it('a targeted SeriesSearch needs no confirm and never sends one', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${base}/command`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: 8, name: 'SeriesSearch', status: 'queued' });
      }),
    );
    await call('sonarr_run_command', { name: 'SeriesSearch', seriesId: 3, confirm: true });
    expect(wire).toEqual([{ method: 'POST', path: '/api/v3/command', query: {} }]);
    expect(bodies).toEqual([{ name: 'SeriesSearch', seriesId: 3 }]);
  });
});

describe('Sonarr root-folder changes require an explicit moveFiles', () => {
  it('sonarr_update_series rejects rootFolderPath without moveFiles before any request', async () => {
    await expect(
      call('sonarr_update_series', { seriesId: 3, rootFolderPath: '/archive' }),
    ).rejects.toThrow(/moveFiles: true.*moveFiles: false/s);
    expect(wire).toEqual([]);
  });

  it.each([true, false])(
    'sonarr_update_series sends moveFiles=%s when given',
    async (moveFiles) => {
      server.use(
        http.get(`${base}/series/3`, () => HttpResponse.json(series)),
        http.put(`${base}/series/3`, async ({ request }) =>
          HttpResponse.json(await request.json()),
        ),
      );
      await call('sonarr_update_series', { seriesId: 3, rootFolderPath: '/archive', moveFiles });
      expect(wire).toEqual([
        { method: 'GET', path: '/api/v3/series/3', query: {} },
        { method: 'PUT', path: '/api/v3/series/3', query: { moveFiles: String(moveFiles) } },
      ]);
    },
  );

  it('sonarr_update_series without rootFolderPath does not need moveFiles', async () => {
    server.use(
      http.get(`${base}/series/3`, () => HttpResponse.json(series)),
      http.put(`${base}/series/3`, async ({ request }) => HttpResponse.json(await request.json())),
    );
    await call('sonarr_update_series', { seriesId: 3, monitored: false });
    expect(wire.map((r) => r.method)).toEqual(['GET', 'PUT']);
  });

  it('sonarr_bulk_edit_series rejects rootFolderPath without moveFiles before any request', async () => {
    await expect(
      call('sonarr_bulk_edit_series', { seriesIds: [1, 2], rootFolderPath: '/archive' }),
    ).rejects.toThrow(/moveFiles: true.*moveFiles: false/s);
    expect(wire).toEqual([]);
  });

  it.each([true, false])(
    'sonarr_bulk_edit_series sends moveFiles=%s when given',
    async (moveFiles) => {
      const bodies: unknown[] = [];
      server.use(
        http.put(`${base}/series/editor`, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json([]);
        }),
      );
      await call('sonarr_bulk_edit_series', {
        seriesIds: [1, 2],
        rootFolderPath: '/archive',
        moveFiles,
      });
      expect(wire).toEqual([{ method: 'PUT', path: '/api/v3/series/editor', query: {} }]);
      expect(bodies).toEqual([{ seriesIds: [1, 2], rootFolderPath: '/archive', moveFiles }]);
    },
  );

  it('sonarr_bulk_edit_series without rootFolderPath does not need moveFiles', async () => {
    server.use(http.put(`${base}/series/editor`, () => HttpResponse.json([])));
    await call('sonarr_bulk_edit_series', { seriesIds: [1, 2], monitored: false });
    expect(wire).toEqual([{ method: 'PUT', path: '/api/v3/series/editor', query: {} }]);
  });
});
