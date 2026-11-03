import { defineTool, type ToolDefinition } from '../mcp/types.js';
import {
  summarizeDiskSpace,
  summarizeHealthCheck,
  summarizeQualityProfile,
  summarizeRootFolder,
  summarizeSystemStatus,
  summarizeUnmappedFolder,
} from './shape.js';
import type {
  DiskSpace,
  HealthCheck,
  QualityProfile,
  RootFolder,
  SystemStatus,
  Tag,
} from './types.js';

/** The calls Sonarr's and Radarr's clients share with the same signature. */
export interface ArrCommonClient {
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<SystemStatus>;
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
 * The two read tools Sonarr and Radarr expose identically: options (quality profiles, root
 * folders and tags in one call) and status (system, health and disk space in one call).
 */
export function createArrCommonTools(
  client: ArrCommonClient,
  prefix: 'sonarr' | 'radarr',
  labels: ArrCommonLabels,
): ToolDefinition[] {
  const { product, item, items, addTool, updateTool } = labels;
  return [
    defineTool({
      name: `${prefix}_list_options`,
      effect: 'read',
      description:
        `List the ids and paths that ${addTool}, ${updateTool} and the bulk editor take, in one call: ` +
        `qualityProfiles (id, name, upgradeAllowed, cutoff), rootFolders where ${items} are stored ` +
        `(id, path, accessible, free space, unmapped folder count; use ${prefix}_list_unmapped_folders ` +
        `for the folders themselves) and tags (id, label) for ${item} organization.`,
      inputSchema: {},
      handler: async () => {
        const [qualityProfiles, rootFolders, tags] = await Promise.all([
          client.listQualityProfiles(),
          client.listRootFolders(),
          client.listTags(),
        ]);
        return {
          qualityProfiles: qualityProfiles.map(summarizeQualityProfile),
          rootFolders: rootFolders.map(summarizeRootFolder),
          tags: tags.map(({ id, label }) => ({ id, label })),
        };
      },
    }),

    defineTool({
      name: `${prefix}_get_status`,
      effect: 'read',
      description:
        `Get ${product} status in one call: system (version, branch, OS, Docker, start time), ` +
        `health (the health check warnings and errors about the installation) and disks (free and ` +
        `total bytes on each drive containing ${items} or root folders).`,
      inputSchema: {},
      handler: async () => {
        const [system, health, disks] = await Promise.all([
          client.getSystemStatus(),
          client.getHealth(),
          client.getDiskSpace(),
        ]);
        return {
          system: summarizeSystemStatus(system),
          health: health.map(summarizeHealthCheck),
          disks: disks.map(summarizeDiskSpace),
        };
      },
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
