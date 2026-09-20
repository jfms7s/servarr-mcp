import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRadarrClient } from '../../src/radarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createRadarrClient({ baseUrl: 'http://radarr.test:7878', apiKey: 'k' });
const url = (path: string) => `http://radarr.test:7878/api/v3${path}`;

describe('RadarrClient', () => {
  it('lists movies', async () => {
    server.use(http.get(url('/movie'), () => HttpResponse.json([{ id: 1, title: 'Dune' }])));
    await expect(client.listMovies()).resolves.toEqual([{ id: 1, title: 'Dune' }]);
  });

  it('gets one movie by id', async () => {
    server.use(http.get(url('/movie/4'), () => HttpResponse.json({ id: 4, title: 'Arrival' })));
    await expect(client.getMovie(4)).resolves.toMatchObject({ id: 4 });
  });

  it('looks up movies by term', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/lookup'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('term');
        return HttpResponse.json([]);
      }),
    );
    await client.lookupMovie('dune');
    expect(seen).toBe('dune');
  });

  it('looks up a movie by tmdb id', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/lookup/tmdb'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('tmdbId');
        return HttpResponse.json({ tmdbId: 438631 });
      }),
    );
    await client.lookupMovieByTmdbId(438631);
    expect(seen).toBe('438631');
  });

  it('adds a movie', async () => {
    let body: unknown;
    server.use(
      http.post(url('/movie'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 2 }, { status: 201 });
      }),
    );
    await client.addMovie({ title: 'Dune', tmdbId: 438631, qualityProfileId: 1, rootFolderPath: '/movies' });
    expect(body).toMatchObject({ tmdbId: 438631, rootFolderPath: '/movies' });
  });

  it('deletes a movie using radarr addImportExclusion spelling', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/movie/3'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteMovie(3, { deleteFiles: true, addImportExclusion: true });
    expect(params?.get('deleteFiles')).toBe('true');
    expect(params?.get('addImportExclusion')).toBe('true');
  });

  it('gets the queue as a paged response', async () => {
    server.use(
      http.get(url('/queue'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 1, records: [{ id: 3 }] }),
      ),
    );
    await expect(client.getQueue({ page: 1 })).resolves.toMatchObject({ totalRecords: 1 });
  });

  it('lists collections', async () => {
    server.use(http.get(url('/collection'), () => HttpResponse.json([{ id: 1, title: 'Dune Collection' }])));
    await expect(client.listCollections()).resolves.toHaveLength(1);
  });

  it('runs a command', async () => {
    let body: unknown;
    server.use(
      http.post(url('/command'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 1, name: 'MoviesSearch', status: 'queued' }, { status: 201 });
      }),
    );
    await client.runCommand({ name: 'MoviesSearch', movieIds: [3] });
    expect(body).toEqual({ name: 'MoviesSearch', movieIds: [3] });
  });

  it('reads system status, health and disk space', async () => {
    server.use(
      http.get(url('/system/status'), () => HttpResponse.json({ appName: 'Radarr', version: '5.0' })),
      http.get(url('/health'), () => HttpResponse.json([])),
      http.get(url('/diskspace'), () => HttpResponse.json([])),
    );
    await expect(client.getSystemStatus()).resolves.toMatchObject({ appName: 'Radarr' });
    await expect(client.getHealth()).resolves.toEqual([]);
    await expect(client.getDiskSpace()).resolves.toEqual([]);
  });

  it('searches releases for a movie', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/release'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('movieId');
        return HttpResponse.json([
          {
            guid: 'abc-123',
            title: 'Dune.2021.1080p',
            indexerId: 1,
            indexer: 'Test Indexer',
            size: 5368709120,
            age: 14,
            protocol: 'torrent',
            approved: true,
          },
        ]);
      }),
    );
    const releases = await client.searchReleases(12);
    expect(seen).toBe('12');
    expect(releases).toHaveLength(1);
    expect(releases[0]?.guid).toBe('abc-123');
  });

  it('grabs a release', async () => {
    let body: unknown;
    server.use(
      http.post(url('/release'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          guid: 'abc-123',
          title: 'Dune.2021.1080p',
          indexerId: 1,
          indexer: 'Test Indexer',
          size: 5368709120,
          age: 14,
          protocol: 'torrent',
          approved: true,
        });
      }),
    );
    await client.grabRelease({ guid: 'abc-123', indexerId: 1 });
    expect(body).toEqual({ guid: 'abc-123', indexerId: 1 });
  });

  it('updates a movie with moveFiles query parameter', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.put(url('/movie/5'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ id: 5, title: 'Dune' });
      }),
    );
    const moviePayload = {
      id: 5,
      title: 'Dune',
      tags: [],
      monitored: true,
      qualityProfileId: 1,
      tmdbId: 1,
      year: 2021,
      status: 'released',
      hasFile: true,
    };
    await client.updateMovie(5, moviePayload as Parameters<typeof client.updateMovie>[1], {
      moveFiles: true,
    });
    expect(params?.get('moveFiles')).toBe('true');
  });

  it('bulk edits movies', async () => {
    let body: unknown;
    server.use(
      http.put(url('/movie/editor'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { id: 1, title: 'Movie 1' },
          { id: 2, title: 'Movie 2' },
        ]);
      }),
    );
    await client.bulkEditMovies({ movieIds: [1, 2], monitored: false });
    expect(body).toEqual({ movieIds: [1, 2], monitored: false });
  });

  it('gets rename preview for movies', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/rename'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([
          {
            id: 1,
            movieId: 5,
            movieFileId: 10,
            existingPath: '/movies/Dune/file.mkv',
            newPath: '/movies/Dune [2021]/file.mkv',
          },
        ]);
      }),
    );
    await client.renamePreview([5]);
    expect(params?.getAll('movieId')).toEqual(['5']);
  });
});
