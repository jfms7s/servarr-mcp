import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  AddMoviePayload,
  BlocklistRecord,
  Collection,
  CommandPayload,
  CommandResource,
  DiskSpace,
  HealthCheck,
  HistoryRecord,
  Movie,
  MovieFile,
  PageParams,
  PagedResponse,
  QualityProfile,
  QueueRecord,
  RootFolder,
  SystemStatus,
  Tag,
} from './types.js';

export interface DeleteMovieOptions {
  deleteFiles?: boolean;
  addImportExclusion?: boolean;
}

export interface CalendarOptions {
  start?: string;
  end?: string;
  unmonitored?: boolean;
}

export interface QueueOptions extends PageParams {
  includeMovie?: boolean;
}

export interface DeleteQueueItemOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
}

export interface HistoryOptions extends PageParams {
  eventType?: number;
}

export interface RadarrClient {
  listMovies(): Promise<Movie[]>;
  getMovie(id: number): Promise<Movie>;
  lookupMovie(term: string): Promise<Movie[]>;
  lookupMovieByTmdbId(tmdbId: number): Promise<Movie>;
  addMovie(payload: AddMoviePayload): Promise<Movie>;
  updateMovie(id: number, payload: Movie): Promise<Movie>;
  deleteMovie(id: number, options?: DeleteMovieOptions): Promise<void>;
  listMovieFiles(movieId: number): Promise<MovieFile[]>;
  deleteMovieFile(id: number): Promise<void>;
  getCalendar(options?: CalendarOptions): Promise<Movie[]>;
  getQueue(options?: QueueOptions): Promise<PagedResponse<QueueRecord>>;
  deleteQueueItem(id: number, options?: DeleteQueueItemOptions): Promise<void>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  getWantedMissing(options?: PageParams): Promise<PagedResponse<Movie>>;
  getBlocklist(options?: PageParams): Promise<PagedResponse<BlocklistRecord>>;
  deleteBlocklistItem(id: number): Promise<void>;
  listCollections(): Promise<Collection[]>;
  runCommand(payload: CommandPayload): Promise<CommandResource>;
  getCommand(id: number): Promise<CommandResource>;
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
  getDiskSpace(): Promise<DiskSpace[]>;
}

export function createRadarrClient(config: InstanceConfig): RadarrClient {
  const http = createArrClient({
    product: 'Radarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v3',
  });

  return {
    listMovies: () => http.get('/movie'),
    getMovie: (id) => http.get(`/movie/${id}`),
    lookupMovie: (term) => http.get('/movie/lookup', { term }),
    lookupMovieByTmdbId: (tmdbId) => http.get('/movie/lookup/tmdb', { tmdbId }),
    addMovie: (payload) => http.post('/movie', payload),
    updateMovie: (id, payload) => http.put(`/movie/${id}`, payload),
    deleteMovie: (id, options) => http.del(`/movie/${id}`, { ...options }),
    listMovieFiles: (movieId) => http.get('/moviefile', { movieId }),
    deleteMovieFile: (id) => http.del(`/moviefile/${id}`),
    getCalendar: (options) => http.get('/calendar', { ...options }),
    getQueue: (options) => http.get('/queue', { ...options }),
    deleteQueueItem: (id, options) => http.del(`/queue/${id}`, { ...options }),
    getHistory: (options) => http.get('/history', { ...options }),
    getWantedMissing: (options) => http.get('/wanted/missing', { ...options }),
    getBlocklist: (options) => http.get('/blocklist', { ...options }),
    deleteBlocklistItem: (id) => http.del(`/blocklist/${id}`),
    listCollections: () => http.get('/collection'),
    runCommand: (payload) => http.post('/command', payload),
    getCommand: (id) => http.get(`/command/${id}`),
    listQualityProfiles: () => http.get('/qualityprofile'),
    listRootFolders: () => http.get('/rootfolder'),
    listTags: () => http.get('/tag'),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
    getDiskSpace: () => http.get('/diskspace'),
  };
}
