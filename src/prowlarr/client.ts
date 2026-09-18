import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  Application,
  CommandResource,
  DownloadClient,
  HealthCheck,
  HistoryRecord,
  Indexer,
  IndexerCategory,
  IndexerStats,
  IndexerStatus,
  PagedResponse,
  Release,
  SystemStatus,
} from './types.js';

export interface SearchOptions {
  query: string;
  indexerIds?: number[];
  categories?: number[];
  type?: string;
  limit?: number;
  offset?: number;
}

export interface GrabPayload {
  guid: string;
  indexerId: number;
}

export interface HistoryOptions {
  page?: number;
  pageSize?: number;
  eventType?: number;
}

export interface ProwlarrClient {
  search(options: SearchOptions): Promise<Release[]>;
  grabRelease(payload: GrabPayload): Promise<unknown>;
  listIndexers(): Promise<Indexer[]>;
  getIndexer(id: number): Promise<Indexer>;
  testIndexer(indexer: Indexer): Promise<unknown>;
  getIndexerStats(): Promise<IndexerStats>;
  getIndexerStatus(): Promise<IndexerStatus[]>;
  listCategories(): Promise<IndexerCategory[]>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  listApplications(): Promise<Application[]>;
  listDownloadClients(): Promise<DownloadClient[]>;
  runCommand(payload: { name: string }): Promise<CommandResource>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
}

export function createProwlarrClient(config: InstanceConfig): ProwlarrClient {
  const http = createArrClient({
    product: 'Prowlarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v1',
  });

  return {
    search: (options) => http.get('/search', { ...options }),
    grabRelease: (payload) => http.post('/search', payload),
    listIndexers: () => http.get('/indexer'),
    getIndexer: (id) => http.get(`/indexer/${id}`),
    // Sends the record back verbatim: Prowlarr redacts secret field values on read and
    // restores them on write, which only works if fields[] round-trips untouched.
    testIndexer: (indexer) => http.post('/indexer/test', indexer),
    getIndexerStats: () => http.get('/indexerstats'),
    getIndexerStatus: () => http.get('/indexerstatus'),
    listCategories: () => http.get('/indexer/categories'),
    getHistory: (options) => http.get('/history', { ...options }),
    listApplications: () => http.get('/applications'),
    listDownloadClients: () => http.get('/downloadclient'),
    runCommand: (payload) => http.post('/command', payload),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
  };
}
