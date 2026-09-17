export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

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
  tvdbId: number;
  imdbId?: string;
  tags: number[];
  seasons: Season[];
  seasonFolder?: boolean;
  statistics?: { episodeFileCount: number; episodeCount: number; sizeOnDisk: number };
  added?: string;
  ended?: boolean;
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

export interface QualityProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export interface RootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
}

export interface Tag {
  id: number;
  label: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
  buildTime?: string;
  osName?: string;
  isDocker?: boolean;
  startTime?: string;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}
