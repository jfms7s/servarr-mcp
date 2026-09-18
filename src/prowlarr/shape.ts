import type {
  Application,
  DownloadClient,
  HistoryRecord,
  Indexer,
  Release,
} from './types.js';

export interface ReleaseSummary {
  guid: string;
  title: string;
  indexer: string;
  indexerId: number;
  sizeGb: number;
  seeders?: number;
  leechers?: number;
  publishDate: string;
  protocol: string;
  categories?: string[];
}

export function summarizeRelease(release: Release): ReleaseSummary {
  return {
    guid: release.guid,
    title: release.title,
    indexer: release.indexer,
    indexerId: release.indexerId,
    sizeGb: Math.round((release.size / 1024 ** 3) * 100) / 100,
    seeders: release.seeders,
    leechers: release.leechers,
    publishDate: release.publishDate,
    protocol: release.protocol,
    categories: release.categories?.map((category) => category.name),
  };
}

// prowlarr_list_indexers was the worst offender of the unshaped list tools:
// its own description promised "protocol, priority and enabled state" while
// it actually returned every indexer's fields[] and capabilities.categories[]
// -- often 50+ categories each. categoryCount replaces the array, since the
// count is the only part of it a caller acts on when choosing an indexer.
//
// This shapes the LIST only. prowlarr_get_indexer still returns the full
// record: the spec's rule is that get-by-id returns everything, and
// prowlarr_test_indexer round-trips a whole indexer object back to Prowlarr,
// so its fields[] must survive untouched. That round-trip goes through
// client.getIndexer directly and is unaffected by anything here, but shaping
// the client rather than the tool WOULD break it.

export interface IndexerSummary {
  id: number;
  name: string;
  protocol: string;
  enable: boolean;
  priority: number;
  privacy?: string;
  categoryCount: number;
}

export function summarizeIndexer(indexer: Indexer): IndexerSummary {
  return {
    id: indexer.id,
    name: indexer.name,
    protocol: indexer.protocol,
    enable: indexer.enable,
    priority: indexer.priority,
    privacy: indexer.privacy,
    categoryCount: indexer.capabilities?.categories?.length ?? 0,
  };
}

export interface HistorySummary {
  id: number;
  indexerId: number;
  eventType: string;
  date: string;
  successful?: boolean;
  data?: Record<string, string>;
}

export function summarizeHistoryRecord(record: HistoryRecord): HistorySummary {
  return {
    id: record.id,
    indexerId: record.indexerId,
    eventType: record.eventType,
    date: record.date,
    successful: record.successful,
    data: record.data,
  };
}

export interface ApplicationSummary {
  id: number;
  name: string;
  syncLevel: string;
  implementation: string;
  tags?: number[];
}

export function summarizeApplication(application: Application): ApplicationSummary {
  return {
    id: application.id,
    name: application.name,
    syncLevel: application.syncLevel,
    implementation: application.implementation,
    tags: application.tags,
  };
}

export interface DownloadClientSummary {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  implementation: string;
}

export function summarizeDownloadClient(client: DownloadClient): DownloadClientSummary {
  return {
    id: client.id,
    name: client.name,
    enable: client.enable,
    protocol: client.protocol,
    priority: client.priority,
    implementation: client.implementation,
  };
}
