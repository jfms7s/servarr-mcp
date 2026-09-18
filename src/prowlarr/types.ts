export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Release {
  guid: string;
  title: string;
  indexer: string;
  indexerId: number;
  size: number;
  seeders?: number;
  leechers?: number;
  publishDate: string;
  protocol: string;
  downloadUrl?: string;
  infoUrl?: string;
  categories?: Array<{ id: number; name: string }>;
  grabs?: number;
}

export interface Indexer {
  id: number;
  name: string;
  protocol: string;
  enable: boolean;
  priority: number;
  privacy?: string;
  appProfileId?: number;
  tags?: number[];
  capabilities?: { categories?: Array<{ id: number; name: string }> };
  fields?: Array<{ name: string; value?: unknown }>;
}

export interface IndexerStats {
  indexers?: Array<{
    indexerId: number;
    indexerName: string;
    numberOfQueries: number;
    numberOfGrabs: number;
    numberOfFailedQueries: number;
    numberOfFailedGrabs: number;
    averageResponseTime: number;
  }>;
}

export interface IndexerStatus {
  id: number;
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  initialFailure?: string;
}

export interface IndexerCategory {
  id: number;
  name: string;
  subCategories?: Array<{ id: number; name: string }>;
}

export interface HistoryRecord {
  id: number;
  indexerId: number;
  eventType: string;
  date: string;
  successful?: boolean;
  data?: Record<string, string>;
}

export interface Application {
  id: number;
  name: string;
  syncLevel: string;
  implementation: string;
  tags?: number[];
}

export interface DownloadClient {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  implementation: string;
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  message?: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
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
