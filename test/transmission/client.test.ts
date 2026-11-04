import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTransmissionClient } from '../../src/transmission/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const URL = 'http://transmission.test:9091/transmission/rpc';
const config = { baseUrl: 'http://transmission.test:9091', apiKey: '' };
const HASH = 'a'.repeat(40);

/** A daemon that wants session id "s1": 409 until the header matches. */
function daemon(onCall: (body: { method: string; arguments: Record<string, unknown> }) => unknown) {
  const seen: Array<{ session: string | null; auth: string | null; method: string }> = [];
  server.use(
    http.post(URL, async ({ request }) => {
      const body = (await request.json()) as { method: string; arguments: Record<string, unknown> };
      const session = request.headers.get('X-Transmission-Session-Id');
      seen.push({ session, auth: request.headers.get('Authorization'), method: body.method });
      if (session !== 's1')
        return new HttpResponse(null, {
          status: 409,
          headers: { 'X-Transmission-Session-Id': 's1' },
        });
      return HttpResponse.json({ result: 'success', arguments: onCall(body) });
    }),
  );
  return seen;
}

describe('TransmissionClient', () => {
  it('echoes the session id from a 409 and retries once, then reuses it', async () => {
    const seen = daemon(() => ({ torrents: [{ hashString: HASH }] }));
    const client = createTransmissionClient(config);
    await expect(client.getTorrents(['hashString'])).resolves.toEqual([{ hashString: HASH }]);
    expect(seen.map((s) => s.session)).toEqual([null, 's1']);
    await client.getTorrents(['hashString']);
    expect(seen.map((s) => s.session)).toEqual([null, 's1', 's1']);
  });

  it('fails clearly when the retry is refused with another 409', async () => {
    server.use(
      http.post(
        URL,
        () =>
          new HttpResponse(null, { status: 409, headers: { 'X-Transmission-Session-Id': 'x' } }),
      ),
    );
    await expect(createTransmissionClient(config).getTorrents(['name'])).rejects.toThrow(
      /Transmission returned 409 .*session id was rejected again/,
    );
  });

  it('fails when a 409 carries no session id', async () => {
    server.use(http.post(URL, () => new HttpResponse(null, { status: 409 })));
    await expect(createTransmissionClient(config).getTorrents(['name'])).rejects.toThrow(
      /409 carried no X-Transmission-Session-Id/,
    );
  });

  it('sends torrent-get fields, and ids only when asked', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    daemon((body) => {
      bodies.push(body.arguments);
      return { torrents: [] };
    });
    const client = createTransmissionClient(config);
    await client.getTorrents(['name']);
    await client.getTorrents(['name'], [HASH]);
    expect(bodies).toEqual([{ fields: ['name'] }, { fields: ['name'], ids: [HASH] }]);
  });

  it('maps each action to its RPC method with the ids', async () => {
    const calls: Array<[string, unknown]> = [];
    daemon((body) => {
      calls.push([body.method, body.arguments]);
      return {};
    });
    const client = createTransmissionClient(config);
    for (const action of ['start', 'start_now', 'stop', 'verify', 'reannounce'] as const)
      await client.applyAction(action, [HASH]);
    expect(calls).toEqual([
      ['torrent-start', { ids: [HASH] }],
      ['torrent-start-now', { ids: [HASH] }],
      ['torrent-stop', { ids: [HASH] }],
      ['torrent-verify', { ids: [HASH] }],
      ['torrent-reannounce', { ids: [HASH] }],
    ]);
  });

  it('sends torrent-remove with delete-local-data as given', async () => {
    const bodies: unknown[] = [];
    daemon((body) => {
      bodies.push(body.arguments);
      return {};
    });
    const client = createTransmissionClient(config);
    await client.removeTorrents([HASH], true);
    await client.removeTorrents([HASH], false);
    expect(bodies).toEqual([
      { ids: [HASH], 'delete-local-data': true },
      { ids: [HASH], 'delete-local-data': false },
    ]);
  });

  it('sends Basic auth only when credentials are configured, and never quotes them', async () => {
    const seen = daemon(() => ({ torrents: [] }));
    await createTransmissionClient(config).getTorrents(['name']);
    expect(seen.every((s) => s.auth === null)).toBe(true);

    seen.length = 0;
    const secured = createTransmissionClient({ ...config, username: 'user', password: 'hunter2' });
    await secured.getTorrents(['name']);
    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('user:hunter2').toString('base64')}`);

    server.use(http.post(URL, () => new HttpResponse('Unauthorized', { status: 401 })));
    const error = await secured.getTorrents(['name']).catch((e: Error) => e);
    expect((error as Error).message).toContain('Transmission returned 401');
    expect((error as Error).message).not.toContain('hunter2');
  });

  it('turns a non-success result into an error', async () => {
    server.use(http.post(URL, () => HttpResponse.json({ result: 'no method name' })));
    await expect(createTransmissionClient(config).getTorrents(['name'])).rejects.toThrow(
      /torrent-get failed: no method name/,
    );
  });

  it('names the base URL, without credentials, when the daemon is unreachable', async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    await expect(createTransmissionClient(config).getTorrents(['name'])).rejects.toThrow(
      /Cannot reach Transmission at http:\/\/transmission\.test:9091/,
    );
  });

  it('refuses a base URL that carries credentials without sending anything', async () => {
    const client = createTransmissionClient({
      baseUrl: 'http://u:pw@transmission.test:9091',
      apiKey: '',
    });
    const error = await client.getTorrents(['name']).catch((e: Error) => e);
    expect((error as Error).message).toContain('contains credentials');
    expect((error as Error).message).not.toContain('pw@');
  });

  it('does not report an unreadable body as invalid JSON', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('socket hang up'));
      },
    });
    server.use(http.post(URL, () => new HttpResponse(broken, { status: 200 })));
    await expect(createTransmissionClient(config).getTorrents(['name'])).rejects.toThrow(
      /could not be read/,
    );
  });

  it('shares one session id between concurrent first calls', async () => {
    daemon(() => ({ torrents: [] }));
    const client = createTransmissionClient(config);
    await expect(
      Promise.all([client.getTorrents(['name']), client.getTorrents(['name'])]),
    ).resolves.toEqual([[], []]);
  });
});
