import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeError } from '../http/errors.js';
import type { ToolDefinition } from './types.js';

// Read at runtime rather than imported: package.json sits outside rootDir
// ("src"), so a JSON import would drag the build's rootDir up and nest the
// output under dist/src. The relative path resolves from both src/mcp (tests)
// and dist/mcp (the built server; the Dockerfile copies package.json to the
// app root alongside dist/).
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

// Backstop for a list a tool forgot to bound: past this a result either
// exceeds the client's tool-result limit or fills the model's context, so an
// error that says how to narrow the call is more useful than the data.
export const MAX_RESULT_CHARS = 50_000;

export function toolResult(
  value: unknown,
  toolName?: string,
): { content: Array<{ type: 'text'; text: string }>; isError?: true } {
  const text = value === undefined ? 'Success.' : JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    const subject = toolName ? `${toolName} result` : 'Result';
    return {
      content: [
        {
          type: 'text',
          text:
            `${subject} too large (${text.length} characters, limit ${MAX_RESULT_CHARS}). ` +
            'Narrow it with limit/offset or a filter.',
        },
      ],
      isError: true,
    };
  }
  return { content: [{ type: 'text', text }] };
}

export function createServer(tools: ToolDefinition[]): McpServer {
  const server = new McpServer({ name: 'servarr-mcp', version });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          return toolResult(await tool.handler(args), tool.name);
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
