import express from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { bearerAuth } from './auth.js';

export async function startStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

export interface HttpHandle {
  close(): Promise<void>;
}

export async function startHttp(
  server: McpServer,
  options: { port: number; token: string },
): Promise<HttpHandle> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const app = express();
  app.use(express.json());
  app.all('/mcp', bearerAuth(options.token), (request, response) => {
    void transport.handleRequest(request, response, request.body);
  });

  const listener = app.listen(options.port);

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
