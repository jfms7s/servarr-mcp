import { readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ArrApiError } from '../../src/http/errors.js';
import { currentRequestSignal } from '../../src/http/cancellation.js';
import { createServer, toolResult } from '../../src/mcp/server.js';
import { defineTool } from '../../src/mcp/types.js';
import { buildTools } from '../../src/tools.js';

async function connect(tools: Parameters<typeof createServer>[0]) {
  const server = createServer(tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const echoTool = defineTool({
  name: 'sonarr_echo',
  effect: 'read',
  description: 'Echo a series id back',
  inputSchema: { seriesId: z.number().int().describe('Series id') },
  handler: async ({ seriesId }) => ({ seriesId }),
});

describe('createServer', () => {
  it('reports the package.json version, not a hardcoded one', async () => {
    // It was hardcoded as '0.1.0' and still said so while v0.1.2 was
    // running in production. Reading package.json is what keeps a client's
    // view of the server version honest across releases.
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const client = await connect([echoTool]);
    expect(client.getServerVersion()).toEqual({ name: 'servarr-mcp', version });
  });

  it('lists registered tools with their descriptions', async () => {
    const client = await connect([echoTool]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['sonarr_echo']);
    expect(tools[0]?.description).toBe('Echo a series id back');
  });

  it('lists each tool with annotations derived from its effect', async () => {
    const deleteTool = defineTool({
      name: 'sonarr_delete_thing',
      effect: 'destructive',
      description: 'Delete a thing',
      inputSchema: {},
      handler: async () => undefined,
    });
    const client = await connect([echoTool, deleteTool]);
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.sonarr_echo).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.sonarr_delete_thing).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('returns the handler result as compact json text', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 3 } });
    expect(result.content).toEqual([{ type: 'text', text: '{"seriesId":3}' }]);
    expect(result.isError).toBeFalsy();
  });

  it('reports an undefined result as a success message', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_void',
        effect: 'read',
        description: 'Returns nothing',
        inputSchema: {},
        handler: async () => undefined,
      }),
    ]);
    const result = await client.callTool({ name: 'sonarr_void', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'Success.' }]);
  });

  it('converts a thrown ArrApiError into a tool error rather than a transport failure', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_boom',
        effect: 'read',
        description: 'Always fails',
        inputSchema: {},
        handler: async () => {
          throw new ArrApiError({
            product: 'Sonarr',
            method: 'GET',
            path: '/api/v3/series/1',
            status: 404,
            detail: 'series not found',
          });
        },
      }),
    ]);

    const result = await client.callTool({ name: 'sonarr_boom', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Sonarr returned 404 for GET /api/v3/series/1: series not found' },
    ]);
  });

  it('passes the call\'s abort signal to the handler and into the request scope', async () => {
    let received: AbortSignal | undefined;
    let scoped: AbortSignal | undefined;
    const client = await connect([
      defineTool({
        name: 'signal_probe',
        effect: 'read',
        description: 'Records its signal',
        inputSchema: {},
        handler: async (_args, context) => {
          received = context?.signal;
          scoped = currentRequestSignal();
          return {};
        },
      }),
    ]);
    await client.callTool({ name: 'signal_probe', arguments: {} });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(scoped).toBe(received);
  });

  it('rejects arguments that do not match the input schema', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 'three' } });
    expect(result.isError).toBe(true);
  });
});

describe('toolResult', () => {
  it('returns small values unchanged as compact json', () => {
    const result = toolResult({ a: [1, 2] });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"a":[1,2]}' }] });
    expect(result).not.toHaveProperty('isError');
  });

  it('returns an error instead of a result over 50,000 characters', () => {
    const result = toolResult({ blob: 'x'.repeat(60_000) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/^Result too large \(60011 characters, limit 50000\)/);
    expect(result.content[0]?.text).toContain('limit/offset');
  });

  it('names the tool in the error when called through the server', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_huge',
        effect: 'read',
        description: 'Returns too much',
        inputSchema: {},
        handler: async () => ({ blob: 'x'.repeat(60_000) }),
      }),
    ]);
    const result = await client.callTool({ name: 'sonarr_huge', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('sonarr_huge');
  });
});

describe('real tool schemas through createServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const instance = { baseUrl: 'http://127.0.0.1:1', apiKey: 'k' };
  const all = buildTools({
    transport: 'stdio',
    host: '127.0.0.1',
    port: 3000,
    sonarr: instance,
    radarr: instance,
    prowlarr: instance,
    overseerr: instance,
  });

  it.each([
    ['radarr_bulk_edit_movies', { movieIds: [] }],
    ['sonarr_get_history', { pageSize: 0 }],
    ['radarr_get_movie', { movieId: 'three' }],
  ])('%s rejects %j before any HTTP request', async (name, args) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect(all);
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(text).not.toMatch(/Cannot reach/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
