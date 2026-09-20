import { z } from 'zod';
import { assertMoveBatchSize, MAX_MOVE_BATCH } from '../mcp/bulk.js';
import { isWithinRoot } from '../mcp/paths.js';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { SonarrClient } from './client.js';
import type { SeriesBulkEditPayload } from './types.js';
import {
  summarizeBlocklistRecord,
  summarizeEpisode,
  summarizeEpisodeFile,
  summarizeHistoryRecord,
  summarizeQualityProfile,
  summarizeQueueRecord,
  summarizeRelease,
  summarizeRenamePreview,
  summarizeSeries,
} from './shape.js';

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

/**
 * Extract folder name from a path, handling both Unix and Windows separators.
 * Split on either separator, then use the root folder's separator style for the result.
 */
function getFolderNameAndJoinPath(currentPath: string | undefined, fallbackName: string | undefined, rootFolderPath: string): { folderName: string; newPath: string } {
  const folderName = currentPath?.split(/[/\\]+/).filter(Boolean).pop() ?? fallbackName;

  if (!folderName) {
    throw new Error(
      'Cannot determine folder name: current path is empty and folderName is not set. ' +
        'Ensure the series has a valid path before relocating.',
    );
  }

  // Determine separator to use: if rootFolderPath contains backslash and no forward slash, use backslash; otherwise use forward slash
  const usesBackslash = rootFolderPath.includes('\\') && !rootFolderPath.includes('/');
  const separator = usesBackslash ? '\\' : '/';

  // Normalize root folder path (remove trailing separators of either type)
  const cleanRoot = rootFolderPath.replace(/[/\\]+$/, '');

  return {
    folderName,
    newPath: `${cleanRoot}${separator}${folderName}`,
  };
}

const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export function createSonarrTools(client: SonarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'sonarr_list_series',
      description:
        'List TV series in the Sonarr library with optional filters. Results are returned ' +
        'as { totalMatched, offset, limit, series } so pagination is visible. Default limit is 50 ' +
        '(pass limit and offset for different ranges). Filters are applied client-side after ' +
        'fetching all series, so titleContains and genre matches are case-insensitive substring/array searches.',
      inputSchema: {
        rootFolder: z
          .string()
          .optional()
          .describe(
            'Root folder to filter by. Matches whole path segments, so /media/shows does not match ' +
              '/media/shows-anime',
          ),
        monitored: z.boolean().optional().describe('Filter by monitored state'),
        genre: z.string().optional().describe('Filter by genre (case-insensitive match against genres array)'),
        titleContains: z.string().optional().describe('Filter by title (case-insensitive substring match)'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Filter by series type'),
        limit: z.number().int().min(1).optional().describe('Maximum results to return (default 50)'),
        offset: z.number().int().min(0).optional().describe('Skip this many results (default 0)'),
      },
      handler: async ({ rootFolder, monitored, genre, titleContains, seriesType, limit = 50, offset = 0 }) => {
        const allSeries = await client.listSeries();

        // Apply filters client-side
        const filtered = allSeries.filter((s) => {
          if (rootFolder !== undefined && !isWithinRoot(s.rootFolderPath, rootFolder)) return false;
          if (monitored !== undefined && s.monitored !== monitored) return false;
          if (genre !== undefined && !s.genres?.some((g) => g.toLowerCase().includes(genre.toLowerCase()))) return false;
          if (titleContains !== undefined && !s.title.toLowerCase().includes(titleContains.toLowerCase())) return false;
          if (seriesType !== undefined && s.seriesType !== seriesType) return false;
          return true;
        });

        const totalMatched = filtered.length;
        const series = filtered.slice(offset, offset + limit).map(summarizeSeries);

        return { totalMatched, offset, limit, series };
      },
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
        'Remove a series from Sonarr. ' +
        'When deleteFiles=true without confirmDeleteFiles=true, returns what would be deleted as a safety check. ' +
        'Set confirmDeleteFiles=true to confirm the destructive operation.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        deleteFiles: z.boolean().optional().describe('Also delete episode files (default false)'),
        confirmDeleteFiles: z
          .boolean()
          .optional()
          .describe('Required when deleteFiles=true, prevents accidental deletion'),
        addImportListExclusion: z
          .boolean()
          .optional()
          .describe('Prevent import lists re-adding it (default false)'),
      },
      handler: async ({ seriesId, deleteFiles, confirmDeleteFiles, addImportListExclusion }) => {
        // Guard against destructive operations without confirmation
        if (deleteFiles && !confirmDeleteFiles) {
          const series = await client.getSeries(seriesId);
          return {
            wouldDelete: {
              title: series.title,
              year: series.year,
              path: series.path,
              episodeFileCount: series.statistics?.episodeFileCount ?? 0,
              sizeOnDisk: series.statistics?.sizeOnDisk ?? 0,
              monitored: series.monitored,
            },
            confirmRequired: true,
          };
        }

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
        'seasonFolder, tags, rootFolderPath, seriesType). When rootFolderPath is provided, ' +
        'the series path is automatically updated to <rootFolderPath>/<folderName>. ' +
        'Set moveFiles to move existing episode files to the new location.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        monitored: z.boolean().optional().describe('Monitor the series'),
        qualityProfileId: z.number().int().optional().describe('From sonarr_list_quality_profiles'),
        seasonFolder: z.boolean().optional().describe('Use season folders'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
        rootFolderPath: z.string().optional().describe('Root folder path from sonarr_list_root_folders. Updates the series path automatically.'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Series type affects episode numbering for anime'),
        moveFiles: z.boolean().optional().describe('Move existing files to new location when changing rootFolderPath (default false)'),
      },
      handler: async ({ seriesId, monitored, qualityProfileId, seasonFolder, tags, rootFolderPath, seriesType, moveFiles }) => {
        const current = await client.getSeries(seriesId);
        const merged = {
          ...current,
          ...(monitored !== undefined && { monitored }),
          ...(qualityProfileId !== undefined && { qualityProfileId }),
          ...(seasonFolder !== undefined && { seasonFolder }),
          ...(tags !== undefined && { tags }),
          ...(seriesType !== undefined && { seriesType }),
          // When changing rootFolderPath, construct the new path by combining
          // the new root folder with the series' folder name
          ...(rootFolderPath !== undefined && (() => {
            const { newPath } = getFolderNameAndJoinPath(current.path, current.folder, rootFolderPath);
            return {
              path: newPath,
              rootFolderPath,
            };
          })()),
        };
        const updated = await client.updateSeries(seriesId, merged, { moveFiles });
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
      handler: async ({ seriesId }) =>
        (await client.listEpisodeFiles(seriesId)).map(summarizeEpisodeFile),
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
        await client.deleteQueueItem(id, {
          removeFromClient: removeFromClient ?? false,
          blocklist: blocklist ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_get_history',
      description: 'List history of download, import and grab events.',
      inputSchema: { ...page, eventType: z.number().int().optional().describe('Filter by event type: 1 grabbed, 2 seriesFolderImported, 3 downloadFolderImported, 4 downloadFailed, 5 episodeFileDeleted, 6 episodeFileRenamed, 7 downloadIgnored. Omit for all events.') },
      handler: async ({ page: pageNum, pageSize, eventType }) => {
        const response = await client.getHistory({ page: pageNum, pageSize, eventType });
        return { ...response, records: response.records.map(summarizeHistoryRecord) };
      },
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
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getBlocklist({ page: pageNum, pageSize });
        return { ...response, records: response.records.map(summarizeBlocklistRecord) };
      },
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
      handler: async () => (await client.listQualityProfiles()).map(summarizeQualityProfile),
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

    defineTool({
      name: 'sonarr_search_releases',
      description:
        'Run a live interactive search across indexers for episode or season releases (can take several seconds). Results are in Sonarr\'s preference order with rank. Rejections are Sonarr\'s verbatim reasons for not choosing a release automatically. Use guid + indexerId with sonarr_grab_release.',
      inputSchema: {
        episodeId: z.number().int().optional().describe('Episode id for single-episode search'),
        seriesId: z.number().int().optional().describe('Series id for season-pack search'),
        seasonNumber: z.number().int().optional().describe('Season number for season-pack search'),
        titleContains: z.string().min(1).optional().describe('Case-insensitive substring filter (e.g. "MeGusta")'),
        approvedOnly: z.boolean().optional().default(false).describe('Show only Sonarr-approved releases'),
        limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum results to return'),
      },
      handler: async (args) => {
        // Validation: exactly one mode - episodeId alone OR seriesId + seasonNumber together
        const hasEpisodeId = args.episodeId !== undefined;
        const hasSeriesId = args.seriesId !== undefined;
        const hasSeasonNumber = args.seasonNumber !== undefined;

        if (!hasEpisodeId && !hasSeriesId && !hasSeasonNumber) {
          throw new Error('Must provide either episodeId alone OR seriesId + seasonNumber together');
        }

        if (hasEpisodeId && (hasSeriesId || hasSeasonNumber)) {
          throw new Error('Cannot mix episodeId with seriesId/seasonNumber; use one mode only');
        }

        if ((hasSeriesId && !hasSeasonNumber) || (hasSeasonNumber && !hasSeriesId)) {
          throw new Error('seriesId and seasonNumber must be provided together');
        }

        // Call client with the appropriate parameters
        const searchParams = hasEpisodeId ? { episodeId: args.episodeId } : { seriesId: args.seriesId, seasonNumber: args.seasonNumber };
        const allReleases = await client.searchReleases(searchParams);

        // Rank over the full list first, so a release keeps Sonarr's rank
        // after the filters below drop the ones ahead of it.
        let filtered = allReleases.map((release, index) => summarizeRelease(release, index + 1));

        if (args.titleContains) {
          const lowerFilter = args.titleContains.toLowerCase();
          filtered = filtered.filter((r) => r.title.toLowerCase().includes(lowerFilter));
        }

        if (args.approvedOnly) {
          filtered = filtered.filter((r) => r.approved);
        }

        const matched = filtered.length;
        const returned = Math.min(args.limit ?? 20, matched);
        const releases = filtered.slice(0, returned);

        return {
          total: allReleases.length,
          matched,
          returned,
          releases,
        };
      },
    }),

    defineTool({
      name: 'sonarr_grab_release',
      description:
        'Download a release via Sonarr. Grab uses cached search results (expire ~30 minutes); if grab fails, run sonarr_search_releases again. Grab overrides Sonarr\'s decision to DOWNLOAD but rejections can still block IMPORT, leaving items stuck in queue. Starts a real download tracked and imported by Sonarr (unlike prowlarr_grab_release, which bypasses Sonarr).',
      inputSchema: {
        guid: z.string().min(1).describe('Release guid from sonarr_search_releases'),
        indexerId: z.number().int().describe('Release indexerId from sonarr_search_releases'),
      },
      handler: async ({ guid, indexerId }) => {
        const grabbed = await client.grabRelease({ guid, indexerId });
        return {
          grabbed: true,
          guid,
          indexerId,
          title: grabbed.title,
        };
      },
    }),

    defineTool({
      name: 'sonarr_bulk_edit_series',
      description:
        'Bulk edit multiple series at once. Only fields explicitly provided are updated; ' +
        'omitted fields are not changed. Supports changing root folder, quality profile, series type, ' +
        'monitored state, season folder setting, and tags. Set moveFiles to move existing files ' +
        `when changing root folder; the files are moved before the call returns, so at most ${MAX_MOVE_BATCH} ` +
        'ids are accepted per call when moveFiles is true. Send larger sets as sequential batches, not in parallel.',
      inputSchema: {
        seriesIds: z.array(z.number().int()).min(1).describe('Series ids to update'),
        monitored: z.boolean().optional().describe('Set monitored state'),
        qualityProfileId: z.number().int().optional().describe('From sonarr_list_quality_profiles'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Series type'),
        seasonFolder: z.boolean().optional().describe('Use season folders'),
        rootFolderPath: z.string().optional().describe('Root folder path from sonarr_list_root_folders'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
        applyTags: z.enum(['add', 'remove', 'replace']).optional().describe('How to apply tags (default replace)'),
        moveFiles: z.boolean().optional().describe('Move files when changing rootFolderPath (default false)'),
      },
      handler: async (args) => {
        assertMoveBatchSize(args.seriesIds, args.moveFiles, 'sonarr_bulk_edit_series');

        // Build payload with only defined fields to avoid blanking unspecified fields
        const payload: Partial<SeriesBulkEditPayload> = { seriesIds: args.seriesIds };
        if (args.monitored !== undefined) payload.monitored = args.monitored;
        if (args.qualityProfileId !== undefined) payload.qualityProfileId = args.qualityProfileId;
        if (args.seriesType !== undefined) payload.seriesType = args.seriesType;
        if (args.seasonFolder !== undefined) payload.seasonFolder = args.seasonFolder;
        if (args.rootFolderPath !== undefined) payload.rootFolderPath = args.rootFolderPath;
        if (args.tags !== undefined) payload.tags = args.tags;
        if (args.applyTags !== undefined) payload.applyTags = args.applyTags;
        if (args.moveFiles !== undefined) payload.moveFiles = args.moveFiles;

        const result = await client.bulkEditSeries(payload as unknown as SeriesBulkEditPayload);
        return {
          updated: result.length,
          series: result.map(summarizeSeries),
        };
      },
    }),

    defineTool({
      name: 'sonarr_list_unmapped_folders',
      description:
        'List folders in each root folder that are not yet mapped to any series. ' +
        'Use this to find media that needs to be imported or organized.',
      inputSchema: {},
      handler: async () => {
        const rootFolders = await client.listRootFolders();
        const result = [];
        for (const rf of rootFolders) {
          const unmapped = rf.unmappedFolders ?? [];
          for (const folder of unmapped) {
            result.push({
              rootFolderId: rf.id,
              rootFolderPath: rf.path,
              folderName: folder.name,
              folderPath: folder.path,
              relativePath: folder.relativePath,
            });
          }
        }
        return result;
      },
    }),

    defineTool({
      name: 'sonarr_get_rename_preview',
      description:
        'Preview how Sonarr will rename episode files for a series or season without actually ' +
        'running the rename. Useful for verifying your naming rules are working correctly. ' +
        'If the series has hundreds of episodes, only the first 100 are shown but the total count is reported.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        seasonNumber: z.number().int().optional().describe('Season number (all seasons if omitted)'),
      },
      handler: async ({ seriesId, seasonNumber }) => {
        const previews = await client.getRenamePreview(seriesId, seasonNumber);
        const MAX_PREVIEW = 100;
        const shown = previews.slice(0, MAX_PREVIEW).map(summarizeRenamePreview);
        return {
          total: previews.length,
          shown: shown.length,
          previews: shown,
        };
      },
    }),

    defineTool({
      name: 'sonarr_find_duplicate_series',
      description:
        'Find potential duplicate series in the library. Detects series with the same tvdbId ' +
        '(exact duplicate) and same normalized title + year under different root folders ' +
        '(likely misplaced copies). Helps identify library organization issues.',
      inputSchema: {},
      handler: async () => {
        const allSeries = await client.listSeries();

        // Find series with duplicate tvdbIds (exact duplicates)
        const tvdbMap = new Map<number, typeof allSeries>();
        for (const series of allSeries) {
          if (!tvdbMap.has(series.tvdbId)) {
            tvdbMap.set(series.tvdbId, []);
          }
          tvdbMap.get(series.tvdbId)!.push(series);
        }

        const exactDuplicates = Array.from(tvdbMap.values())
          .filter((group) => group.length > 1)
          .map((group) => {
            const first = group[0]!;
            return {
              tvdbId: first.tvdbId,
              count: group.length,
              series: group.map((s) => ({ id: s.id, title: s.title, path: s.path })),
            };
          });

        // Find series with same normalized title+year in different root folders
        type TitleYearKey = string;
        const titleYearMap = new Map<TitleYearKey, typeof allSeries>();
        for (const series of allSeries) {
          const key = `${series.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${series.year}`;
          if (!titleYearMap.has(key)) {
            titleYearMap.set(key, []);
          }
          titleYearMap.get(key)!.push(series);
        }

        const misplacedCopies = Array.from(titleYearMap.values())
          .filter((group) => group.length > 1 && new Set(group.map((s) => s.rootFolderPath)).size > 1)
          .map((group) => {
            const first = group[0]!;
            return {
              title: first.title,
              year: first.year,
              count: group.length,
              series: group.map((s) => ({ id: s.id, title: s.title, path: s.path })),
            };
          });

        return {
          total: allSeries.length,
          exactDuplicates,
          misplacedCopies,
        };
      },
    }),

    defineTool({
      name: 'sonarr_import_folder',
      description:
        'Scan a folder and import any episode files found into existing series entries in Sonarr. ' +
        'This is asynchronous — it returns a command id that can be polled with sonarr_get_command. ' +
        'Important: the series must already exist in Sonarr for files to attach to it; otherwise the scan will not import them. ' +
        'Use folderPath from sonarr_list_unmapped_folders.',
      inputSchema: {
        path: z.string().describe('Absolute path to the folder to import, as returned by sonarr_list_unmapped_folders (folderPath field)'),
        importMode: z
          .enum(['Auto', 'Move', 'Copy'])
          .optional()
          .describe('How to handle files: Auto (default, let Sonarr decide), Move (relocate to configured library), Copy (keep original, duplicate to library)'),
      },
      handler: async ({ path, importMode }) => {
        const command = await client.runCommand({
          name: 'DownloadedEpisodesScan',
          path,
          ...(importMode && { importMode }),
        });
        return {
          commandId: command.id,
          status: command.status,
          message: `Scanning ${path} for episodes to import`,
        };
      },
    }),
  ];
}
