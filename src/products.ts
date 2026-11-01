import { PRODUCT_SETTINGS, type InstanceConfig, type ProductId } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { createOverseerrClient } from './overseerr/client.js';
import { createOverseerrTools } from './overseerr/tools.js';
import { createProwlarrClient } from './prowlarr/client.js';
import { createProwlarrTools } from './prowlarr/tools.js';
import { createRadarrClient } from './radarr/client.js';
import { createRadarrTools } from './radarr/tools.js';
import { createSonarrClient } from './sonarr/client.js';
import { createSonarrTools } from './sonarr/tools.js';

const FACTORIES: Record<ProductId, (instance: InstanceConfig) => ToolDefinition[]> = {
  sonarr: (instance) => createSonarrTools(createSonarrClient(instance)),
  radarr: (instance) => createRadarrTools(createRadarrClient(instance)),
  prowlarr: (instance) => createProwlarrTools(createProwlarrClient(instance)),
  overseerr: (instance) => createOverseerrTools(createOverseerrClient(instance)),
};

export interface Product {
  id: ProductId;
  label: string;
  envPrefix: string;
  createTools: (instance: InstanceConfig) => ToolDefinition[];
}

/** The product registry, in PRODUCT_SETTINGS order: Sonarr, Radarr, Prowlarr, Overseerr. */
export const PRODUCTS: readonly Product[] = PRODUCT_SETTINGS.map((settings) => ({
  ...settings,
  createTools: FACTORIES[settings.id],
}));
