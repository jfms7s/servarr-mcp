import { describe, expect, it, vi } from 'vitest';
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
  it('registers all 24 tools with unique radarr_ prefixed names', () => {
    const names = createRadarrTools({} as RadarrClient).map((t) => t.name);
    expect(names).toHaveLength(24);
    expect(names.every((n) => n.startsWith('radarr_'))).toBe(true);
    expect(new Set(names).size).toBe(24);
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
    const shape = tool?.inputSchema as { name: { parse: (v: unknown) => unknown } };
    expect(() => shape.name.parse('MoviesSearch')).not.toThrow();
    expect(() => shape.name.parse('Nope')).toThrow();
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
});
