import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ProwlarrClient } from '../../src/prowlarr/client.js';
import { createProwlarrTools } from '../../src/prowlarr/tools.js';

function toolsFor(overrides: Partial<ProwlarrClient>) {
  const tools = createProwlarrTools(overrides as ProwlarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createProwlarrTools', () => {
  it('registers all 11 tools with unique prowlarr_ prefixed names', () => {
    const names = createProwlarrTools({} as ProwlarrClient).map((t) => t.name);
    expect(names).toHaveLength(11);
    expect(names.every((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(new Set(names).size).toBe(11);
  });

  it('summarises search results with size in gigabytes', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        guid: 'g1',
        title: 'Dune.2021.2160p',
        indexer: 'nzbgeek',
        indexerId: 1,
        size: 1024 ** 3 * 5,
        seeders: 20,
        publishDate: '2026-01-01T00:00:00Z',
        protocol: 'usenet',
        categories: [{ id: 2000, name: 'Movies' }],
      },
    ]);
    const get = toolsFor({ search });
    const result = (await get('prowlarr_search').handler({ query: 'dune' })) as Array<{
      sizeGb: number;
      categories?: string[];
    }>;
    expect(result[0]?.sizeGb).toBe(5);
    expect(result[0]?.categories).toEqual(['Movies']);
  });

  it('grabs a release by guid and indexer id', async () => {
    const grabRelease = vi.fn().mockResolvedValue({});
    const get = toolsFor({ grabRelease });
    await get('prowlarr_grab_release').handler({ guid: 'g1', indexerId: 1 });
    expect(grabRelease).toHaveBeenCalledWith({ guid: 'g1', indexerId: 1 });
  });

  it('requires a non-empty search query', () => {
    const tool = createProwlarrTools({} as ProwlarrClient).find(
      (t) => t.name === 'prowlarr_search',
    );
    if (!tool) throw new Error('prowlarr_search is not registered');
    const schema = z.object(tool.inputSchema).pick({ query: true });
    expect(() => schema.parse({ query: '' })).toThrow();
    // Without the positive case, a schema rejecting every query would pass.
    expect(() => schema.parse({ query: 'andor' })).not.toThrow();
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ listIndexers: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('prowlarr_list_indexers').handler({})).rejects.toThrow('down');
  });

  it('test_indexer fetches and posts the record verbatim', async () => {
    const indexerRecord = {
      id: 3,
      name: 'nzbgeek',
      protocol: 'usenet',
      enable: true,
      priority: 25,
      fields: [
        { name: 'username', value: '********' },
        { name: 'apikey', value: '********' },
      ],
    };
    const getIndexer = vi.fn().mockResolvedValue(indexerRecord);
    const testIndexer = vi.fn().mockResolvedValue({ success: true });
    const get = toolsFor({ getIndexer, testIndexer });
    await get('prowlarr_test_indexer').handler({ indexerId: 3 });
    expect(getIndexer).toHaveBeenCalledWith(3);
    expect(testIndexer).toHaveBeenCalledWith(indexerRecord);
  });

  it('shapes get_indexer, dropping field UI metadata', async () => {
    const get = toolsFor({
      getIndexer: vi.fn().mockResolvedValue({
        id: 3,
        name: 'Nyaa',
        protocol: 'torrent',
        enable: true,
        priority: 25,
        privacy: 'public',
        appProfileId: 1,
        tags: [2],
        capabilities: {
          categories: [
            { id: 1, name: 'Anime' },
            { id: 2, name: 'TV' },
          ],
        },
        fields: [
          {
            name: 'baseUrl',
            label: 'Base Url',
            helpText: 'Pick one',
            value: 'https://nyaa.si',
            selectOptions: [{ value: 1 }],
          },
        ],
      }),
    });
    const result = await get('prowlarr_get_indexer').handler({ indexerId: 3 });
    expect(result).toEqual({
      id: 3,
      name: 'Nyaa',
      protocol: 'torrent',
      enable: true,
      priority: 25,
      privacy: 'public',
      appProfileId: 1,
      tags: [2],
      categoryCount: 2,
      fields: [{ name: 'baseUrl', value: 'https://nyaa.si' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/label|helpText|selectOptions/);
  });

  it('returns shaped system, health and per-indexer status from one call', async () => {
    const getSystemStatus = vi.fn().mockResolvedValue({
      appName: 'Prowlarr',
      version: '1.30.0',
      osName: 'alpine',
      isDocker: true,
      startTime: '2026-11-01T00:00:00Z',
      authentication: 'forms',
      appData: '/config',
      startupPath: '/app/prowlarr/bin',
    });
    const getHealth = vi.fn().mockResolvedValue([
      {
        source: 'IndexerStatusCheck',
        type: 'warning',
        message: 'Indexers unavailable due to failures: nzbgeek',
        wikiUrl: 'https://wiki.servarr.com/prowlarr/system#indexers-are-unavailable',
        id: 9,
      },
    ]);
    const getIndexerStats = vi.fn().mockResolvedValue({
      id: 1,
      indexers: [
        {
          indexerId: 1,
          indexerName: 'nzbgeek',
          averageResponseTime: 420,
          numberOfQueries: 100,
          numberOfGrabs: 7,
          numberOfRssQueries: 50,
          numberOfAuthQueries: 3,
          numberOfFailedQueries: 12,
          numberOfFailedGrabs: 1,
          numberOfFailedRssQueries: 0,
          numberOfFailedAuthQueries: 0,
        },
        {
          indexerId: 2,
          indexerName: 'tracker',
          averageResponseTime: 100,
          numberOfQueries: 10,
          numberOfGrabs: 2,
          numberOfFailedQueries: 0,
          numberOfFailedGrabs: 0,
        },
      ],
      userAgents: [{ userAgent: 'Sonarr', numberOfQueries: 1 }],
      hosts: [{ host: '10.0.0.1', numberOfQueries: 1 }],
    });
    const getIndexerStatus = vi.fn().mockResolvedValue([
      {
        id: 5,
        indexerId: 1,
        disabledTill: '2026-11-03T12:00:00Z',
        mostRecentFailure: '2026-11-03T11:00:00Z',
        initialFailure: '2026-11-03T10:00:00Z',
        cookies: { session: 'secret' },
      },
      { id: 6, indexerId: 3, disabledTill: '2026-11-03T13:00:00Z' },
    ]);
    const get = toolsFor({ getSystemStatus, getHealth, getIndexerStats, getIndexerStatus });

    const result = await get('prowlarr_get_status').handler({});

    expect(result).toEqual({
      system: {
        appName: 'Prowlarr',
        version: '1.30.0',
        osName: 'alpine',
        isDocker: true,
        startTime: '2026-11-01T00:00:00Z',
      },
      health: [
        {
          source: 'IndexerStatusCheck',
          type: 'warning',
          message: 'Indexers unavailable due to failures: nzbgeek',
          wikiUrl: 'https://wiki.servarr.com/prowlarr/system#indexers-are-unavailable',
        },
      ],
      indexers: [
        {
          indexerId: 1,
          name: 'nzbgeek',
          queries: 100,
          grabs: 7,
          failedQueries: 12,
          failedGrabs: 1,
          averageResponseTimeMs: 420,
          disabledTill: '2026-11-03T12:00:00Z',
          mostRecentFailure: '2026-11-03T11:00:00Z',
          initialFailure: '2026-11-03T10:00:00Z',
        },
        {
          indexerId: 2,
          name: 'tracker',
          queries: 10,
          grabs: 2,
          failedQueries: 0,
          failedGrabs: 0,
          averageResponseTimeMs: 100,
        },
        { indexerId: 3, disabledTill: '2026-11-03T13:00:00Z' },
      ],
    });
    // No raw upstream record leaks through.
    const text = JSON.stringify(result);
    for (const raw of ['authentication', 'appData', 'userAgents', 'hosts', 'cookies', '"id":'])
      expect(text).not.toContain(raw);
  });
});
