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
    await startHttp(() => createServer(tools), {
      port: config.port,
      token: config.token as string,
    });
    console.error(`servarr-mcp: http transport listening on port ${config.port}`);
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
