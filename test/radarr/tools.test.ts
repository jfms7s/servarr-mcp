import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

function toolsFor(overrides: Partial<RadarrClient>) {
  const tools = createRadarrTools(overrides as RadarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

const movie = {
  id: 1,
  title: 'Dune',
  year: 2021,
  status: 'released',
  monitored: true,
  hasFile: false,
  qualityProfileId: 1,
  tmdbId: 438631,
  tags: [],
};

describe('createRadarrTools', () => {
  it('registers all 26 tools with unique radarr_ prefixed names', () => {
    const names = createRadarrTools({} as RadarrClient).map((t) => t.name);
    expect(names).toHaveLength(26);
    expect(names.every((n) => n.startsWith('radarr_'))).toBe(true);
    expect(new Set(names).size).toBe(26);
  });

  it('summarises the movie list', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockResolvedValue([movie]) });
    const result = (await get('radarr_list_movies').handler({})) as unknown[];
    expect(result).toEqual([expect.objectContaining({ id: 1, title: 'Dune' })]);
  });

  it('returns the full record from get_movie', async () => {
    const getMovie = vi.fn().mockResolvedValue({ id: 4, title: 'Arrival', path: '/movies' });
    const get = toolsFor({ getMovie });
    await expect(get('radarr_get_movie').handler({ movieId: 4 })).resolves.toMatchObject({ id: 4 });
    expect(getMovie).toHaveBeenCalledWith(4);
  });

  it('maps searchForMovie into addOptions', async () => {
    const addMovie = vi.fn().mockResolvedValue(movie);
    const get = toolsFor({ addMovie });
    await get('radarr_add_movie').handler({
      title: 'Dune',
      tmdbId: 438631,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      searchForMovie: true,
    });
    expect(addMovie).toHaveBeenCalledWith(
      expect.objectContaining({ addOptions: { searchForMovie: true } }),
    );
  });

  it('defaults delete_movie to keeping files', async () => {
    const deleteMovie = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteMovie });
    await get('radarr_delete_movie').handler({ movieId: 2 });
    expect(deleteMovie).toHaveBeenCalledWith(2, { deleteFiles: false, addImportExclusion: false });
  });

  it('defaults delete_queue_item to safe removal', async () => {
    const deleteQueueItem = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteQueueItem });
    await get('radarr_delete_queue_item').handler({ id: 4 });
    expect(deleteQueueItem).toHaveBeenCalledWith(4, { removeFromClient: false, blocklist: false });
  });

  it('restricts run_command to supported command names', () => {
    const tool = createRadarrTools({} as RadarrClient).find((t) => t.name === 'radarr_run_command');
    if (!tool) throw new Error('radarr_run_command is not registered');
    const schema = z.object(tool.inputSchema).pick({ name: true });
    expect(() => schema.parse({ name: 'MoviesSearch' })).not.toThrow();
    expect(() => schema.parse({ name: 'Nope' })).toThrow();
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('radarr_list_movies').handler({})).rejects.toThrow('down');
  });

  it('update_movie merges changes with fetched record and preserves other fields', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [1, 2],
      year: 2021,
      status: 'released',
    });
    const updateMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      monitored: false,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [1, 2],
      year: 2021,
      status: 'released',
    });
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({ movieId: 5, monitored: false });
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        id: 5,
        title: 'Dune',
        monitored: false,
        qualityProfileId: 1,
        minimumAvailability: 'released',
        tags: [1, 2],
      }),
    );
  });

  it('search_releases assigns rank to full unfiltered list, then filters', async () => {
    const searchReleases = vi.fn().mockResolvedValue([
      {
        guid: 'abc-123',
        title: 'Dune.2021.1080p.BluRay',
        indexerId: 1,
        indexer: 'Indexer1',
        size: 5368709120,
        age: 14,
        protocol: 'torrent',
        approved: true,
      },
      {
        guid: 'def-456',
        title: 'Dune.2021.720p.BluRay',
        indexerId: 2,
        indexer: 'Indexer2',
        size: 2684354560,
        age: 10,
        protocol: 'torrent',
        approved: false,
      },
      {
        guid: 'ghi-789',
        title: 'Dune.2021.1080p.WEB-DL',
        indexerId: 1,
        indexer: 'Indexer1',
        size: 4294967296,
        age: 5,
        protocol: 'torrent',
        approved: true,
      },
    ]);
    const get = toolsFor({ searchReleases });

    interface SearchResult {
      total: number;
      matched: number;
      returned: number;
      releases: Array<{ rank: number }>;
    }

    // No filters
    const result1 = (await get('radarr_search_releases').handler({
      movieId: 12,
    })) as SearchResult;
    expect(result1.total).toBe(3);
    expect(result1.matched).toBe(3);
    expect(result1.returned).toBe(3);
    expect(result1.releases).toHaveLength(3);
    expect(result1.releases[0].rank).toBe(1);
    expect(result1.releases[1].rank).toBe(2);
    expect(result1.releases[2].rank).toBe(3);

    // With titleContains filter (case-insensitive)
    const result2 = (await get('radarr_search_releases').handler({
      movieId: 12,
      titleContains: '1080p',
    })) as SearchResult;
    expect(result2.total).toBe(3);
    expect(result2.matched).toBe(2);
    expect(result2.returned).toBe(2);
    expect(result2.releases[0].rank).toBe(1);
    expect(result2.releases[1].rank).toBe(3);

    // With approvedOnly filter
    const result3 = (await get('radarr_search_releases').handler({
      movieId: 12,
      approvedOnly: true,
    })) as SearchResult;
    expect(result3.total).toBe(3);
    expect(result3.matched).toBe(2);
    expect(result3.returned).toBe(2);

    // With limit
    const result4 = (await get('radarr_search_releases').handler({
      movieId: 12,
      limit: 2,
    })) as SearchResult;
    expect(result4.total).toBe(3);
    expect(result4.matched).toBe(3);
    expect(result4.returned).toBe(2);
  });

  it('search_releases defaults titleContains to case-insensitive and limit to 20', async () => {
    const searchReleases = vi.fn().mockResolvedValue([
      {
        guid: 'test',
        title: 'DUNE.2021.1080P',
        indexerId: 1,
        indexer: 'Indexer',
        size: 5368709120,
        age: 1,
        protocol: 'torrent',
        approved: true,
      },
    ]);
    const get = toolsFor({ searchReleases });

    // titleContains is case-insensitive
    const result = (await get('radarr_search_releases').handler({
      movieId: 12,
      titleContains: 'dune',
    })) as unknown as { returned: number };
    expect(result.returned).toBe(1);

    // Default limit is 20
    const resultNoLimit = (await get('radarr_search_releases').handler({
      movieId: 12,
    })) as unknown as { returned: number };
    expect(resultNoLimit.returned).toBe(1);
  });

  it('grab_release sends only guid and indexerId', async () => {
    const grabRelease = vi.fn().mockResolvedValue({
      guid: 'abc-123',
      title: 'Dune.2021.1080p',
      indexerId: 1,
      indexer: 'Indexer',
      size: 5368709120,
      age: 14,
      protocol: 'torrent',
      approved: true,
    });
    const get = toolsFor({ grabRelease });
    const result = (await get('radarr_grab_release').handler({
      guid: 'abc-123',
      indexerId: 1,
    })) as unknown as { grabbed: boolean };
    expect(grabRelease).toHaveBeenCalledWith({ guid: 'abc-123', indexerId: 1 });
    expect(result.grabbed).toBe(true);
  });
});
