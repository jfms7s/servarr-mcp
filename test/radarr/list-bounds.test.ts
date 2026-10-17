import { describe, expect, it, vi } from 'vitest';
import type { RadarrClient } from '../../src/radarr/client.js';
import { summarizeMovie } from '../../src/radarr/shape.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

function toolsFor(overrides: Partial<RadarrClient>) {
  const tools = createRadarrTools(overrides as RadarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

const movie = (id: number) => ({
  id,
  title: `Movie ${id}`,
  year: 2021,
  status: 'released',
  monitored: true,
  hasFile: false,
  qualityProfileId: 1,
  tmdbId: 1000 + id,
  tags: [],
  overview: 'A plot summary.',
});

const range = <T>(n: number, make: (id: number) => T) => Array.from({ length: n }, (_, i) => make(i + 1));

describe('summarizeMovie', () => {
  it('keeps the overview by default and drops it with overview: false', () => {
    expect(summarizeMovie(movie(1) as never).overview).toBe('A plot summary.');
    expect(summarizeMovie(movie(1) as never, { overview: false })).not.toHaveProperty('overview');
  });
});

describe('Radarr list tools leave overview out by default', () => {
  it('radarr_list_movies omits overview unless includeOverview is true', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockResolvedValue([movie(1)]) });
    const plain = (await get('radarr_list_movies').handler({})) as { movies: object[] };
    expect(plain.movies[0]).not.toHaveProperty('overview');
    const withOverview = (await get('radarr_list_movies').handler({ includeOverview: true })) as {
      movies: Array<{ overview?: string }>;
    };
    expect(withOverview.movies[0]?.overview).toBe('A plot summary.');
  });

  it('radarr_get_calendar omits overview', async () => {
    const get = toolsFor({ getCalendar: vi.fn().mockResolvedValue([movie(1)]) });
    const result = (await get('radarr_get_calendar').handler({})) as { movies: object[] };
    expect(result.movies[0]).not.toHaveProperty('overview');
  });

  it('radarr_get_wanted_missing omits overview', async () => {
    const getWantedMissing = vi
      .fn()
      .mockResolvedValue({ page: 1, pageSize: 20, totalRecords: 1, records: [movie(1)] });
    const get = toolsFor({ getWantedMissing });
    const result = (await get('radarr_get_wanted_missing').handler({})) as { records: object[] };
    expect(result.records[0]).not.toHaveProperty('overview');
  });

  it('radarr_bulk_edit_movies omits overview', async () => {
    const get = toolsFor({ bulkEditMovies: vi.fn().mockResolvedValue([movie(1)]) });
    const result = (await get('radarr_bulk_edit_movies').handler({ movieIds: [1], monitored: true })) as {
      movies: object[];
    };
    expect(result.movies[0]).not.toHaveProperty('overview');
  });

  it('radarr_lookup_movie keeps overview', async () => {
    const get = toolsFor({ lookupMovie: vi.fn().mockResolvedValue([movie(1)]) });
    const result = (await get('radarr_lookup_movie').handler({ term: 'movie' })) as Array<{ overview?: string }>;
    expect(result[0]?.overview).toBe('A plot summary.');
  });
});

describe('radarr_get_calendar is paged', () => {
  it('defaults to 100 rows and reports totalMatched', async () => {
    const get = toolsFor({ getCalendar: vi.fn().mockResolvedValue(range(150, movie)) });
    const result = (await get('radarr_get_calendar').handler({})) as {
      totalMatched: number;
      offset: number;
      limit: number;
      movies: Array<{ id: number }>;
    };
    expect(result).toMatchObject({ totalMatched: 150, offset: 0, limit: 100 });
    expect(result.movies).toHaveLength(100);
  });

  it('respects limit and offset', async () => {
    const get = toolsFor({ getCalendar: vi.fn().mockResolvedValue(range(150, movie)) });
    const result = (await get('radarr_get_calendar').handler({ limit: 20, offset: 140 })) as {
      totalMatched: number;
      movies: Array<{ id: number }>;
    };
    expect(result).toMatchObject({ totalMatched: 150, offset: 140, limit: 20 });
    expect(result.movies.map((m) => m.id)).toEqual(range(10, (i) => 140 + i));
  });
});
