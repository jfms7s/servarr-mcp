import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  AddSeriesPayload,
  BlocklistRecord,
  CommandPayload,
  CommandResource,
  DiskSpace,
  Episode,
  EpisodeFile,
  GrabReleasePayload,
  HealthCheck,
  HistoryRecord,
  PageParams,
  PagedResponse,
  QualityProfile,
  QueueRecord,
  Release,
  RenameEpisodeResource,
  RootFolder,
  Series,
  SeriesBulkEditPayload,
  SystemStatus,
  Tag,
} from './types.js';

export interface DeleteSeriesOptions {
  deleteFiles?: boolean;
  addImportListExclusion?: boolean;
}

export interface UpdateSeriesOptions {
  moveFiles?: boolean;
}

export interface CalendarOptions {
  start?: string;
  end?: string;
  includeSeries?: boolean;
}

export interface QueueOptions extends PageParams {
  includeSeries?: boolean;
  includeEpisode?: boolean;
}

export interface DeleteQueueItemOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
}

export interface HistoryOptions extends PageParams {
  eventType?: number;
}

export interface WantedOptions extends PageParams {
  includeSeries?: boolean;
}

export interface SonarrClient {
  listSeries(): Promise<Series[]>;
  getSeries(id: number): Promise<Series>;
  lookupSeries(term: string): Promise<Series[]>;
  addSeries(payload: AddSeriesPayload): Promise<Series>;
  updateSeries(id: number, payload: Series, options?: UpdateSeriesOptions): Promise<Series>;
  bulkEditSeries(payload: SeriesBulkEditPayload): Promise<Series[]>;
  deleteSeries(id: number, options?: DeleteSeriesOptions): Promise<void>;
  listEpisodes(seriesId: number, seasonNumber?: number): Promise<Episode[]>;
  getEpisode(id: number): Promise<Episode>;
  monitorEpisodes(episodeIds: number[], monitored: boolean): Promise<Episode[]>;
  listEpisodeFiles(seriesId: number): Promise<EpisodeFile[]>;
  deleteEpisodeFile(id: number): Promise<void>;
  getCalendar(options?: CalendarOptions): Promise<Episode[]>;
  getQueue(options?: QueueOptions): Promise<PagedResponse<QueueRecord>>;
  deleteQueueItem(id: number, options?: DeleteQueueItemOptions): Promise<void>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  getWantedMissing(options?: WantedOptions): Promise<PagedResponse<Episode>>;
  getBlocklist(options?: PageParams): Promise<PagedResponse<BlocklistRecord>>;
  deleteBlocklistItem(id: number): Promise<void>;
  getRenamePreview(seriesId: number, seasonNumber?: number): Promise<RenameEpisodeResource[]>;
  runCommand(payload: CommandPayload): Promise<CommandResource>;
  getCommand(id: number): Promise<CommandResource>;
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
  getDiskSpace(): Promise<DiskSpace[]>;
  searchReleases(params: { episodeId?: number; seriesId?: number; seasonNumber?: number }): Promise<Release[]>;
  grabRelease(payload: GrabReleasePayload): Promise<Release>;
}

export function createSonarrClient(config: InstanceConfig): SonarrClient {
  const http = createArrClient({
    product: 'Sonarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v3',
  });

  return {
    listSeries: () => http.get('/series'),
    getSeries: (id) => http.get(`/series/${id}`),
    lookupSeries: (term) => http.get('/series/lookup', { term }),
    addSeries: (payload) => http.post('/series', payload),
    updateSeries: (id, payload, options) =>
      http.put(`/series/${id}`, payload, { moveFiles: options?.moveFiles }),
    bulkEditSeries: (payload) => http.put('/series/editor', payload),
    deleteSeries: (id, options) => http.del(`/series/${id}`, { ...options }),
    listEpisodes: (seriesId, seasonNumber) => http.get('/episode', { seriesId, seasonNumber }),
    getEpisode: (id) => http.get(`/episode/${id}`),
    monitorEpisodes: (episodeIds, monitored) =>
      http.put('/episode/monitor', { episodeIds, monitored }),
    listEpisodeFiles: (seriesId) => http.get('/episodefile', { seriesId }),
    deleteEpisodeFile: (id) => http.del(`/episodefile/${id}`),
    getCalendar: (options) => http.get('/calendar', { ...options }),
    getQueue: (options) => http.get('/queue', { ...options }),
    deleteQueueItem: (id, options) => http.del(`/queue/${id}`, { ...options }),
    getHistory: (options) => http.get('/history', { ...options }),
    getWantedMissing: (options) => http.get('/wanted/missing', { ...options }),
    getBlocklist: (options) => http.get('/blocklist', { ...options }),
    deleteBlocklistItem: (id) => http.del(`/blocklist/${id}`),
    getRenamePreview: (seriesId, seasonNumber) =>
      http.get('/rename', { seriesId, seasonNumber }),
    runCommand: (payload) => http.post('/command', payload),
    getCommand: (id) => http.get(`/command/${id}`),
    listQualityProfiles: () => http.get('/qualityprofile'),
    listRootFolders: () => http.get('/rootfolder'),
    listTags: () => http.get('/tag'),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
    getDiskSpace: () => http.get('/diskspace'),
    searchReleases: (params) => http.get('/release', { ...params }),
    grabRelease: (payload) => http.post('/release', payload),
  };
}
