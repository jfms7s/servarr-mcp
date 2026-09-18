import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { RadarrClient } from './client.js';
import { summarizeMovie, summarizeQueueRecord } from './shape.js';

const COMMAND_NAMES = [
  'MoviesSearch',
  'MissingMoviesSearch',
  'RefreshMovie',
  'RescanMovie',
  'RenameFiles',
  'DownloadedMoviesScan',
] as const;

const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export function createRadarrTools(client: RadarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'radarr_list_movies',
      description:
        'List all movies in the Radarr library, summarised. Returns id, title, year, ' +
        'monitored state and whether a file exists. Use radarr_get_movie for the full record.',
      inputSchema: {},
      handler: async () => (await client.listMovies()).map(summarizeMovie),
    }),

    defineTool({
      name: 'radarr_get_movie',
      description: 'Get the full Radarr record for one movie.',
      inputSchema: { movieId: z.number().int().describe('Radarr movie id') },
      handler: ({ movieId }) => client.getMovie(movieId),
    }),

    defineTool({
      name: 'radarr_lookup_movie',
      description:
        'Search TMDB for movies matching a search term. Use this to find the tmdbId needed ' +
        'by radarr_add_movie. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Movie title to search for') },
      handler: async ({ term }) => (await client.lookupMovie(term)).map(summarizeMovie),
    }),

    defineTool({
      name: 'radarr_add_movie',
      description:
        'Add a new movie to Radarr. Get tmdbId from radarr_lookup_movie, qualityProfileId ' +
        'from radarr_list_quality_profiles, and rootFolderPath from radarr_list_root_folders.',
      inputSchema: {
        title: z.string().describe('Movie title'),
        tmdbId: z.number().int().describe('TMDB id, from radarr_lookup_movie'),
        qualityProfileId: z.number().int().describe('From radarr_list_quality_profiles'),
        rootFolderPath: z.string().describe('From radarr_list_root_folders'),
        monitored: z.boolean().optional().describe('Monitor the movie (default true)'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching (default released)'),
        searchForMovie: z.boolean().optional().describe('Search immediately (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from radarr_list_tags'),
      },
      handler: async (args) => {
        const added = await client.addMovie({
          title: args.title,
          tmdbId: args.tmdbId,
          qualityProfileId: args.qualityProfileId,
          rootFolderPath: args.rootFolderPath,
          monitored: args.monitored ?? true,
          minimumAvailability: args.minimumAvailability ?? 'released',
          tags: args.tags,
          addOptions: { searchForMovie: args.searchForMovie ?? false },
        });
        return summarizeMovie(added);
      },
    }),

    defineTool({
      name: 'radarr_update_movie',
      description:
        'Update a movie, changing only the provided fields (monitored, qualityProfileId, ' +
        'minimumAvailability, tags). All other fields are read from the current record.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        monitored: z.boolean().optional().describe('Monitor the movie'),
        qualityProfileId: z.number().int().optional().describe('From radarr_list_quality_profiles'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from radarr_list_tags'),
      },
      handler: async ({ movieId, monitored, qualityProfileId, minimumAvailability, tags }) => {
        const current = await client.getMovie(movieId);
        const merged = {
          ...current,
          ...(monitored !== undefined && { monitored }),
          ...(qualityProfileId !== undefined && { qualityProfileId }),
          ...(minimumAvailability !== undefined && { minimumAvailability }),
          ...(tags !== undefined && { tags }),
        };
        const updated = await client.updateMovie(movieId, merged);
        return summarizeMovie(updated);
      },
    }),

    defineTool({
      name: 'radarr_delete_movie',
      description:
        'Remove a movie from Radarr. Destructive: set deleteFiles to true only when the user ' +
        'has explicitly asked for the file on disk to be deleted too.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        deleteFiles: z.boolean().optional().describe('Also delete the movie file (default false)'),
        addImportExclusion: z
          .boolean()
          .optional()
          .describe('Prevent lists re-adding it (default false)'),
      },
      handler: async ({ movieId, deleteFiles, addImportExclusion }) => {
        await client.deleteMovie(movieId, {
          deleteFiles: deleteFiles ?? false,
          addImportExclusion: addImportExclusion ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'radarr_list_movie_files',
      description:
        'List downloaded movie files for a movie. Shows file path, size, and quality information.',
      inputSchema: { movieId: z.number().int().describe('Radarr movie id') },
      handler: ({ movieId }) => client.listMovieFiles(movieId),
    }),

    defineTool({
      name: 'radarr_delete_movie_file',
      description: 'Destructive: permanently delete a movie file and its record.',
      inputSchema: {
        movieFileId: z.number().int().describe('Radarr movie file id'),
      },
      handler: async ({ movieFileId }) => {
        await client.deleteMovieFile(movieFileId);
        return undefined;
      },
    }),

    defineTool({
      name: 'radarr_get_calendar',
      description:
        'List movies with releases in a date range. Pass start and end for a predictable ' +
        'window; if they are omitted Radarr chooses its own short range around today. ' +
        'Use this to see upcoming releases.',
      inputSchema: {
        start: z.string().optional().describe('ISO date, inclusive'),
        end: z.string().optional().describe('ISO date, exclusive'),
      },
      handler: async ({ start, end }) =>
        (await client.getCalendar({ start, end })).map(summarizeMovie),
    }),

    defineTool({
      name: 'radarr_get_queue',
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
      name: 'radarr_delete_queue_item',
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
      name: 'radarr_get_history',
      description: 'List history of download, import and grab events.',
      inputSchema: {
        ...page,
        eventType: z
          .number()
          .int()
          .optional()
          .describe(
            'Filter by event type: 1 grabbed, 2 downloadFolderImported, 3 downloadFailed, 4 movieFileDeleted, 5 movieFileRenamed, 6 downloadIgnored. Omit for all events.',
          ),
      },
      handler: ({ page: pageNum, pageSize, eventType }) =>
        client.getHistory({ page: pageNum, pageSize, eventType }),
    }),

    defineTool({
      name: 'radarr_get_wanted_missing',
      description: 'List wanted but missing movies (monitored but not downloaded yet).',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getWantedMissing({ page: pageNum, pageSize });
        return { ...response, records: response.records.map(summarizeMovie) };
      },
    }),

    defineTool({
      name: 'radarr_get_blocklist',
      description: 'List releases on the blocklist (failed imports or manually blocked).',
      inputSchema: { ...page },
      handler: ({ page: pageNum, pageSize }) =>
        client.getBlocklist({ page: pageNum, pageSize }),
    }),

    defineTool({
      name: 'radarr_delete_blocklist_item',
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
      name: 'radarr_list_collections',
      description: 'List all movie collections defined in Radarr.',
      inputSchema: {},
      handler: () => client.listCollections(),
    }),

    defineTool({
      name: 'radarr_run_command',
      description:
        'Trigger a Radarr background command, for example searching for a movie or rescanning ' +
        'its folder. Returns a command id; poll it with radarr_get_command.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        movieIds: z.array(z.number().int()).optional().describe('Target movie ids'),
      },
      handler: (args) => client.runCommand(args),
    }),

    defineTool({
      name: 'radarr_get_command',
      description:
        'Poll the status of a background command launched by radarr_run_command or radarr_add_movie.',
      inputSchema: {
        commandId: z.number().int().describe('Command id'),
      },
      handler: ({ commandId }) => client.getCommand(commandId),
    }),

    defineTool({
      name: 'radarr_list_quality_profiles',
      description:
        'List available quality profiles. Use these ids in radarr_add_movie and radarr_update_movie.',
      inputSchema: {},
      handler: () => client.listQualityProfiles(),
    }),

    defineTool({
      name: 'radarr_list_root_folders',
      description:
        'List configured root folders where movies are stored. Use these paths in radarr_add_movie.',
      inputSchema: {},
      handler: () => client.listRootFolders(),
    }),

    defineTool({
      name: 'radarr_list_tags',
      description: 'List all tags available for movie organization.',
      inputSchema: {},
      handler: () => client.listTags(),
    }),

    defineTool({
      name: 'radarr_get_system_status',
      description: 'Get Radarr version, OS, Docker status and other system information.',
      inputSchema: {},
      handler: () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'radarr_get_health',
      description: 'Check Radarr health status. Returns warnings or errors about the installation.',
      inputSchema: {},
      handler: () => client.getHealth(),
    }),

    defineTool({
      name: 'radarr_get_disk_space',
      description: 'List disk space on each drive containing movies or root folders.',
      inputSchema: {},
      handler: () => client.getDiskSpace(),
    }),
  ];
}
