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
  it('registers all 31 tools with unique radarr_ prefixed names', () => {
    const names = createRadarrTools({} as RadarrClient).map((t) => t.name);
    expect(names).toHaveLength(31);
    expect(names.every((n) => n.startsWith('radarr_'))).toBe(true);
    expect(new Set(names).size).toBe(31);
  });

  it('summarises the movie list', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockResolvedValue([movie]) });
    const result = (await get('radarr_list_movies').handler({})) as unknown as {
      totalMatched: number;
      movies: unknown[];
    };
    expect(result.totalMatched).toBe(1);
    expect(result.movies).toEqual([expect.objectContaining({ id: 1, title: 'Dune' })]);
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

  it('restricts run_command to supported command names including RenameMovie', () => {
    const tool = createRadarrTools({} as RadarrClient).find((t) => t.name === 'radarr_run_command');
    if (!tool) throw new Error('radarr_run_command is not registered');
    const schema = z.object(tool.inputSchema).pick({ name: true });
    expect(() => schema.parse({ name: 'MoviesSearch' })).not.toThrow();
    expect(() => schema.parse({ name: 'RenameMovie' })).not.toThrow();
    expect(() => schema.parse({ name: 'MoveMovie' })).toThrow();
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
      { moveFiles: false },
    );
  });

  it('update_movie calculates new path when rootFolderPath is provided, preserving folder name', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Chicken Run',
      year: 2000,
      path: '/mnt/archive/media/movies/Chicken Run (2000)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    });
    const updateMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Chicken Run',
      year: 2000,
      path: '/mnt/archive/media/movies-animation/Chicken Run (2000)',
      rootFolderPath: '/mnt/archive/media/movies-animation',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    });
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      rootFolderPath: '/mnt/archive/media/movies-animation',
      moveFiles: true,
    });
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        rootFolderPath: '/mnt/archive/media/movies-animation',
        path: '/mnt/archive/media/movies-animation/Chicken Run (2000)',
      }),
      { moveFiles: true },
    );
  });

  it('update_movie handles rootFolderPath with trailing slashes correctly', async () => {
    const movieData = {
      id: 5,
      title: 'Movie',
      year: 2020,
      path: '/old/Movie (2020)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    };
    const getMovie = vi.fn().mockResolvedValue(movieData);
    const updateMovie = vi.fn().mockResolvedValue(movieData);
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      rootFolderPath: '/new/root/',
    });
    // Should normalize the trailing slash to avoid double slashes
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/new/root/Movie (2020)',
      }),
      { moveFiles: false },
    );
  });

  it('update_movie preserves path when rootFolderPath is not provided', async () => {
    const movieData = {
      id: 5,
      title: 'Movie',
      year: 2020,
      path: '/movies/Movie (2020)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    };
    const getMovie = vi.fn().mockResolvedValue(movieData);
    const updateMovie = vi.fn().mockResolvedValue(movieData);
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      monitored: false,
    });
    // Path should remain unchanged when rootFolderPath is not provided
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/movies/Movie (2020)',
        monitored: false,
      }),
      { moveFiles: false },
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
    expect(result1.releases[0]?.rank).toBe(1);
    expect(result1.releases[1]?.rank).toBe(2);
    expect(result1.releases[2]?.rank).toBe(3);

    // With titleContains filter (case-insensitive)
    const result2 = (await get('radarr_search_releases').handler({
      movieId: 12,
      titleContains: '1080p',
    })) as SearchResult;
    expect(result2.total).toBe(3);
    expect(result2.matched).toBe(2);
    expect(result2.returned).toBe(2);
    expect(result2.releases[0]?.rank).toBe(1);
    expect(result2.releases[1]?.rank).toBe(3);

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

  it('list_movies filters by rootFolder, hasFile, monitored, genre, and titleContains', async () => {
    const listMovies = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Dune',
        year: 2021,
        status: 'released',
        monitored: true,
        hasFile: true,
        qualityProfileId: 1,
        tmdbId: 438631,
        tags: [],
        path: '/movies/scifi/Dune',
        genres: ['sci-fi', 'action'],
      },
      {
        id: 2,
        title: 'Arrival',
        year: 2016,
        status: 'released',
        monitored: false,
        hasFile: false,
        qualityProfileId: 1,
        tmdbId: 329865,
        tags: [],
        path: '/archive/Arrival',
        genres: ['sci-fi', 'drama'],
      },
      {
        id: 3,
        title: 'The Matrix',
        year: 1999,
        status: 'released',
        monitored: true,
        hasFile: true,
        qualityProfileId: 1,
        tmdbId: 603,
        tags: [],
        path: '/movies/scifi/The Matrix',
        genres: ['sci-fi', 'action'],
      },
    ]);
    const get = toolsFor({ listMovies });

    // No filters
    const result1 = (await get('radarr_list_movies').handler({})) as unknown as {
      totalMatched: number;
      movies: unknown[];
    };
    expect(result1.totalMatched).toBe(3);
    expect(result1.movies).toHaveLength(3);

    // Filter by rootFolder
    const result2 = (await get('radarr_list_movies').handler({
      rootFolder: '/movies',
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result2.totalMatched).toBe(2);

    // Filter by hasFile
    const result3 = (await get('radarr_list_movies').handler({
      hasFile: true,
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result3.totalMatched).toBe(2);

    // Filter by monitored
    const result4 = (await get('radarr_list_movies').handler({
      monitored: true,
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result4.totalMatched).toBe(2);

    // Filter by genre (case-insensitive)
    const result5 = (await get('radarr_list_movies').handler({
      genre: 'drama',
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result5.totalMatched).toBe(1);

    // Filter by titleContains
    const result6 = (await get('radarr_list_movies').handler({
      titleContains: 'dune',
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result6.totalMatched).toBe(1);

    // Combined filters
    const result7 = (await get('radarr_list_movies').handler({
      genre: 'sci-fi',
      hasFile: true,
    })) as unknown as { totalMatched: number; movies: unknown[] };
    expect(result7.totalMatched).toBe(2);
  });

  it('list_movies applies offset and limit', async () => {
    const movies = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `Movie ${i + 1}`,
      year: 2020 + i,
      status: 'released',
      monitored: true,
      hasFile: true,
      qualityProfileId: 1,
      tmdbId: 1000 + i,
      tags: [],
    }));
    const listMovies = vi.fn().mockResolvedValue(movies);
    const get = toolsFor({ listMovies });

    const result = (await get('radarr_list_movies').handler({
      offset: 2,
      limit: 3,
    })) as unknown as { totalMatched: number; offset: number; limit: number; movies: unknown[] };
    expect(result.totalMatched).toBe(10);
    expect(result.offset).toBe(2);
    expect(result.limit).toBe(3);
    expect(result.movies).toHaveLength(3);
  });

  it('update_movie includes rootFolderPath and passes moveFiles as option', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      path: '/old/movies/Dune (2021)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      year: 2021,
      status: 'released',
      rootFolderPath: '/old/movies',
      tmdbId: 1,
      hasFile: true,
    });
    const updateMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      path: '/new/movies/Dune (2021)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      year: 2021,
      status: 'released',
      rootFolderPath: '/new/movies',
      tmdbId: 1,
      hasFile: true,
    });
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      rootFolderPath: '/new/movies',
      moveFiles: true,
    });
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        rootFolderPath: '/new/movies',
        path: '/new/movies/Dune (2021)',
      }),
      { moveFiles: true },
    );
  });

  it('bulk_edit_movies omits undefined fields in payload', async () => {
    const bulkEditMovies = vi.fn().mockResolvedValue([
      { id: 1, title: 'Movie 1', monitored: false },
      { id: 2, title: 'Movie 2', monitored: false },
    ]);
    const get = toolsFor({ bulkEditMovies });
    await get('radarr_bulk_edit_movies').handler({
      movieIds: [1, 2],
      monitored: false,
    });
    expect(bulkEditMovies).toHaveBeenCalledWith(
      expect.objectContaining({
        movieIds: [1, 2],
        monitored: false,
      }),
    );
    // Verify undefined fields are not in the payload
    const call = bulkEditMovies.mock.calls[0]![0];
    expect(call).not.toHaveProperty('tags');
    expect(call).not.toHaveProperty('rootFolderPath');
  });

  it('delete_movie returns preview when deleteFiles=true without confirmDeleteFiles', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 7,
      title: 'Dune',
      year: 2021,
      path: '/movies/Dune',
      monitored: true,
      hasFile: true,
      qualityProfileId: 1,
      tmdbId: 438631,
      tags: [],
    });
    const listMovieFiles = vi.fn().mockResolvedValue([
      { id: 1, relativePath: 'Dune.2021.1080p.mkv' },
      { id: 2, relativePath: 'Dune.2021.subs.srt' },
    ]);
    const get = toolsFor({ getMovie, listMovieFiles });
    const result = (await get('radarr_delete_movie').handler({
      movieId: 7,
      deleteFiles: true,
    })) as unknown as { wouldDelete: { files: unknown[] }; confirmRequired: boolean };
    expect(result.confirmRequired).toBe(true);
    expect(result.wouldDelete.files).toEqual(['Dune.2021.1080p.mkv', 'Dune.2021.subs.srt']);
  });

  it('delete_movie executes when confirmDeleteFiles=true', async () => {
    const deleteMovie = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteMovie });
    await get('radarr_delete_movie').handler({
      movieId: 7,
      deleteFiles: true,
      confirmDeleteFiles: true,
    });
    expect(deleteMovie).toHaveBeenCalledWith(7, { deleteFiles: true, addImportExclusion: false });
  });

  it('update_movie handles Windows-style paths correctly', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      year: 2021,
      path: 'D:\\Movies\\Dune (2021)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
      rootFolderPath: 'D:\\Movies',
    });
    const updateMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      year: 2021,
      path: 'E:\\Movies2\\Dune (2021)',
      rootFolderPath: 'E:\\Movies2',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    });
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      rootFolderPath: 'E:\\Movies2',
    });
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: 'E:\\Movies2\\Dune (2021)',
      }),
      { moveFiles: false },
    );
  });

  it('update_movie preserves forward slashes when moving to Unix path', async () => {
    const getMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      year: 2021,
      path: '/old/movies/Dune (2021)',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
      rootFolderPath: '/old/movies',
    });
    const updateMovie = vi.fn().mockResolvedValue({
      id: 5,
      title: 'Dune',
      year: 2021,
      path: '/new/movies/Dune (2021)',
      rootFolderPath: '/new/movies',
      monitored: true,
      qualityProfileId: 1,
      minimumAvailability: 'released',
      tags: [],
      status: 'released',
      tmdbId: 1,
      hasFile: true,
    });
    const get = toolsFor({ getMovie, updateMovie });
    await get('radarr_update_movie').handler({
      movieId: 5,
      rootFolderPath: '/new/movies',
    });
    expect(updateMovie).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        path: '/new/movies/Dune (2021)',
      }),
      { moveFiles: false },
    );
  });

  it('get_rename_preview returns { total, shown, previews } envelope', async () => {
    const renamePreview = vi.fn().mockResolvedValue([
      { id: 1, movieId: 1, movieFileId: 1, existingPath: '/old/file1.mkv', newPath: '/new/file1.mkv' },
      { id: 2, movieId: 1, movieFileId: 2, existingPath: '/old/file2.mkv', newPath: '/new/file2.mkv' },
    ]);
    const get = toolsFor({ renamePreview });
    const result = (await get('radarr_get_rename_preview').handler({ movieIds: [1] })) as {
      total: number;
      shown: number;
      previews: unknown[];
    };
    expect(result.total).toBe(2);
    expect(result.shown).toBe(2);
    expect(result.previews).toHaveLength(2);
  });

  it('get_rename_preview caps at 100 but reports total', async () => {
    const previews = Array.from({ length: 150 }, (_, i) => ({
      id: i,
      movieId: 1,
      movieFileId: i,
      existingPath: `/old/file${i}.mkv`,
      newPath: `/new/file${i}.mkv`,
    }));
    const renamePreview = vi.fn().mockResolvedValue(previews);
    const get = toolsFor({ renamePreview });
    const result = (await get('radarr_get_rename_preview').handler({ movieIds: [1] })) as {
      total: number;
      shown: number;
      previews: unknown[];
    };
    expect(result.total).toBe(150);
    expect(result.shown).toBe(100);
    expect(result.previews).toHaveLength(100);
  });

  it('find_duplicate_movies detects exact duplicates by tmdbId', async () => {
    const listMovies = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Dune',
        year: 2021,
        tmdbId: 438631,
        path: '/movies/Dune',
        rootFolderPath: '/movies',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: true,
      },
      {
        id: 2,
        title: 'Dune',
        year: 2021,
        tmdbId: 438631,
        path: '/backup/Dune',
        rootFolderPath: '/backup',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: false,
      },
    ]);
    const get = toolsFor({ listMovies });
    const result = (await get('radarr_find_duplicate_movies').handler({})) as {
      total: number;
      exactDuplicates: Array<{ count: number }>;
      misplacedCopies: unknown[];
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(1);
    expect(result.exactDuplicates[0]?.count).toBe(2);
    expect(result.misplacedCopies).toHaveLength(0);
  });

  it('find_duplicate_movies detects misplaced copies by title+year in different root folders', async () => {
    const listMovies = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Dune',
        year: 2021,
        tmdbId: 438631,
        path: '/movies/Dune',
        rootFolderPath: '/movies',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: true,
      },
      {
        id: 2,
        title: 'Dune',
        year: 2021,
        tmdbId: 999999,
        path: '/backup/Dune',
        rootFolderPath: '/backup',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: false,
      },
    ]);
    const get = toolsFor({ listMovies });
    const result = (await get('radarr_find_duplicate_movies').handler({})) as {
      total: number;
      exactDuplicates: unknown[];
      misplacedCopies: Array<{ count: number }>;
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(0);
    expect(result.misplacedCopies).toHaveLength(1);
    expect(result.misplacedCopies[0]?.count).toBe(2);
  });

  it('find_duplicate_movies does not flag movies with same title+year in same root folder', async () => {
    const listMovies = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: 'Dune',
        year: 2021,
        tmdbId: 438631,
        path: '/movies/Dune',
        rootFolderPath: '/movies',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: true,
      },
      {
        id: 2,
        title: 'Dune',
        year: 2021,
        tmdbId: 999999,
        path: '/movies/Dune2',
        rootFolderPath: '/movies',
        status: 'released',
        monitored: true,
        qualityProfileId: 1,
        tags: [],
        hasFile: false,
      },
    ]);
    const get = toolsFor({ listMovies });
    const result = (await get('radarr_find_duplicate_movies').handler({})) as {
      total: number;
      exactDuplicates: unknown[];
      misplacedCopies: Array<{ count: number }>;
    };
    expect(result.total).toBe(2);
    expect(result.exactDuplicates).toHaveLength(0);
    expect(result.misplacedCopies).toHaveLength(0);
  });

  it('list_unmapped_folders returns flat array with rootFolderId', async () => {
    const listRootFolders = vi.fn().mockResolvedValue([
      {
        id: 1,
        path: '/movies',
        accessible: true,
        unmappedFolders: [
          { name: 'NewMovie1', path: '/movies/NewMovie1', relativePath: 'NewMovie1' },
          { name: 'NewMovie2', path: '/movies/NewMovie2', relativePath: 'NewMovie2' },
        ],
      },
      {
        id: 2,
        path: '/archive',
        accessible: true,
        unmappedFolders: [{ name: 'OldMovie', path: '/archive/OldMovie', relativePath: 'OldMovie' }],
      },
    ]);
    const get = toolsFor({ listRootFolders });
    const result = (await get('radarr_list_unmapped_folders').handler({})) as Array<{
      rootFolderId: number;
      rootFolderPath: string;
      folderName?: string;
      folderPath?: string;
    }>;
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      rootFolderId: 1,
      rootFolderPath: '/movies',
      folderName: 'NewMovie1',
    });
    expect(result[2]).toMatchObject({
      rootFolderId: 2,
      rootFolderPath: '/archive',
      folderName: 'OldMovie',
    });
  });

  it('import_folder calls runCommand with DownloadedMoviesScan and path', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      id: 42,
      name: 'DownloadedMoviesScan',
      status: 'queued',
    });
    const get = toolsFor({ runCommand });
    const result = (await get('radarr_import_folder').handler({
      path: '/unmapped/NewMovie (2021)',
    })) as unknown as { commandId: number; status: string };
    expect(runCommand).toHaveBeenCalledWith({
      name: 'DownloadedMoviesScan',
      path: '/unmapped/NewMovie (2021)',
    });
    expect(result.commandId).toBe(42);
    expect(result.status).toBe('queued');
  });

  it('import_folder supports importMode parameter', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      id: 43,
      name: 'DownloadedMoviesScan',
      status: 'queued',
    });
    const get = toolsFor({ runCommand });
    await get('radarr_import_folder').handler({
      path: '/unmapped/Movie (2020)',
      importMode: 'Move',
    });
    expect(runCommand).toHaveBeenCalledWith({
      name: 'DownloadedMoviesScan',
      path: '/unmapped/Movie (2020)',
      importMode: 'Move',
    });
  });
});
