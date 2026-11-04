import { PRODUCT_SETTINGS, type InstanceConfig, type ProductId } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { createOverseerrClient, type OverseerrClient } from './overseerr/client.js';
import { createOverseerrTools } from './overseerr/tools.js';
import { createProwlarrClient, type ProwlarrClient } from './prowlarr/client.js';
import { createProwlarrTools } from './prowlarr/tools.js';
import { createRadarrClient, type RadarrClient } from './radarr/client.js';
import { createRadarrTools } from './radarr/tools.js';
import { createSonarrClient, type SonarrClient } from './sonarr/client.js';
import { createSonarrTools } from './sonarr/tools.js';
import { createTautulliClient, type TautulliClient } from './tautulli/client.js';
import { createTransmissionClient, type TransmissionClient } from './transmission/client.js';
import { createTransmissionTools } from './transmission/tools.js';

/** The configured products' clients, each built once and shared with the cross-product tools. */
export interface ProductClients {
  sonarr?: SonarrClient;
  radarr?: RadarrClient;
  prowlarr?: ProwlarrClient;
  overseerr?: OverseerrClient;
  tautulli?: TautulliClient;
  transmission?: TransmissionClient;
}

type Factory = (instance: InstanceConfig, clients: ProductClients) => ToolDefinition[];

/** Each factory builds the product's client, records it in `clients`, and returns its own tools. */
const FACTORIES: Record<ProductId, Factory> = {
  sonarr: (instance, clients) => createSonarrTools((clients.sonarr = createSonarrClient(instance))),
  radarr: (instance, clients) => createRadarrTools((clients.radarr = createRadarrClient(instance))),
  prowlarr: (instance, clients) =>
    createProwlarrTools((clients.prowlarr = createProwlarrClient(instance))),
  overseerr: (instance, clients) =>
    createOverseerrTools((clients.overseerr = createOverseerrClient(instance))),
  tautulli: (instance, clients) => {
    clients.tautulli = createTautulliClient(instance);
    return [];
  },
  transmission: (instance, clients) =>
    createTransmissionTools((clients.transmission = createTransmissionClient(instance))),
};

export interface Product {
  id: ProductId;
  label: string;
  envPrefix: string;
  legacyEnvPrefix?: string;
  /** Set for a product with no tools of its own (see ProductSettings.companionOf). */
  companionOf?: readonly string[];
  /** Set for a product with no API key (see ProductSettings.auth). */
  auth?: 'basic';
  createTools: (instance: InstanceConfig, clients?: ProductClients) => ToolDefinition[];
}

/** The product registry, in PRODUCT_SETTINGS order: Sonarr, Radarr, Prowlarr, Overseerr, Tautulli, Transmission. */
export const PRODUCTS: readonly Product[] = PRODUCT_SETTINGS.map((settings) => ({
  ...settings,
  createTools: (instance: InstanceConfig, clients: ProductClients = {}) =>
    FACTORIES[settings.id](instance, clients),
}));
