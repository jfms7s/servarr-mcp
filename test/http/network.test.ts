import net from 'node:net';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, createArrClient } from '../../src/http/client.js';
import { ArrApiError } from '../../src/http/errors.js';

describe('createArrClient network failures', () => {
  it('provides OS-level error detail for a real connection failure', async () => {
    // Point at a valid port nothing is listening on, with no MSW interceptor
    const client = createArrClient({
      product: 'Sonarr',
      baseUrl: 'http://127.0.0.1:54321',
      apiKey: 'test-key',
      apiBase: '/api/v3',
    });

    const error = (await client.get('/series').catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.status).toBeUndefined();
    // Real OS-level error indicators like ECONNREFUSED, ECONNRESET, etc.
    // Should contain indicators of connection failure, not the generic "fetch failed"
    expect(error.detail).toMatch(/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/);
    // Should NOT be the generic "fetch failed" message
    expect(error.detail).not.toBe('fetch failed');
  });
});

describe('createArrClient timeouts', () => {
  const servers: Array<net.Server> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            if ('closeAllConnections' in server) (server as http.Server).closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function listen(server: net.Server): Promise<string> {
    servers.push(server);
    // A silent server keeps its sockets open, so track them to destroy them on close.
    const sockets = new Set<net.Socket>();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    const close = server.close.bind(server);
    server.close = ((cb?: (err?: Error) => void) => {
      for (const socket of sockets) socket.destroy();
      return close(cb);
    }) as typeof server.close;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function delayedJson(delayMs: number): http.Server {
    return http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }, delayMs);
    });
  }

  const client = (baseUrl: string, timeoutMs?: number) =>
    createArrClient({ product: 'Sonarr', baseUrl, apiKey: 'k', apiBase: '/api/v3', timeoutMs });

  it('defaults to 30 s', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('gives up on a server that never answers', async () => {
    const baseUrl = await listen(net.createServer(() => {}));
    const started = Date.now();
    const error = (await client(baseUrl, 200)
      .get('/series')
      .catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.status).toBeUndefined();
    expect(error.detail).toContain('no response within 0.2 s');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives up when the body stalls after the headers', async () => {
    const baseUrl = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"ok":');
      }),
    );
    const error = (await client(baseUrl, 200)
      .get('/series')
      .catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.detail).toContain('no response within');
  });

  it('still succeeds for a slow server within the timeout', async () => {
    const baseUrl = await listen(delayedJson(50));
    await expect(client(baseUrl, 1_000).get('/series')).resolves.toEqual({ ok: true });
  });

  it('lets a call override the client timeout', async () => {
    const baseUrl = await listen(delayedJson(200));
    const arr = client(baseUrl, 100);
    await expect(arr.get('/series')).rejects.toThrow(/no response within 0.1 s/);
    await expect(arr.get('/series', undefined, { timeoutMs: 1_000 })).resolves.toEqual({
      ok: true,
    });
  });
});
