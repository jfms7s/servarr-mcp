import type { ServarrConfig } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { createProwlarrClient } from './prowlarr/client.js';
import { createProwlarrTools } from './prowlarr/tools.js';
import { createRadarrClient } from './radarr/client.js';
import { createRadarrTools } from './radarr/tools.js';
import { createSonarrClient } from './sonarr/client.js';
import { createSonarrTools } from './sonarr/tools.js';

export function buildTools(config: ServarrConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (config.sonarr) tools.push(...createSonarrTools(createSonarrClient(config.sonarr)));
  if (config.radarr) tools.push(...createRadarrTools(createRadarrClient(config.radarr)));
  if (config.prowlarr) tools.push(...createProwlarrTools(createProwlarrClient(config.prowlarr)));

  return tools;
}
