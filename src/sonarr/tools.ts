import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { SonarrClient } from './client.js';
import { summarizeEpisode, summarizeQueueRecord, summarizeSeries } from './shape.js';

const COMMAND_NAMES = [
  'SeriesSearch',
  'EpisodeSearch',
  'SeasonSearch',
  'MissingEpisodeSearch',
  'RefreshSeries',
  'RescanSeries',
  'RenameFiles',
  'DownloadedEpisodesScan',
] as const;

const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export function createSonarrTools(client: SonarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'sonarr_list_series',
      description:
        'List all TV series in the Sonarr library, summarised. Returns id, title, year, ' +
        'monitored state and episode counts. Use sonarr_get_series for the full record.',
      inputSchema: {},
      handler: async () => (await client.listSeries()).map(summarizeSeries),
    }),

    defineTool({
      name: 'sonarr_get_series',
      description: 'Get the full Sonarr record for one series, including every season.',
      inputSchema: { seriesId: z.number().int().describe('Sonarr series id') },
      handler: ({ seriesId }) => client.getSeries(seriesId),
    }),

    defineTool({
      name: 'sonarr_lookup_series',
      description:
        'Search TheTVDB for series matching a search term. Use this to find the tvdbId ' +
        'needed by sonarr_add_series. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Series title to search for') },
      handler: async ({ term }) => (await client.lookupSeries(term)).map(summarizeSeries),
    }),

    defineTool({
      name: 'sonarr_add_series',
      description:
        'Add a new series to Sonarr. Get tvdbId from sonarr_lookup_series, qualityProfileId ' +
        'from sonarr_list_quality_profiles, and rootFolderPath from sonarr_list_root_folders.',
      inputSchema: {
        title: z.string().describe('Series title'),
        tvdbId: z.number().int().describe('TheTVDB id, from sonarr_lookup_series'),
        qualityProfileId: z.number().int().describe('From sonarr_list_quality_profiles'),
        rootFolderPath: z.string().describe('From sonarr_list_root_folders'),
        monitored: z.boolean().optional().describe('Monitor the series (default true)'),
        seasonFolder: z.boolean().optional().describe('Use season folders (default true)'),
        searchForMissingEpisodes: z
          .boolean()
          .optional()
          .describe('Start searching for episodes immediately (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
      },
      handler: async (args) => {
        const series = await client.addSeries({
          title: args.title,
          tvdbId: args.tvdbId,
          qualityProfileId: args.qualityProfileId,
          rootFolderPath: args.rootFolderPath,
          monitored: args.monitored ?? true,
          seasonFolder: args.seasonFolder ?? true,
          tags: args.tags,
          addOptions: {
            monitor: 'all',
            searchForMissingEpisodes: args.searchForMissingEpisodes ?? false,
          },
        });
        return summarizeSeries(series);
      },
    }),

    defineTool({
      name: 'sonarr_delete_series',
      description:
        'Remove a series from Sonarr. Destructive: set deleteFiles to true only when the ' +
        'user has explicitly asked for the files on disk to be deleted too.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        deleteFiles: z.boolean().optional().describe('Also delete episode files (default false)'),
        addImportListExclusion: z
          .boolean()
          .optional()
          .describe('Prevent import lists re-adding it (default false)'),
      },
      handler: async ({ seriesId, deleteFiles, addImportListExclusion }) => {
        await client.deleteSeries(seriesId, {
          deleteFiles: deleteFiles ?? false,
          addImportListExclusion: addImportListExclusion ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_get_queue',
      description:
        'List items currently downloading or awaiting import, with percent complete and any ' +
        'error messages. Use this to diagnose stuck or failed downloads.',
      inputSchema: { ...page },
      handler: async (args) => {
        const queue = await client.getQueue(args);
        return { ...queue, records: queue.records.map(summarizeQueueRecord) };
      },
    }),

    defineTool({
      name: 'sonarr_run_command',
      description:
        'Trigger a Sonarr background command, for example searching for a series or ' +
        'rescanning its folder. Returns a command id; poll it with sonarr_get_command.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        seriesId: z.number().int().optional().describe('Target series, for series-scoped commands'),
        seasonNumber: z.number().int().optional().describe('Target season, for SeasonSearch'),
        episodeIds: z
          .array(z.number().int())
          .optional()
          .describe('Target episodes, for EpisodeSearch'),
      },
      handler: (args) => client.runCommand(args),
    }),

    defineTool({
      name: 'sonarr_get_calendar',
      description:
        'List episodes airing in a date range. Pass start and end for a predictable ' +
        'window; if they are omitted Sonarr chooses its own short range around today.',
      inputSchema: {
        start: z.string().optional().describe('ISO date, inclusive'),
        end: z.string().optional().describe('ISO date, exclusive'),
      },
      handler: async ({ start, end }) =>
        (await client.getCalendar({ start, end, includeSeries: true })).map(summarizeEpisode),
    }),

    defineTool({
      name: 'sonarr_update_series',
      description:
        'Update a series, changing only the provided fields (monitored, qualityProfileId, ' +
        'seasonFolder, tags). All other fields are read from the current record.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        monitored: z.boolean().optional().describe('Monitor the series'),
        qualityProfileId: z.number().int().optional().describe('From sonarr_list_quality_profiles'),
        seasonFolder: z.boolean().optional().describe('Use season folders'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
      },
      handler: async ({ seriesId, monitored, qualityProfileId, seasonFolder, tags }) => {
        const current = await client.getSeries(seriesId);
        const merged = {
          ...current,
          ...(monitored !== undefined && { monitored }),
          ...(qualityProfileId !== undefined && { qualityProfileId }),
          ...(seasonFolder !== undefined && { seasonFolder }),
          ...(tags !== undefined && { tags }),
        };
        const updated = await client.updateSeries(seriesId, merged);
        return summarizeSeries(updated);
      },
    }),

    defineTool({
      name: 'sonarr_list_episodes',
      description:
        'List episodes for a series or season, summarised with file state and air dates. ' +
        'Omit seasonNumber to list all seasons.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        seasonNumber: z.number().int().optional().describe('Season number (all seasons if omitted)'),
      },
      handler: async ({ seriesId, seasonNumber }) =>
        (await client.listEpisodes(seriesId, seasonNumber)).map(summarizeEpisode),
    }),

    defineTool({
      name: 'sonarr_get_episode',
      description: 'Get the full Sonarr record for one episode.',
      inputSchema: {
        episodeId: z.number().int().describe('Sonarr episode id'),
      },
      handler: ({ episodeId }) => client.getEpisode(episodeId),
    }),

    defineTool({
      name: 'sonarr_monitor_episodes',
      description: 'Set the monitored state for one or more episodes.',
      inputSchema: {
        episodeIds: z.array(z.number().int()).describe('Episode ids to update'),
        monitored: z.boolean().describe('New monitored state'),
      },
      handler: async ({ episodeIds, monitored }) =>
        (await client.monitorEpisodes(episodeIds, monitored)).map(summarizeEpisode),
    }),

    defineTool({
      name: 'sonarr_list_episode_files',
      description: 'List episode files (downloaded episodes) for a series.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
      },
      handler: ({ seriesId }) => client.listEpisodeFiles(seriesId),
    }),

    defineTool({
      name: 'sonarr_delete_episode_file',
      description: 'Destructive: permanently delete an episode file and its record.',
      inputSchema: {
        episodeFileId: z.number().int().describe('Sonarr episode file id'),
      },
      handler: async ({ episodeFileId }) => {
        await client.deleteEpisodeFile(episodeFileId);
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_delete_queue_item',
      description:
        'Destructive: remove an item from the download queue. Use removeFromClient to also ' +
        'request removal from the torrent/usenet client, and blocklist to prevent re-importing.',
      inputSchema: {
        id: z.number().int().describe('Queue item id'),
        removeFromClient: z.boolean().optional().describe('Remove from download client (default false)'),
        blocklist: z.boolean().optional().describe('Add to blocklist (default false)'),
      },
      handler: async ({ id, removeFromClient, blocklist }) => {
        await client.deleteQueueItem(id, { removeFromClient, blocklist });
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_get_history',
      description: 'List history of download, import and grab events.',
      inputSchema: { ...page, eventType: z.number().int().optional().describe('Filter by event type: 1 grabbed, 2 seriesFolderImported, 3 downloadFolderImported, 4 downloadFailed, 5 episodeFileDeleted, 6 episodeFileRenamed, 7 downloadIgnored. Omit for all events.') },
      handler: ({ page: pageNum, pageSize, eventType }) =>
        client.getHistory({ page: pageNum, pageSize, eventType }),
    }),

    defineTool({
      name: 'sonarr_get_wanted_missing',
      description: 'List wanted but missing episodes (not downloaded yet).',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getWantedMissing({ page: pageNum, pageSize, includeSeries: true });
        return { ...response, records: response.records.map(summarizeEpisode) };
      },
    }),

    defineTool({
      name: 'sonarr_get_blocklist',
      description: 'List releases on the blocklist (failed imports or manually blocked).',
      inputSchema: { ...page },
      handler: ({ page: pageNum, pageSize }) =>
        client.getBlocklist({ page: pageNum, pageSize }),
    }),

    defineTool({
      name: 'sonarr_delete_blocklist_item',
      description: 'Destructive: remove a release from the blocklist.',
      inputSchema: {
        id: z.number().int().describe('Blocklist item id'),
      },
      handler: async ({ id }) => {
        await client.deleteBlocklistItem(id);
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_get_command',
      description:
        'Poll the status of a background command launched by sonarr_run_command or sonarr_add_series.',
      inputSchema: {
        commandId: z.number().int().describe('Command id'),
      },
      handler: ({ commandId }) => client.getCommand(commandId),
    }),

    defineTool({
      name: 'sonarr_list_quality_profiles',
      description:
        'List available quality profiles. Use these ids in sonarr_add_series and sonarr_update_series.',
      inputSchema: {},
      handler: () => client.listQualityProfiles(),
    }),

    defineTool({
      name: 'sonarr_list_root_folders',
      description:
        'List configured root folders where series are stored. Use these paths in sonarr_add_series.',
      inputSchema: {},
      handler: () => client.listRootFolders(),
    }),

    defineTool({
      name: 'sonarr_list_tags',
      description: 'List all tags available for series organization.',
      inputSchema: {},
      handler: () => client.listTags(),
    }),

    defineTool({
      name: 'sonarr_get_system_status',
      description: 'Get Sonarr version, OS, Docker status and other system information.',
      inputSchema: {},
      handler: () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'sonarr_get_health',
      description: 'Check Sonarr health status. Returns warnings or errors about the installation.',
      inputSchema: {},
      handler: () => client.getHealth(),
    }),

    defineTool({
      name: 'sonarr_get_disk_space',
      description: 'List disk space on each drive containing series or root folders.',
      inputSchema: {},
      handler: () => client.getDiskSpace(),
    }),
  ];
}
