import type { ToolDefinition } from '../mcp/types.js';
import type { ProductClients } from '../products.js';
import { createCleanupReportTool } from './cleanup.js';

/**
 * Tools that span products, each registered only when the products it needs are configured.
 * They take product clients, never another product's tools.
 */
export function createWorkflowTools(clients: ProductClients): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (clients.tautulli && (clients.radarr || clients.sonarr)) {
    tools.push(
      createCleanupReportTool({
        tautulli: clients.tautulli,
        radarr: clients.radarr,
        sonarr: clients.sonarr,
      }),
    );
  }
  return tools;
}
