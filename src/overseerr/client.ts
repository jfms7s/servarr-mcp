import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  CombinedRatings,
  CreateRequestPayload,
  MediaListResponse,
  MediaRequest,
  MovieDetails,
  OverseerrStatus,
  PersonCombinedCredits,
  PersonDetails,
  RadarrSettings,
  RequestCounts,
  RequestListResponse,
  RtRating,
  SearchResponse,
  ServiceProfile,
  TvDetails,
  UserListResponse,
} from './types.js';

export interface DiscoverOptions {
  page?: number;
  genre?: string;
  language?: string;
}

export interface ListRequestsOptions {
  take?: number;
  skip?: number;
  filter?: 'all' | 'approved' | 'available' | 'pending' | 'processing' | 'unavailable' | 'failed' | 'deleted' | 'completed';
  sort?: 'added' | 'modified';
  requestedBy?: number;
}

export interface ListMediaOptions {
  take?: number;
  skip?: number;
  filter?: 'all' | 'available' | 'partial' | 'allavailable' | 'processing' | 'pending' | 'deleted';
  sort?: 'added' | 'modified' | 'mediaAdded';
}

export interface ListUsersOptions {
  take?: number;
  skip?: number;
  sort?: 'created' | 'updated' | 'requests' | 'displayname';
}

export interface OverseerrClient {
  search(query: string, page?: number): Promise<SearchResponse>;
  discoverMovies(options?: DiscoverOptions): Promise<SearchResponse>;
  discoverTv(options?: DiscoverOptions): Promise<SearchResponse>;
  getTrending(page?: number): Promise<SearchResponse>;
  getMovie(movieId: number): Promise<MovieDetails>;
  getTv(tvId: number): Promise<TvDetails>;
  getMovieRecommendations(movieId: number, page?: number, language?: string): Promise<SearchResponse>;
  getSimilarMovies(movieId: number, page?: number, language?: string): Promise<SearchResponse>;
  getTvRecommendations(tvId: number, page?: number, language?: string): Promise<SearchResponse>;
  getSimilarTv(tvId: number, page?: number, language?: string): Promise<SearchResponse>;
  getMovieRatings(movieId: number): Promise<CombinedRatings>;
  getTvRatings(tvId: number): Promise<RtRating>;
  getPerson(personId: number): Promise<PersonDetails>;
  getPersonCredits(personId: number): Promise<PersonCombinedCredits>;
  listRequests(options?: ListRequestsOptions): Promise<RequestListResponse>;
  getRequest(requestId: number): Promise<MediaRequest>;
  getRequestCount(): Promise<RequestCounts>;
  createRequest(payload: CreateRequestPayload): Promise<MediaRequest>;
  updateRequestStatus(requestId: number, status: 'approve' | 'decline'): Promise<MediaRequest>;
  updateRequest(requestId: number, payload: UpdateRequestPayload): Promise<MediaRequest>;
  retryRequest(requestId: number): Promise<MediaRequest>;
  deleteRequest(requestId: number): Promise<void>;
  listMedia(options?: ListMediaOptions): Promise<MediaListResponse>;
  deleteMedia(mediaId: number): Promise<void>;
  listUsers(options?: ListUsersOptions): Promise<UserListResponse>;
  getSystemStatus(): Promise<OverseerrStatus>;
  listRadarrServers(): Promise<RadarrSettings[]>;
  getRadarrProfiles(radarrId: number): Promise<ServiceProfile[]>;
}

export interface UpdateRequestPayload {
  mediaType: 'movie' | 'tv';
  seasons?: number[];
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  userId?: number;
}

export function createOverseerrClient(config: InstanceConfig): OverseerrClient {
  const http = createArrClient({
    product: 'Overseerr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v1',
  });

  return {
    search: (query, page) => http.get('/search', { query, page }),
    discoverMovies: (options) => http.get('/discover/movies', { ...options }),
    discoverTv: (options) => http.get('/discover/tv', { ...options }),
    getTrending: (page) => http.get('/discover/trending', { page }),
    getMovie: (movieId) => http.get(`/movie/${movieId}`),
    getTv: (tvId) => http.get(`/tv/${tvId}`),
    getMovieRecommendations: (movieId, page, language) => http.get(`/movie/${movieId}/recommendations`, { page, language }),
    getSimilarMovies: (movieId, page, language) => http.get(`/movie/${movieId}/similar`, { page, language }),
    getTvRecommendations: (tvId, page, language) => http.get(`/tv/${tvId}/recommendations`, { page, language }),
    getSimilarTv: (tvId, page, language) => http.get(`/tv/${tvId}/similar`, { page, language }),
    getMovieRatings: (movieId) => http.get(`/movie/${movieId}/ratingscombined`),
    getTvRatings: (tvId) => http.get(`/tv/${tvId}/ratings`),
    getPerson: (personId) => http.get(`/person/${personId}`),
    getPersonCredits: (personId) => http.get(`/person/${personId}/combined_credits`),
    listRequests: (options) => http.get('/request', { ...options }),
    getRequest: (requestId) => http.get(`/request/${requestId}`),
    getRequestCount: () => http.get('/request/count'),
    createRequest: (payload) => http.post('/request', payload),
    updateRequestStatus: (requestId, status) => http.post(`/request/${requestId}/${status}`),
    updateRequest: (requestId, payload) => http.put(`/request/${requestId}`, payload),
    retryRequest: (requestId) => http.post(`/request/${requestId}/retry`),
    deleteRequest: (requestId) => http.del(`/request/${requestId}`),
    listMedia: (options) => http.get('/media', { ...options }),
    deleteMedia: (mediaId) => http.del(`/media/${mediaId}`),
    listUsers: (options) => http.get('/user', { ...options }),
    getSystemStatus: () => http.get('/status'),
    listRadarrServers: () => http.get('/settings/radarr'),
    getRadarrProfiles: (radarrId) => http.get(`/settings/radarr/${radarrId}/profiles`),
  };
}
