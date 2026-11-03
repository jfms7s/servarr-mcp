import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { OverseerrClient } from '../../src/overseerr/client.js';
import { createOverseerrTools } from '../../src/overseerr/tools.js';
import { ArrApiError } from '../../src/http/errors.js';

function toolsFor(overrides: Partial<OverseerrClient>) {
  const tools = createOverseerrTools(overrides as OverseerrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

const request = {
  id: 1,
  status: 1,
  media: { id: 550, status: 5 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

describe('createOverseerrTools', () => {
  it('registers all 21 tools with unique overseerr_ prefixed names', () => {
    const names = createOverseerrTools({} as OverseerrClient).map((t) => t.name);
    expect(names).toHaveLength(21);
    expect(names.every((n) => n.startsWith('overseerr_'))).toBe(true);
    expect(new Set(names).size).toBe(21);
  });

  it('searches for media', async () => {
    const search = vi.fn().mockResolvedValue({
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [{ id: 550, mediaType: 'movie' }],
    });
    const get = toolsFor({ search });
    const result = (await get('overseerr_search').handler({ query: 'fight club' })) as unknown;
    expect(search).toHaveBeenCalledWith('fight club', undefined);
    expect(result).toHaveProperty('results');
  });

  it('discovers movies', async () => {
    const discoverMovies = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ discoverMovies });
    await get('overseerr_discover_movies').handler({ page: 1, genre: '28' });
    expect(discoverMovies).toHaveBeenCalledWith({ page: 1, genre: '28' });
  });

  it('discovers tv', async () => {
    const discoverTv = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ discoverTv });
    await get('overseerr_discover_tv').handler({});
    expect(discoverTv).toHaveBeenCalledWith({});
  });

  it('gets trending', async () => {
    const getTrending = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ getTrending });
    await get('overseerr_get_trending').handler({ page: 2 });
    expect(getTrending).toHaveBeenCalledWith(2);
  });

  it('gets a movie with its ratings', async () => {
    const getMovie = vi.fn().mockResolvedValue({ id: 550, title: 'Fight Club' });
    const getMovieRatings = vi.fn().mockResolvedValue({
      rt: {
        title: 'Fight Club',
        year: 1999,
        url: 'https://rt/fight_club',
        criticsScore: 79,
        criticsRating: 'Certified Fresh',
        audienceScore: 96,
        audienceRating: 'Upright',
      },
      imdb: { title: 'Fight Club', url: 'https://imdb/tt0137523', criticsScore: 8.8 },
    });
    const get = toolsFor({ getMovie, getMovieRatings });
    const result = await get('overseerr_get_movie').handler({ movieId: 550 });
    expect(getMovie).toHaveBeenCalledWith(550);
    expect(getMovieRatings).toHaveBeenCalledWith(550);
    expect(result).toMatchObject({
      id: 550,
      title: 'Fight Club',
      ratings: {
        rottenTomatoes: {
          criticsScore: 79,
          criticsRating: 'Certified Fresh',
          audienceScore: 96,
          audienceRating: 'Upright',
          url: 'https://rt/fight_club',
        },
        imdb: { score: 8.8, url: 'https://imdb/tt0137523' },
      },
    });
    expect(result).not.toHaveProperty('ratingsUnavailable');
  });

  it('still returns the movie when Overseerr has no ratings for it', async () => {
    const getMovie = vi.fn().mockResolvedValue({ id: 550, title: 'Fight Club' });
    const getMovieRatings = vi.fn().mockRejectedValue(
      new ArrApiError({
        product: 'Overseerr',
        method: 'GET',
        path: '/movie/550/ratingscombined',
        status: 404,
        detail: 'No ratings found.',
      }),
    );
    const get = toolsFor({ getMovie, getMovieRatings });
    const result = await get('overseerr_get_movie').handler({ movieId: 550 });
    expect(result).toMatchObject({ id: 550, title: 'Fight Club' });
    expect(result).not.toHaveProperty('ratings');
    expect((result as { ratingsUnavailable: string }).ratingsUnavailable).toContain('404');
  });

  it('fails the movie call when Overseerr cannot be reached at all', async () => {
    const unreachable = new ArrApiError({
      product: 'Overseerr',
      method: 'GET',
      path: '/movie/550/ratingscombined',
      detail: 'fetch failed',
    });
    const get = toolsFor({
      getMovie: vi.fn().mockResolvedValue({ id: 550, title: 'Fight Club' }),
      getMovieRatings: vi.fn().mockRejectedValue(unreachable),
    });
    await expect(get('overseerr_get_movie').handler({ movieId: 550 })).rejects.toBe(unreachable);
  });

  it('gets a tv series with its Rotten Tomatoes ratings', async () => {
    const getTv = vi.fn().mockResolvedValue({ id: 1399, name: 'Breaking Bad' });
    const getTvRatings = vi.fn().mockResolvedValue({ criticsScore: 96, audienceScore: 98 });
    const get = toolsFor({ getTv, getTvRatings });
    const result = await get('overseerr_get_tv').handler({ tvId: 1399 });
    expect(getTv).toHaveBeenCalledWith(1399);
    expect(getTvRatings).toHaveBeenCalledWith(1399);
    expect(result).toMatchObject({
      id: 1399,
      ratings: { rottenTomatoes: { criticsScore: 96, audienceScore: 98 } },
    });
  });

  it('lists requests', async () => {
    const listRequests = vi
      .fn()
      .mockResolvedValue({ pageInfo: { page: 1, pages: 1, results: 1 }, results: [request] });
    const get = toolsFor({ listRequests });
    const result = (await get('overseerr_list_requests').handler({})) as unknown;
    expect(listRequests).toHaveBeenCalledWith({});
    expect(result).toHaveProperty('results');
  });

  it('gets a single request', async () => {
    const getRequest = vi.fn().mockResolvedValue(request);
    const get = toolsFor({ getRequest });
    await get('overseerr_get_request').handler({ requestId: 1 });
    expect(getRequest).toHaveBeenCalledWith(1);
  });

  it('lists requests without counts by default (no extra upstream call)', async () => {
    const listRequests = vi
      .fn()
      .mockResolvedValue({ pageInfo: { page: 1, pages: 1, results: 1 }, results: [request] });
    const getRequestCount = vi.fn();
    const get = toolsFor({ listRequests, getRequestCount });
    const result = (await get('overseerr_list_requests').handler({ take: 5 })) as object;
    expect(getRequestCount).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('counts');
  });

  it('adds request counts with includeCounts: true', async () => {
    const listRequests = vi
      .fn()
      .mockResolvedValue({ pageInfo: { page: 1, pages: 1, results: 1 }, results: [request] });
    const getRequestCount = vi.fn().mockResolvedValue({ total: 10, pending: 3, approved: 5 });
    const get = toolsFor({ listRequests, getRequestCount });
    const result = await get('overseerr_list_requests').handler({
      take: 5,
      includeCounts: true,
    });
    expect(listRequests).toHaveBeenCalledWith({ take: 5 });
    expect(getRequestCount).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ counts: { total: 10, pending: 3, approved: 5 } });
  });

  it('creates a request with full payload', async () => {
    const createRequest = vi.fn().mockResolvedValue(request);
    const get = toolsFor({ createRequest });
    await get('overseerr_create_request').handler({
      mediaType: 'movie',
      mediaId: 550,
      is4k: true,
    });
    expect(createRequest).toHaveBeenCalledWith({
      mediaType: 'movie',
      mediaId: 550,
      is4k: true,
    });
  });

  it('updates request status', async () => {
    const updateRequestStatus = vi.fn().mockResolvedValue({ ...request, status: 2 });
    const get = toolsFor({ updateRequestStatus });
    await get('overseerr_update_request_status').handler({ requestId: 1, status: 'approve' });
    expect(updateRequestStatus).toHaveBeenCalledWith(1, 'approve');
  });

  it('retries a request', async () => {
    const retryRequest = vi.fn().mockResolvedValue(request);
    const get = toolsFor({ retryRequest });
    await get('overseerr_retry_request').handler({ requestId: 1 });
    expect(retryRequest).toHaveBeenCalledWith(1);
  });

  it('deletes a request', async () => {
    const deleteRequest = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteRequest });
    const result = await get('overseerr_delete_request').handler({ requestId: 1 });
    expect(deleteRequest).toHaveBeenCalledWith(1);
    expect(result).toBeUndefined();
  });

  it('lists media', async () => {
    const listMedia = vi
      .fn()
      .mockResolvedValue({ pageInfo: { page: 1, pages: 1, results: 0 }, results: [] });
    const get = toolsFor({ listMedia });
    const result = (await get('overseerr_list_media').handler({ take: 30 })) as unknown;
    expect(listMedia).toHaveBeenCalledWith({ take: 30 });
    expect(result).toHaveProperty('results');
  });

  it('deletes media', async () => {
    const deleteMedia = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteMedia });
    const result = await get('overseerr_delete_media').handler({ mediaId: 456 });
    expect(deleteMedia).toHaveBeenCalledWith(456);
    expect(result).toBeUndefined();
  });

  it('lists users', async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValue({ pageInfo: { page: 1, pages: 1, results: 0 }, results: [] });
    const get = toolsFor({ listUsers });
    const result = (await get('overseerr_list_users').handler({ sort: 'created' })) as unknown;
    expect(listUsers).toHaveBeenCalledWith({ sort: 'created' });
    expect(result).toHaveProperty('results');
  });

  it('gets system status', async () => {
    const getSystemStatus = vi.fn().mockResolvedValue({ version: '0.1.0' });
    const get = toolsFor({ getSystemStatus });
    const result = await get('overseerr_get_system_status').handler({});
    expect(getSystemStatus).toHaveBeenCalled();
    expect(result).toHaveProperty('version');
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ search: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('overseerr_search').handler({ query: 'test' })).rejects.toThrow('down');
  });

  it('restricts status parameter to approve and decline', () => {
    const tool = createOverseerrTools({} as OverseerrClient).find(
      (t) => t.name === 'overseerr_update_request_status',
    );
    if (!tool) throw new Error('tool not found');
    const schema = z.object(tool.inputSchema).pick({ status: true });
    expect(() => schema.parse({ status: 'approve' })).not.toThrow();
    expect(() => schema.parse({ status: 'decline' })).not.toThrow();
    expect(() => schema.parse({ status: 'invalid' })).toThrow();
  });

  it.each([
    ['movie', 'recommendations', 'getMovieRecommendations'],
    ['movie', 'similar', 'getSimilarMovies'],
    ['tv', 'recommendations', 'getTvRecommendations'],
    ['tv', 'similar', 'getSimilarTv'],
  ] as const)('gets %s %s through %s', async (mediaType, relation, method) => {
    const fetchRelated = vi.fn().mockResolvedValue({
      page: 2,
      totalPages: 3,
      totalResults: 50,
      results: [{ id: 7, mediaType, title: 'Related', overview: 'x'.repeat(400) }],
    });
    const others = vi.fn();
    const all = {
      getMovieRecommendations: others,
      getSimilarMovies: others,
      getTvRecommendations: others,
      getSimilarTv: others,
      [method]: fetchRelated,
    };
    const get = toolsFor(all);
    const result = (await get('overseerr_get_related').handler({
      mediaType,
      id: 550,
      relation,
      page: 2,
      language: 'de',
    })) as { page: number; results: Array<{ id: number; overview?: string }> };
    expect(fetchRelated).toHaveBeenCalledWith(550, 2, 'de');
    expect(others).not.toHaveBeenCalled();
    expect(result.page).toBe(2);
    expect(result.results[0]?.id).toBe(7);
    // Shaped like search results: the overview is truncated.
    expect(result.results[0]?.overview?.length).toBeLessThan(400);
  });

  it('passes undefined page and language through to get_related', async () => {
    const getSimilarTv = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ getSimilarTv });
    await get('overseerr_get_related').handler({ mediaType: 'tv', id: 1399, relation: 'similar' });
    expect(getSimilarTv).toHaveBeenCalledWith(1399, undefined, undefined);
  });

  it('rejects an unknown relation or media type', () => {
    const tool = createOverseerrTools({} as OverseerrClient).find(
      (t) => t.name === 'overseerr_get_related',
    );
    if (!tool) throw new Error('tool not found');
    const schema = z.object(tool.inputSchema);
    expect(() => schema.parse({ mediaType: 'movie', id: 1, relation: 'similar' })).not.toThrow();
    expect(() => schema.parse({ mediaType: 'movie', id: 1, relation: 'sequels' })).toThrow();
    expect(() => schema.parse({ mediaType: 'person', id: 1, relation: 'similar' })).toThrow();
  });

  it('gets person details with their credits', async () => {
    const getPerson = vi.fn().mockResolvedValue({
      id: 1,
      name: 'Brad Pitt',
      biography: 'An actor',
      knownForDepartment: 'Acting',
    });
    const getPersonCredits = vi.fn().mockResolvedValue({
      id: 1,
      cast: [{ id: 550, title: 'Fight Club', character: 'Tyler Durden', overview: 'desc' }],
      crew: [{ id: 100, title: 'Some Movie', job: 'Producer', overview: 'desc' }],
    });
    const get = toolsFor({ getPerson, getPersonCredits });
    const result = await get('overseerr_get_person').handler({ personId: 1 });
    expect(getPerson).toHaveBeenCalledWith(1);
    expect(getPersonCredits).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      id: 1,
      name: 'Brad Pitt',
      credits: {
        castTotal: 1,
        crewTotal: 1,
        cast: [{ id: 550, character: 'Tyler Durden' }],
        crew: [{ id: 100, job: 'Producer' }],
      },
    });
  });

  it('discovers movies with language parameter', async () => {
    const discoverMovies = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ discoverMovies });
    await get('overseerr_discover_movies').handler({ page: 1, genre: '28', language: 'es' });
    expect(discoverMovies).toHaveBeenCalledWith({ page: 1, genre: '28', language: 'es' });
  });

  it('discovers tv with language parameter', async () => {
    const discoverTv = vi
      .fn()
      .mockResolvedValue({ page: 1, totalPages: 1, totalResults: 0, results: [] });
    const get = toolsFor({ discoverTv });
    await get('overseerr_discover_tv').handler({ language: 'fr' });
    expect(discoverTv).toHaveBeenCalledWith({ language: 'fr' });
  });

  it('lists radarr servers with apiKey stripped for security', async () => {
    const listRadarrServers = vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Radarr Main',
        hostname: '127.0.0.1',
        port: 7878,
        apiKey: 'super-secret-key-12345',
        useSsl: false,
        baseUrl: '/radarr',
        activeProfileId: 1,
        activeProfileName: '720p/1080p',
        activeDirectory: '/mnt/archive/media/movies',
        is4k: false,
        minimumAvailability: 'In Cinema',
        isDefault: true,
        externalUrl: 'http://radarr.example.com',
        syncEnabled: false,
        preventSearch: false,
      },
    ]);
    const get = toolsFor({ listRadarrServers });
    const result = (await get('overseerr_list_radarr_servers').handler({})) as unknown[];
    expect(listRadarrServers).toHaveBeenCalledWith();
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('activeDirectory');
    expect(result[0]).toHaveProperty('activeProfileId');
    // SECURITY: apiKey must not be in the output
    expect(result[0]).not.toHaveProperty('apiKey');
    // SECURITY: connection details must not be in the output
    expect(result[0]).not.toHaveProperty('hostname');
    expect(result[0]).not.toHaveProperty('port');
    expect(result[0]).not.toHaveProperty('baseUrl');
    expect(result[0]).not.toHaveProperty('externalUrl');
  });

  it('gets radarr profiles', async () => {
    const getRadarrProfiles = vi.fn().mockResolvedValue([
      { id: 1, name: '720p/1080p' },
      { id: 2, name: '4K' },
    ]);
    const get = toolsFor({ getRadarrProfiles });
    const result = await get('overseerr_get_radarr_profiles').handler({ radarrId: 1 });
    expect(getRadarrProfiles).toHaveBeenCalledWith(1);
    expect(result).toHaveLength(2);
  });

  it('updates a request with partial payload sending only provided fields', async () => {
    const updateRequest = vi.fn().mockResolvedValue({
      ...request,
      rootFolder: '/mnt/archive/media/movies-anime',
      profileId: 2,
    });
    const get = toolsFor({ updateRequest });
    const result = await get('overseerr_update_request').handler({
      requestId: 1,
      mediaType: 'movie',
      rootFolder: '/mnt/archive/media/movies-anime',
      profileId: 2,
    });
    expect(updateRequest).toHaveBeenCalledWith(1, {
      mediaType: 'movie',
      rootFolder: '/mnt/archive/media/movies-anime',
      profileId: 2,
    });
    expect(result).toHaveProperty('id');
  });

  it('updates a request with only mediaType and is4k', async () => {
    const updateRequest = vi.fn().mockResolvedValue({
      ...request,
      is4k: true,
    });
    const get = toolsFor({ updateRequest });
    await get('overseerr_update_request').handler({
      requestId: 1,
      mediaType: 'movie',
      is4k: true,
    });
    expect(updateRequest).toHaveBeenCalledWith(1, {
      mediaType: 'movie',
      is4k: true,
    });
  });

  it('updates a tv request with is4k and its seasons', async () => {
    const updateRequest = vi.fn().mockResolvedValue({ ...request, is4k: true });
    const get = toolsFor({ updateRequest });
    await get('overseerr_update_request').handler({
      requestId: 1,
      mediaType: 'tv',
      is4k: true,
      seasons: [1],
    });
    expect(updateRequest).toHaveBeenCalledWith(1, { mediaType: 'tv', is4k: true, seasons: [1] });
  });

  it('updates a request with seasons for tv media', async () => {
    const updateRequest = vi.fn().mockResolvedValue({
      ...request,
      seasons: [{ id: 1, seasonNumber: 1 }],
    });
    const get = toolsFor({ updateRequest });
    await get('overseerr_update_request').handler({
      requestId: 1,
      mediaType: 'tv',
      seasons: [1, 2, 3],
    });
    expect(updateRequest).toHaveBeenCalledWith(1, {
      mediaType: 'tv',
      seasons: [1, 2, 3],
    });
  });

  it.each([undefined, []])(
    'rejects a tv update with seasons %j before calling Overseerr',
    async (seasons) => {
      const updateRequest = vi.fn();
      const get = toolsFor({ updateRequest });
      await expect(
        get('overseerr_update_request').handler({
          requestId: 1,
          mediaType: 'tv',
          is4k: true,
          seasons,
        }),
      ).rejects.toThrow(/seasons/);
      expect(updateRequest).not.toHaveBeenCalled();
    },
  );
});

describe('overseerr input descriptions', () => {
  it('describes every input field of every tool', () => {
    const missing = createOverseerrTools({} as OverseerrClient).flatMap((tool) =>
      Object.entries(tool.inputSchema)
        .filter(([, schema]) => !(schema as z.ZodType).description)
        .map(([key]) => `${tool.name}.${key}`),
    );
    expect(missing).toEqual([]);
  });
});
