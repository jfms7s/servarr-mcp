import type { ServarrConfig } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { PRODUCTS } from './products.js';

export function buildTools(config: ServarrConfig): ToolDefinition[] {
  return PRODUCTS.flatMap((product) => {
    const instance = config[product.id];
    return instance ? product.createTools(instance) : [];
  });
}
