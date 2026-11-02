import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_INFO_PAGE, createTautulliClient } from '../../src/tautulli/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const KEY = 'secret-tautulli-key';
const client = createTautulliClient({ baseUrl: 'http://tautulli.test:8181', apiKey: KEY });
const api = 'http://tautulli.test:8181/api/v2';
const ok = (data: unknown) =>
  HttpResponse.json({ response: { result: 'success', message: null, data } });

describe('TautulliClient', () => {
  it('sends cmd and apikey as query parameters and unwraps the envelope', async () => {
    let query: Record<string, string> = {};
    server.use(
      http.get(api, ({ request }) => {
        query = Object.fromEntries(new URL(request.url).searchParams);
        return ok([{ section_id: '1', section_name: 'Movies', section_type: 'movie' }]);
      }),
    );
    await expect(client.getLibraries()).resolves.toEqual([
      { section_id: '1', section_name: 'Movies', section_type: 'movie' },
    ]);
    expect(query).toEqual({ cmd: 'get_libraries', apikey: KEY });
  });

  it('turns a 200 with result "error" into an error that does not quote the key', async () => {
    server.use(
      http.get(api, () =>
        HttpResponse.json({
          response: { result: 'error', message: `Invalid apikey ${KEY}`, data: {} },
        }),
      ),
    );
    const error = await client.getLibraries().then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Tautulli returned 200');
    expect(error.message).toContain('cmd=get_libraries');
    expect(error.message).toContain('Invalid apikey');
    expect(error.message).not.toContain(KEY);
  });

  it('never puts the key into an HTTP error', async () => {
    server.use(http.get(api, () => new HttpResponse('nope', { status: 500 })));
    const error = await client.getLibraries().then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error,
    );
    expect(error.message).toContain('Tautulli returned 500');
    expect(error.message).not.toContain(KEY);
  });

  it('pages get_library_media_info until every row is read', async () => {
    const starts: string[] = [];
    const total = MEDIA_INFO_PAGE + 2;
    server.use(
      http.get(api, ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get('cmd')).toBe('get_library_media_info');
        expect(params.get('section_id')).toBe('3');
        const start = Number(params.get('start'));
        starts.push(String(start));
        const count = Math.min(Number(params.get('length')), total - start);
        return ok({
          recordsFiltered: total,
          data: Array.from({ length: count }, (_, i) => ({ rating_key: start + i, title: 't' })),
        });
      }),
    );
    const rows = await client.listLibraryMedia(3);
    expect(rows).toHaveLength(total);
    expect(starts).toEqual(['0', String(MEDIA_INFO_PAGE)]);
  });

  it('redacts the key from an error body that quotes the request URL', async () => {
    server.use(
      http.get(
        api,
        ({ request }) => new HttpResponse(`bad request ${request.url}`, { status: 400 }),
      ),
    );
    const error = await client.getLibraries().then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error,
    );
    expect(error.message).toContain('Tautulli returned 400');
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain(KEY);
  });

  it('turns a success envelope without data into an error', async () => {
    server.use(http.get(api, () => HttpResponse.json({ response: { result: 'success' } })));
    await expect(client.getLibraries()).rejects.toThrow('the response carried no data');
  });

  it('keeps paging past a short page and a blank total until a page comes back empty', async () => {
    const all = 1200;
    const cap = 500;
    const starts: number[] = [];
    server.use(
      http.get(api, ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('start'));
        starts.push(start);
        const count = Math.max(0, Math.min(cap, all - start));
        return ok({
          recordsFiltered: '',
          data: Array.from({ length: count }, (_, i) => ({ rating_key: start + i, title: 't' })),
        });
      }),
    );
    const rows = await client.listLibraryMedia(1);
    expect(rows).toHaveLength(all);
    expect(starts).toEqual([0, 500, 1000, 1200]);
  });

  it('refuses to return a partial library when it never ends', async () => {
    server.use(
      http.get(api, ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('start'));
        return ok({
          recordsFiltered: '',
          data: Array.from({ length: MEDIA_INFO_PAGE }, (_, i) => ({
            rating_key: start + i,
            title: 't',
          })),
        });
      }),
    );
    await expect(client.listLibraryMedia(1)).rejects.toThrow(/not reading a partial library/);
  });
});
