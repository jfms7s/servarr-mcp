import type {
  CreditRole,
  MediaInfo,
  MediaRequest,
  MovieDetails,
  OverseerrUser,
  PersonDetails,
  SearchResult,
  TvDetails,
} from './types.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
}

export interface MediaInfoSummary {
  id: number;
  tmdbId?: number;
  tvdbId?: number;
  status: number;
  requestCount: number;
  updatedAt?: string;
}

export function summarizeMediaInfo(media: MediaInfo): MediaInfoSummary {
  return {
    id: media.id,
    tmdbId: media.tmdbId,
    tvdbId: media.tvdbId,
    status: media.status,
    requestCount: media.requests?.length ?? 0,
    updatedAt: media.updatedAt,
  };
}

export interface SearchResultSummary {
  id: number;
  mediaType: string;
  title?: string;
  name?: string;
  overview?: string;
  posterPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  popularity?: number;
  mediaInfo?: MediaInfoSummary;
}

export function summarizeSearchResult(result: SearchResult): SearchResultSummary {
  return {
    id: result.id,
    mediaType: result.mediaType,
    title: result.title,
    name: result.name,
    overview: truncateOverview(result.overview),
    posterPath: result.posterPath,
    releaseDate: result.releaseDate,
    firstAirDate: result.firstAirDate,
    voteAverage: result.voteAverage,
    popularity: result.popularity,
    mediaInfo: result.mediaInfo ? summarizeMediaInfo(result.mediaInfo) : undefined,
  };
}

export interface MovieDetailsSummary {
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
  genres?: Array<{ id: number; name: string }>;
  mediaInfo?: MediaInfoSummary;
}

export function summarizeMovieDetails(movie: MovieDetails): MovieDetailsSummary {
  return {
    id: movie.id,
    imdbId: movie.imdbId,
    title: movie.title,
    originalTitle: movie.originalTitle,
    overview: truncateOverview(movie.overview),
    tagline: movie.tagline,
    releaseDate: movie.releaseDate,
    runtime: movie.runtime,
    status: movie.status,
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath,
    voteAverage: movie.voteAverage,
    voteCount: movie.voteCount,
    genres: movie.genres,
    mediaInfo: movie.mediaInfo ? summarizeMediaInfo(movie.mediaInfo) : undefined,
  };
}

export interface TvDetailsSummary {
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
  genres?: Array<{ id: number; name: string }>;
  seasons?: Array<{ id: number; seasonNumber: number; name: string; episodeCount: number; airDate?: string }>;
  mediaInfo?: MediaInfoSummary;
}

export function summarizeTvDetails(tv: TvDetails): TvDetailsSummary {
  return {
    id: tv.id,
    name: tv.name,
    originalName: tv.originalName,
    overview: truncateOverview(tv.overview),
    tagline: tv.tagline,
    firstAirDate: tv.firstAirDate,
    lastAirDate: tv.lastAirDate,
    status: tv.status,
    numberOfEpisodes: tv.numberOfEpisodes,
    numberOfSeasons: tv.numberOfSeasons,
    posterPath: tv.posterPath,
    backdropPath: tv.backdropPath,
    voteAverage: tv.voteAverage,
    voteCount: tv.voteCount,
    genres: tv.genres,
    seasons: tv.seasons,
    mediaInfo: tv.mediaInfo ? summarizeMediaInfo(tv.mediaInfo) : undefined,
  };
}

export interface MediaRequestSummary {
  id: number;
  status: number;
  media?: MediaInfoSummary;
  createdAt: string;
  updatedAt: string;
  requestedBy?: { id: number; username?: string; displayName?: string };
  is4k?: boolean;
  seasons?: Array<{ id: number; seasonNumber: number }>;
  rootFolder?: string;
}

export function summarizeMediaRequest(request: MediaRequest): MediaRequestSummary {
  return {
    id: request.id,
    status: request.status,
    media: request.media ? summarizeMediaInfo(request.media) : undefined,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    requestedBy: request.requestedBy
      ? {
          id: request.requestedBy.id,
          username: request.requestedBy.username,
          displayName: request.requestedBy.displayName,
        }
      : undefined,
    is4k: request.is4k,
    seasons: request.seasons,
    rootFolder: request.rootFolder,
  };
}

export interface UserSummary {
  id: number;
  email?: string;
  username?: string;
  displayName?: string;
  permissions?: number;
  requestCount?: number;
  createdAt?: string;
}

export function summarizeUser(user: OverseerrUser): UserSummary {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    permissions: user.permissions,
    requestCount: user.requestCount,
    createdAt: user.createdAt,
  };
}

export interface PersonDetailsSummary {
  id: number;
  name: string;
  biography?: string;
  knownForDepartment?: string;
  deathday?: string;
  placeOfBirth?: string;
  profilePath?: string;
  imdbId?: string;
}

export function summarizePersonDetails(person: PersonDetails): PersonDetailsSummary {
  return {
    id: person.id,
    name: person.name,
    biography: truncateOverview(person.biography),
    knownForDepartment: person.knownForDepartment,
    deathday: person.deathday,
    placeOfBirth: person.placeOfBirth,
    profilePath: person.profilePath,
    imdbId: person.imdbId,
  };
}

export interface CreditRoleSummary {
  id: number;
  mediaType?: string;
  title?: string;
  name?: string;
  character?: string;
  job?: string;
  department?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
}

export function summarizeCreditRole(credit: CreditRole): CreditRoleSummary {
  return {
    id: credit.id,
    mediaType: credit.mediaType,
    title: credit.title,
    name: credit.name,
    character: credit.character,
    job: credit.job,
    department: credit.department,
    releaseDate: credit.releaseDate,
    firstAirDate: credit.firstAirDate,
    voteAverage: credit.voteAverage,
  };
}
