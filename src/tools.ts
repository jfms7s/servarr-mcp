import type { ServarrConfig } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { PRODUCTS, type ProductClients } from './products.js';
import { createWorkflowTools } from './workflows/tools.js';

export function buildTools(config: ServarrConfig): ToolDefinition[] {
  const clients: ProductClients = {};
  const productTools = PRODUCTS.flatMap((product) => {
    const instance = config[product.id];
    return instance ? product.createTools(instance, clients) : [];
  });
  return [...productTools, ...createWorkflowTools(clients)];
}
