import { describe, expect, it } from 'vitest';
import {
  summarizeApplication,
  summarizeDownloadClient,
  summarizeHistoryRecord,
  summarizeIndexer,
} from '../../src/prowlarr/shape.js';
import type {
  Application,
  DownloadClient,
  HistoryRecord,
  Indexer,
} from '../../src/prowlarr/types.js';

function indexerFixture(): Indexer {
  return {
    id: 7,
    name: 'TorrentLeech',
    protocol: 'torrent',
    enable: true,
    priority: 25,
    privacy: 'private',
    appProfileId: 1,
    tags: [3],
    capabilities: {
      categories: Array.from({ length: 58 }, (_, index) => ({
        id: 2000 + index,
        name: `Category ${index}`,
      })),
    },
    fields: [
      { name: 'baseUrl', value: 'https://example.invalid' },
      // Prowlarr redacts secrets server-side before serialising; this asserts
      // we never hand even the redacted placeholder to the model in a list.
      { name: 'apiKey', value: '********' },
      { name: 'passkey', value: '********' },
    ],
  } as unknown as Indexer;
}

describe('summarizeIndexer', () => {
  it('drops fields[] and replaces the category array with a count', () => {
    const result = summarizeIndexer(indexerFixture());

    expect(Object.keys(result).sort()).toEqual([
      'categoryCount',
      'enable',
      'id',
      'name',
      'priority',
      'privacy',
      'protocol',
    ]);
    expect(result.categoryCount).toBe(58);
    expect(JSON.stringify(result)).not.toContain('passkey');
    expect(JSON.stringify(result)).not.toContain('********');
  });

  it('leaves the caller-supplied record untouched so test_indexer can round-trip it', () => {
    // prowlarr_test_indexer reads an indexer with client.getIndexer and POSTs
    // the whole object back. If shaping ever mutated its input -- or were
    // moved down into the client -- fields[] would be stripped and every
    // test would fail against a provider that needs its credentials.
    const indexer = indexerFixture();
    summarizeIndexer(indexer);

    expect(indexer.fields).toHaveLength(3);
    expect(indexer.capabilities?.categories).toHaveLength(58);
  });

  it('reports zero categories when the indexer advertises none', () => {
    const indexer = { ...indexerFixture(), capabilities: undefined };
    expect(summarizeIndexer(indexer).categoryCount).toBe(0);
  });
});

describe('summarizeHistoryRecord', () => {
  it('keeps the event identity and its flat data map', () => {
    const record = {
      id: 9,
      indexerId: 7,
      eventType: 'indexerQuery',
      date: '2026-04-22T10:00:00Z',
      successful: true,
      data: { query: 'andor', elapsedTime: '412' },
      indexer: { id: 7, name: 'TorrentLeech', fields: [{ name: 'apiKey', value: '********' }] },
    } as unknown as HistoryRecord;

    const result = summarizeHistoryRecord(record);

    expect(Object.keys(result).sort()).toEqual([
      'data',
      'date',
      'eventType',
      'id',
      'indexerId',
      'successful',
    ]);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });
});

describe('summarizeApplication', () => {
  it('drops the nested fields[] carrying each *arr instance API key', () => {
    const application = {
      id: 2,
      name: 'Sonarr',
      syncLevel: 'fullSync',
      implementation: 'Sonarr',
      tags: [1],
      fields: [{ name: 'apiKey', value: '********' }],
      configContract: 'SonarrSettings',
    } as unknown as Application;

    const result = summarizeApplication(application);

    expect(Object.keys(result).sort()).toEqual([
      'id',
      'implementation',
      'name',
      'syncLevel',
      'tags',
    ]);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });
});

describe('summarizeDownloadClient', () => {
  it('drops the nested fields[] carrying the client password', () => {
    const client = {
      id: 1,
      name: 'Transmission',
      enable: true,
      protocol: 'torrent',
      priority: 1,
      implementation: 'Transmission',
      fields: [
        { name: 'username', value: 'admin' },
        { name: 'password', value: '********' },
      ],
    } as unknown as DownloadClient;

    const result = summarizeDownloadClient(client);

    expect(Object.keys(result).sort()).toEqual([
      'enable',
      'id',
      'implementation',
      'name',
      'priority',
      'protocol',
    ]);
    expect(JSON.stringify(result)).not.toContain('password');
  });
});
