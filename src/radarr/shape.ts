import type {
  BlocklistRecord,
  Collection,
  HistoryRecord,
  Movie,
  MovieFile,
  QualityProfile,
  QueueRecord,
  Release,
  RenameMovieResource,
} from './types.js';
import { redactHistoryData } from '../arr/redact.js';
import { summarizeMediaFileRef, type MediaFileRef } from '../arr/shape.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
}

// Lists pass { overview: false }: a plot summary is the bulk of a list row
// (about 300 of 700 characters) and rarely what a list query is after.
// Lookups, add and update keep it -- they are few rows, and the overview
// helps pick the right title.
export interface SummaryOptions {
  overview?: boolean;
}

export interface MovieSummary {
  id: number;
  title: string;
  year: number;
  status: string;
  monitored: boolean;
  hasFile: boolean;
  qualityProfileId: number;
  tmdbId: number;
  imdbId?: string;
  path?: string;
  runtime?: number;
  sizeOnDisk?: number;
  tags: number[];
  overview?: string;
  genres?: string[];
  originalLanguage?: string;
}

export function summarizeMovie(movie: Movie, options: SummaryOptions = {}): MovieSummary {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    status: movie.status,
    monitored: movie.monitored,
    hasFile: movie.hasFile,
    qualityProfileId: movie.qualityProfileId,
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    path: movie.path,
    runtime: movie.runtime,
    sizeOnDisk: movie.sizeOnDisk,
    tags: movie.tags ?? [],
    ...(options.overview !== false && { overview: truncateOverview(movie.overview) }),
    genres: movie.genres,
    originalLanguage: movie.originalLanguage?.name,
  };
}

// radarr_get_movie returns this by default (full: true gives the raw record): the list
// summary plus what a caller needs to act on one movie, without images,
// alternateTitles, ratings or the file's mediaInfo.
export interface MovieDetail extends MovieSummary {
  rootFolderPath?: string;
  added?: string;
  minimumAvailability?: string;
  movieFile?: MediaFileRef;
}

export function summarizeMovieDetail(movie: Movie): MovieDetail {
  return {
    ...summarizeMovie(movie),
    rootFolderPath: movie.rootFolderPath,
    added: movie.added,
    minimumAvailability: movie.minimumAvailability,
    movieFile: movie.movieFile ? summarizeMediaFileRef(movie.movieFile) : undefined,
  };
}

export interface QueueSummary {
  id: number;
  movieId?: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  percentComplete: number;
  timeleft?: string;
  indexer?: string;
  downloadClient?: string;
  errorMessage?: string;
  statusMessages?: string[];
}

export function summarizeQueueRecord(record: QueueRecord): QueueSummary {
  const percentComplete =
    record.size > 0 ? Math.round(((record.size - record.sizeleft) / record.size) * 100) : 0;
  const statusMessages = record.statusMessages?.flatMap((entry) => entry.messages);

  return {
    id: record.id,
    movieId: record.movieId,
    title: record.title,
    status: record.status,
    trackedDownloadState: record.trackedDownloadState,
    percentComplete,
    timeleft: record.timeleft,
    indexer: record.indexer,
    downloadClient: record.downloadClient,
    errorMessage: record.errorMessage,
    statusMessages: statusMessages?.length ? statusMessages : undefined,
  };
}

// See the note on sonarr/shape.ts's list summaries: a TypeScript interface
// filters nothing at runtime, so these tools returned the full upstream
// record until now. Collections are the Radarr-only case -- the movies[]
// array is kept but reduced to identity, since an upstream collection
// carries a full Movie object per entry.

export interface QualityProfileSummary {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export function summarizeQualityProfile(profile: QualityProfile): QualityProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    upgradeAllowed: profile.upgradeAllowed,
    cutoff: profile.cutoff,
  };
}

export interface MovieFileSummary {
  id: number;
  movieId: number;
  relativePath: string;
  sizeGb: number;
  dateAdded: string;
  quality?: string;
}

export function summarizeMovieFile(file: MovieFile): MovieFileSummary {
  return {
    id: file.id,
    movieId: file.movieId,
    relativePath: file.relativePath,
    sizeGb: Math.round((file.size / 1024 ** 3) * 100) / 100,
    dateAdded: file.dateAdded,
    quality: file.quality?.quality.name,
  };
}

export interface HistorySummary {
  id: number;
  movieId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export function summarizeHistoryRecord(record: HistoryRecord): HistorySummary {
  return {
    id: record.id,
    movieId: record.movieId,
    sourceTitle: record.sourceTitle,
    eventType: record.eventType,
    date: record.date,
    data: redactHistoryData(record.data),
  };
}

export interface BlocklistSummary {
  id: number;
  movieId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export function summarizeBlocklistRecord(record: BlocklistRecord): BlocklistSummary {
  return {
    id: record.id,
    movieId: record.movieId,
    sourceTitle: record.sourceTitle,
    date: record.date,
    protocol: record.protocol,
    indexer: record.indexer,
  };
}

export interface CollectionSummary {
  id: number;
  title: string;
  tmdbId: number;
  monitored: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  movieCount: number;
  movies?: Array<{ tmdbId: number; title: string; monitored?: boolean }>;
}

export function summarizeCollection(collection: Collection): CollectionSummary {
  return {
    id: collection.id,
    title: collection.title,
    tmdbId: collection.tmdbId,
    monitored: collection.monitored,
    qualityProfileId: collection.qualityProfileId,
    rootFolderPath: collection.rootFolderPath,
    movieCount: collection.movies?.length ?? 0,
    movies: collection.movies?.map((movie) => ({
      tmdbId: movie.tmdbId,
      title: movie.title,
      monitored: movie.monitored,
    })),
  };
}

// Raw release payloads are ~5 KB each, and rejections are kept verbatim
// because they are the exact reasons Radarr declines a release.
export interface ReleaseSummary {
  rank: number;
  guid: string;
  indexerId: number;
  title: string;
  quality?: string;
  sizeGb: number;
  ageDays: number;
  indexer: string;
  protocol: string;
  seeders?: number;
  leechers?: number;
  releaseGroup?: string;
  edition?: string;
  languages: string[];
  customFormatScore?: number;
  approved: boolean;
  rejections: string[];
}

export function summarizeRelease(release: Release, rank: number): ReleaseSummary {
  return {
    rank,
    guid: release.guid,
    indexerId: release.indexerId,
    title: release.title,
    quality: release.quality?.quality.name,
    sizeGb: Math.round((release.size / 1024 ** 3) * 100) / 100,
    ageDays: release.age,
    indexer: release.indexer,
    protocol: release.protocol,
    seeders: release.seeders,
    leechers: release.leechers,
    releaseGroup: release.releaseGroup,
    edition: release.edition,
    languages: release.languages?.map((lang) => lang.name) ?? [],
    customFormatScore: release.customFormatScore,
    approved: release.approved,
    rejections: release.rejections ?? [],
  };
}

export interface RenamePreviewSummary {
  id: number;
  movieId: number;
  movieFileId: number;
  existingPath?: string;
  newPath?: string;
}

export function summarizeRenamePreview(resource: RenameMovieResource): RenamePreviewSummary {
  return {
    id: resource.id,
    movieId: resource.movieId,
    movieFileId: resource.movieFileId,
    existingPath: resource.existingPath,
    newPath: resource.newPath,
  };
}

export { summarizeUnmappedFolder, type UnmappedFolderSummary } from '../arr/shape.js';
