import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSonarrClient } from '../../src/sonarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createSonarrClient({ baseUrl: 'http://sonarr.test:8989', apiKey: 'k' });
const url = (path: string) => `http://sonarr.test:8989/api/v3${path}`;

describe('SonarrClient', () => {
  it('lists series', async () => {
    server.use(http.get(url('/series'), () => HttpResponse.json([{ id: 1, title: 'Andor' }])));
    await expect(client.listSeries()).resolves.toEqual([{ id: 1, title: 'Andor' }]);
  });

  it('gets one series by id', async () => {
    server.use(http.get(url('/series/7'), () => HttpResponse.json({ id: 7, title: 'Severance' })));
    await expect(client.getSeries(7)).resolves.toMatchObject({ id: 7 });
  });

  it('looks up series by term', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/series/lookup'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('term');
        return HttpResponse.json([]);
      }),
    );
    await client.lookupSeries('the expanse');
    expect(seen).toBe('the expanse');
  });

  it('adds a series', async () => {
    let body: unknown;
    server.use(
      http.post(url('/series'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 12 }, { status: 201 });
      }),
    );
    await client.addSeries({
      title: 'Andor',
      tvdbId: 404,
      qualityProfileId: 1,
      rootFolderPath: '/tv',
    });
    expect(body).toMatchObject({ tvdbId: 404, rootFolderPath: '/tv' });
  });

  it('deletes a series and forwards the delete options as query params', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/series/3'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteSeries(3, { deleteFiles: true, addImportListExclusion: false });
    expect(params?.get('deleteFiles')).toBe('true');
    expect(params?.get('addImportListExclusion')).toBe('false');
  });

  it('lists episodes filtered by series and season', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/episode'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await client.listEpisodes(5, 2);
    expect(params?.get('seriesId')).toBe('5');
    expect(params?.get('seasonNumber')).toBe('2');
  });

  it('monitors episodes with a put body', async () => {
    let body: unknown;
    server.use(
      http.put(url('/episode/monitor'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([]);
      }),
    );
    await client.monitorEpisodes([1, 2], true);
    expect(body).toEqual({ episodeIds: [1, 2], monitored: true });
  });

  it('gets the queue as a paged response', async () => {
    server.use(
      http.get(url('/queue'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 1, records: [{ id: 9 }] }),
      ),
    );
    const queue = await client.getQueue({ page: 1 });
    expect(queue.records).toHaveLength(1);
    expect(queue.totalRecords).toBe(1);
  });

  it('deletes a queue item with removal options', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/queue/4'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteQueueItem(4, { removeFromClient: true, blocklist: true });
    expect(params?.get('removeFromClient')).toBe('true');
    expect(params?.get('blocklist')).toBe('true');
  });

  it('runs a command', async () => {
    let body: unknown;
    server.use(
      http.post(url('/command'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 1, name: 'SeriesSearch', status: 'queued' }, { status: 201 });
      }),
    );
    const command = await client.runCommand({ name: 'SeriesSearch', seriesId: 3 });
    expect(body).toEqual({ name: 'SeriesSearch', seriesId: 3 });
    expect(command.status).toBe('queued');
  });

  it('reads system status, health and disk space', async () => {
    server.use(
      http.get(url('/system/status'), () => HttpResponse.json({ appName: 'Sonarr', version: '4.0' })),
      http.get(url('/health'), () => HttpResponse.json([{ source: 'x', type: 'warning', message: 'm' }])),
      http.get(url('/diskspace'), () => HttpResponse.json([{ path: '/tv', freeSpace: 1 }])),
    );
    await expect(client.getSystemStatus()).resolves.toMatchObject({ appName: 'Sonarr' });
    await expect(client.getHealth()).resolves.toHaveLength(1);
    await expect(client.getDiskSpace()).resolves.toHaveLength(1);
  });

  it('searches releases by episodeId', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/release'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([{ guid: 'abc', title: 'Release 1' }]);
      }),
    );
    const releases = await client.searchReleases({ episodeId: 42 });
    expect(params?.get('episodeId')).toBe('42');
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ guid: 'abc', title: 'Release 1' });
  });

  it('searches releases by seriesId and seasonNumber', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/release'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await client.searchReleases({ seriesId: 7, seasonNumber: 2 });
    expect(params?.get('seriesId')).toBe('7');
    expect(params?.get('seasonNumber')).toBe('2');
  });

  it('grabs a release with guid and indexerId', async () => {
    let body: unknown;
    server.use(
      http.post(url('/release'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ guid: 'xyz', title: 'Grabbed Release' }, { status: 200 });
      }),
    );
    const result = await client.grabRelease({ guid: 'xyz', indexerId: 3 });
    expect(body).toEqual({ guid: 'xyz', indexerId: 3 });
    expect(result).toMatchObject({ guid: 'xyz', title: 'Grabbed Release' });
  });
});
