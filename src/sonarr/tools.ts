import { z } from 'zod';
import { assertMoveBatchSize, assertMoveFilesChosen, MAX_MOVE_BATCH, trackMoveCommand } from '../arr/bulk.js';
import { CACHED_LIBRARY_NOTE, refreshInput } from '../arr/library.js';
import { listWindow, page, pageOf } from '../arr/paging.js';
import { isWithinRoot, normalizeTitle, relocatePath } from '../arr/paths.js';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { SonarrClient } from './client.js';
import type { SeriesBulkEditPayload } from './types.js';
import {
  summarizeBlocklistRecord,
  summarizeEpisode,
  summarizeEpisodeDetail,
  summarizeEpisodeFile,
  summarizeHistoryRecord,
  summarizeQualityProfile,
  summarizeQueueRecord,
  summarizeRelease,
  summarizeRenamePreview,
  summarizeUnmappedFolder,
  summarizeSeries,
  summarizeSeriesDetail,
} from './shape.js';
import { summarizeRootFolder } from '../arr/shape.js';

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

/** What Sonarr queues for a file-moving edit: BulkMoveSeries from the editor, MoveSeries from PUT /series. */
const SONARR_MOVE_COMMANDS = ['BulkMoveSeries', 'MoveSeries'];

export function createSonarrTools(client: SonarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'sonarr_list_series',
      effect: 'read',
      description:
        'List TV series in the Sonarr library with optional filters. Results are returned ' +
        'as { totalMatched, offset, limit, series } so pagination is visible. Default limit is 50 ' +
        '(pass limit and offset for different ranges). Filters are applied client-side after ' +
        'fetching all series, so titleContains and genre matches are case-insensitive substring/array searches. ' +
        'Rows omit the plot overview unless includeOverview is true.' +
        CACHED_LIBRARY_NOTE,
      inputSchema: {
        rootFolder: z
          .string()
          .optional()
          .describe(
            'Folder to filter by: a root folder or any folder beneath it, matched against the series folder. ' +
              'Matches whole path segments, so /media/shows does not match /media/shows-anime',
          ),
        monitored: z.boolean().optional().describe('Filter by monitored state'),
        genre: z.string().optional().describe('Filter by genre (case-insensitive match against genres array)'),
        titleContains: z.string().optional().describe('Filter by title (case-insensitive substring match)'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Filter by series type'),
        limit: z.number().int().min(1).optional().describe('Maximum results to return (default 50)'),
        offset: z.number().int().min(0).optional().describe('Skip this many results (default 0)'),
        includeOverview: z.boolean().optional().describe('Include each row\'s plot overview (default false)'),
        refresh: refreshInput,
      },
      handler: async ({ rootFolder, monitored, genre, titleContains, seriesType, limit = 50, offset = 0, includeOverview = false, refresh }) => {
        const allSeries = await client.listSeries({ refresh });

        // Apply filters client-side
        const genreLower = genre?.toLowerCase();
        const titleLower = titleContains?.toLowerCase();
        const filtered = allSeries.filter((s) => {
          if (rootFolder !== undefined && !isWithinRoot(s.path ?? s.rootFolderPath, rootFolder)) return false;
          if (monitored !== undefined && s.monitored !== monitored) return false;
          if (genreLower !== undefined && !s.genres?.some((g) => g.toLowerCase().includes(genreLower))) return false;
          if (titleLower !== undefined && !s.title.toLowerCase().includes(titleLower)) return false;
          if (seriesType !== undefined && s.seriesType !== seriesType) return false;
          return true;
        });

        const totalMatched = filtered.length;
        const series = filtered.slice(offset, offset + limit).map((s) => summarizeSeries(s, { overview: includeOverview }));

        return { totalMatched, offset, limit, series };
      },
    }),

    defineTool({
      name: 'sonarr_get_series',
      effect: 'read',
      description:
        'Get one Sonarr series: the list summary plus every season (monitored, file and episode counts), ' +
        'root folder, season-folder setting and added date. full=true returns the raw Sonarr record.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        full: z.boolean().optional().describe('Return the raw Sonarr record instead of the summary (default false)'),
      },
      handler: async ({ seriesId, full }) => {
        const series = await client.getSeries(seriesId);
        return full ? series : summarizeSeriesDetail(series);
      },
    }),

    defineTool({
      name: 'sonarr_lookup_series',
      effect: 'read',
      description:
        'Search TheTVDB for series matching a search term. Use this to find the tvdbId ' +
        'needed by sonarr_add_series. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Series title to search for') },
      handler: async ({ term }) => (await client.lookupSeries(term)).map((s) => summarizeSeries(s)),
    }),

    defineTool({
      name: 'sonarr_add_series',
      effect: 'write',
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
      effect: 'destructive',
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
      effect: 'read',
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
      effect: 'write',
      description:
        'Trigger a Sonarr background command, for example searching for a series or ' +
        'rescanning its folder. Returns a command id; poll it with sonarr_get_command. ' +
        'MissingEpisodeSearch searches (and may download) every missing monitored episode, so without ' +
        'confirm=true it only returns { wouldRun: { command, missingCount }, confirmRequired: true } and runs nothing.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        seriesId: z.number().int().optional().describe('Target series, for series-scoped commands'),
        seasonNumber: z.number().int().optional().describe('Target season, for SeasonSearch'),
        episodeIds: z
          .array(z.number().int())
          .optional()
          .describe('Target episodes, for EpisodeSearch'),
        confirm: z.boolean().optional().describe('Required to run MissingEpisodeSearch, prevents an accidental library-wide search'),
      },
      handler: async ({ confirm, ...command }) => {
        if (command.name === 'MissingEpisodeSearch' && confirm !== true) {
          const missing = await client.getWantedMissing({ page: 1, pageSize: 1 });
          return { wouldRun: { command: command.name, missingCount: missing.totalRecords }, confirmRequired: true };
        }
        return client.runCommand(command);
      },
    }),

    defineTool({
      name: 'sonarr_get_calendar',
      effect: 'read',
      description:
        'List episodes airing in a date range. Pass start and end for a predictable ' +
        'window; if they are omitted Sonarr chooses its own short range around today. ' +
        'Results are returned as { totalMatched, offset, limit, episodes }; default limit is 100 ' +
        '(pass limit and offset for other ranges). Rows omit the plot overview.',
      inputSchema: {
        start: z.string().optional().describe('ISO date, inclusive'),
        end: z.string().optional().describe('ISO date, exclusive'),
        ...listWindow,
      },
      handler: async ({ start, end, limit, offset }) => {
        const calendar = await client.getCalendar({ start, end, includeSeries: true });
        const { rows, ...window } = pageOf(calendar, { limit, offset });
        return { ...window, episodes: rows.map((e) => summarizeEpisode(e, { overview: false })) };
      },
    }),

    defineTool({
      name: 'sonarr_update_series',
      effect: 'destructive',
      description:
        'Update a series, changing only the provided fields (monitored, qualityProfileId, ' +
        'seasonFolder, tags, rootFolderPath, seriesType). When rootFolderPath is provided, ' +
        'the series path is automatically updated to <rootFolderPath>/<folderName>, and moveFiles is ' +
        'required: true moves the episode files with the record, false repoints the record only (the files ' +
        'stay put and Sonarr reports the episodes missing after a rescan). With moveFiles true, Sonarr queues ' +
        'the move as a background command and returns before the files move: the result carries ' +
        'moveCommandId to poll with sonarr_get_command (null when none was found).',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        monitored: z.boolean().optional().describe('Monitor the series'),
        qualityProfileId: z.number().int().optional().describe('From sonarr_list_quality_profiles'),
        seasonFolder: z.boolean().optional().describe('Use season folders'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
        rootFolderPath: z.string().optional().describe('Root folder path from sonarr_list_root_folders. Updates the series path automatically.'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Series type affects episode numbering for anime'),
        moveFiles: z
          .boolean()
          .optional()
          .describe('Required with rootFolderPath: true moves the files, false repoints the record only'),
      },
      handler: async ({ seriesId, monitored, qualityProfileId, seasonFolder, tags, rootFolderPath, seriesType, moveFiles }) => {
        assertMoveFilesChosen(rootFolderPath, moveFiles, 'sonarr_update_series');
        const current = await client.getSeries(seriesId);
        const merged = {
          ...current,
          ...(monitored !== undefined && { monitored }),
          ...(qualityProfileId !== undefined && { qualityProfileId }),
          ...(seasonFolder !== undefined && { seasonFolder }),
          ...(tags !== undefined && { tags }),
          ...(seriesType !== undefined && { seriesType }),
          ...(rootFolderPath !== undefined && { rootFolderPath }),
        };

        // When rootFolderPath changes, compute the new path by preserving the folder name
        if (rootFolderPath !== undefined) {
          merged.path = relocatePath(current.path, current.folder, rootFolderPath, 'series');
        }

        if (moveFiles !== true) {
          return summarizeSeries(await client.updateSeries(seriesId, merged, { moveFiles: moveFiles ?? false }));
        }
        const { result, ...move } = await trackMoveCommand(() => client.listCommands(), SONARR_MOVE_COMMANDS, () =>
          client.updateSeries(seriesId, merged, { moveFiles }),
        );
        return { ...summarizeSeries(result), ...move };
      },
    }),

    defineTool({
      name: 'sonarr_list_episodes',
      effect: 'read',
      description:
        'List episodes for a series or season, summarised with file state and air dates. ' +
        'Omit seasonNumber to list all seasons. Results are returned as { totalMatched, offset, limit, episodes }; ' +
        'default limit is 100 (pass limit and offset for other ranges). ' +
        'Rows omit the plot overview unless includeOverview is true.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        seasonNumber: z.number().int().optional().describe('Season number (all seasons if omitted)'),
        ...listWindow,
        includeOverview: z.boolean().optional().describe('Include each row\'s plot overview (default false)'),
      },
      handler: async ({ seriesId, seasonNumber, limit, offset, includeOverview = false }) => {
        const { rows, ...window } = pageOf(await client.listEpisodes(seriesId, seasonNumber), { limit, offset });
        return { ...window, episodes: rows.map((e) => summarizeEpisode(e, { overview: includeOverview })) };
      },
    }),

    defineTool({
      name: 'sonarr_get_episode',
      effect: 'read',
      description:
        'Get one Sonarr episode: the list summary plus its file (id, relative path, size, quality) when it has one. ' +
        'full=true returns the raw Sonarr record.',
      inputSchema: {
        episodeId: z.number().int().describe('Sonarr episode id'),
        full: z.boolean().optional().describe('Return the raw Sonarr record instead of the summary (default false)'),
      },
      handler: async ({ episodeId, full }) => {
        const episode = await client.getEpisode(episodeId);
        return full ? episode : summarizeEpisodeDetail(episode);
      },
    }),

    defineTool({
      name: 'sonarr_monitor_episodes',
      effect: 'write',
      description: 'Set the monitored state for one or more episodes.',
      inputSchema: {
        episodeIds: z.array(z.number().int()).min(1).describe('Episode ids to update'),
        monitored: z.boolean().describe('New monitored state'),
      },
      handler: async ({ episodeIds, monitored }) =>
        (await client.monitorEpisodes(episodeIds, monitored)).map((e) => summarizeEpisode(e, { overview: false })),
    }),

    defineTool({
      name: 'sonarr_list_episode_files',
      effect: 'read',
      description:
        'List episode files (downloaded episodes) for a series. Results are returned as ' +
        '{ totalMatched, offset, limit, files }; default limit is 100 (pass limit and offset for other ranges).',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        ...listWindow,
      },
      handler: async ({ seriesId, limit, offset }) => {
        const { rows, ...window } = pageOf(await client.listEpisodeFiles(seriesId), { limit, offset });
        return { ...window, files: rows.map(summarizeEpisodeFile) };
      },
    }),

    defineTool({
      name: 'sonarr_delete_episode_file',
      effect: 'destructive',
      description:
        'Destructive: permanently delete an episode file on disk and its record. ' +
        'Without confirm=true, deletes nothing and returns the file that would be deleted as a safety check.',
      inputSchema: {
        episodeFileId: z.number().int().describe('Sonarr episode file id'),
        confirm: z.boolean().optional().describe('Required to delete, prevents accidental deletion'),
      },
      handler: async ({ episodeFileId, confirm }) => {
        if (confirm !== true) {
          const file = await client.getEpisodeFile(episodeFileId);
          return {
            wouldDelete: {
              id: file.id,
              seriesId: file.seriesId,
              seasonNumber: file.seasonNumber,
              relativePath: file.relativePath,
              path: file.path,
              size: file.size,
              quality: file.quality?.quality.name,
            },
            confirmRequired: true,
          };
        }
        await client.deleteEpisodeFile(episodeFileId);
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_delete_queue_item',
      effect: 'destructive',
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
      effect: 'read',
      description: 'List history of download, import and grab events.',
      inputSchema: { ...page, eventType: z.number().int().optional().describe('Filter by event type: 1 grabbed, 2 seriesFolderImported, 3 downloadFolderImported, 4 downloadFailed, 5 episodeFileDeleted, 6 episodeFileRenamed, 7 downloadIgnored. Omit for all events.') },
      handler: async ({ page: pageNum, pageSize, eventType }) => {
        const response = await client.getHistory({ page: pageNum, pageSize, eventType });
        return { ...response, records: response.records.map(summarizeHistoryRecord) };
      },
    }),

    defineTool({
      name: 'sonarr_get_wanted_missing',
      effect: 'read',
      description: 'List wanted but missing episodes (not downloaded yet). Rows omit the plot overview.',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getWantedMissing({ page: pageNum, pageSize, includeSeries: true });
        return { ...response, records: response.records.map((e) => summarizeEpisode(e, { overview: false })) };
      },
    }),

    defineTool({
      name: 'sonarr_get_blocklist',
      effect: 'read',
      description: 'List releases on the blocklist (failed imports or manually blocked).',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getBlocklist({ page: pageNum, pageSize });
        return { ...response, records: response.records.map(summarizeBlocklistRecord) };
      },
    }),

    defineTool({
      name: 'sonarr_delete_blocklist_item',
      effect: 'destructive',
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
      effect: 'read',
      description:
        'Poll the status of a background command launched by sonarr_run_command or sonarr_import_folder, or the ' +
        'moveCommandId returned by sonarr_update_series and sonarr_bulk_edit_series.',
      inputSchema: {
        commandId: z.number().int().describe('Command id'),
      },
      handler: ({ commandId }) => client.getCommand(commandId),
    }),

    defineTool({
      name: 'sonarr_list_quality_profiles',
      effect: 'read',
      description:
        'List available quality profiles. Use these ids in sonarr_add_series and sonarr_update_series.',
      inputSchema: {},
      handler: async () => (await client.listQualityProfiles()).map(summarizeQualityProfile),
    }),

    defineTool({
      name: 'sonarr_list_root_folders',
      effect: 'read',
      description:
        'List configured root folders where series are stored (id, path, accessible, free space, ' +
        'unmapped folder count). Use these paths in sonarr_add_series; use sonarr_list_unmapped_folders for the folders themselves.',
      inputSchema: {},
      handler: async () => (await client.listRootFolders()).map(summarizeRootFolder),
    }),

    defineTool({
      name: 'sonarr_list_tags',
      effect: 'read',
      description: 'List all tags available for series organization.',
      inputSchema: {},
      handler: () => client.listTags(),
    }),

    defineTool({
      name: 'sonarr_get_system_status',
      effect: 'read',
      description: 'Get Sonarr version, OS, Docker status and other system information.',
      inputSchema: {},
      handler: () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'sonarr_get_health',
      effect: 'read',
      description: 'Check Sonarr health status. Returns warnings or errors about the installation.',
      inputSchema: {},
      handler: () => client.getHealth(),
    }),

    defineTool({
      name: 'sonarr_get_disk_space',
      effect: 'read',
      description: 'List disk space on each drive containing series or root folders.',
      inputSchema: {},
      handler: () => client.getDiskSpace(),
    }),

    defineTool({
      name: 'sonarr_search_releases',
      effect: 'read',
      description:
        'Run a live interactive search across indexers for episode or season releases (can take several seconds). Results are in Sonarr\'s preference order with rank. Rejections are Sonarr\'s verbatim reasons for not choosing a release automatically. Use guid + indexerId with sonarr_grab_release.',
      inputSchema: {
        episodeId: z.number().int().optional().describe('Episode id for single-episode search'),
        seriesId: z.number().int().optional().describe('Series id for season-pack search'),
        seasonNumber: z.number().int().optional().describe('Season number for season-pack search'),
        titleContains: z.string().min(1).optional().describe('Case-insensitive substring filter (e.g. "MeGusta")'),
        approvedOnly: z.boolean().optional().describe('Show only Sonarr-approved releases (default false)'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum results to return (default 20)'),
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
      effect: 'destructive',
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
      effect: 'destructive',
      description:
        'Bulk edit multiple series at once. Only fields explicitly provided are updated; ' +
        'omitted fields are not changed. Supports changing root folder, quality profile, series type, ' +
        'monitored state, season folder setting, and tags. When rootFolderPath is given, moveFiles is ' +
        'required: true moves the files with the records, false repoints the records only (the files stay put ' +
        'and Sonarr reports the episodes missing after a rescan). ' +
        'With moveFiles true, Sonarr queues the move as a background command and returns before the files ' +
        'move: the result carries moveCommandId to poll with sonarr_get_command (null when none was found). ' +
        `At most ${MAX_MOVE_BATCH} ids are accepted per call when moveFiles is true; send larger sets as ` +
        'sequential batches, and poll each moveCommandId until it completes before the next batch or a retry.',
      inputSchema: {
        seriesIds: z.array(z.number().int()).min(1).describe('Series ids to update'),
        monitored: z.boolean().optional().describe('Set monitored state'),
        qualityProfileId: z.number().int().optional().describe('From sonarr_list_quality_profiles'),
        seriesType: z.enum(['standard', 'daily', 'anime']).optional().describe('Series type'),
        seasonFolder: z.boolean().optional().describe('Use season folders'),
        rootFolderPath: z.string().optional().describe('Root folder path from sonarr_list_root_folders'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
        applyTags: z.enum(['add', 'remove', 'replace']).optional().describe('How to apply tags (default replace)'),
        moveFiles: z
          .boolean()
          .optional()
          .describe('Required with rootFolderPath: true moves the files, false repoints the records only'),
      },
      handler: async (args) => {
        assertMoveFilesChosen(args.rootFolderPath, args.moveFiles, 'sonarr_bulk_edit_series');
        assertMoveBatchSize(args.seriesIds, args.moveFiles, 'sonarr_bulk_edit_series');

        // Build payload with only defined fields to avoid blanking unspecified fields
        const payload: SeriesBulkEditPayload = { seriesIds: args.seriesIds };
        if (args.monitored !== undefined) payload.monitored = args.monitored;
        if (args.qualityProfileId !== undefined) payload.qualityProfileId = args.qualityProfileId;
        if (args.seriesType !== undefined) payload.seriesType = args.seriesType;
        if (args.seasonFolder !== undefined) payload.seasonFolder = args.seasonFolder;
        if (args.rootFolderPath !== undefined) payload.rootFolderPath = args.rootFolderPath;
        if (args.tags !== undefined) payload.tags = args.tags;
        if (args.applyTags !== undefined) payload.applyTags = args.applyTags;
        if (args.moveFiles !== undefined) payload.moveFiles = args.moveFiles;

        const edit = () => client.bulkEditSeries(payload);
        const summarize = (result: Awaited<ReturnType<typeof edit>>) => ({
          updated: result.length,
          series: result.map((s) => summarizeSeries(s, { overview: false })),
        });
        if (args.moveFiles !== true) return summarize(await edit());
        const { result, ...move } = await trackMoveCommand(() => client.listCommands(), SONARR_MOVE_COMMANDS, edit);
        return { ...summarize(result), ...move };
      },
    }),

    defineTool({
      name: 'sonarr_list_unmapped_folders',
      effect: 'read',
      description:
        'List folders in each root folder that are not yet mapped to any series. ' +
        'Use this to find media that needs to be imported or organized.',
      inputSchema: {},
      handler: async () => {
        const rootFolders = await client.listRootFolders();
        return rootFolders.flatMap((rf) => (rf.unmappedFolders ?? []).map((folder) => summarizeUnmappedFolder(rf, folder)));
      },
    }),

    defineTool({
      name: 'sonarr_get_rename_preview',
      effect: 'read',
      description:
        'Preview how Sonarr will rename episode files for a series or season without actually ' +
        'running the rename. Useful for verifying your naming rules are working correctly. ' +
        'At most 100 previews are returned; `total` gives the full count.',
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
      effect: 'read',
      description:
        'Find potential duplicate series in the library. Detects series with the same tvdbId ' +
        '(exact duplicate) and different series (distinct tvdbIds) with the same normalized title + year ' +
        'under different root folders (likely misplaced copies). Helps identify library organization issues.' +
        CACHED_LIBRARY_NOTE,
      inputSchema: { refresh: refreshInput },
      handler: async ({ refresh }) => {
        const allSeries = await client.listSeries({ refresh });

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

        // Find different series (distinct tvdbIds) with the same normalized title+year in different
        // root folders. Titles that normalize to nothing carry no key and are skipped.
        const titleYearMap = new Map<string, typeof allSeries>();
        for (const series of allSeries) {
          const title = normalizeTitle(series.title);
          if (title === '') continue;
          const key = `${title}:${series.year}`;
          const group = titleYearMap.get(key) ?? [];
          group.push(series);
          titleYearMap.set(key, group);
        }

        const misplacedCopies = Array.from(titleYearMap.values())
          .filter((group) => group.length > 1)
          .filter((group) => new Set(group.map((s) => s.tvdbId)).size > 1)
          .filter((group) => new Set(group.map((s) => s.rootFolderPath)).size > 1)
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
      effect: 'destructive',
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
