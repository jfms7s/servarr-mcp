import { z } from 'zod';
import { assertMoveBatchSize, MAX_MOVE_BATCH } from '../mcp/bulk.js';
import { isWithinRoot } from '../mcp/paths.js';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { RadarrClient } from './client.js';
import {
  summarizeBlocklistRecord,
  summarizeCollection,
  summarizeHistoryRecord,
  summarizeMovie,
  summarizeMovieFile,
  summarizeQualityProfile,
  summarizeQueueRecord,
  summarizeRelease,
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

/**
 * Extract folder name from a path, handling both Unix and Windows separators.
 * Split on either separator, then use the root folder's separator style for the result.
 */
function getFolderNameAndJoinPath(currentPath: string | undefined, fallbackName: string | undefined, rootFolderPath: string): { folderName: string; newPath: string } {
  const folderName = currentPath?.split(/[/\\]+/).filter(Boolean).pop() ?? fallbackName;

  if (!folderName) {
    throw new Error(
      'Cannot determine folder name: current path is empty and folderName is not set. ' +
        'Ensure the movie has a valid path before relocating.',
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

export function createRadarrTools(client: RadarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'radarr_list_movies',
      description:
        'List movies in Radarr with optional filtering and pagination. ' +
        'Results are returned as { totalMatched, offset, limit, movies } so pagination is visible. Default limit is 50 ' +
        '(pass limit and offset for different ranges). Filters are applied client-side after ' +
        'fetching all movies, so titleContains and genre matches are case-insensitive substring/array searches.',
      inputSchema: {
        rootFolder: z
          .string()
          .optional()
          .describe(
            'Root folder to filter by. Matches whole path segments, so /media/movies does not match ' +
              '/media/movies-anime',
          ),
        hasFile: z.boolean().optional().describe('Filter by whether a file exists'),
        monitored: z.boolean().optional().describe('Filter by monitored state'),
        genre: z.string().optional().describe('Case-insensitive match against genres array'),
        titleContains: z
          .string()
          .optional()
          .describe('Case-insensitive substring match against title'),
        offset: z.number().int().min(0).optional().describe('Skip this many results (default 0)'),
        limit: z.number().int().min(1).optional().describe('Maximum results to return (default 50)'),
      },
      handler: async ({ rootFolder, hasFile, monitored, genre, titleContains, offset, limit }) => {
        let movies = await client.listMovies();

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
          movies = movies.filter((m) => m.genres?.some((g) => g.toLowerCase().includes(lowerGenre)));
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
          movies: movies.map(summarizeMovie),
        };
      },
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
        'minimumAvailability, rootFolderPath, tags). All other fields are read from the current record. ' +
        'When rootFolderPath is given, path is automatically updated to move the movie folder ' +
        'to the new root (preserving the existing folder name). Set moveFiles=true to physically relocate files.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        monitored: z.boolean().optional().describe('Monitor the movie'),
        qualityProfileId: z.number().int().optional().describe('From radarr_list_quality_profiles'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching'),
        rootFolderPath: z.string().optional().describe('New root folder path from radarr_list_root_folders'),
        moveFiles: z.boolean().optional().describe('Move existing files to new root folder (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from radarr_list_tags'),
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
          const { newPath } = getFolderNameAndJoinPath(current.path, current.folderName, rootFolderPath);
          merged.path = newPath;
        }

        const updated = await client.updateMovie(movieId, merged, { moveFiles: moveFiles ?? false });
        return summarizeMovie(updated);
      },
    }),

    defineTool({
      name: 'radarr_bulk_edit_movies',
      description:
        'Bulk-edit multiple movies with a single API call. ' +
        'Only provided fields are sent to the API, others are left unchanged. ' +
        'Use applyTags to control how tags are merged: add, remove, or replace. ' +
        `When moveFiles is true the files are moved before the call returns, so at most ${MAX_MOVE_BATCH} ids ` +
        'are accepted per call; send larger sets as sequential batches, not in parallel.',
      inputSchema: {
        movieIds: z
          .array(z.number().int())
          .min(1)
          .describe('Radarr movie ids to edit (minimum 1)'),
        monitored: z.boolean().optional().describe('Set monitored state'),
        qualityProfileId: z.number().int().optional().describe('From radarr_list_quality_profiles'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching'),
        rootFolderPath: z.string().optional().describe('New root folder path'),
        moveFiles: z.boolean().optional().describe('Move existing files (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from radarr_list_tags'),
        applyTags: z
          .enum(['add', 'remove', 'replace'])
          .optional()
          .describe('How to apply tags: add, remove, or replace (default replace)'),
      },
      handler: async ({
        movieIds,
        monitored,
        qualityProfileId,
        minimumAvailability,
        rootFolderPath,
        moveFiles,
        tags,
        applyTags,
      }) => {
        assertMoveBatchSize(movieIds, moveFiles, 'radarr_bulk_edit_movies');

        // Build payload with only defined fields
        const payload: Record<string, unknown> = { movieIds };

        if (monitored !== undefined) payload.monitored = monitored;
        if (qualityProfileId !== undefined) payload.qualityProfileId = qualityProfileId;
        if (minimumAvailability !== undefined) payload.minimumAvailability = minimumAvailability;
        if (rootFolderPath !== undefined) payload.rootFolderPath = rootFolderPath;
        if (moveFiles !== undefined) payload.moveFiles = moveFiles;
        if (tags !== undefined) payload.tags = tags;
        if (applyTags !== undefined) payload.applyTags = applyTags;

        const result = await client.bulkEditMovies(payload as unknown as Parameters<typeof client.bulkEditMovies>[0]);
        return {
          updated: result.length,
          movies: result.map(summarizeMovie),
        };
      },
    }),

    defineTool({
      name: 'radarr_delete_movie',
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
          const movie = await client.getMovie(movieId);
          const files = await client.listMovieFiles(movieId);
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
      description:
        'List downloaded movie files for a movie. Shows file path, size, and quality information.',
      inputSchema: { movieId: z.number().int().describe('Radarr movie id') },
      handler: async ({ movieId }) =>
        (await client.listMovieFiles(movieId)).map(summarizeMovieFile),
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
        await client.deleteQueueItem(id, {
          removeFromClient: removeFromClient ?? false,
          blocklist: blocklist ?? false,
        });
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
      handler: async ({ page: pageNum, pageSize, eventType }) => {
        const response = await client.getHistory({ page: pageNum, pageSize, eventType });
        return { ...response, records: response.records.map(summarizeHistoryRecord) };
      },
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
      handler: async ({ page: pageNum, pageSize }) => {
        const response = await client.getBlocklist({ page: pageNum, pageSize });
        return { ...response, records: response.records.map(summarizeBlocklistRecord) };
      },
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
      handler: async () => (await client.listCollections()).map(summarizeCollection),
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
      name: 'radarr_search_releases',
      description:
        'Search for releases to download a movie. Runs a live interactive search across indexers ' +
        '(can take several seconds); results are in Radarr\'s preference order with `rank`. ' +
        '`rejections` are Radarr\'s verbatim reasons for not choosing a release automatically. ' +
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
      handler: async ({ movieId, titleContains, approvedOnly, limit: userLimit }) => {
        const releases = await client.searchReleases(movieId);
        const defaultLimit = 20;
        const finalLimit = userLimit ?? defaultLimit;

        let filtered = releases.map((release, index) => summarizeRelease(release, index + 1));

        if (titleContains) {
          const lowerFilter = titleContains.toLowerCase();
          filtered = filtered.filter((r) => r.title.toLowerCase().includes(lowerFilter));
        }

        if (approvedOnly) {
          filtered = filtered.filter((r) => r.approved);
        }

        const matched = filtered.length;
        const returned = Math.min(matched, finalLimit);
        const result = filtered.slice(0, finalLimit);

        return {
          total: releases.length,
          matched,
          returned,
          releases: result,
        };
      },
    }),

    defineTool({
      name: 'radarr_grab_release',
      description:
        'Download a release from a previous search. Note two caveats: ' +
        '(a) Radarr grabs from its cached search results, which expire after about 30 minutes — ' +
        'if the grab fails, run radarr_search_releases again first. ' +
        '(b) Grabbing a rejected release overrides Radarr\'s decision to DOWNLOAD it, not necessarily ' +
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

    defineTool({
      name: 'radarr_list_unmapped_folders',
      description:
        'List folders in each root folder that Radarr has not yet mapped to any movie. ' +
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
      name: 'radarr_get_rename_preview',
      description:
        'Preview how files would be renamed without actually renaming them. ' +
        'If the result contains hundreds of files, only the first 100 are shown but the total count is reported. ' +
        'Useful to verify rename patterns before applying them.',
      inputSchema: {
        movieIds: z
          .array(z.number().int())
          .min(1)
          .describe('Movie ids to preview rename for'),
      },
      handler: async ({ movieIds }) => {
        const previews = await client.renamePreview(movieIds);
        const MAX_PREVIEW = 100;
        const shown = previews.slice(0, MAX_PREVIEW).map((p) => ({
          id: p.id,
          movieId: p.movieId,
          movieFileId: p.movieFileId,
          existingPath: p.existingPath,
          newPath: p.newPath,
        }));
        return {
          total: previews.length,
          shown: shown.length,
          previews: shown,
        };
      },
    }),

    defineTool({
      name: 'radarr_find_duplicate_movies',
      description:
        'Find movies that appear to be the same film in more than one place. ' +
        'Reports exact duplicates (same tmdbId) and misplaced copies (same title+year under different root folders). ' +
        'Returns a compact grouping suitable for cleanup decisions.',
      inputSchema: {},
      handler: async () => {
        const movies = await client.listMovies();

        // Group by tmdbId for exact duplicates
        const byTmdbId = new Map<number, typeof movies>();
        for (const movie of movies) {
          const existing = byTmdbId.get(movie.tmdbId) ?? [];
          existing.push(movie);
          byTmdbId.set(movie.tmdbId, existing);
        }

        // Find exactDuplicates (same tmdbId, multiple entries)
        const exactDuplicates = Array.from(byTmdbId.entries())
          .filter(([, group]) => group.length > 1)
          .map(([tmdbId, group]) => ({
            tmdbId,
            count: group.length,
            movies: group.map((m) => ({
              id: m.id,
              title: m.title,
              year: m.year,
              path: m.path,
              hasFile: m.hasFile,
            })),
          }));

        // Group by normalized title+year for misplaced copies
        const byTitle = new Map<string, typeof movies>();
        for (const movie of movies) {
          const key = `${movie.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${movie.year}`;
          const existing = byTitle.get(key) ?? [];
          existing.push(movie);
          byTitle.set(key, existing);
        }

        const misplacedCopies = Array.from(byTitle.entries())
          .filter(([, group]) => group.length > 1)
          .filter(([, group]) => new Set(group.map((m) => m.tmdbId)).size > 1) // Different tmdbIds
          .filter(([, group]) => new Set(group.map((m) => m.rootFolderPath)).size > 1) // Different root folders
          .map(([, group]) => ({
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

    defineTool({
      name: 'radarr_list_quality_profiles',
      description:
        'List available quality profiles. Use these ids in radarr_add_movie and radarr_update_movie.',
      inputSchema: {},
      handler: async () => (await client.listQualityProfiles()).map(summarizeQualityProfile),
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

    defineTool({
      name: 'radarr_import_folder',
      description:
        'Scan a folder and import any movie file found into an existing movie entry in Radarr. ' +
        'This is asynchronous — it returns a command id that can be polled with radarr_get_command. ' +
        'Important: the movie must already exist in Radarr for the file to attach to it; otherwise the scan will not import it. ' +
        'Use folderPath from radarr_list_unmapped_folders.',
      inputSchema: {
        path: z.string().describe('Absolute path to the folder to import, as returned by radarr_list_unmapped_folders (folderPath field)'),
        importMode: z
          .enum(['Auto', 'Move', 'Copy'])
          .optional()
          .describe('How to handle the file: Auto (default, let Radarr decide), Move (relocate to configured library), Copy (keep original, duplicate to library)'),
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
