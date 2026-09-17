import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArrApiError } from '../../src/http/errors.js';
import { createServer } from '../../src/mcp/server.js';
import { defineTool } from '../../src/mcp/types.js';

async function connect(tools: Parameters<typeof createServer>[0]) {
  const server = createServer(tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const echoTool = defineTool({
  name: 'sonarr_echo',
  description: 'Echo a series id back',
  inputSchema: { seriesId: z.number().int().describe('Series id') },
  handler: async ({ seriesId }) => ({ seriesId }),
});

describe('createServer', () => {
  it('lists registered tools with their descriptions', async () => {
    const client = await connect([echoTool]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['sonarr_echo']);
    expect(tools[0]?.description).toBe('Echo a series id back');
  });

  it('returns the handler result as pretty-printed json text', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 3 } });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ seriesId: 3 }, null, 2) }]);
    expect(result.isError).toBeFalsy();
  });

  it('reports an undefined result as a success message', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_void',
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

  it('rejects arguments that do not match the input schema', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 'three' } });
    expect(result.isError).toBe(true);
  });
});
