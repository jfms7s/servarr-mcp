import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProwlarrClient } from '../../src/prowlarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createProwlarrClient({ baseUrl: 'http://prowlarr.test:9696', apiKey: 'k' });
const url = (path: string) => `http://prowlarr.test:9696/api/v1${path}`;

describe('ProwlarrClient', () => {
  it('uses the v1 api base', async () => {
    server.use(http.get(url('/indexer'), () => HttpResponse.json([{ id: 1, name: 'nzbgeek' }])));
    await expect(client.listIndexers()).resolves.toHaveLength(1);
  });

  it('searches with query, indexer ids and categories', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/search'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );

    await client.search({ query: 'dune', indexerIds: [1, 2], categories: [2000], limit: 50 });

    expect(params?.get('query')).toBe('dune');
    expect(params?.getAll('indexerIds')).toEqual(['1', '2']);
    expect(params?.getAll('categories')).toEqual(['2000']);
    expect(params?.get('limit')).toBe('50');
  });

  it('grabs a release by guid and indexer id', async () => {
    let body: unknown;
    server.use(
      http.post(url('/search'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await client.grabRelease({ guid: 'abc', indexerId: 3 });
    expect(body).toEqual({ guid: 'abc', indexerId: 3 });
  });

  it('reads indexer stats and status', async () => {
    server.use(
      http.get(url('/indexerstats'), () => HttpResponse.json({ indexers: [] })),
      http.get(url('/indexerstatus'), () => HttpResponse.json([])),
    );
    await expect(client.getIndexerStats()).resolves.toEqual({ indexers: [] });
    await expect(client.getIndexerStatus()).resolves.toEqual([]);
  });

  it('reads history as a paged response', async () => {
    server.use(
      http.get(url('/history'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 0, records: [] }),
      ),
    );
    await expect(client.getHistory({ page: 1 })).resolves.toMatchObject({ totalRecords: 0 });
  });

  it('lists applications and download clients', async () => {
    server.use(
      http.get(url('/applications'), () => HttpResponse.json([{ id: 1, name: 'Sonarr' }])),
      http.get(url('/downloadclient'), () => HttpResponse.json([{ id: 2, name: 'sab' }])),
    );
    await expect(client.listApplications()).resolves.toHaveLength(1);
    await expect(client.listDownloadClients()).resolves.toHaveLength(1);
  });
});
