import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { createServer } from '../../src/mcp/server.js';
import { defineTool } from '../../src/mcp/types.js';
import { startHttp } from '../../src/mcp/transport.js';

const testTool = defineTool({
  name: 'test_echo',
  description: 'Echo input back',
  inputSchema: { text: z.string().describe('Text to echo') },
  handler: async ({ text }) => ({ text }),
});

describe('startHttp integration', () => {
  let handle: Awaited<ReturnType<typeof startHttp>> | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it('handles two sequential MCP requests over HTTP with valid token', async () => {
    const token = 'test-secret-token';
    handle = await startHttp(() => createServer([testTool]), {
      port: 0,
      token,
    });

    const url = new URL(`http://localhost:${handle.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);

    // First request: tools/list (implicitly initializes)
    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(1);
    expect(toolsResult.tools[0]?.name).toBe('test_echo');

    // Second request: call the tool (this fails with single-transport bug)
    const callResult = await client.callTool({
      name: 'test_echo',
      arguments: { text: 'hello' },
    });
    expect(callResult.isError).toBeFalsy();
    expect(callResult.content[0]?.type).toBe('text');

    // Third request: call again to verify multiple requests work
    const callResult2 = await client.callTool({
      name: 'test_echo',
      arguments: { text: 'world' },
    });
    expect(callResult2.isError).toBeFalsy();

    await client.close();
  });

  it('rejects requests with missing authorization header', async () => {
    const token = 'test-secret-token';
    handle = await startHttp(() => createServer([testTool]), {
      port: 0,
      token,
    });

    const url = new URL(`http://localhost:${handle.port}/mcp`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('rejects requests with wrong bearer token', async () => {
    const token = 'test-secret-token';
    handle = await startHttp(() => createServer([testTool]), {
      port: 0,
      token,
    });

    const url = new URL(`http://localhost:${handle.port}/mcp`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
