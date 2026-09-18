import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

function toolsFor(overrides: Partial<SonarrClient>) {
  const client = overrides as SonarrClient;
  const tools = createSonarrTools(client);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createSonarrTools', () => {
  it('registers all 28 tools with unique sonarr_ prefixed names', () => {
    const names = createSonarrTools({} as SonarrClient).map((t) => t.name);
    expect(names).toHaveLength(28);
    expect(names.every((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(new Set(names).size).toBe(28);
  });

  it('gives every tool a non-empty description', () => {
    for (const tool of createSonarrTools({} as SonarrClient)) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('summarises the series list', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({})) as unknown[];
    expect(result).toEqual([expect.objectContaining({ id: 1, title: 'Andor', seasonCount: 0 })]);
  });

  it('returns the full record from get_series', async () => {
    const getSeries = vi.fn().mockResolvedValue({ id: 7, title: 'Severance', path: '/tv' });
    const get = toolsFor({ getSeries });
    await expect(get('sonarr_get_series').handler({ seriesId: 7 })).resolves.toMatchObject({ id: 7 });
    expect(getSeries).toHaveBeenCalledWith(7);
  });

  it('passes the add_series arguments straight through', async () => {
    const addSeries = vi.fn().mockResolvedValue({ id: 3, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] });
    const get = toolsFor({ addSeries });
    await get('sonarr_add_series').handler({
      title: 'Andor',
      tvdbId: 9,
      qualityProfileId: 1,
      rootFolderPath: '/tv',
      searchForMissingEpisodes: true,
    });
    expect(addSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        tvdbId: 9,
        rootFolderPath: '/tv',
        addOptions: expect.objectContaining({ searchForMissingEpisodes: true }),
      }),
    );
  });

  it('defaults delete_series to keeping files', async () => {
    const deleteSeries = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteSeries });
    await get('sonarr_delete_series').handler({ seriesId: 4 });
    expect(deleteSeries).toHaveBeenCalledWith(4, { deleteFiles: false, addImportListExclusion: false });
  });

  it('defaults delete_queue_item to safe removal', async () => {
    const deleteQueueItem = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteQueueItem });
    await get('sonarr_delete_queue_item').handler({ id: 4 });
    expect(deleteQueueItem).toHaveBeenCalledWith(4, { removeFromClient: false, blocklist: false });
  });

  it('summarises queue records', async () => {
    const getQueue = vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalRecords: 1,
      records: [{ id: 1, title: 'x', status: 'downloading', size: 100, sizeleft: 50 }],
    });
    const get = toolsFor({ getQueue });
    const result = (await get('sonarr_get_queue').handler({})) as { records: unknown[] };
    expect(result.records).toEqual([expect.objectContaining({ percentComplete: 50 })]);
  });

  it('restricts run_command to the supported command names', async () => {
    const tool = createSonarrTools({} as SonarrClient).find((t) => t.name === 'sonarr_run_command');
    if (!tool) throw new Error('sonarr_run_command is not registered');
    // Picked down to `name` so a rejection can only come from the enum, never
    // from some other required field -- which would make the toThrow() below
    // pass for the wrong reason.
    const schema = z.object(tool.inputSchema).pick({ name: true });
    expect(() => schema.parse({ name: 'SeriesSearch' })).not.toThrow();
    expect(() => schema.parse({ name: 'DropDatabase' })).toThrow();
  });

  it('propagates client errors out of the handler', async () => {
    const listSeries = vi.fn().mockRejectedValue(new Error('down'));
    const get = toolsFor({ listSeries });
    await expect(get('sonarr_list_series').handler({})).rejects.toThrow('down');
  });

  it('update_series merges changes with fetched record and preserves other fields', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [1, 2],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      monitored: false,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [1, 2],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({ seriesId: 5, monitored: false });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        id: 5,
        title: 'Test Series',
        monitored: false,
        qualityProfileId: 1,
        seasonFolder: true,
        tags: [1, 2],
      }),
    );
  });

  it('search_releases requires either episodeId alone or seriesId+seasonNumber together', async () => {
    const searchReleases = vi.fn().mockResolvedValue([]);
    const get = toolsFor({ searchReleases });
    const tool = get('sonarr_search_releases');

    // Valid: episodeId alone
    await tool.handler({ episodeId: 42, approvedOnly: false, limit: 20 });
    expect(searchReleases).toHaveBeenCalledWith({ episodeId: 42 });

    searchReleases.mockClear();
    searchReleases.mockResolvedValue([]);

    // Valid: seriesId and seasonNumber together
    await tool.handler({ seriesId: 5, seasonNumber: 2, approvedOnly: false, limit: 20 });
    expect(searchReleases).toHaveBeenCalledWith({ seriesId: 5, seasonNumber: 2 });

    searchReleases.mockClear();

    searchReleases.mockClear();

    // Valid: season 0 is Sonarr's specials season, not a missing value
    await tool.handler({ seriesId: 5, seasonNumber: 0, approvedOnly: false, limit: 20 });
    expect(searchReleases).toHaveBeenCalledWith({ seriesId: 5, seasonNumber: 0 });

    searchReleases.mockClear();

    // Invalid: no params
    await expect(tool.handler({ approvedOnly: false, limit: 20 })).rejects.toThrow();
    expect(searchReleases).not.toHaveBeenCalled();

    // Invalid: episodeId with seriesId
    await expect(tool.handler({ episodeId: 42, seriesId: 5, approvedOnly: false, limit: 20 })).rejects.toThrow();
    expect(searchReleases).not.toHaveBeenCalled();

    // Invalid: seriesId without seasonNumber
    await expect(tool.handler({ seriesId: 5, approvedOnly: false, limit: 20 })).rejects.toThrow();
    expect(searchReleases).not.toHaveBeenCalled();

    // Invalid: seasonNumber without seriesId
    await expect(tool.handler({ seasonNumber: 2, approvedOnly: false, limit: 20 })).rejects.toThrow();
    expect(searchReleases).not.toHaveBeenCalled();
  });

  it('search_releases applies filtering and returns counts', async () => {
    const searchReleases = vi.fn().mockResolvedValue([
      {
        guid: '1',
        title: 'Release 1',
        approved: true,
        indexerId: 1,
        indexer: 'Site1',
        size: 1024,
        age: 1,
        protocol: 'torrent',
        rejections: [],
      },
      {
        guid: '2',
        title: 'Best Release',
        approved: false,
        indexerId: 2,
        indexer: 'Site2',
        size: 2048,
        age: 2,
        protocol: 'torrent',
        rejections: ['Not an upgrade'],
      },
      {
        guid: '3',
        title: 'Amazing Release',
        approved: true,
        indexerId: 3,
        indexer: 'Site3',
        size: 3072,
        age: 3,
        protocol: 'torrent',
        rejections: [],
      },
    ]);
    const get = toolsFor({ searchReleases });
    const result = (await get('sonarr_search_releases').handler({
      episodeId: 42,
      titleContains: 'Best',
      approvedOnly: false,
      limit: 20,
    })) as {
      total: number;
      matched: number;
      returned: number;
      releases: unknown[];
    };

    expect(result.total).toBe(3);
    expect(result.matched).toBe(1); // Only "Best Release" matches titleContains
    expect(result.returned).toBe(1);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]).toMatchObject({ guid: '2', rank: 2 });
  });

  it('search_releases filters by approvedOnly', async () => {
    const searchReleases = vi.fn().mockResolvedValue([
      { guid: '1', title: 'Release 1', approved: true, indexerId: 1, indexer: 'Site1', size: 1024, age: 1, protocol: 'torrent', rejections: [] },
      { guid: '2', title: 'Release 2', approved: false, indexerId: 2, indexer: 'Site2', size: 2048, age: 2, protocol: 'torrent', rejections: [] },
    ]);
    const get = toolsFor({ searchReleases });
    const result = (await get('sonarr_search_releases').handler({
      episodeId: 42,
      approvedOnly: true,
      limit: 20,
    })) as { returned: number; releases: unknown[] };

    expect(result.returned).toBe(1);
    expect(result.releases[0]).toMatchObject({ approved: true });
  });

  it('search_releases defaults to limit 20', async () => {
    const releases = Array.from({ length: 30 }, (_, i) => ({
      guid: String(i),
      title: `Release ${i}`,
      approved: true,
      indexerId: 1,
      indexer: 'Site',
      size: 1024,
      age: 1,
      protocol: 'torrent',
      rejections: [],
    }));
    const searchReleases = vi.fn().mockResolvedValue(releases);
    const get = toolsFor({ searchReleases });
    const result = (await get('sonarr_search_releases').handler({
      episodeId: 42,
      approvedOnly: false,
    })) as { returned: number };

    expect(result.returned).toBe(20);
  });

  it('grab_release sends exactly guid and indexerId to the client', async () => {
    const grabRelease = vi.fn().mockResolvedValue({ guid: 'abc', title: 'Grabbed', approved: true, indexerId: 1, indexer: 'Site', size: 1024, age: 1, protocol: 'torrent', rejections: [] });
    const get = toolsFor({ grabRelease });
    await get('sonarr_grab_release').handler({ guid: 'abc', indexerId: 5 });

    expect(grabRelease).toHaveBeenCalledWith({ guid: 'abc', indexerId: 5 });
    expect(grabRelease).toHaveBeenCalledTimes(1);
  });

  it('grab_release returns grabbed status with title from response', async () => {
    const grabRelease = vi.fn().mockResolvedValue({
      guid: 'xyz',
      title: 'Grabbed Release Title',
      approved: true,
      indexerId: 3,
      indexer: 'Site',
      size: 1024,
      age: 1,
      protocol: 'torrent',
      rejections: [],
    });
    const get = toolsFor({ grabRelease });
    const result = (await get('sonarr_grab_release').handler({ guid: 'xyz', indexerId: 3 })) as {
      grabbed: boolean;
      guid: string;
      indexerId: number;
      title?: string;
    };

    expect(result.grabbed).toBe(true);
    expect(result.guid).toBe('xyz');
    expect(result.indexerId).toBe(3);
    expect(result.title).toBe('Grabbed Release Title');
  });
});
