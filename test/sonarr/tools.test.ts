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
  it('registers all 33 tools with unique sonarr_ prefixed names', () => {
    const names = createSonarrTools({} as SonarrClient).map((t) => t.name);
    expect(names).toHaveLength(33);
    expect(names.every((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(new Set(names).size).toBe(33);
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
    const result = (await get('sonarr_list_series').handler({})) as { series: unknown[] };
    expect(result.series).toEqual([expect.objectContaining({ id: 1, title: 'Andor', seasonCount: 0 })]);
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
      path: '/tv/Test Series',
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
      { moveFiles: undefined },
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

  it('update_series now supports rootFolderPath, seriesType, and moveFiles', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/tv/Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/anime/Test Series',
      rootFolderPath: '/anime',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      seriesType: 'anime',
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: '/anime',
      seriesType: 'anime',
      moveFiles: true,
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/anime/Test Series',
        rootFolderPath: '/anime',
        seriesType: 'anime',
      }),
      { moveFiles: true },
    );
  });

  it('update_series strips trailing slash from rootFolderPath to avoid double slashes', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/tv/Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/newroot/Test Series',
      rootFolderPath: '/newroot/',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: '/newroot/',
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/newroot/Test Series',
      }),
      { moveFiles: undefined },
    );
  });

  it('update_series handles current.path with trailing slash correctly', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/tv/Test Series/',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/anime/Test Series',
      rootFolderPath: '/anime',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: '/anime',
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/anime/Test Series',
      }),
      { moveFiles: undefined },
    );
  });

  it('update_series falls back to folder field when path is unavailable', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      folder: 'Test Series (2020)',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/anime/Test Series (2020)',
      rootFolderPath: '/anime',
      folder: 'Test Series (2020)',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: '/anime',
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/anime/Test Series (2020)',
      }),
      { moveFiles: undefined },
    );
  });

  it('update_series throws when path and folder are both unavailable', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries });
    const tool = get('sonarr_update_series');
    await expect(
      tool.handler({
        seriesId: 5,
        rootFolderPath: '/anime',
      }),
    ).rejects.toThrow(/Cannot determine folder name/);
  });

  it('update_series without rootFolderPath does not rewrite path', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/tv/Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/tv/Test Series',
      monitored: false,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      monitored: false,
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/tv/Test Series',
        monitored: false,
      }),
      { moveFiles: undefined },
    );
  });

  it('list_series applies filters client-side', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Andor',
        year: 2022,
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tvdbId: 1,
        tags: [],
        seasons: [],
        path: '/tv/Andor',
        rootFolderPath: '/tv',
        genres: ['sci-fi', 'drama'],
        seriesType: 'standard',
      },
      {
        id: 2,
        title: 'Attack on Titan',
        year: 2013,
        status: 'ended',
        monitored: false,
        qualityProfileId: 1,
        tvdbId: 2,
        tags: [],
        seasons: [],
        path: '/anime/Attack on Titan',
        rootFolderPath: '/anime',
        genres: ['action', 'anime'],
        seriesType: 'anime',
      },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({ seriesType: 'anime' })) as {
      totalMatched: number;
      series: unknown[];
    };
    expect(result.totalMatched).toBe(1);
    expect(result.series[0]).toMatchObject({ title: 'Attack on Titan' });
  });

  it('list_series filters by genre case-insensitively', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Series1', year: 2020, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 1, tags: [], seasons: [], genres: ['Drama', 'Comedy'] },
      { id: 2, title: 'Series2', year: 2020, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 2, tags: [], seasons: [], genres: ['Action'] },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({ genre: 'drama' })) as { totalMatched: number };
    expect(result.totalMatched).toBe(1);
  });

  it('list_series respects offset and limit pagination', async () => {
    const listSeries = vi.fn().mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        id: i,
        title: `Series ${i}`,
        year: 2020,
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tvdbId: i,
        tags: [],
        seasons: [],
      })),
    );
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({ offset: 10, limit: 5 })) as {
      totalMatched: number;
      offset: number;
      limit: number;
      series: unknown[];
    };
    expect(result.totalMatched).toBe(100);
    expect(result.offset).toBe(10);
    expect(result.limit).toBe(5);
    expect(result.series).toHaveLength(5);
  });

  it('list_series rootFolder matches whole path segments, not sibling roots that share a prefix', async () => {
    const at = (id: number, rootFolderPath: string) => ({
      id,
      title: `Show ${id}`,
      rootFolderPath,
      path: `${rootFolderPath}/Show ${id}`,
      monitored: true,
      qualityProfileId: 1,
      tags: [],
    });
    const listSeries = vi.fn().mockResolvedValue([
      at(1, '/mnt/media/shows'),
      at(2, '/mnt/media/shows-anime'),
    ]);
    const get = toolsFor({ listSeries });

    const result = (await get('sonarr_list_series').handler({
      rootFolder: '/mnt/media/shows',
    })) as unknown as { totalMatched: number; series: { id: number }[] };

    expect(result.totalMatched).toBe(1);
    expect(result.series.map((s) => s.id)).toEqual([1]);
  });

  it('bulk_edit_series rejects a file-moving batch above the limit without calling Sonarr', async () => {
    const bulkEditSeries = vi.fn();
    const get = toolsFor({ bulkEditSeries });

    await expect(
      get('sonarr_bulk_edit_series').handler({
        seriesIds: Array.from({ length: 11 }, (_, i) => i + 1),
        rootFolderPath: '/mnt/media/shows-anime',
        moveFiles: true,
      }),
    ).rejects.toThrow(/sonarr_bulk_edit_series.*10/);
    expect(bulkEditSeries).not.toHaveBeenCalled();
  });

  it('bulk_edit_series omits undefined fields', async () => {
    const bulkEditSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Series1', year: 2020, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 1, tags: [], seasons: [] },
      { id: 2, title: 'Series2', year: 2020, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 2, tags: [], seasons: [] },
    ]);
    const get = toolsFor({ bulkEditSeries });
    await get('sonarr_bulk_edit_series').handler({
      seriesIds: [1, 2],
      monitored: true,
    });
    expect(bulkEditSeries).toHaveBeenCalledWith({
      seriesIds: [1, 2],
      monitored: true,
    });
    expect(bulkEditSeries).not.toHaveBeenCalledWith(
      expect.objectContaining({ qualityProfileId: undefined }),
    );
  });

  it('list_unmapped_folders returns flat array with rootFolderId', async () => {
    const listRootFolders = vi.fn().mockResolvedValue([
      {
        id: 1,
        path: '/tv',
        accessible: true,
        unmappedFolders: [
          { name: 'NewSeries1', path: '/tv/NewSeries1', relativePath: 'NewSeries1' },
          { name: 'NewSeries2', path: '/tv/NewSeries2', relativePath: 'NewSeries2' },
        ],
      },
      {
        id: 2,
        path: '/anime',
        accessible: true,
        unmappedFolders: [{ name: 'NewAnime', path: '/anime/NewAnime', relativePath: 'NewAnime' }],
      },
    ]);
    const get = toolsFor({ listRootFolders });
    const result = (await get('sonarr_list_unmapped_folders').handler({})) as Array<{
      rootFolderId: number;
      rootFolderPath: string;
      folderName?: string;
      folderPath?: string;
    }>;
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      rootFolderId: 1,
      rootFolderPath: '/tv',
      folderName: 'NewSeries1',
    });
    expect(result[2]).toMatchObject({
      rootFolderId: 2,
      rootFolderPath: '/anime',
      folderName: 'NewAnime',
    });
  });

  it('get_rename_preview caps results at 100 but reports total', async () => {
    const getRenamePreview = vi.fn().mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({
        id: i,
        seriesId: 1,
        seasonNumber: 1,
        episodeNumbers: [i + 1],
        existingPath: `/old/episode${i}.mkv`,
        newPath: `/new/S01E${(i + 1).toString().padStart(2, '0')}.mkv`,
      })),
    );
    const get = toolsFor({ getRenamePreview });
    const result = (await get('sonarr_get_rename_preview').handler({ seriesId: 1 })) as {
      total: number;
      shown: number;
      previews: unknown[];
    };
    expect(result.total).toBe(150);
    expect(result.shown).toBe(100);
    expect(result.previews).toHaveLength(100);
  });

  it('find_duplicate_series detects exact duplicates by tvdbId', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Series',
        year: 2020,
        tvdbId: 100,
        path: '/tv/Series',
        rootFolderPath: '/tv',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
      {
        id: 2,
        title: 'Series',
        year: 2020,
        tvdbId: 100,
        path: '/backup/Series',
        rootFolderPath: '/backup',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_find_duplicate_series').handler({})) as {
      total: number;
      exactDuplicates: Array<{ count: number }>;
      misplacedCopies: unknown[];
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(1);
    expect(result.exactDuplicates[0]?.count).toBe(2);
  });

  it('find_duplicate_series detects misplaced copies by title+year in different folders', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Andor',
        year: 2022,
        tvdbId: 1,
        path: '/tv/Andor',
        rootFolderPath: '/tv',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
      {
        id: 2,
        title: 'Andor',
        year: 2022,
        tvdbId: 999,
        path: '/backup/Andor',
        rootFolderPath: '/backup',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_find_duplicate_series').handler({})) as {
      total: number;
      exactDuplicates: unknown[];
      misplacedCopies: Array<{ count: number }>;
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(0);
    expect(result.misplacedCopies).toHaveLength(1);
    expect(result.misplacedCopies[0]?.count).toBe(2);
  });

  it('find_duplicate_series does not flag series with same title+year in same root folder', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Andor',
        year: 2022,
        tvdbId: 1,
        path: '/tv/Andor',
        rootFolderPath: '/tv',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
      {
        id: 2,
        title: 'Andor',
        year: 2022,
        tvdbId: 999,
        path: '/tv/Andor2',
        rootFolderPath: '/tv',
        status: 'continuing',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        seasons: [],
      },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_find_duplicate_series').handler({})) as {
      total: number;
      exactDuplicates: unknown[];
      misplacedCopies: Array<{ count: number }>;
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(0);
    expect(result.misplacedCopies).toHaveLength(0);
  });

  it('update_series handles Windows-style paths correctly', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: 'D:\\TV\\Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
      rootFolderPath: 'D:\\TV',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: 'E:\\TV2\\Test Series',
      rootFolderPath: 'E:\\TV2',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: 'E:\\TV2',
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: 'E:\\TV2\\Test Series',
      }),
      { moveFiles: undefined },
    );
  });

  it('update_series preserves forward slashes when moving to Unix path', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/old/tv/Test Series',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
      rootFolderPath: '/old/tv',
    });
    const updateSeries = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Test Series',
      path: '/new/tv/Test Series',
      rootFolderPath: '/new/tv',
      monitored: true,
      qualityProfileId: 1,
      seasonFolder: true,
      tags: [],
      year: 2020,
      status: 'continuing',
    });
    const get = toolsFor({ getSeries, updateSeries });
    await get('sonarr_update_series').handler({
      seriesId: 5,
      rootFolderPath: '/new/tv',
    });
    expect(updateSeries).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/new/tv/Test Series',
      }),
      { moveFiles: undefined },
    );
  });

  it('delete_series returns preview when deleteFiles=true without confirmDeleteFiles', async () => {
    const getSeries = vi.fn().mockResolvedValue({
      id: 3,
      title: 'Series',
      year: 2020,
      tvdbId: 123,
      path: '/tv/Series',
      rootFolderPath: '/tv',
      status: 'continuing',
      monitored: true,
      qualityProfileId: 1,
      tags: [],
      seasons: [],
      statistics: { episodeFileCount: 50, episodeCount: 100, sizeOnDisk: 5368709120 },
    });
    const listEpisodeFiles = vi.fn().mockResolvedValue([]);
    const get = toolsFor({ getSeries, listEpisodeFiles });
    const result = (await get('sonarr_delete_series').handler({
      seriesId: 3,
      deleteFiles: true,
    })) as unknown as { wouldDelete: { episodeFileCount: number; sizeOnDisk: number }; confirmRequired: boolean };
    expect(result.confirmRequired).toBe(true);
    expect(result.wouldDelete.episodeFileCount).toBe(50);
    expect(result.wouldDelete.sizeOnDisk).toBe(5368709120);
  });

  it('delete_series executes when confirmDeleteFiles=true', async () => {
    const deleteSeries = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteSeries });
    await get('sonarr_delete_series').handler({
      seriesId: 3,
      deleteFiles: true,
      confirmDeleteFiles: true,
    });
    expect(deleteSeries).toHaveBeenCalledWith(3, { deleteFiles: true, addImportListExclusion: false });
  });

  it('bulk_edit_series returns { updated, series } envelope', async () => {
    const bulkEditSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Series1', year: 2020, status: 'continuing', monitored: false, qualityProfileId: 1, tvdbId: 1, tags: [], seasons: [] },
      { id: 2, title: 'Series2', year: 2020, status: 'continuing', monitored: false, qualityProfileId: 1, tvdbId: 2, tags: [], seasons: [] },
    ]);
    const get = toolsFor({ bulkEditSeries });
    const result = (await get('sonarr_bulk_edit_series').handler({
      seriesIds: [1, 2],
      monitored: false,
    })) as unknown as { updated: number; series: unknown[] };
    expect(result.updated).toBe(2);
    expect(result.series).toHaveLength(2);
  });

  it('list_unmapped_folders returns flat array with rootFolderId', async () => {
    const listRootFolders = vi.fn().mockResolvedValue([
      {
        id: 1,
        path: '/tv',
        accessible: true,
        unmappedFolders: [
          { name: 'NewSeries1', path: '/tv/NewSeries1', relativePath: 'NewSeries1' },
          { name: 'NewSeries2', path: '/tv/NewSeries2', relativePath: 'NewSeries2' },
        ],
      },
      {
        id: 2,
        path: '/anime',
        accessible: true,
        unmappedFolders: [{ name: 'NewAnime', path: '/anime/NewAnime', relativePath: 'NewAnime' }],
      },
    ]);
    const get = toolsFor({ listRootFolders });
    const result = (await get('sonarr_list_unmapped_folders').handler({})) as Array<{
      rootFolderId: number;
      rootFolderPath: string;
      folderName?: string;
      folderPath?: string;
    }>;
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      rootFolderId: 1,
      rootFolderPath: '/tv',
      folderName: 'NewSeries1',
    });
    expect(result[2]).toMatchObject({
      rootFolderId: 2,
      rootFolderPath: '/anime',
      folderName: 'NewAnime',
    });
  });

  it('import_folder calls runCommand with DownloadedEpisodesScan and path', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      id: 99,
      name: 'DownloadedEpisodesScan',
      status: 'queued',
    });
    const get = toolsFor({ runCommand });
    const result = (await get('sonarr_import_folder').handler({
      path: '/unmapped/NewSeries',
    })) as unknown as { commandId: number; status: string };
    expect(runCommand).toHaveBeenCalledWith({
      name: 'DownloadedEpisodesScan',
      path: '/unmapped/NewSeries',
    });
    expect(result.commandId).toBe(99);
    expect(result.status).toBe('queued');
  });

  it('import_folder supports importMode parameter', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      id: 100,
      name: 'DownloadedEpisodesScan',
      status: 'queued',
    });
    const get = toolsFor({ runCommand });
    await get('sonarr_import_folder').handler({
      path: '/unmapped/Series',
      importMode: 'Copy',
    });
    expect(runCommand).toHaveBeenCalledWith({
      name: 'DownloadedEpisodesScan',
      path: '/unmapped/Series',
      importMode: 'Copy',
    });
  });
});
