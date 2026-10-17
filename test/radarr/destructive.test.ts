import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

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

const base = 'http://radarr.test:7878/api/v3';
const ok = () => new HttpResponse(null, { status: 200 });
const tools = createRadarrTools(createRadarrClient({ baseUrl: 'http://radarr.test:7878', apiKey: 'k' }));

/** Calls a tool the way the MCP server does: arguments validated against its input schema first. */
function call(name: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.handler(z.object(tool.inputSchema).parse(args));
}

describe('Radarr destructive tools on the wire (defaults only)', () => {
  it('radarr_delete_queue_item keeps the download in the client and off the blocklist', async () => {
    server.use(http.delete(`${base}/queue/4`, ok));
    await call('radarr_delete_queue_item', { id: 4 });
    expect(wire).toEqual([
      {
        method: 'DELETE',
        path: '/api/v3/queue/4',
        query: { removeFromClient: 'false', blocklist: 'false' },
      },
    ]);
  });

  it('radarr_delete_blocklist_item deletes only that blocklist entry', async () => {
    server.use(http.delete(`${base}/blocklist/5`, ok));
    await call('radarr_delete_blocklist_item', { id: 5 });
    expect(wire).toEqual([{ method: 'DELETE', path: '/api/v3/blocklist/5', query: {} }]);
  });

  it('radarr_delete_movie_file deletes only that movie file', async () => {
    server.use(http.delete(`${base}/moviefile/9`, ok));
    await call('radarr_delete_movie_file', { movieFileId: 9 });
    expect(wire).toEqual([{ method: 'DELETE', path: '/api/v3/moviefile/9', query: {} }]);
  });

  it('radarr_delete_movie keeps the files and adds no import exclusion', async () => {
    server.use(http.delete(`${base}/movie/3`, ok));
    await call('radarr_delete_movie', { movieId: 3 });
    expect(wire).toEqual([
      {
        method: 'DELETE',
        path: '/api/v3/movie/3',
        query: { deleteFiles: 'false', addImportExclusion: 'false' },
      },
    ]);
  });
});
