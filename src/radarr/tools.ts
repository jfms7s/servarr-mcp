import { z } from 'zod';
import {
  assertMoveBatchSize,
  assertMoveFilesChosen,
  MAX_MOVE_BATCH,
  trackMoveCommand,
} from '../arr/bulk.js';
import { CACHED_LIBRARY_NOTE, refreshInput } from '../arr/library.js';
import { listWindow, page, pageOf } from '../arr/paging.js';
import { isWithinRoot, rootFolderOf, relocatePath } from '../arr/paths.js';
import { findDuplicates } from '../arr/duplicates.js';
import { pickDefined } from '../arr/payload.js';
import { capPreviews, rankAndFilterReleases } from '../arr/releases.js';
import { createArrCommonTools, createUnmappedFoldersTool } from '../arr/tools.js';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { RadarrClient } from './client.js';
import type { MovieEditorPayload } from './types.js';
import {
  summarizeBlocklistRecord,
  summarizeCollection,
  summarizeHistoryRecord,
  summarizeMovie,
  summarizeMovieDetail,
  summarizeMovieFile,
  summarizeQueueRecord,
  summarizeRelease,
  summarizeRenamePreview,
} from './shape.js';

const COMMAND_NAMES = [
  'MoviesSearch',
  'MissingMoviesSearch',
  'RefreshMovie',
  'RescanMovie',
  'RenameFiles',
  'DownloadedMoviesScan',
  'RenameMovie',
] as const;

/** What Radarr queues for a file-moving edit: BulkMoveMovie from the editor, MoveMovie from PUT /movie. */
const RADARR_MOVE_COMMANDS = ['BulkMoveMovie', 'MoveMovie'];

export function createRadarrTools(client: RadarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'radarr_list_movies',
      effect: 'read',
      description:
        'List movies in Radarr with optional filtering and pagination. ' +
        'Results are returned as { totalMatched, offset, limit, movies } so pagination is visible. Default limit is 50 ' +
        '(pass limit and offset for different ranges). Filters are applied client-side after ' +
        'fetching all movies, so titleContains and genre matches are case-insensitive substring/array searches. ' +
        'Rows omit the plot overview unless includeOverview is true.' +
        CACHED_LIBRARY_NOTE,
      inputSchema: {
        rootFolder: z
          .string()
          .optional()
          .describe(
            'Folder to filter by: a root folder or any folder beneath it, matched against the movie folder. ' +
              'Matches whole path segments, so /media/movies does not match /media/movies-anime',
          ),
        hasFile: z.boolean().optional().describe('Filter by whether a file exists'),
        monitored: z.boolean().optional().describe('Filter by monitored state'),
        genre: z.string().optional().describe('Case-insensitive match against genres array'),
        titleContains: z
          .string()
          .optional()
          .describe('Case-insensitive substring match against title'),
        offset: z.number().int().min(0).optional().describe('Skip this many results (default 0)'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Maximum results to return (default 50)'),
        includeOverview: z
          .boolean()
          .optional()
          .describe("Include each row's plot overview (default false)"),
        refresh: refreshInput,
      },
      handler: async ({
        rootFolder,
        hasFile,
        monitored,
        genre,
        titleContains,
        offset,
        limit,
        includeOverview,
        refresh,
      }) => {
        let movies = await client.listMovies({ refresh });

        // Apply filters
        if (rootFolder) {
          movies = movies.filter((m) => isWithinRoot(m.path, rootFolder));
        }
        if (hasFile !== undefined) {
          movies = movies.filter((m) => m.hasFile === hasFile);
        }
        if (monitored !== undefined) {
          movies = movies.filter((m) => m.monitored === monitored);
        }
        if (genre) {
          const lowerGenre = genre.toLowerCase();
          movies = movies.filter((m) =>
            m.genres?.some((g) => g.toLowerCase().includes(lowerGenre)),
          );
        }
        if (titleContains) {
          const lowerTitle = titleContains.toLowerCase();
          movies = movies.filter((m) => m.title.toLowerCase().includes(lowerTitle));
        }

        const filteredMatched = movies.length;
        const finalOffset = offset ?? 0;
        const finalLimit = limit ?? 50;

        movies = movies.slice(finalOffset, finalOffset + finalLimit);

        return {
          totalMatched: filteredMatched,
          offset: finalOffset,
          limit: finalLimit,
          movies: movies.map((m) => summarizeMovie(m, { overview: includeOverview ?? false })),
        };
      },
    }),

    defineTool({
      name: 'radarr_get_movie',
      effect: 'read',
      description:
        'Get one Radarr movie: the list summary plus root folder, added date, minimum availability and ' +
        'its file (id, relative path, size, quality) when it has one. full=true returns the raw Radarr record.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        full: z
          .boolean()
          .optional()
          .describe('Return the raw Radarr record instead of the summary (default false)'),
      },
      handler: async ({ movieId, full }) => {
        const movie = await client.getMovie(movieId);
        return full ? movie : summarizeMovieDetail(movie);
      },
    }),

    defineTool({
      name: 'radarr_lookup_movie',
      effect: 'read',
      description:
        'Search TMDB for movies matching a search term. Use this to find the tmdbId needed ' +
        'by radarr_add_movie. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Movie title to search for') },
      handler: async ({ term }) => (await client.lookupMovie(term)).map((m) => summarizeMovie(m)),
    }),

    defineTool({
      name: 'radarr_add_movie',
      effect: 'write',
      description:
        'Add a new movie to Radarr. Get tmdbId from radarr_lookup_movie, qualityProfileId ' +
        'and rootFolderPath from radarr_list_options. ' +
        "Household requests go through Overseerr (overseerr_create_request) so they're tracked and approved; use radarr_add_movie / sonarr_add_series for direct adds by the owner.",
      inputSchema: {
        title: z.string().describe('Movie title'),
        tmdbId: z.number().int().describe('TMDB id, from radarr_lookup_movie'),
        qualityProfileId: z.number().int().describe('From radarr_list_options (qualityProfiles)'),
        rootFolderPath: z.string().describe('From radarr_list_options (rootFolders)'),
        monitored: z.boolean().optional().describe('Monitor the movie (default true)'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching (default released)'),
        searchForMovie: z.boolean().optional().describe('Search immediately (default false)'),
        tags: z
          .array(z.number().int())
          .optional()
          .describe('Tag ids from radarr_list_options (tags)'),
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
      effect: 'destructive',
      description:
        'Update a movie, changing only the provided fields (monitored, qualityProfileId, ' +
        'minimumAvailability, rootFolderPath, tags). All other fields are read from the current record. ' +
        'When rootFolderPath is given, path is automatically updated to the new root (preserving the ' +
        'existing folder name), and moveFiles is required: true moves the files with the record, false ' +
        'repoints the record only (the files stay put and Radarr reports the movie missing after a rescan). ' +
        'With moveFiles true, Radarr queues the move as a background command and returns before the files ' +
        'move: the result carries moveCommandId to poll with radarr_get_command (null when none was found).',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        monitored: z.boolean().optional().describe('Monitor the movie'),
        qualityProfileId: z
          .number()
          .int()
          .optional()
          .describe('From radarr_list_options (qualityProfiles)'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching'),
        rootFolderPath: z
          .string()
          .optional()
          .describe('New root folder path from radarr_list_options (rootFolders)'),
        moveFiles: z
          .boolean()
          .optional()
          .describe(
            'Required with rootFolderPath: true moves the files, false repoints the record only',
          ),
        tags: z
          .array(z.number().int())
          .optional()
          .describe('Tag ids from radarr_list_options (tags)'),
      },
      handler: async ({
        movieId,
        monitored,
        qualityProfileId,
        minimumAvailability,
        rootFolderPath,
        moveFiles,
        tags,
      }) => {
        assertMoveFilesChosen(rootFolderPath, moveFiles, 'radarr_update_movie');
        const current = await client.getMovie(movieId);
        const merged = {
          ...current,
          ...(monitored !== undefined && { monitored }),
          ...(qualityProfileId !== undefined && { qualityProfileId }),
          ...(minimumAvailability !== undefined && { minimumAvailability }),
          ...(rootFolderPath !== undefined && { rootFolderPath }),
          ...(tags !== undefined && { tags }),
        };

        // When rootFolderPath changes, compute the new path by preserving the folder name
        if (rootFolderPath !== undefined) {
          const newPath = relocatePath(current.path, current.folderName, rootFolderPath, 'movie');
          merged.path = newPath;
        }

        if (moveFiles !== true) {
          return summarizeMovie(await client.updateMovie(movieId, merged, { moveFiles: false }));
        }
        const { result, ...move } = await trackMoveCommand(
          () => client.listCommands(),
          RADARR_MOVE_COMMANDS,
          () => client.updateMovie(movieId, merged, { moveFiles: true }),
        );
        return { ...summarizeMovie(result), ...move };
      },
    }),

    defineTool({
      name: 'radarr_bulk_edit_movies',
      effect: 'destructive',
      description:
        'Bulk-edit multiple movies with a single API call. ' +
        'Only provided fields are sent to the API, others are left unchanged. ' +
        'Use applyTags to control how tags are merged: add, remove, or replace. ' +
        'When rootFolderPath is given, moveFiles is required: true moves the files with the records, false ' +
        'repoints the records only (the files stay put and Radarr reports the movies missing after a rescan). ' +
        'With moveFiles true, Radarr queues the move as a background command and returns before the files ' +
        'move: the result carries moveCommandId to poll with radarr_get_command (null when none was found). ' +
        `At most ${MAX_MOVE_BATCH} ids are accepted per call when moveFiles is true; send larger sets as ` +
        'sequential batches, and poll each moveCommandId until it completes before the next batch or a retry.',
      inputSchema: {
        movieIds: z.array(z.number().int()).min(1).describe('Radarr movie ids to edit (minimum 1)'),
        monitored: z.boolean().optional().describe('Set monitored state'),
        qualityProfileId: z
          .number()
          .int()
          .optional()
          .describe('From radarr_list_options (qualityProfiles)'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching'),
        rootFolderPath: z.string().optional().describe('New root folder path'),
        moveFiles: z
          .boolean()
          .optional()
          .describe(
            'Required with rootFolderPath: true moves the files, false repoints the records only',
          ),
        tags: z
          .array(z.number().int())
          .optional()
          .describe('Tag ids from radarr_list_options (tags)'),
        applyTags: z
          .enum(['add', 'remove', 'replace'])
          .optional()
          .describe('How to apply tags: add, remove, or replace (default replace)'),
      },
      handler: async (args) => {
        const { movieIds, rootFolderPath, moveFiles } = args;
        assertMoveFilesChosen(rootFolderPath, moveFiles, 'radarr_bulk_edit_movies');
        assertMoveBatchSize(movieIds, moveFiles, 'radarr_bulk_edit_movies');

        // Only the fields that were set, so an omitted field is not blanked upstream.
        const payload: MovieEditorPayload = {
          movieIds,
          ...pickDefined(args, [
            'monitored',
            'qualityProfileId',
            'minimumAvailability',
            'rootFolderPath',
            'moveFiles',
            'tags',
            'applyTags',
          ]),
        };

        const edit = () => client.bulkEditMovies(payload);
        const summarize = (result: Awaited<ReturnType<typeof edit>>) => ({
          updated: result.length,
          movies: result.map((m) => summarizeMovie(m, { overview: false })),
        });
        if (moveFiles !== true) return summarize(await edit());
        const { result, ...move } = await trackMoveCommand(
          () => client.listCommands(),
          RADARR_MOVE_COMMANDS,
          edit,
        );
        return { ...summarize(result), ...move };
      },
    }),

    defineTool({
      name: 'radarr_delete_movie',
      effect: 'destructive',
      description:
        'Remove a movie from Radarr. ' +
        'When deleteFiles=true without confirmDeleteFiles=true, returns what would be deleted as a safety check. ' +
        'Set confirmDeleteFiles=true to confirm the destructive operation.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        deleteFiles: z.boolean().optional().describe('Also delete the movie file (default false)'),
        confirmDeleteFiles: z
          .boolean()
          .optional()
          .describe('Required when deleteFiles=true, prevents accidental deletion'),
        addImportExclusion: z
          .boolean()
          .optional()
          .describe('Prevent lists re-adding it (default false)'),
      },
      handler: async ({ movieId, deleteFiles, confirmDeleteFiles, addImportExclusion }) => {
        // Guard against destructive operations without confirmation
        if (deleteFiles && !confirmDeleteFiles) {
          const [movie, files] = await Promise.all([
            client.getMovie(movieId),
            client.listMovieFiles(movieId),
          ]);
          return {
            wouldDelete: {
              title: movie.title,
              year: movie.year,
              path: movie.path,
              files: files.map((f) => f.relativePath),
              hasFile: movie.hasFile,
              monitored: movie.monitored,
            },
            confirmRequired: true,
          };
        }

        await client.deleteMovie(movieId, {
          deleteFiles: deleteFiles ?? false,
          addImportExclusion: addImportExclusion ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'radarr_list_movie_files',
      effect: 'read',
      description:
        'List downloaded movie files for a movie. Shows file path, size, and quality information.',
      inputSchema: { movieId: z.number().int().describe('Radarr movie id') },
      handler: async ({ movieId }) =>
        (await client.listMovieFiles(movieId)).map(summarizeMovieFile),
    }),

    defineTool({
      name: 'radarr_delete_movie_file',
      effect: 'destructive',
      description:
        'Destructive: permanently delete a movie file on disk and its record. ' +
        'Without confirm=true, deletes nothing and returns the file that would be deleted as a safety check.',
      inputSchema: {
        movieFileId: z.number().int().describe('Radarr movie file id'),
        confirm: z
          .boolean()
          .optional()
          .describe('Required to delete, prevents accidental deletion'),
      },
      handler: async ({ movieFileId, confirm }) => {
        if (confirm !== true) {
          const file = await client.getMovieFile(movieFileId);
          return {
            wouldDelete: {
              id: file.id,
              movieId: file.movieId,
              relativePath: file.relativePath,
              path: file.path,
              size: file.size,
              quality: file.quality?.quality.name,
            },
            confirmRequired: true,
          };
        }
        await client.deleteMovieFile(movieFileId);
        return undefined;
      },
    }),

    defineTool({
      name: 'radarr_get_calendar',
      effect: 'read',
      description:
        'List movies with releases in a date range. Pass start and end for a predictable ' +
        'window; if they are omitted Radarr chooses its own short range around today. ' +
        'Use this to see upcoming releases. Results are returned as { totalMatched, offset, limit, movies }; ' +
        'default limit is 100 (pass limit and offset for other ranges). Rows omit the plot overview.',
      inputSchema: {
        start: z.string().optional().describe('ISO date, inclusive'),
        end: z.string().optional().describe('ISO date, exclusive'),
        ...listWindow,
      },
      handler: async ({ start, end, limit, offset }) => {
        const { rows, ...window } = pageOf(await client.getCalendar({ start, end }), {
          limit,
          offset,
        });
        return { ...window, movies: rows.map((m) => summarizeMovie(m, { overview: false })) };
      },
    }),

    defineTool({
      name: 'radarr_get_queue',
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
      name: 'radarr_delete_queue_item',
      effect: 'destructive',
      description:
        'Destructive: remove an item from the download queue. Use removeFromClient to also ' +
        'request removal from the torrent/usenet client, and blocklist to prevent re-importing.',
      inputSchema: {
        id: z.number().int().describe('Queue item id'),
        removeFromClient: z
          .boolean()
          .optional()
          .describe('Remove from download client (default false)'),
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
      name: 'radarr_get_history',
      effect: 'read',
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
      handler: async ({ page: pageNum, pageSize, eventType }) => {
        const response = await client.getHistory({ page: pageNum, pageSize, eventType });
        return { ...response, records: response.records.map(summarizeHistoryRecord) };
      },
    }),

    defineTool({
      name: 'radarr_get_wanted_missing',
      effect: 'read',
      description:
        'List wanted but missing movies (monitored but not downloaded yet). Rows omit the plot overview.',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getWantedMissing({ page: pageNum, pageSize });
        return {
          ...response,
          records: response.records.map((m) => summarizeMovie(m, { overview: false })),
        };
      },
    }),

    defineTool({
      name: 'radarr_get_wanted_cutoff',
      effect: 'read',
      description:
        "List movies whose file is below the quality profile's cutoff (upgrades Radarr still looks for). " +
        'Each row adds currentQuality, the quality of the file on disk. Rows omit the plot overview.',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getWantedCutoff({ page: pageNum, pageSize });
        return {
          ...response,
          records: response.records.map((m) => ({
            ...summarizeMovie(m, { overview: false }),
            currentQuality: m.movieFile?.quality?.quality.name,
          })),
        };
      },
    }),

    defineTool({
      name: 'radarr_get_blocklist',
      effect: 'read',
      description: 'List releases on the blocklist (failed imports or manually blocked).',
      inputSchema: { ...page },
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getBlocklist({ page: pageNum, pageSize });
        return { ...response, records: response.records.map(summarizeBlocklistRecord) };
      },
    }),

    defineTool({
      name: 'radarr_delete_blocklist_item',
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
      name: 'radarr_list_collections',
      effect: 'read',
      description: 'List all movie collections defined in Radarr.',
      inputSchema: {},
      handler: async () => (await client.listCollections()).map(summarizeCollection),
    }),

    defineTool({
      name: 'radarr_run_command',
      effect: 'write',
      description:
        'Trigger a Radarr background command, for example searching for a movie or rescanning ' +
        'its folder. Returns a command id; poll it with radarr_get_command. ' +
        'MissingMoviesSearch searches (and may download) every missing monitored movie, so without ' +
        'confirm=true it only returns { wouldRun: { command, missingCount }, confirmRequired: true } and runs nothing.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        movieIds: z.array(z.number().int()).optional().describe('Target movie ids'),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'Required to run MissingMoviesSearch, prevents an accidental library-wide search',
          ),
      },
      handler: async ({ confirm, ...command }) => {
        if (command.name === 'MissingMoviesSearch' && confirm !== true) {
          const missing = await client.getWantedMissing({ page: 1, pageSize: 1 });
          return {
            wouldRun: { command: command.name, missingCount: missing.totalRecords },
            confirmRequired: true,
          };
        }
        return client.runCommand(command);
      },
    }),

    defineTool({
      name: 'radarr_get_command',
      effect: 'read',
      description:
        'Poll the status of a background command launched by radarr_run_command or radarr_import_folder, or the ' +
        'moveCommandId returned by radarr_update_movie and radarr_bulk_edit_movies.',
      inputSchema: {
        commandId: z.number().int().describe('Command id'),
      },
      handler: ({ commandId }) => client.getCommand(commandId),
    }),

    defineTool({
      name: 'radarr_search_releases',
      effect: 'read',
      description:
        'Search for releases to download a movie. Runs a live interactive search across indexers ' +
        "(can take several seconds); results are in Radarr's preference order with `rank`. " +
        "`rejections` are Radarr's verbatim reasons for not choosing a release automatically. " +
        'Use guid + indexerId with radarr_grab_release to download a release.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        titleContains: z
          .string()
          .min(1)
          .optional()
          .describe('Filter results by title substring (case-insensitive)'),
        approvedOnly: z
          .boolean()
          .optional()
          .describe('Only show approved releases (default false)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum results to return (default 20)'),
      },
      handler: async ({ movieId, ...filters }) =>
        rankAndFilterReleases(await client.searchReleases(movieId), summarizeRelease, filters),
    }),

    defineTool({
      name: 'radarr_grab_release',
      effect: 'destructive',
      description:
        'Download a release from a previous search. Note two caveats: ' +
        '(a) Radarr grabs from its cached search results, which expire after about 30 minutes — ' +
        'if the grab fails, run radarr_search_releases again first. ' +
        "(b) Grabbing a rejected release overrides Radarr's decision to DOWNLOAD it, not necessarily " +
        'its decision to IMPORT it — the rejection reasons (e.g. not an upgrade, quality not wanted in profile) ' +
        'can still block import, leaving the item stuck in the queue. ' +
        'This starts a real download that Radarr tracks and imports (unlike prowlarr_grab_release, ' +
        'which bypasses Radarr).',
      inputSchema: {
        guid: z.string().min(1).describe('Release guid from radarr_search_releases'),
        indexerId: z.number().int().describe('Release indexerId from radarr_search_releases'),
      },
      handler: async ({ guid, indexerId }) => {
        const response = await client.grabRelease({ guid, indexerId });
        return {
          grabbed: true,
          guid,
          indexerId,
          title: response.title,
        };
      },
    }),

    createUnmappedFoldersTool(
      client,
      'radarr',
      'List folders in each root folder that Radarr has not yet mapped to any movie. ' +
        'Use this to find media that needs to be imported or organized.',
    ),

    defineTool({
      name: 'radarr_get_rename_preview',
      effect: 'read',
      description:
        'Preview how files would be renamed without actually renaming them. ' +
        'At most 100 previews are returned; `total` gives the full count. ' +
        'Useful to verify rename patterns before applying them.',
      inputSchema: {
        movieIds: z.array(z.number().int()).min(1).describe('Movie ids to preview rename for'),
      },
      handler: async ({ movieIds }) => {
        return capPreviews(await client.renamePreview(movieIds), summarizeRenamePreview);
      },
    }),

    defineTool({
      name: 'radarr_find_duplicate_movies',
      effect: 'read',
      description:
        'Find movies that appear to be the same film in more than one place. ' +
        'Reports exact duplicates (same tmdbId) and misplaced copies (same title+year under different root folders). ' +
        'Returns a compact grouping suitable for cleanup decisions.' +
        CACHED_LIBRARY_NOTE,
      inputSchema: { refresh: refreshInput },
      handler: async ({ refresh }) => {
        const [movies, rootFolders] = await Promise.all([
          client.listMovies({ refresh }),
          client.listRootFolders(),
        ]);
        const rootPaths = rootFolders.map((root) => root.path);

        // Radarr's movie list often carries only `path`, so derive each movie's root folder from
        // the configured root folders before comparing.
        const { exact, misplaced } = findDuplicates(movies, {
          idOf: (movie) => movie.tmdbId,
          title: (movie) => movie.title,
          year: (movie) => movie.year,
          rootOf: (movie) => rootFolderOf(movie.path, rootPaths, movie.rootFolderPath),
        });

        const exactDuplicates = exact.map(({ id, items }) => ({
          tmdbId: id,
          count: items.length,
          movies: items.map((m) => ({
            id: m.id,
            title: m.title,
            year: m.year,
            path: m.path,
            hasFile: m.hasFile,
          })),
        }));

        const misplacedCopies = misplaced.map((group) => ({
          title: group[0]!.title,
          year: group[0]!.year,
          count: group.length,
          movies: group.map((m) => ({
            id: m.id,
            title: m.title,
            tmdbId: m.tmdbId,
            path: m.path,
            hasFile: m.hasFile,
          })),
        }));

        return {
          total: movies.length,
          exactDuplicates,
          misplacedCopies,
        };
      },
    }),

    ...createArrCommonTools(client, 'radarr', {
      product: 'Radarr',
      item: 'movie',
      items: 'movies',
      addTool: 'radarr_add_movie',
      updateTool: 'radarr_update_movie',
    }),

    defineTool({
      name: 'radarr_import_folder',
      effect: 'destructive',
      description:
        'Scan a folder and import any movie file found into an existing movie entry in Radarr. ' +
        'This is asynchronous — it returns a command id that can be polled with radarr_get_command. ' +
        'Important: the movie must already exist in Radarr for the file to attach to it; otherwise the scan will not import it. ' +
        'Use folderPath from radarr_list_unmapped_folders.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'Absolute path to the folder to import, as returned by radarr_list_unmapped_folders (folderPath field)',
          ),
        importMode: z
          .enum(['Auto', 'Move', 'Copy'])
          .optional()
          .describe(
            'How to handle the file: Auto (default, let Radarr decide), Move (relocate to configured library), Copy (keep original, duplicate to library)',
          ),
      },
      handler: async ({ path, importMode }) => {
        const command = await client.runCommand({
          name: 'DownloadedMoviesScan',
          path,
          ...(importMode && { importMode }),
        });
        return {
          commandId: command.id,
          status: command.status,
          message: `Scanning ${path} for movies to import`,
        };
      },
    }),
  ];
}
