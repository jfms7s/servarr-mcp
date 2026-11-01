import express, { type ErrorRequestHandler } from 'express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { bearerAuth } from './auth.js';

export async function startStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

// express.json() fails a bad body (malformed JSON, too large, unsupported charset or
// encoding) with an error carrying a string `type` and a 4xx `status`, which Express would
// answer with its HTML error page (stack trace and paths outside production). Answer it as
// JSON-RPC instead, with a fixed message; anything else goes on to the default handler.
const bodyParserError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  if (typeof type !== 'string' || typeof status !== 'number' || status < 400 || status > 499) {
    next(error);
    return;
  }
  const parseFailed = type === 'entity.parse.failed';
  response.status(status).json({
    jsonrpc: '2.0',
    error: parseFailed
      ? { code: -32700, message: 'Parse error' }
      : { code: -32600, message: status === 413 ? 'Invalid Request: body too large' : 'Invalid Request' },
    id: null,
  });
};

export interface HttpHandle {
  port: number;
  /** The address actually bound, e.g. `127.0.0.1`, or `::` for `*` on a dual-stack host. */
  address: string;
  close(): Promise<void>;
}

export async function startHttp(
  createMcpServer: () => McpServer,
  options: { port: number; host?: string; token: string },
): Promise<HttpHandle> {
  const app = express();

  // Deliberately before bearerAuth and deliberately contentless: a Kubernetes
  // probe cannot present a token, and /mcp answers an unauthenticated request
  // with 401, which a probe reads as a failing container. Reaching here proves
  // the event loop is still serving, which is what a probe is for -- it says
  // nothing about the arr instances, and must never report on them, since that
  // would take the pod down for an outage outside it.
  app.get('/healthz', (_request, response) => {
    response.type('text/plain').send('ok');
  });

  app.all('/mcp', bearerAuth(options.token), express.json(), (request, response) => {
    void (async () => {
      const server = createMcpServer();
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    })().catch((error: unknown) => {
      // Tool errors never get here (createServer turns them into results), so this is the
      // transport itself failing; without the log a 500 would leave no trace.
      console.error('servarr-mcp: /mcp request failed:', error);
      if (!response.headersSent) response.status(500).json({ error: 'internal error' });
    });
  });

  // After the /mcp route: bearerAuth runs first, so an unauthenticated malformed body still gets 401.
  app.use('/mcp', bodyParserError);

  // `*` leaves the host out, so Node binds `::` (dual-stack) where IPv6 exists and falls back
  // to 0.0.0.0 where it doesn't -- what the server did before the host became configurable.
  const host = options.host ?? '127.0.0.1';
  const listener = host === '*' ? app.listen(options.port) : app.listen(options.port, host);
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });

  const addr = listener.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : options.port;
  const address = typeof addr === 'object' && addr !== null ? addr.address : host;

  return {
    port,
    address,
    close: () =>
      new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
        // close() alone stops new connections but waits for keep-alive ones to
        // go idle on their own, which a polling MCP client may never do.
        listener.closeIdleConnections();
      }),
  };
}
