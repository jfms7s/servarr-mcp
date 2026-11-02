import { defineTool, type ToolDefinition } from '../mcp/types.js';
import { summarizeQualityProfile, summarizeRootFolder, summarizeUnmappedFolder } from './shape.js';
import type { DiskSpace, HealthCheck, QualityProfile, RootFolder, Tag } from './types.js';

/** The calls Sonarr's and Radarr's clients share with the same signature. */
export interface ArrCommonClient {
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<unknown>;
  getHealth(): Promise<HealthCheck[]>;
  getDiskSpace(): Promise<DiskSpace[]>;
}

/** Product wording; the tool names come from the prefix. */
export interface ArrCommonLabels {
  /** "Sonarr" */
  product: string;
  /** "series", "movie" (singular, as in "series organization") */
  item: string;
  /** "series", "movies" */
  items: string;
  /** "sonarr_add_series" */
  addTool: string;
  /** "sonarr_update_series" */
  updateTool: string;
}

/**
 * The six read tools Sonarr and Radarr expose identically: quality profiles, root folders,
 * tags, system status, health and disk space, in that order.
 */
export function createArrCommonTools(
  client: ArrCommonClient,
  prefix: 'sonarr' | 'radarr',
  labels: ArrCommonLabels,
): ToolDefinition[] {
  const { product, item, items, addTool, updateTool } = labels;
  return [
    defineTool({
      name: `${prefix}_list_quality_profiles`,
      effect: 'read',
      description: `List available quality profiles. Use these ids in ${addTool} and ${updateTool}.`,
      inputSchema: {},
      handler: async () => (await client.listQualityProfiles()).map(summarizeQualityProfile),
    }),

    defineTool({
      name: `${prefix}_list_root_folders`,
      effect: 'read',
      description:
        `List configured root folders where ${items} are stored (id, path, accessible, free space, ` +
        `unmapped folder count). Use these paths in ${addTool}; use ${prefix}_list_unmapped_folders for the folders themselves.`,
      inputSchema: {},
      handler: async () => (await client.listRootFolders()).map(summarizeRootFolder),
    }),

    defineTool({
      name: `${prefix}_list_tags`,
      effect: 'read',
      description: `List all tags available for ${item} organization.`,
      inputSchema: {},
      handler: () => client.listTags(),
    }),

    defineTool({
      name: `${prefix}_get_system_status`,
      effect: 'read',
      description: `Get ${product} version, OS, Docker status and other system information.`,
      inputSchema: {},
      handler: () => client.getSystemStatus(),
    }),

    defineTool({
      name: `${prefix}_get_health`,
      effect: 'read',
      description: `Check ${product} health status. Returns warnings or errors about the installation.`,
      inputSchema: {},
      handler: () => client.getHealth(),
    }),

    defineTool({
      name: `${prefix}_get_disk_space`,
      effect: 'read',
      description: `List disk space on each drive containing ${items} or root folders.`,
      inputSchema: {},
      handler: () => client.getDiskSpace(),
    }),
  ];
}

/** `<prefix>_list_unmapped_folders`: every root folder's unmapped folders, flattened. */
export function createUnmappedFoldersTool(
  client: Pick<ArrCommonClient, 'listRootFolders'>,
  prefix: 'sonarr' | 'radarr',
  description: string,
): ToolDefinition {
  return defineTool({
    name: `${prefix}_list_unmapped_folders`,
    effect: 'read',
    description,
    inputSchema: {},
    handler: async () => {
      const rootFolders = await client.listRootFolders();
      return rootFolders.flatMap((rootFolder) =>
        (rootFolder.unmappedFolders ?? []).map((folder) =>
          summarizeUnmappedFolder(rootFolder, folder),
        ),
      );
    },
  });
}
