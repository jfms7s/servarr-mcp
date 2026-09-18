import type { Movie, QueueRecord } from './types.js';

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
