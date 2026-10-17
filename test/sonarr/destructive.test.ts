import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

// The destructive tools wired to the real client, so the request that reaches the
// server is what is asserted, not what the tool hands to a mocked client.

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
const ok = () => new HttpResponse(null, { status: 200 });
const tools = createSonarrTools(createSonarrClient({ baseUrl: 'http://sonarr.test:8989', apiKey: 'k' }));

/** Calls a tool the way the MCP server does: arguments validated against its input schema first. */
function call(name: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.handler(z.object(tool.inputSchema).parse(args));
}

describe('Sonarr destructive tools on the wire (defaults only)', () => {
  it('sonarr_delete_queue_item keeps the download in the client and off the blocklist', async () => {
    server.use(http.delete(`${base}/queue/4`, ok));
    await call('sonarr_delete_queue_item', { id: 4 });
    expect(wire).toEqual([
      {
        method: 'DELETE',
        path: '/api/v3/queue/4',
        query: { removeFromClient: 'false', blocklist: 'false' },
      },
    ]);
  });

  it('sonarr_delete_blocklist_item deletes only that blocklist entry', async () => {
    server.use(http.delete(`${base}/blocklist/5`, ok));
    await call('sonarr_delete_blocklist_item', { id: 5 });
    expect(wire).toEqual([{ method: 'DELETE', path: '/api/v3/blocklist/5', query: {} }]);
  });

  it('sonarr_delete_episode_file deletes only that episode file', async () => {
    server.use(http.delete(`${base}/episodefile/9`, ok));
    await call('sonarr_delete_episode_file', { episodeFileId: 9 });
    expect(wire).toEqual([{ method: 'DELETE', path: '/api/v3/episodefile/9', query: {} }]);
  });

  it('sonarr_delete_series keeps the files and adds no import list exclusion', async () => {
    server.use(http.delete(`${base}/series/3`, ok));
    await call('sonarr_delete_series', { seriesId: 3 });
    expect(wire).toEqual([
      {
        method: 'DELETE',
        path: '/api/v3/series/3',
        query: { deleteFiles: 'false', addImportListExclusion: 'false' },
      },
    ]);
  });

  it('sonarr_monitor_episodes sends the episode ids and state in the PUT body', async () => {
    let body: unknown;
    server.use(
      http.put(`${base}/episode/monitor`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { id: 11, seriesId: 3, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', monitored: false, hasFile: false },
        ]);
      }),
    );
    const result = await call('sonarr_monitor_episodes', { episodeIds: [11, 12], monitored: false });
    expect(wire).toEqual([{ method: 'PUT', path: '/api/v3/episode/monitor', query: {} }]);
    expect(body).toEqual({ episodeIds: [11, 12], monitored: false });
    expect(result).toEqual([expect.objectContaining({ id: 11, monitored: false })]);
  });
});
