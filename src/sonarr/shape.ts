import type { Episode, QueueRecord, Series } from './types.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
}

export interface SeriesSummary {
  id: number;
  title: string;
  year: number;
  status: string;
  network?: string;
  monitored: boolean;
  qualityProfileId: number;
  tvdbId: number;
  path?: string;
  tags: number[];
  seasonCount: number;
  episodeFileCount?: number;
  episodeCount?: number;
  sizeOnDisk?: number;
  overview?: string;
}

export function summarizeSeries(series: Series): SeriesSummary {
  return {
    id: series.id,
    title: series.title,
    year: series.year,
    status: series.status,
    network: series.network,
    monitored: series.monitored,
    qualityProfileId: series.qualityProfileId,
    tvdbId: series.tvdbId,
    path: series.path,
    tags: series.tags ?? [],
    seasonCount: series.seasons?.length ?? 0,
    episodeFileCount: series.statistics?.episodeFileCount,
    episodeCount: series.statistics?.episodeCount,
    sizeOnDisk: series.statistics?.sizeOnDisk,
    overview: truncateOverview(series.overview),
  };
}

export interface EpisodeSummary {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  hasFile: boolean;
  monitored: boolean;
  seriesTitle?: string;
  overview?: string;
}

export function summarizeEpisode(episode: Episode): EpisodeSummary {
  return {
    id: episode.id,
    seriesId: episode.seriesId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    airDateUtc: episode.airDateUtc,
    hasFile: episode.hasFile,
    monitored: episode.monitored,
    seriesTitle: episode.series?.title,
    overview: truncateOverview(episode.overview),
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
