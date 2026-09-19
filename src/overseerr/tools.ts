import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { OverseerrClient } from './client.js';
import {
  summarizeMediaInfo,
  summarizeMediaRequest,
  summarizeMovieDetails,
  summarizeSearchResult,
  summarizeTvDetails,
  summarizeUser,
  summarizePersonDetails,
  summarizeCreditRole,
} from './shape.js';

export function createOverseerrTools(client: OverseerrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'overseerr_search',
      description:
        'Search Overseerr for movies, TV shows, and people by title. Each result\'s mediaInfo.status (when present) reports library/request state: 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available, 6 deleted. Use the result id as mediaId for overseerr_create_request, or overseerr_get_movie/overseerr_get_tv for full details.',
      inputSchema: {
        query: z.string().min(1).describe('Search term'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
      },
      handler: async (args) => {
        const result = await client.search(args.query, args.page);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_discover_movies',
      description:
        'Discover popular and upcoming movies from TMDB, optionally filtered by genre id. Does not require a search term.',
      inputSchema: {
        page: z.number().int().min(1).optional(),
        genre: z.string().optional().describe('TMDB genre id'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.discoverMovies(args);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_discover_tv',
      description:
        'Discover popular and upcoming TV shows from TMDB, optionally filtered by genre id. Does not require a search term.',
      inputSchema: {
        page: z.number().int().min(1).optional(),
        genre: z.string().optional().describe('TMDB genre id'),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.discoverTv(args);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_trending',
      description: 'List currently trending movies and TV shows.',
      inputSchema: {
        page: z.number().int().min(1).optional(),
      },
      handler: async (args) => {
        const result = await client.getTrending(args.page);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_movie',
      description: 'Get full Overseerr/TMDB details for one movie, including its request/availability status.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
      },
      handler: async (args) => summarizeMovieDetails(await client.getMovie(args.movieId)),
    }),

    defineTool({
      name: 'overseerr_get_tv',
      description: 'Get full Overseerr/TMDB details for one TV series, including its request/availability status.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
      },
      handler: async (args) => summarizeTvDetails(await client.getTv(args.tvId)),
    }),

    defineTool({
      name: 'overseerr_list_requests',
      description:
        'List media requests. Only the API key owner\'s own requests are returned unless the key has admin/manage-requests permissions in Overseerr.',
      inputSchema: {
        take: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max results (default 20)'),
        skip: z.number().int().min(0).optional().describe('Results to skip, for pagination'),
        filter: z
          .enum(['all', 'approved', 'available', 'pending', 'processing', 'unavailable', 'failed', 'deleted', 'completed'])
          .optional(),
        sort: z.enum(['added', 'modified']).optional(),
        requestedBy: z.number().int().optional().describe('Filter to one user id'),
      },
      handler: async (args) => {
        const result = await client.listRequests(args);
        return {
          pageInfo: result.pageInfo,
          results: result.results.map(summarizeMediaRequest),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_request',
      description: 'Get one media request by id.',
      inputSchema: {
        requestId: z.number().int(),
      },
      handler: async (args) => summarizeMediaRequest(await client.getRequest(args.requestId)),
    }),

    defineTool({
      name: 'overseerr_get_request_count',
      description: 'Get counts of requests by status (pending, approved, declined, etc).',
      inputSchema: {},
      handler: async () => client.getRequestCount(),
    }),

    defineTool({
      name: 'overseerr_create_request',
      description:
        'Request that a movie or TV show be added. Get mediaId from overseerr_search, overseerr_discover_movies, overseerr_discover_tv, or overseerr_get_trending (their result id is the TMDB id Overseerr expects here). For TV requests, pass seasons as an array of season numbers or the string "all"; omit seasons for movies.',
      inputSchema: {
        mediaType: z.enum(['movie', 'tv']),
        mediaId: z.number().int().describe('TMDB id'),
        seasons: z
          .union([z.array(z.number().int()), z.literal('all')])
          .optional(),
        is4k: z.boolean().optional(),
        serverId: z.number().int().optional(),
        profileId: z.number().int().optional(),
        rootFolder: z.string().optional(),
        userId: z.number().int().optional().describe('Request on behalf of this user id; requires admin permissions'),
      },
      handler: async (args) => summarizeMediaRequest(await client.createRequest(args)),
    }),

    defineTool({
      name: 'overseerr_update_request_status',
      description: 'Approve or decline a pending media request.',
      inputSchema: {
        requestId: z.number().int(),
        status: z.enum(['approve', 'decline']),
      },
      handler: async (args) =>
        summarizeMediaRequest(await client.updateRequestStatus(args.requestId, args.status)),
    }),

    defineTool({
      name: 'overseerr_retry_request',
      description: 'Retry a failed request by resending it to the connected Sonarr or Radarr instance.',
      inputSchema: {
        requestId: z.number().int(),
      },
      handler: async (args) => summarizeMediaRequest(await client.retryRequest(args.requestId)),
    }),

    defineTool({
      name: 'overseerr_delete_request',
      description: 'Destructive: permanently remove a media request.',
      inputSchema: {
        requestId: z.number().int(),
      },
      handler: async (args) => {
        await client.deleteRequest(args.requestId);
        return undefined;
      },
    }),

    defineTool({
      name: 'overseerr_list_media',
      description: 'List media items known to Overseerr with their availability status.',
      inputSchema: {
        take: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional(),
        skip: z.number().int().min(0).optional(),
        filter: z
          .enum(['all', 'available', 'partial', 'allavailable', 'processing', 'pending', 'deleted'])
          .optional(),
        sort: z.enum(['added', 'modified', 'mediaAdded']).optional(),
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
      description:
        'Destructive: remove a media item from Overseerr, clearing its availability so it can be re-requested.',
      inputSchema: {
        mediaId: z.number().int(),
      },
      handler: async (args) => {
        await client.deleteMedia(args.mediaId);
        return undefined;
      },
    }),

    defineTool({
      name: 'overseerr_list_users',
      description: 'List Overseerr users. Requires the API key to have user-management permissions.',
      inputSchema: {
        take: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional(),
        skip: z.number().int().min(0).optional(),
        sort: z.enum(['created', 'updated', 'requests', 'displayname']).optional(),
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
      description: 'Get Overseerr version and update status.',
      inputSchema: {},
      handler: async () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'overseerr_get_movie_recommendations',
      description: 'Get movies recommended based on a given movie. Use the movieId from overseerr_get_movie or overseerr_search.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
        page: z.number().int().min(1).optional(),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getMovieRecommendations(args.movieId, args.page, args.language);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_similar_movies',
      description: 'Get movies similar to a given movie.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
        page: z.number().int().min(1).optional(),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getSimilarMovies(args.movieId, args.page, args.language);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_tv_recommendations',
      description: 'Get TV shows recommended based on a given show.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
        page: z.number().int().min(1).optional(),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getTvRecommendations(args.tvId, args.page, args.language);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_similar_tv',
      description: 'Get TV shows similar to a given show.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
        page: z.number().int().min(1).optional(),
        language: z.string().optional().describe('ISO 639-1 language code, e.g. "en"'),
      },
      handler: async (args) => {
        const result = await client.getSimilarTv(args.tvId, args.page, args.language);
        return {
          page: result.page,
          totalPages: result.totalPages,
          totalResults: result.totalResults,
          results: result.results.map(summarizeSearchResult),
        };
      },
    }),

    defineTool({
      name: 'overseerr_get_movie_ratings',
      description: 'Get Rotten Tomatoes and IMDB ratings for a movie, when available.',
      inputSchema: {
        movieId: z.number().int().describe('TMDB movie id'),
      },
      handler: async (args) => client.getMovieRatings(args.movieId),
    }),

    defineTool({
      name: 'overseerr_get_tv_ratings',
      description: 'Get Rotten Tomatoes ratings for a TV show, when available.',
      inputSchema: {
        tvId: z.number().int().describe('TMDB TV series id'),
      },
      handler: async (args) => client.getTvRatings(args.tvId),
    }),

    defineTool({
      name: 'overseerr_get_person',
      description: 'Get biography and details for a person (actor, director, etc).',
      inputSchema: {
        personId: z.number().int().describe('TMDB person id'),
      },
      handler: async (args) => summarizePersonDetails(await client.getPerson(args.personId)),
    }),

    defineTool({
      name: 'overseerr_get_person_credits',
      description: 'Get a person\'s combined movie and TV credits (cast and crew roles).',
      inputSchema: {
        personId: z.number().int().describe('TMDB person id'),
      },
      handler: async (args) => {
        const credits = await client.getPersonCredits(args.personId);
        return {
          id: credits.id,
          cast: credits.cast.map(summarizeCreditRole),
          crew: credits.crew.map(summarizeCreditRole),
        };
      },
    }),
  ];
}
