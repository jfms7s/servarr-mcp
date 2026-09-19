import type {
  BlocklistRecord,
  Collection,
  HistoryRecord,
  Movie,
  MovieFile,
  QualityProfile,
  QueueRecord,
  Release,
} from './types.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
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
}

export function summarizeMovie(movie: Movie): MovieSummary {
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
    overview: truncateOverview(movie.overview),
  };
}

export interface QueueSummary {
  id: number;
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
    data: record.data,
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
