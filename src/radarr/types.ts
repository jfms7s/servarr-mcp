export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Language {
  id: number;
  name: string;
}

export interface UnmappedFolder {
  name?: string;
  path?: string;
  relativePath?: string;
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
  folderName?: string;
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
  genres?: string[];
  originalLanguage?: Language;
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
  unmappedFolders?: UnmappedFolder[];
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
  edition?: string;
  languages?: Array<{ id: number; name: string }>;
  quality?: { quality: { id: number; name: string } };
  customFormatScore?: number;
  approved: boolean;
  rejections?: string[];
}

export interface GrabReleasePayload {
  guid: string;
  indexerId: number;
}

export interface MovieEditorPayload {
  movieIds: number[];
  monitored?: boolean;
  qualityProfileId?: number;
  minimumAvailability?: string;
  rootFolderPath?: string;
  tags?: number[];
  applyTags?: 'add' | 'remove' | 'replace';
  moveFiles?: boolean;
}

export interface RenameMovieResource {
  id: number;
  movieId: number;
  movieFileId: number;
  existingPath?: string;
  newPath?: string;
}
