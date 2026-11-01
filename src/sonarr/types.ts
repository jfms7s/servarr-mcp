export type {
  QualityProfile,
  RootFolder,
  UnmappedFolder,
  Tag,
  DiskSpace,
  PageParams,
  HealthCheck,
  PagedResponse,
} from '../arr/types.js';

export interface Season {
  seasonNumber: number;
  monitored: boolean;
  statistics?: { episodeFileCount: number; episodeCount: number; percentOfEpisodes: number };
}

export interface Series {
  id: number;
  title: string;
  sortTitle?: string;
  status: string;
  overview?: string;
  network?: string;
  year: number;
  seasonCount?: number;
  monitored: boolean;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  folder?: string;
  tvdbId: number;
  imdbId?: string;
  tags: number[];
  seasons: Season[];
  seasonFolder?: boolean;
  statistics?: { episodeFileCount: number; episodeCount: number; sizeOnDisk: number };
  added?: string;
  ended?: boolean;
  genres?: string[];
  seriesType?: string;
  originalLanguage?: { id: number; name: string };
}

export interface AddSeriesPayload {
  title: string;
  tvdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  seasonFolder?: boolean;
  languageProfileId?: number;
  tags?: number[];
  seriesType?: string;
  addOptions?: { monitor?: string; searchForMissingEpisodes?: boolean };
}

export interface Episode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  episodeFileId?: number;
  series?: Series;
  /** Present on GET /episode/{id} when the episode has a file. */
  episodeFile?: EpisodeFile;
}

export interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality?: { quality: { id: number; name: string } };
}

export interface QueueRecord {
  id: number;
  seriesId?: number;
  episodeId?: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  errorMessage?: string;
  downloadClient?: string;
  indexer?: string;
  statusMessages?: Array<{ title?: string; messages: string[] }>;
}

export interface HistoryRecord {
  id: number;
  episodeId: number;
  seriesId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export interface BlocklistRecord {
  id: number;
  seriesId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export interface CommandPayload {
  name: string;
  seriesId?: number;
  seriesIds?: number[];
  episodeIds?: number[];
  seasonNumber?: number;
  path?: string;
  importMode?: string;
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  queued?: string;
  started?: string;
  ended?: string;
  message?: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
  buildTime?: string;
  osName?: string;
  isDocker?: boolean;
  startTime?: string;
}

export interface Release {
  guid: string;
  title: string;
  indexerId: number;
  indexer: string;
  size: number;
  age: number;
  protocol: string;
  seeders?: number;
  leechers?: number;
  releaseGroup?: string;
  languages?: Array<{ id: number; name: string }>;
  quality?: { quality: { id: number; name: string } };
  customFormatScore?: number;
  approved: boolean;
  rejections?: string[];
  fullSeason?: boolean;
  seasonNumber?: number;
}

export interface GrabReleasePayload {
  guid: string;
  indexerId: number;
}

export interface RenameEpisodeResource {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumbers?: number[];
  episodeFileId?: number;
  existingPath?: string;
  newPath?: string;
}

export interface SeriesBulkEditPayload {
  seriesIds: number[];
  monitored?: boolean;
  qualityProfileId?: number;
  seriesType?: string;
  seasonFolder?: boolean;
  rootFolderPath?: string;
  tags?: number[];
  applyTags?: string;
  moveFiles?: boolean;
}
