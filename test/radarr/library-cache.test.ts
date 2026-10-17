import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_TTL_MS } from '../../src/http/cache.js';
import { createRadarrClient, type RadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';
import type { Movie } from '../../src/radarr/types.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://radarr.test:7878';
const url = (path: string) => `${base}/api/v3${path}`;

const movie = (id: number): Movie =>
  ({
    id,
    title: `Movie ${id}`,
    year: 2000 + id,
    tmdbId: 100 + id,
    path: `/movies/Movie ${id}`,
    rootFolderPath: '/movies',
    monitored: true,
    hasFile: true,
    qualityProfileId: 1,
    tags: [],
  }) as unknown as Movie;

let movieGets = 0;
let client: RadarrClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  movieGets = 0;
  client = createRadarrClient({ baseUrl: base, apiKey: 'k' });
  server.use(
    http.get(url('/movie'), () => {
      movieGets += 1;
      return HttpResponse.json([movie(1), movie(2), movie(3)]);
    }),
    http.get(url('/rootfolder'), () => HttpResponse.json([{ id: 1, path: '/movies', accessible: true }])),
  );
});
afterEach(() => vi.useRealTimers());

function tool(name: string) {
  const found = createRadarrTools(client).find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

describe('Radarr library cache', () => {
  it('serves two radarr_list_movies pages within the ttl from one GET /movie', async () => {
    const list = tool('radarr_list_movies');
    const first = (await list.handler({ limit: 2, offset: 0 })) as { movies: unknown[] };
    const second = (await list.handler({ limit: 2, offset: 2 })) as { movies: unknown[] };

    expect(first.movies).toHaveLength(2);
    expect(second.movies).toHaveLength(1);
    expect(movieGets).toBe(1);
  });

  it('serves radarr_find_duplicate_movies from the same download as the list', async () => {
    await tool('radarr_list_movies').handler({});
    const result = (await tool('radarr_find_duplicate_movies').handler({})) as { total: number };

    expect(result.total).toBe(3);
    expect(movieGets).toBe(1);
  });

  it('downloads again once the ttl has passed', async () => {
    await client.listMovies();
    vi.advanceTimersByTime(LIBRARY_TTL_MS);
    await client.listMovies();
    expect(movieGets).toBe(2);
  });

  it('downloads again when a list or duplicate tool passes refresh: true', async () => {
    await tool('radarr_list_movies').handler({});
    await tool('radarr_list_movies').handler({ refresh: true });
    await tool('radarr_find_duplicate_movies').handler({ refresh: true });
    expect(movieGets).toBe(3);
  });

  it('shares one GET /movie between concurrent calls', async () => {
    await Promise.all([client.listMovies(), client.listMovies(), client.listMovies()]);
    expect(movieGets).toBe(1);
  });

  it('does not cache a failed download', async () => {
    server.use(
      http.get(url('/movie'), () => {
        movieGets += 1;
        return new HttpResponse('boom', { status: 500 });
      }, { once: true }),
    );
    await expect(client.listMovies()).rejects.toThrow();
    await expect(client.listMovies()).resolves.toHaveLength(3);
    expect(movieGets).toBe(2);
  });

  describe('every write invalidates the cached list', () => {
    const writes: Array<[string, (c: RadarrClient) => Promise<unknown>]> = [
      ['addMovie', (c) => c.addMovie({ title: 'New', tmdbId: 9 } as never)],
      ['updateMovie', (c) => c.updateMovie(1, movie(1))],
      ['bulkEditMovies', (c) => c.bulkEditMovies({ movieIds: [1], monitored: false } as never)],
      ['deleteMovie', (c) => c.deleteMovie(1)],
      ['deleteMovieFile', (c) => c.deleteMovieFile(1)],
      ...(['RefreshMovie', 'RescanMovie', 'RenameFiles', 'RenameMovie', 'DownloadedMoviesScan'] as const).map(
        (name): [string, (c: RadarrClient) => Promise<unknown>] => [
          `runCommand ${name}`,
          (c) => c.runCommand({ name, movieIds: [1] }),
        ],
      ),
    ];

    beforeEach(() => {
      server.use(
        http.post(url('/movie'), () => HttpResponse.json(movie(9))),
        http.put(url('/movie/editor'), () => HttpResponse.json([movie(1)])),
        http.put(url('/movie/1'), () => HttpResponse.json(movie(1))),
        http.delete(url('/movie/1'), () => new HttpResponse(null, { status: 200 })),
        http.delete(url('/moviefile/1'), () => new HttpResponse(null, { status: 200 })),
        http.post(url('/command'), async ({ request }) => {
          const body = (await request.json()) as { name: string };
          return HttpResponse.json({ id: 7, name: body.name, status: 'queued' });
        }),
      );
    });

    it.each(writes)('%s', async (_name, write) => {
      await client.listMovies();
      await write(client);
      await client.listMovies();
      expect(movieGets).toBe(2);
    });

    it('a write that fails still invalidates, since it may have reached Radarr', async () => {
      server.use(http.put(url('/movie/1'), () => new HttpResponse('nope', { status: 500 })));
      await client.listMovies();
      await expect(client.updateMovie(1, movie(1))).rejects.toThrow();
      await client.listMovies();
      expect(movieGets).toBe(2);
    });

    it('radarr_import_folder', async () => {
      await client.listMovies();
      await tool('radarr_import_folder').handler({ path: '/downloads/Movie 9' });
      await client.listMovies();
      expect(movieGets).toBe(2);
    });

    it('a search command does not invalidate', async () => {
      await client.listMovies();
      await client.runCommand({ name: 'MoviesSearch', movieIds: [1] });
      await client.listMovies();
      expect(movieGets).toBe(1);
    });

    it('polling a library command that has completed invalidates', async () => {
      server.use(
        http.get(url('/command/7'), () =>
          HttpResponse.json({ id: 7, name: 'RescanMovie', status: 'completed' }),
        ),
      );
      await client.listMovies();
      await client.getCommand(7);
      await client.listMovies();
      expect(movieGets).toBe(2);
    });

    it('polling a command that is still running does not invalidate', async () => {
      server.use(
        http.get(url('/command/7'), () =>
          HttpResponse.json({ id: 7, name: 'RescanMovie', status: 'started' }),
        ),
      );
      await client.listMovies();
      await client.getCommand(7);
      await client.listMovies();
      expect(movieGets).toBe(1);
    });
  });
});
