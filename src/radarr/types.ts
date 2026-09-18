export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Movie {
  id: number;
  title: string;
  originalTitle?: string;
  sortTitle?: string;
  status: string;
  overview?: string;
  year: number;
  runtime?: number;
  monitored: boolean;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  tmdbId: number;
  imdbId?: string;
  tags: number[];
  hasFile: boolean;
  isAvailable?: boolean;
  minimumAvailability?: string;
  sizeOnDisk?: number;
  added?: string;
  collection?: { title?: string; tmdbId?: number };
  ratings?: Record<string, { value?: number; votes?: number }>;
}

export interface AddMoviePayload {
  title: string;
  tmdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  minimumAvailability?: string;
  tags?: number[];
  addOptions?: { searchForMovie?: boolean };
}

export interface MovieFile {
  id: number;
  movieId: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality?: { quality: { id: number; name: string } };
}

export interface QueueRecord {
  id: number;
  movieId?: number;
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
  movieId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export interface BlocklistRecord {
  id: number;
  movieId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export interface Collection {
  id: number;
  title: string;
  tmdbId: number;
  monitored: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  movies?: Array<{ tmdbId: number; title: string; monitored?: boolean }>;
}

export interface CommandPayload {
  name: string;
  movieId?: number;
  movieIds?: number[];
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
