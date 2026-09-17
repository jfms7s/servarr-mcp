import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createArrClient } from '../../src/http/client.js';
import { ArrApiError } from '../../src/http/errors.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createArrClient({
  product: 'Sonarr',
  baseUrl: 'http://sonarr.test:8989',
  apiKey: 'test-key',
  apiBase: '/api/v3',
});

describe('createArrClient', () => {
  it('sends the api key header and resolves the path against the api base', async () => {
    let seenKey: string | null = null;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/series', ({ request }) => {
        seenKey = request.headers.get('X-Api-Key');
        return HttpResponse.json([{ id: 1 }]);
      }),
    );

    await expect(client.get('/series')).resolves.toEqual([{ id: 1 }]);
    expect(seenKey).toBe('test-key');
  });

  it('serialises query parameters and drops undefined and null values', async () => {
    let url: URL | undefined;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/episode', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );

    await client.get('/episode', { seriesId: 5, monitored: true, season: undefined, tag: null });

    expect(url?.searchParams.get('seriesId')).toBe('5');
    expect(url?.searchParams.get('monitored')).toBe('true');
    expect(url?.searchParams.has('season')).toBe(false);
    expect(url?.searchParams.has('tag')).toBe(false);
  });

  it('repeats array query parameters', async () => {
    let url: URL | undefined;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/queue', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ records: [] });
      }),
    );

    await client.get('/queue', { status: ['queued', 'paused'] });

    expect(url?.searchParams.getAll('status')).toEqual(['queued', 'paused']);
  });

  it('posts a json body', async () => {
    let body: unknown;
    server.use(
      http.post('http://sonarr.test:8989/api/v3/series', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 7 }, { status: 201 });
      }),
    );

    await expect(client.post('/series', { title: 'Andor' })).resolves.toEqual({ id: 7 });
    expect(body).toEqual({ title: 'Andor' });
  });

  it('returns undefined for a 204 with no body', async () => {
    server.use(
      http.delete('http://sonarr.test:8989/api/v3/series/9', () => new HttpResponse(null, { status: 204 })),
    );

    await expect(client.del('/series/9')).resolves.toBeUndefined();
  });

  it('maps a 404 with a json message to an ArrApiError', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/series/42', () =>
        HttpResponse.json({ message: 'series not found' }, { status: 404 }),
      ),
    );

    await expect(client.get('/series/42')).rejects.toThrow(
      'Sonarr returned 404 for GET /api/v3/series/42: series not found',
    );
  });

  it('flattens arr validation errors', async () => {
    server.use(
      http.post('http://sonarr.test:8989/api/v3/series', () =>
        HttpResponse.json(
          [
            { propertyName: 'rootFolderPath', errorMessage: 'is required' },
            { propertyName: 'qualityProfileId', errorMessage: 'must be greater than 0' },
          ],
          { status: 400 },
        ),
      ),
    );

    await expect(client.post('/series', {})).rejects.toThrow(
      'rootFolderPath is required; qualityProfileId must be greater than 0',
    );
  });

  it('gives a dedicated message for an auth failure and never echoes the key', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/health', () => new HttpResponse(null, { status: 401 })),
    );

    const error = await client.get('/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrApiError);
    expect((error as ArrApiError).message).toContain('rejected the API key');
    expect((error as ArrApiError).message).not.toContain('test-key');
  });

  it('truncates a long unparseable error body', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/health', () =>
        new HttpResponse('x'.repeat(1000), { status: 500 }),
      ),
    );

    const error = (await client.get('/health').catch((e: unknown) => e)) as ArrApiError;
    expect(error.detail.length).toBeLessThanOrEqual(203);
    expect(error.detail.endsWith('...')).toBe(true);
  });

  it('wraps a network failure as an unreachable ArrApiError', async () => {
    server.use(http.get('http://sonarr.test:8989/api/v3/health', () => HttpResponse.error()));

    const error = (await client.get('/health').catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.status).toBeUndefined();
    expect(error.message).toContain('Cannot reach Sonarr');
  });
});
