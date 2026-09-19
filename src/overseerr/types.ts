export interface PageInfo {
  page: number;
  pages: number;
  results: number;
}

export interface MediaInfo {
  id: number;
  tmdbId?: number;
  tvdbId?: number;
  status: number; // 1 unknown, 2 pending, 3 processing, 4 partially_available, 5 available, 6 deleted
  requests?: MediaRequest[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchResult {
  id: number;
  mediaType: string; // 'movie' | 'tv' | 'person'
  title?: string;
  name?: string;
  overview?: string;
  posterPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  popularity?: number;
  mediaInfo?: MediaInfo;
}

export interface SearchResponse {
  page: number;
  totalPages: number;
  totalResults: number;
  results: SearchResult[];
}

export interface Genre {
  id: number;
  name: string;
}

export interface MovieDetails {
  id: number;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  tagline?: string;
  releaseDate?: string;
  runtime?: number;
  status?: string;
  posterPath?: string;
  backdropPath?: string;
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  genres?: Genre[];
  productionCompanies?: Array<{ id: number; name: string }>;
  mediaInfo?: MediaInfo;
}

export interface SeasonSummary {
  id: number;
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
}

export interface TvDetails {
  id: number;
  name: string;
  originalName?: string;
  overview?: string;
  tagline?: string;
  firstAirDate?: string;
  lastAirDate?: string;
  status?: string;
  numberOfEpisodes?: number;
  numberOfSeasons?: number;
  posterPath?: string;
  backdropPath?: string;
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  genres?: Genre[];
  networks?: Array<{ id: number; name: string }>;
  seasons?: SeasonSummary[];
  mediaInfo?: MediaInfo;
}

export interface RequestUser {
  id: number;
  email?: string;
  username?: string;
  displayName?: string;
}

export interface MediaRequest {
  id: number;
  status: number; // 1 pending, 2 approved, 3 declined
  media?: MediaInfo;
  createdAt: string;
  updatedAt: string;
  requestedBy?: RequestUser;
  modifiedBy?: RequestUser | null;
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  seasons?: Array<{ id: number; seasonNumber: number }>;
}

export interface RequestListResponse {
  pageInfo: PageInfo;
  results: MediaRequest[];
}

export interface RequestCounts {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
}

export interface CreateRequestPayload {
  mediaType: 'movie' | 'tv';
  mediaId: number;
  seasons?: number[] | 'all';
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  userId?: number;
}

export interface MediaListResponse {
  pageInfo: PageInfo;
  results: MediaInfo[];
}

export interface OverseerrUser {
  id: number;
  email?: string;
  username?: string;
  displayName?: string;
  plexUsername?: string;
  permissions?: number;
  createdAt?: string;
  requestCount?: number;
}

export interface UserListResponse {
  pageInfo: PageInfo;
  results: OverseerrUser[];
}

export interface OverseerrStatus {
  version: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
  restartRequired?: boolean;
}

export interface RtRating {
  title?: string;
  year?: number;
  url?: string;
  criticsScore?: number;
  criticsRating?: string;
  audienceScore?: number;
  audienceRating?: string;
}

export interface ImdbRating {
  title?: string;
  url?: string;
  criticsScore?: number;
}

export interface CombinedRatings {
  rt?: RtRating;
  imdb?: ImdbRating;
}

export interface PersonDetails {
  id: number;
  name: string;
  deathday?: string;
  knownForDepartment?: string;
  alsoKnownAs?: string[];
  gender?: string;
  biography?: string;
  popularity?: string;
  placeOfBirth?: string;
  profilePath?: string;
  adult?: boolean;
  imdbId?: string;
  homepage?: string;
}

export interface CreditRole {
  id: number;
  mediaType?: string;
  title?: string;
  name?: string;
  character?: string;
  job?: string;
  department?: string;
  overview?: string;
  posterPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
}

export interface PersonCombinedCredits {
  id: number;
  cast: CreditRole[];
  crew: CreditRole[];
}
