import type { Release } from './types.js';

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
