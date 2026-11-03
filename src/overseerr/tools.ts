import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { OverseerrClient } from './client.js';
import type { UpdateRequestPayload } from './types.js';
import {
  summarizeMediaInfo,
  summarizeMediaRequest,
  summarizeMovieDetails,
  summarizeSearchResponse,
  summarizeTvDetails,
  summarizeUser,
  summarizePersonDetails,
  summarizeCreditRole,
  summarizeRadarrSettings,
  type CreditRoleSummary,
} from './shape.js';

const DEFAULT_CREDITS_LIMIT = 50;

// Newest first by release (movie) or first-air (TV) date. ISO dates compare
// as strings; undated credits (announced, not yet scheduled) sort last.
function byNewest(a: CreditRoleSummary, b: CreditRoleSummary): number {
  const aDate = a.releaseDate ?? a.firstAirDate ?? '';
  const bDate = b.releaseDate ?? b.firstAirDate ?? '';
  return bDate.localeCompare(aDate);
}

export function createOverseerrTools(client: OverseerrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'overseerr_search',
      effect: 'read',
      description:
        "Search Overseerr for movies, TV shows, and people by title. Each result's mediaInfo.status (when present) reports library/request state: 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available, 6 deleted. Use the result id as mediaId for overseerr_create_request, or overseerr_get_movie/overseerr_get_tv for more details.",
      inputSchema: {
        query: z.string().min(1).describe('Search term'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
      },
      handler: async (args) => {
        const result = await client.search(args.query, args.page);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_discover_movies',
      effect: 'read',
      description:
        'Discover popular and upcoming movies from TMDB, optionally filtered by genre id. Does not require a search term.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        genre: z.string().optional().describe('TMDB genre id'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.discoverMovies(args);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_discover_tv',
      effect: 'read',
      description:
        'Discover popular and upcoming TV shows from TMDB, optionally filtered by genre id. Does not require a search term.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        genre: z.string().optional().describe('TMDB genre id'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.discoverTv(args);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_trending',
      effect: 'read',
      description: 'List currently trending movies and TV shows.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
      },
      handler: async (args) => {
        const result = await client.getTrending(args.page);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_movie',
      effect: 'read',
      description:
        'Get a summary of Overseerr/TMDB details for one movie: ids, titles, overview (truncated), tagline, release date, ' +
        'runtime, status, poster/backdrop paths, vote average and count, genres, and its request/availability status (mediaInfo).',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
      },
      handler: async (args) => summarizeMovieDetails(await client.getMovie(args.movieId)),
    }),

    defineTool({
      name: 'overseerr_get_tv',
      effect: 'read',
      description:
        'Get a summary of Overseerr/TMDB details for one TV series: ids, names, overview (truncated), tagline, first/last air ' +
        'dates, status, episode and season counts, seasons, poster/backdrop paths, vote average and count, genres, and its ' +
        'request/availability status (mediaInfo).',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
      },
      handler: async (args) => summarizeTvDetails(await client.getTv(args.tvId)),
    }),

    defineTool({
      name: 'overseerr_list_requests',
      effect: 'read',
      description:
        "List media requests. Only the API key owner's own requests are returned unless the key has admin/manage-requests permissions in Overseerr. " +
        'Pass includeCounts: true to add counts, the number of requests by status (total, movie, tv, pending, approved, declined, processing, available), at the cost of one more upstream call.',
      inputSchema: {
        take: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        skip: z.number().int().min(0).optional().describe('Results to skip, for pagination'),
        filter: z
          .enum([
            'all',
            'approved',
            'available',
            'pending',
            'processing',
            'unavailable',
            'failed',
            'deleted',
            'completed',
          ])
          .optional()
          .describe('Only items with this status (default all)'),
        sort: z.enum(['added', 'modified']).optional().describe('Sort order'),
        requestedBy: z.number().int().optional().describe('Filter to one user id'),
        includeCounts: z
          .boolean()
          .optional()
          .describe('Also return counts of all requests by status (default false)'),
      },
      handler: async ({ includeCounts, ...query }) => {
        const [result, counts] = await Promise.all([
          client.listRequests(query),
          includeCounts ? client.getRequestCount() : undefined,
        ]);
        return {
          pageInfo: result.pageInfo,
          results: result.results.map(summarizeMediaRequest),
          ...(counts ? { counts } : {}),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_request',
      effect: 'read',
      description: 'Get one media request by id.',
      inputSchema: {
        requestId: z.number().int().describe('Media request id, from overseerr_list_requests'),
      },
      handler: async (args) => summarizeMediaRequest(await client.getRequest(args.requestId)),
    }),

    defineTool({
      name: 'overseerr_create_request',
      effect: 'write',
      description:
        'Request that a movie or TV show be added. Get mediaId from overseerr_search, overseerr_discover_movies, overseerr_discover_tv, or overseerr_get_trending (their result id is the TMDB id Overseerr expects here). For TV requests, pass seasons as an array of season numbers or the string "all"; omit seasons for movies.',
      inputSchema: {
        mediaType: z.enum(['movie', 'tv']).describe('movie or tv'),
        mediaId: z.number().int().describe('TMDB id'),
        seasons: z
          .union([z.array(z.number().int()), z.literal('all')])
          .optional()
          .describe('TV only: season numbers, or "all"; omit for movies'),
        is4k: z.boolean().optional().describe('Request the 4K version (default false)'),
        serverId: z
          .number()
          .int()
          .optional()
          .describe('Radarr server id, from overseerr_list_radarr_servers'),
        profileId: z
          .number()
          .int()
          .optional()
          .describe('Quality profile id, from overseerr_get_radarr_profiles'),
        rootFolder: z
          .string()
          .optional()
          .describe(
            "Root folder path (a server's activeDirectory, from overseerr_list_radarr_servers)",
          ),
        userId: z
          .number()
          .int()
          .optional()
          .describe('Request on behalf of this user id; requires admin permissions'),
      },
      handler: async (args) => summarizeMediaRequest(await client.createRequest(args)),
    }),

    defineTool({
      name: 'overseerr_update_request_status',
      effect: 'destructive',
      description: 'Approve or decline a pending media request.',
      inputSchema: {
        requestId: z.number().int().describe('Media request id, from overseerr_list_requests'),
        status: z.enum(['approve', 'decline']).describe('approve or decline'),
      },
      handler: async (args) =>
        summarizeMediaRequest(await client.updateRequestStatus(args.requestId, args.status)),
    }),

    defineTool({
      name: 'overseerr_retry_request',
      effect: 'write',
      description:
        'Retry a failed request by resending it to the connected Sonarr or Radarr instance.',
      inputSchema: {
        requestId: z.number().int().describe('Media request id, from overseerr_list_requests'),
      },
      handler: async (args) => summarizeMediaRequest(await client.retryRequest(args.requestId)),
    }),

    defineTool({
      name: 'overseerr_delete_request',
      effect: 'destructive',
      description: 'Destructive: permanently remove a media request.',
      inputSchema: {
        requestId: z.number().int().describe('Media request id, from overseerr_list_requests'),
      },
      handler: async (args) => {
        await client.deleteRequest(args.requestId);
        return undefined;
      },
    }),

    defineTool({
      name: 'overseerr_list_media',
      effect: 'read',
      description: 'List media items known to Overseerr with their availability status.',
      inputSchema: {
        take: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        skip: z.number().int().min(0).optional().describe('Results to skip, for pagination'),
        filter: z
          .enum(['all', 'available', 'partial', 'allavailable', 'processing', 'pending', 'deleted'])
          .optional()
          .describe('Only items with this status (default all)'),
        sort: z.enum(['added', 'modified', 'mediaAdded']).optional().describe('Sort order'),
      },
      handler: async (args) => {
        const result = await client.listMedia(args);
        return {
          pageInfo: result.pageInfo,
          results: result.results.map(summarizeMediaInfo),
        };
      },
    }),

    defineTool({
      name: 'overseerr_delete_media',
      effect: 'destructive',
      description:
        'Destructive: remove a media item from Overseerr, clearing its availability so it can be re-requested.',
      inputSchema: {
        mediaId: z
          .number()
          .int()
          .describe('Overseerr media id (not the TMDB id), from overseerr_list_media'),
      },
      handler: async (args) => {
        await client.deleteMedia(args.mediaId);
        return undefined;
      },
    }),

    defineTool({
      name: 'overseerr_list_users',
      effect: 'read',
      description:
        'List Overseerr users. Requires the API key to have user-management permissions.',
      inputSchema: {
        take: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
        skip: z.number().int().min(0).optional().describe('Results to skip, for pagination'),
        sort: z
          .enum(['created', 'updated', 'requests', 'displayname'])
          .optional()
          .describe('Sort order'),
      },
      handler: async (args) => {
        const result = await client.listUsers(args);
        return {
          pageInfo: result.pageInfo,
          results: result.results.map(summarizeUser),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_system_status',
      effect: 'read',
      description: 'Get Overseerr version and update status.',
      inputSchema: {},
      handler: async () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'overseerr_get_movie_recommendations',
      effect: 'read',
      description:
        'Get movies recommended based on a given movie. Use the movieId from overseerr_get_movie or overseerr_search.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getMovieRecommendations(args.movieId, args.page, args.language);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_similar_movies',
      effect: 'read',
      description: 'Get movies similar to a given movie.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getSimilarMovies(args.movieId, args.page, args.language);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_tv_recommendations',
      effect: 'read',
      description: 'Get TV shows recommended based on a given show.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getTvRecommendations(args.tvId, args.page, args.language);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_similar_tv',
      effect: 'read',
      description: 'Get TV shows similar to a given show.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getSimilarTv(args.tvId, args.page, args.language);
        return summarizeSearchResponse(result);
      },
    }),

    defineTool({
      name: 'overseerr_get_movie_ratings',
      effect: 'read',
      description: 'Get Rotten Tomatoes and IMDB ratings for a movie, when available.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
      },
      handler: async (args) => client.getMovieRatings(args.movieId),
    }),

    defineTool({
      name: 'overseerr_get_tv_ratings',
      effect: 'read',
      description: 'Get Rotten Tomatoes ratings for a TV show, when available.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
      },
      handler: async (args) => client.getTvRatings(args.tvId),
    }),

    defineTool({
      name: 'overseerr_get_person',
      effect: 'read',
      description: 'Get biography and details for a person (actor, director, etc).',
      inputSchema: {
        personId: z.number().int().describe('TMDB person id'),
      },
      handler: async (args) => summarizePersonDetails(await client.getPerson(args.personId)),
    }),

    defineTool({
      name: 'overseerr_get_person_credits',
      effect: 'read',
      description:
        "Get a person's combined movie and TV credits (cast and crew roles), newest first. " +
        `Returns at most limit (default ${DEFAULT_CREDITS_LIMIT}) cast and limit crew rows, with castTotal and crewTotal ` +
        'giving the full counts.',
      inputSchema: {
        personId: z.number().int().describe('TMDB person id'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `Maximum cast rows and maximum crew rows to return (default ${DEFAULT_CREDITS_LIMIT})`,
          ),
      },
      handler: async (args) => {
        const credits = await client.getPersonCredits(args.personId);
        const limit = args.limit ?? DEFAULT_CREDITS_LIMIT;
        const newest = (roles: typeof credits.cast) =>
          roles.map(summarizeCreditRole).sort(byNewest).slice(0, limit);
        return {
          id: credits.id,
          castTotal: credits.cast.length,
          crewTotal: credits.crew.length,
          cast: newest(credits.cast),
          crew: newest(credits.crew),
        };
      },
    }),

    defineTool({
      name: 'overseerr_list_radarr_servers',
      effect: 'read',
      description:
        'List all Radarr instances configured in Overseerr. Shows the activeDirectory (root folder) for each Radarr server, which is the default root folder where requests are routed — this field explains misrouting issues when multiple root folders are configured. Requires admin API key. NOTE: apiKey and connection details (hostname, port, baseUrl, externalUrl) are not returned for security reasons.',
      inputSchema: {},
      handler: async () => {
        const servers = await client.listRadarrServers();
        return servers.map(summarizeRadarrSettings);
      },
    }),

    defineTool({
      name: 'overseerr_get_radarr_profiles',
      effect: 'read',
      description:
        'Get quality profiles available on a specific Radarr server instance. Use this to map profile IDs before calling overseerr_update_request to change the quality profile for a request.',
      inputSchema: {
        radarrId: z
          .number()
          .int()
          .describe('Radarr instance id from overseerr_list_radarr_servers'),
      },
      handler: async (args) => client.getRadarrProfiles(args.radarrId),
    }),

    defineTool({
      name: 'overseerr_update_request',
      effect: 'destructive',
      description:
        'Update a media request (e.g., change quality profile, root folder, 4K setting). The mediaType field is required. Only fields provided are sent to the API. For mediaType "tv", seasons is required (Overseerr rejects a TV update without it). IMPORTANT: changing rootFolder only affects where Radarr is told to put the item when the request is (re)processed. It does NOT move files for a request that is already available — use Radarr tools to move files after updating. Requires the MANAGE_REQUESTS permission.',
      inputSchema: {
        requestId: z.number().int().describe('Media request id, from overseerr_list_requests'),
        mediaType: z.enum(['movie', 'tv']).describe('Media type (required)'),
        rootFolder: z.string().optional().describe('Root folder path for Radarr/Sonarr'),
        profileId: z
          .number()
          .int()
          .optional()
          .describe('Quality profile id, from overseerr_get_radarr_profiles'),
        serverId: z
          .number()
          .int()
          .optional()
          .describe('Radarr/Sonarr server id, from overseerr_list_radarr_servers'),
        is4k: z.boolean().optional().describe('Request the 4K version (default false)'),
        seasons: z
          .array(z.number().int())
          .optional()
          .describe('For TV (required when mediaType is "tv"): array of season numbers to request'),
        languageProfileId: z
          .number()
          .int()
          .optional()
          .describe('Sonarr language profile id (TV only)'),
        userId: z.number().int().optional().describe('Change request owner; requires admin'),
      },
      handler: async (args) => {
        // A raw-shape input schema cannot express this cross-field rule.
        if (args.mediaType === 'tv' && (args.seasons === undefined || args.seasons.length === 0)) {
          throw new Error('seasons is required when mediaType is "tv"');
        }
        const payload: UpdateRequestPayload = {
          mediaType: args.mediaType,
        };
        if (args.rootFolder !== undefined) payload.rootFolder = args.rootFolder;
        if (args.profileId !== undefined) payload.profileId = args.profileId;
        if (args.serverId !== undefined) payload.serverId = args.serverId;
        if (args.is4k !== undefined) payload.is4k = args.is4k;
        if (args.seasons !== undefined) payload.seasons = args.seasons;
        if (args.languageProfileId !== undefined)
          payload.languageProfileId = args.languageProfileId;
        if (args.userId !== undefined) payload.userId = args.userId;

        const result = await client.updateRequest(args.requestId, payload);
        return summarizeMediaRequest(result);
      },
    }),
  ];
}
