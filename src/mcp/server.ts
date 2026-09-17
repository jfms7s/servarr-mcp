import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeError } from '../http/errors.js';
import type { ToolDefinition } from './types.js';

export function toolResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = value === undefined ? 'Success.' : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function createServer(tools: ToolDefinition[]): McpServer {
  const server = new McpServer({ name: 'servarr-mcp', version: '0.1.0' });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          return toolResult(await tool.handler(args));
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: describeError(error) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
