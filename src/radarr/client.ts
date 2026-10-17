import type { InstanceConfig } from '../config.js';
import { LIBRARY_TTL_MS, cached, invalidating } from '../http/cache.js';
import { EDITOR_TIMEOUT_MS, SEARCH_TIMEOUT_MS, createArrClient } from '../http/client.js';
import type {
  AddMoviePayload,
  BlocklistRecord,
  Collection,
  CommandPayload,
  CommandResource,
  DiskSpace,
  GrabReleasePayload,
  HealthCheck,
  HistoryRecord,
  Movie,
  MovieEditorPayload,
  MovieFile,
  PageParams,
  PagedResponse,
  QualityProfile,
  QueueRecord,
  Release,
  RenameMovieResource,
  RootFolder,
  SystemStatus,
  Tag,
} from './types.js';

export interface DeleteMovieOptions {
  deleteFiles?: boolean;
  addImportExclusion?: boolean;
}

export interface UpdateMovieOptions {
  moveFiles?: boolean;
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

export interface ListMoviesOptions {
  /** Skip the cached library and download it again. */
  refresh?: boolean;
}

/** Commands that change what GET /movie returns once they run. */
const LIBRARY_COMMANDS = new Set(
  ['RefreshMovie', 'RescanMovie', 'RenameFiles', 'RenameMovie', 'DownloadedMoviesScan'].map((n) =>
    n.toLowerCase(),
  ),
);
const changesLibrary = (name: string | undefined) =>
  name !== undefined && LIBRARY_COMMANDS.has(name.toLowerCase());

export interface RadarrClient {
  /**
   * The whole library, cached for LIBRARY_TTL_MS. Every write through this client
   * invalidates it; changes made elsewhere show up once the TTL passes or with refresh.
   */
  listMovies(options?: ListMoviesOptions): Promise<Movie[]>;
  getMovie(id: number): Promise<Movie>;
  lookupMovie(term: string): Promise<Movie[]>;
  lookupMovieByTmdbId(tmdbId: number): Promise<Movie>;
  addMovie(payload: AddMoviePayload): Promise<Movie>;
  updateMovie(id: number, payload: Movie, options?: UpdateMovieOptions): Promise<Movie>;
  bulkEditMovies(payload: MovieEditorPayload): Promise<Movie[]>;
  deleteMovie(id: number, options?: DeleteMovieOptions): Promise<void>;
  listMovieFiles(movieId: number): Promise<MovieFile[]>;
  deleteMovieFile(id: number): Promise<void>;
  renamePreview(movieIds: number[]): Promise<RenameMovieResource[]>;
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
  searchReleases(movieId: number): Promise<Release[]>;
  grabRelease(payload: GrabReleasePayload): Promise<Release>;
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
  const library = cached(() => http.get<Movie[]>('/movie'), LIBRARY_TTL_MS);
  const write = <T>(run: () => Promise<T>) => invalidating(library, run);

  return {
    listMovies: (options) => {
      if (options?.refresh) library.invalidate();
      return library.get();
    },
    getMovie: (id) => http.get(`/movie/${id}`),
    lookupMovie: (term) => http.get('/movie/lookup', { term }),
    lookupMovieByTmdbId: (tmdbId) => http.get('/movie/lookup/tmdb', { tmdbId }),
    addMovie: (payload) => write(() => http.post('/movie', payload)),
    updateMovie: (id, payload, options) =>
      write(() => http.put(`/movie/${id}`, payload, { moveFiles: options?.moveFiles })),
    bulkEditMovies: (payload) =>
      write(() => http.put('/movie/editor', payload, undefined, { timeoutMs: EDITOR_TIMEOUT_MS })),
    deleteMovie: (id, options) => write(() => http.del(`/movie/${id}`, { ...options })),
    listMovieFiles: (movieId) => http.get('/moviefile', { movieId }),
    deleteMovieFile: (id) => write(() => http.del(`/moviefile/${id}`)),
    renamePreview: (movieIds) => http.get('/rename', { movieId: movieIds }),
    getCalendar: (options) => http.get('/calendar', { ...options }),
    getQueue: (options) => http.get('/queue', { ...options }),
    deleteQueueItem: (id, options) => http.del(`/queue/${id}`, { ...options }),
    getHistory: (options) => http.get('/history', { ...options }),
    getWantedMissing: (options) => http.get('/wanted/missing', { ...options }),
    getBlocklist: (options) => http.get('/blocklist', { ...options }),
    deleteBlocklistItem: (id) => http.del(`/blocklist/${id}`),
    listCollections: () => http.get('/collection'),
    runCommand: (payload) => {
      const run = () => http.post<CommandResource>('/command', payload);
      return changesLibrary(payload.name) ? write(run) : run();
    },
    getCommand: async (id) => {
      const command = await http.get<CommandResource>(`/command/${id}`);
      // Commands run in the background, so the library changes when they finish, not
      // when they are queued.
      if (command.status === 'completed' && changesLibrary(command.name)) library.invalidate();
      return command;
    },
    searchReleases: (movieId) =>
      http.get('/release', { movieId }, { timeoutMs: SEARCH_TIMEOUT_MS }),
    grabRelease: (payload) => http.post('/release', payload),
    listQualityProfiles: () => http.get('/qualityprofile'),
    listRootFolders: () => http.get('/rootfolder'),
    listTags: () => http.get('/tag'),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
    getDiskSpace: () => http.get('/diskspace'),
  };
}
