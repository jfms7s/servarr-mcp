import { describe, expect, it, vi } from 'vitest';
import type { SonarrClient } from '../../src/sonarr/client.js';
import { summarizeEpisode, summarizeSeries } from '../../src/sonarr/shape.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

function toolsFor(overrides: Partial<SonarrClient>) {
  const tools = createSonarrTools(overrides as SonarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

const series = (id: number) => ({
  id,
  title: `Show ${id}`,
  year: 2020,
  status: 'continuing',
  monitored: true,
  qualityProfileId: 1,
  tvdbId: 100 + id,
  tags: [],
  seasons: [],
  overview: 'A plot summary.',
});

const episode = (id: number) => ({
  id,
  seriesId: 1,
  seasonNumber: 1,
  episodeNumber: id,
  title: `Episode ${id}`,
  hasFile: false,
  monitored: true,
  overview: 'An episode plot.',
});

const episodeFile = (id: number) => ({
  id,
  seriesId: 1,
  seasonNumber: 1,
  relativePath: `S01E${id}.mkv`,
  size: 1024 ** 3,
  dateAdded: '2026-01-01T00:00:00Z',
});

const range = <T>(n: number, make: (id: number) => T) => Array.from({ length: n }, (_, i) => make(i + 1));

describe('Sonarr summarisers', () => {
  it('keep the overview by default and drop it with overview: false', () => {
    expect(summarizeSeries(series(1) as never).overview).toBe('A plot summary.');
    expect(summarizeSeries(series(1) as never, { overview: false })).not.toHaveProperty('overview');
    expect(summarizeEpisode(episode(1) as never).overview).toBe('An episode plot.');
    expect(summarizeEpisode(episode(1) as never, { overview: false })).not.toHaveProperty('overview');
  });
});

describe('Sonarr list tools leave overview out by default', () => {
  it('sonarr_list_series omits overview unless includeOverview is true', async () => {
    const get = toolsFor({ listSeries: vi.fn().mockResolvedValue([series(1)]) });
    const plain = (await get('sonarr_list_series').handler({})) as { series: object[] };
    expect(plain.series[0]).not.toHaveProperty('overview');
    const withOverview = (await get('sonarr_list_series').handler({ includeOverview: true })) as {
      series: Array<{ overview?: string }>;
    };
    expect(withOverview.series[0]?.overview).toBe('A plot summary.');
  });

  it('sonarr_list_episodes omits overview unless includeOverview is true', async () => {
    const get = toolsFor({ listEpisodes: vi.fn().mockResolvedValue([episode(1)]) });
    const plain = (await get('sonarr_list_episodes').handler({ seriesId: 1 })) as { episodes: object[] };
    expect(plain.episodes[0]).not.toHaveProperty('overview');
    const withOverview = (await get('sonarr_list_episodes').handler({ seriesId: 1, includeOverview: true })) as {
      episodes: Array<{ overview?: string }>;
    };
    expect(withOverview.episodes[0]?.overview).toBe('An episode plot.');
  });

  it('sonarr_get_calendar omits overview', async () => {
    const get = toolsFor({ getCalendar: vi.fn().mockResolvedValue([episode(1)]) });
    const result = (await get('sonarr_get_calendar').handler({})) as { episodes: object[] };
    expect(result.episodes[0]).not.toHaveProperty('overview');
  });

  it('sonarr_get_wanted_missing omits overview', async () => {
    const getWantedMissing = vi
      .fn()
      .mockResolvedValue({ page: 1, pageSize: 20, totalRecords: 1, records: [episode(1)] });
    const get = toolsFor({ getWantedMissing });
    const result = (await get('sonarr_get_wanted_missing').handler({})) as { records: object[] };
    expect(result.records[0]).not.toHaveProperty('overview');
  });

  it('sonarr_bulk_edit_series omits overview', async () => {
    const get = toolsFor({ bulkEditSeries: vi.fn().mockResolvedValue([series(1)]) });
    const result = (await get('sonarr_bulk_edit_series').handler({ seriesIds: [1], monitored: true })) as {
      series: object[];
    };
    expect(result.series[0]).not.toHaveProperty('overview');
  });

  it('sonarr_monitor_episodes omits overview', async () => {
    const get = toolsFor({ monitorEpisodes: vi.fn().mockResolvedValue([episode(1)]) });
    const result = (await get('sonarr_monitor_episodes').handler({ episodeIds: [1], monitored: true })) as object[];
    expect(result[0]).not.toHaveProperty('overview');
  });

  it('sonarr_lookup_series keeps overview', async () => {
    const get = toolsFor({ lookupSeries: vi.fn().mockResolvedValue([series(1)]) });
    const result = (await get('sonarr_lookup_series').handler({ term: 'show' })) as Array<{ overview?: string }>;
    expect(result[0]?.overview).toBe('A plot summary.');
  });
});

describe('Sonarr unbounded lists are paged', () => {
  const cases = [
    {
      tool: 'sonarr_list_episodes',
      key: 'episodes',
      args: { seriesId: 1 },
      client: { listEpisodes: vi.fn().mockResolvedValue(range(150, episode)) },
    },
    {
      tool: 'sonarr_list_episode_files',
      key: 'files',
      args: { seriesId: 1 },
      client: { listEpisodeFiles: vi.fn().mockResolvedValue(range(150, episodeFile)) },
    },
    {
      tool: 'sonarr_get_calendar',
      key: 'episodes',
      args: {},
      client: { getCalendar: vi.fn().mockResolvedValue(range(150, episode)) },
    },
  ] as const;

  for (const { tool, key, args, client } of cases) {
    it(`${tool} defaults to 100 rows and reports totalMatched`, async () => {
      const get = toolsFor(client as Partial<SonarrClient>);
      const result = (await get(tool).handler({ ...args })) as Record<string, unknown>;
      expect(result).toMatchObject({ totalMatched: 150, offset: 0, limit: 100 });
      const rows = result[key] as Array<{ id: number }>;
      expect(rows).toHaveLength(100);
      expect(rows[0]?.id).toBe(1);
    });

    it(`${tool} respects limit and offset`, async () => {
      const get = toolsFor(client as Partial<SonarrClient>);
      const result = (await get(tool).handler({ ...args, limit: 20, offset: 140 })) as Record<string, unknown>;
      expect(result).toMatchObject({ totalMatched: 150, offset: 140, limit: 20 });
      const rows = result[key] as Array<{ id: number }>;
      expect(rows.map((r) => r.id)).toEqual(range(10, (i) => 140 + i));
    });
  }
});
