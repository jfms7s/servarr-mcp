#!/usr/bin/env node
import { ConfigError, loadConfig } from './config.js';
import { createServer } from './mcp/server.js';
import { startHttp, startStdio } from './mcp/transport.js';
import { buildTools } from './tools.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const tools = buildTools(config);

  const enabled = [
    config.sonarr && 'Sonarr',
    config.radarr && 'Radarr',
    config.prowlarr && 'Prowlarr',
  ].filter(Boolean);

  // stdout carries the MCP protocol on the stdio transport, so log to stderr.
  console.error(`servarr-mcp: ${tools.length} tools from ${enabled.join(', ')}`);

  if (config.transport === 'http' || config.transport === 'both') {
    const http = await startHttp(() => createServer(tools), {
      port: config.port,
      token: config.token as string,
    });
    console.error(`servarr-mcp: http transport listening on port ${config.port}`);

    // This process is PID 1 in a container, and the kernel applies no default
    // signal disposition to PID 1 -- without these handlers SIGTERM is ignored
    // outright and every pod rollout waits out the full termination grace
    // period before being SIGKILLed.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        // Don't let a stuck connection hold the pod open for the whole grace
        // period; close() resolving first cancels this.
        const forceExit = setTimeout(() => process.exit(0), 5000);
        forceExit.unref();
        void http.close().then(
          () => process.exit(0),
          (error: unknown) => {
            console.error(error);
            process.exit(1);
          },
        );
      });
    }
  }

  if (config.transport === 'stdio' || config.transport === 'both') {
    await startStdio(createServer(tools));
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`servarr-mcp: ${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
