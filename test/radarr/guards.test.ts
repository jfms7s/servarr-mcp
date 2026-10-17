import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

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

const base = 'http://radarr.test:7878/api/v3';
const tools = createRadarrTools(
  createRadarrClient({ baseUrl: 'http://radarr.test:7878', apiKey: 'k' }),
);

/** Calls a tool the way the MCP server does: arguments validated against its input schema first. */
function call(name: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.handler(z.object(tool.inputSchema).parse(args));
}

const movie = {
  id: 3,
  title: 'Dune',
  path: '/movies/Dune (2021)',
  rootFolderPath: '/movies',
  folderName: 'Dune (2021)',
};

describe('radarr_run_command library-wide missing search', () => {
  it('without confirm, previews the missing count and sends no command', async () => {
    server.use(
      http.get(`${base}/wanted/missing`, () =>
        HttpResponse.json({ page: 1, pageSize: 1, totalRecords: 42, records: [] }),
      ),
    );
    const result = await call('radarr_run_command', { name: 'MissingMoviesSearch' });
    expect(result).toEqual({
      wouldRun: { command: 'MissingMoviesSearch', missingCount: 42 },
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
    const result = await call('radarr_run_command', {
      name: 'MissingMoviesSearch',
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
        return HttpResponse.json({ id: 7, name: 'MissingMoviesSearch', status: 'queued' });
      }),
    );
    await call('radarr_run_command', { name: 'MissingMoviesSearch', confirm: true });
    expect(wire).toEqual([{ method: 'POST', path: '/api/v3/command', query: {} }]);
    expect(bodies).toEqual([{ name: 'MissingMoviesSearch' }]);
  });

  it('a targeted MoviesSearch needs no confirm and never sends one', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${base}/command`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: 8, name: 'MoviesSearch', status: 'queued' });
      }),
    );
    await call('radarr_run_command', { name: 'MoviesSearch', movieIds: [3], confirm: true });
    expect(wire).toEqual([{ method: 'POST', path: '/api/v3/command', query: {} }]);
    expect(bodies).toEqual([{ name: 'MoviesSearch', movieIds: [3] }]);
  });
});

describe('Radarr root-folder changes require an explicit moveFiles', () => {
  it('radarr_update_movie rejects rootFolderPath without moveFiles before any request', async () => {
    await expect(
      call('radarr_update_movie', { movieId: 3, rootFolderPath: '/archive' }),
    ).rejects.toThrow(/moveFiles: true.*moveFiles: false/s);
    expect(wire).toEqual([]);
  });

  it.each([true, false])('radarr_update_movie sends moveFiles=%s when given', async (moveFiles) => {
    server.use(
      http.get(`${base}/movie/3`, () => HttpResponse.json(movie)),
      http.put(`${base}/movie/3`, async ({ request }) => HttpResponse.json(await request.json())),
    );
    await call('radarr_update_movie', { movieId: 3, rootFolderPath: '/archive', moveFiles });
    expect(wire).toEqual([
      { method: 'GET', path: '/api/v3/movie/3', query: {} },
      { method: 'PUT', path: '/api/v3/movie/3', query: { moveFiles: String(moveFiles) } },
    ]);
  });

  it('radarr_update_movie without rootFolderPath does not need moveFiles', async () => {
    server.use(
      http.get(`${base}/movie/3`, () => HttpResponse.json(movie)),
      http.put(`${base}/movie/3`, async ({ request }) => HttpResponse.json(await request.json())),
    );
    await call('radarr_update_movie', { movieId: 3, monitored: false });
    expect(wire.map((r) => r.method)).toEqual(['GET', 'PUT']);
  });

  it('radarr_bulk_edit_movies rejects rootFolderPath without moveFiles before any request', async () => {
    await expect(
      call('radarr_bulk_edit_movies', { movieIds: [1, 2], rootFolderPath: '/archive' }),
    ).rejects.toThrow(/moveFiles: true.*moveFiles: false/s);
    expect(wire).toEqual([]);
  });

  it.each([true, false])(
    'radarr_bulk_edit_movies sends moveFiles=%s when given',
    async (moveFiles) => {
      const bodies: unknown[] = [];
      server.use(
        http.put(`${base}/movie/editor`, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json([]);
        }),
      );
      await call('radarr_bulk_edit_movies', {
        movieIds: [1, 2],
        rootFolderPath: '/archive',
        moveFiles,
      });
      expect(wire).toEqual([{ method: 'PUT', path: '/api/v3/movie/editor', query: {} }]);
      expect(bodies).toEqual([{ movieIds: [1, 2], rootFolderPath: '/archive', moveFiles }]);
    },
  );

  it('radarr_bulk_edit_movies without rootFolderPath does not need moveFiles', async () => {
    server.use(http.put(`${base}/movie/editor`, () => HttpResponse.json([])));
    await call('radarr_bulk_edit_movies', { movieIds: [1, 2], monitored: false });
    expect(wire).toEqual([{ method: 'PUT', path: '/api/v3/movie/editor', query: {} }]);
  });
});
