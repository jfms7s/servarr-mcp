import type {
  BlocklistRecord,
  Episode,
  EpisodeFile,
  HistoryRecord,
  QualityProfile,
  QueueRecord,
  Release,
  Series,
} from './types.js';

const MAX_OVERVIEW = 300;

function toGb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

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

// The four summaries below exist because a TypeScript interface does not
// filter anything at runtime. The list tools used to return whatever
// JSON.parse produced, which for these four record types is several times
// what the declared interface admits to -- quality profiles carry every
// known quality with its allowed flag, episode files carry a full mediaInfo
// block, and history/blocklist records carry the whole embedded series.
// Asserting the exact key set is how the tests pin that down.

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

export interface EpisodeFileSummary {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  sizeGb: number;
  dateAdded: string;
  quality?: string;
}

export function summarizeEpisodeFile(file: EpisodeFile): EpisodeFileSummary {
  return {
    id: file.id,
    seriesId: file.seriesId,
    seasonNumber: file.seasonNumber,
    // relativePath alone -- the absolute path adds the series folder prefix
    // to every row and tells the caller nothing it can act on.
    relativePath: file.relativePath,
    sizeGb: toGb(file.size),
    dateAdded: file.dateAdded,
    quality: file.quality?.quality.name,
  };
}

export interface HistorySummary {
  id: number;
  episodeId: number;
  seriesId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export function summarizeHistoryRecord(record: HistoryRecord): HistorySummary {
  return {
    id: record.id,
    episodeId: record.episodeId,
    seriesId: record.seriesId,
    sourceTitle: record.sourceTitle,
    eventType: record.eventType,
    date: record.date,
    // Kept: a flat string map holding the event's own detail (why an import
    // was rejected, where a file landed). It is the substance of a history
    // row, and it is bounded -- unlike the series/episode objects dropped here.
    data: record.data,
  };
}

export interface BlocklistSummary {
  id: number;
  seriesId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export function summarizeBlocklistRecord(record: BlocklistRecord): BlocklistSummary {
  return {
    id: record.id,
    seriesId: record.seriesId,
    sourceTitle: record.sourceTitle,
    date: record.date,
    protocol: record.protocol,
    indexer: record.indexer,
  };
}

// A raw search returned 13 releases as ~64 KB (~5 KB each), and rejections are kept
// verbatim because they are the exact reasons Sonarr declines a release.
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
  languages: string[];
  customFormatScore?: number;
  fullSeason?: boolean;
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
    sizeGb: toGb(release.size),
    ageDays: release.age,
    indexer: release.indexer,
    protocol: release.protocol,
    seeders: release.seeders,
    leechers: release.leechers,
    releaseGroup: release.releaseGroup,
    languages: release.languages?.map((lang) => lang.name) ?? [],
    customFormatScore: release.customFormatScore,
    fullSeason: release.fullSeason,
    approved: release.approved,
    rejections: release.rejections ?? [],
  };
}
