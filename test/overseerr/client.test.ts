import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOverseerrClient } from '../../src/overseerr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createOverseerrClient({ baseUrl: 'http://overseerr.test:5055', apiKey: 'k' });
const url = (path: string) => `http://overseerr.test:5055/api/v1${path}`;

describe('OverseerrClient', () => {
  it('searches for media', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/search'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('query');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 1, results: [{ id: 11 }] });
      }),
    );
    const result = await client.search('dune');
    expect(seen).toBe('dune');
    expect(result.results).toHaveLength(1);
  });

  it('discovers movies', async () => {
    server.use(
      http.get(url('/discover/movies'), ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        return HttpResponse.json({
          page: page ? parseInt(page) : 1,
          totalPages: 2,
          totalResults: 50,
          results: [],
        });
      }),
    );
    const result = await client.discoverMovies({ page: 2, genre: '28' });
    expect(result.page).toBe(2);
  });

  it('discovers tv', async () => {
    server.use(
      http.get(url('/discover/tv'), () =>
        HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] }),
      ),
    );
    const result = await client.discoverTv();
    expect(result.results).toHaveLength(0);
  });

  it('gets trending', async () => {
    server.use(
      http.get(url('/discover/trending'), ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        return HttpResponse.json({
          page: page ? parseInt(page) : 1,
          totalPages: 1,
          totalResults: 5,
          results: [],
        });
      }),
    );
    const result = await client.getTrending(1);
    expect(result.page).toBe(1);
  });

  it('gets a movie by id', async () => {
    server.use(
      http.get(url('/movie/550'), () => HttpResponse.json({ id: 550, title: 'Fight Club' })),
    );
    const result = await client.getMovie(550);
    expect(result.title).toBe('Fight Club');
  });

  it('gets a tv series by id', async () => {
    server.use(
      http.get(url('/tv/1399'), () => HttpResponse.json({ id: 1399, name: 'Breaking Bad' })),
    );
    const result = await client.getTv(1399);
    expect(result.name).toBe('Breaking Bad');
  });

  it('lists requests with query params', async () => {
    const seen: Record<string, string> = {};
    server.use(
      http.get(url('/request'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.take = params.get('take') ?? '';
        seen.skip = params.get('skip') ?? '';
        seen.filter = params.get('filter') ?? '';
        return HttpResponse.json({ pageInfo: { page: 1, pages: 1, results: 0, pageSize: 20 }, results: [] });
      }),
    );
    await client.listRequests({ take: 50, skip: 10, filter: 'approved' });
    expect(seen.take).toBe('50');
    expect(seen.skip).toBe('10');
    expect(seen.filter).toBe('approved');
  });

  it('gets a single request', async () => {
    server.use(
      http.get(url('/request/123'), () => HttpResponse.json({ id: 123, status: 2 })),
    );
    const result = await client.getRequest(123);
    expect(result.id).toBe(123);
  });

  it('gets request counts', async () => {
    server.use(
      http.get(url('/request/count'), () =>
        HttpResponse.json({ total: 10, pending: 3, approved: 5, declined: 2 }),
      ),
    );
    const result = await client.getRequestCount();
    expect(result.total).toBe(10);
  });

  it('creates a request with json body', async () => {
    let body: unknown;
    server.use(
      http.post(url('/request'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 500, status: 1 }, { status: 201 });
      }),
    );
    await client.createRequest({ mediaType: 'movie', mediaId: 550 });
    expect(body).toEqual({ mediaType: 'movie', mediaId: 550 });
  });

  it('updates request status to approve', async () => {
    server.use(
      http.post(url('/request/123/approve'), () => HttpResponse.json({ id: 123, status: 2 })),
    );
    const result = await client.updateRequestStatus(123, 'approve');
    expect(result.status).toBe(2);
  });

  it('updates request status to decline', async () => {
    server.use(
      http.post(url('/request/123/decline'), () => HttpResponse.json({ id: 123, status: 3 })),
    );
    const result = await client.updateRequestStatus(123, 'decline');
    expect(result.status).toBe(3);
  });

  it('retries a request', async () => {
    server.use(
      http.post(url('/request/123/retry'), () => HttpResponse.json({ id: 123, status: 1 })),
    );
    const result = await client.retryRequest(123);
    expect(result.id).toBe(123);
  });

  it('deletes a request', async () => {
    server.use(http.delete(url('/request/123'), () => new HttpResponse(null, { status: 204 })));
    await expect(client.deleteRequest(123)).resolves.toBeUndefined();
  });

  it('lists media with query params', async () => {
    const seen: Record<string, string> = {};
    server.use(
      http.get(url('/media'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.take = params.get('take') ?? '';
        seen.filter = params.get('filter') ?? '';
        return HttpResponse.json({ pageInfo: { page: 1, pages: 1, results: 0, pageSize: 20 }, results: [] });
      }),
    );
    await client.listMedia({ take: 30, filter: 'available' });
    expect(seen.take).toBe('30');
    expect(seen.filter).toBe('available');
  });

  it('deletes media', async () => {
    server.use(http.delete(url('/media/456'), () => new HttpResponse(null, { status: 204 })));
    await expect(client.deleteMedia(456)).resolves.toBeUndefined();
  });

  it('lists users with query params', async () => {
    const seen: Record<string, string> = {};
    server.use(
      http.get(url('/user'), ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.take = params.get('take') ?? '';
        seen.sort = params.get('sort') ?? '';
        return HttpResponse.json({ pageInfo: { page: 1, pages: 1, results: 0, pageSize: 20 }, results: [] });
      }),
    );
    await client.listUsers({ take: 25, sort: 'created' });
    expect(seen.take).toBe('25');
    expect(seen.sort).toBe('created');
  });

  it('gets system status', async () => {
    server.use(
      http.get(url('/status'), () => HttpResponse.json({ version: '0.1.0' })),
    );
    const result = await client.getSystemStatus();
    expect(result.version).toBe('0.1.0');
  });

  it('gets movie recommendations with page query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/550/recommendations'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('page');
        return HttpResponse.json({ page: 2, totalPages: 5, totalResults: 50, results: [] });
      }),
    );
    const result = await client.getMovieRecommendations(550, 2);
    expect(seen).toBe('2');
    expect(result.page).toBe(2);
  });

  it('gets similar movies', async () => {
    server.use(
      http.get(url('/movie/550/similar'), () =>
        HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] }),
      ),
    );
    const result = await client.getSimilarMovies(550);
    expect(result.results).toHaveLength(0);
  });

  it('gets tv recommendations', async () => {
    server.use(
      http.get(url('/tv/1399/recommendations'), () =>
        HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] }),
      ),
    );
    const result = await client.getTvRecommendations(1399);
    expect(result.results).toHaveLength(0);
  });

  it('gets similar tv shows', async () => {
    server.use(
      http.get(url('/tv/1399/similar'), () =>
        HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] }),
      ),
    );
    const result = await client.getSimilarTv(1399);
    expect(result.results).toHaveLength(0);
  });

  it('gets movie ratings from ratingscombined endpoint', async () => {
    server.use(
      http.get(url('/movie/550/ratingscombined'), () =>
        HttpResponse.json({
          rt: { criticsScore: 67, audienceScore: 79 },
          imdb: { criticsScore: 8.8 },
        }),
      ),
    );
    const result = await client.getMovieRatings(550);
    expect(result.rt?.criticsScore).toBe(67);
    expect(result.imdb?.criticsScore).toBe(8.8);
  });

  it('gets tv ratings', async () => {
    server.use(
      http.get(url('/tv/1399/ratings'), () =>
        HttpResponse.json({ criticsScore: 96, audienceScore: 95 }),
      ),
    );
    const result = await client.getTvRatings(1399);
    expect(result.criticsScore).toBe(96);
  });

  it('gets person details', async () => {
    server.use(
      http.get(url('/person/1'), () =>
        HttpResponse.json({
          id: 1,
          name: 'Brad Pitt',
          biography: 'An American actor and film producer.',
          knownForDepartment: 'Acting',
        }),
      ),
    );
    const result = await client.getPerson(1);
    expect(result.name).toBe('Brad Pitt');
    expect(result.knownForDepartment).toBe('Acting');
  });

  it('gets person combined credits', async () => {
    server.use(
      http.get(url('/person/1/combined_credits'), () =>
        HttpResponse.json({
          id: 1,
          cast: [{ id: 550, title: 'Fight Club', character: 'Tyler Durden' }],
          crew: [{ id: 100, title: 'Some Movie', job: 'Producer' }],
        }),
      ),
    );
    const result = await client.getPersonCredits(1);
    expect(result.cast).toHaveLength(1);
    expect(result.crew).toHaveLength(1);
    expect(result.cast[0]?.character).toBe('Tyler Durden');
  });

  it('discovers movies with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/discover/movies'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.discoverMovies({ language: 'es' });
    expect(seen).toBe('es');
  });

  it('discovers tv with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/discover/tv'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.discoverTv({ language: 'fr' });
    expect(seen).toBe('fr');
  });

  it('gets movie recommendations with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/550/recommendations'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.getMovieRecommendations(550, undefined, 'de');
    expect(seen).toBe('de');
  });

  it('gets similar movies with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/550/similar'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.getSimilarMovies(550, undefined, 'it');
    expect(seen).toBe('it');
  });

  it('gets tv recommendations with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/tv/1399/recommendations'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.getTvRecommendations(1399, undefined, 'ja');
    expect(seen).toBe('ja');
  });

  it('gets similar tv shows with language query param', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/tv/1399/similar'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('language');
        return HttpResponse.json({ page: 1, totalPages: 1, totalResults: 0, results: [] });
      }),
    );
    await client.getSimilarTv(1399, undefined, 'pt');
    expect(seen).toBe('pt');
  });
});
