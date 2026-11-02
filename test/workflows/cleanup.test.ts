import { describe, expect, it, vi } from 'vitest';
import type { CleanupClients } from '../../src/workflows/cleanup.js';
import {
  buildCleanupReport,
  createCleanupReportTool,
  parseGuid,
  titleKey,
} from '../../src/workflows/cleanup.js';
import type { TautulliMediaItem } from '../../src/tautulli/types.js';

const NOW = new Date('2026-11-02T00:00:00Z');
const daysAgo = (days: number) => Math.floor(NOW.getTime() / 1000) - days * 86400;
const GIB = 1024 ** 3;

const movie = (id: number, title: string, year: number, tmdbId: number, gb: number) => ({
  id,
  title,
  year,
  tmdbId,
  sizeOnDisk: gb * GIB,
});

function clientsFor(
  movieMedia: TautulliMediaItem[],
  showMedia: TautulliMediaItem[] = [],
  extraMovieMedia?: TautulliMediaItem[],
) {
  const libraries = [
    { section_id: 1, section_name: 'Movies', section_type: 'movie' },
    { section_id: 2, section_name: 'TV', section_type: 'show' },
    { section_id: 3, section_name: 'Music', section_type: 'artist' },
    ...(extraMovieMedia
      ? [{ section_id: 4, section_name: 'Movies 4K', section_type: 'movie' }]
      : []),
  ];
  const tautulli = {
    getLibraries: vi.fn().mockResolvedValue(libraries),
    listLibraryMedia: vi.fn(async (id: number | string) =>
      id === 1 ? movieMedia : id === 2 ? showMedia : id === 4 ? (extraMovieMedia ?? []) : [],
    ),
  };
  const radarr = {
    listMovies: vi
      .fn()
      .mockResolvedValue([
        movie(10, 'Dune', 2021, 438631, 60),
        movie(11, 'Arrival', 2016, 329865, 30),
        movie(12, 'Amélie', 2001, 194, 8),
        movie(13, 'Small Film', 2020, 999, 0.5),
        movie(14, 'Twin', 2010, 501, 5),
        movie(15, 'Twin', 2010, 502, 5),
      ]),
  };
  const sonarr = {
    listSeries: vi.fn().mockResolvedValue([
      {
        id: 20,
        title: 'Andor',
        year: 2022,
        tvdbId: 393189,
        statistics: { sizeOnDisk: 90 * GIB },
      },
    ]),
  };
  return { tautulli, radarr, sonarr };
}

const options = {
  unwatchedDays: 365,
  minSizeGb: 0,
  mediaType: 'all' as const,
  limit: 50,
  now: NOW,
};

describe('parseGuid and titleKey', () => {
  it('reads legacy agent and tmdb:// / tvdb:// guids, and nothing from plex://', () => {
    expect(parseGuid('com.plexapp.agents.themoviedb://438631?lang=en')).toEqual({ tmdb: 438631 });
    expect(parseGuid('com.plexapp.agents.thetvdb://393189?lang=en')).toEqual({ tvdb: 393189 });
    expect(parseGuid('tmdb://5')).toEqual({ tmdb: 5 });
    expect(parseGuid('plex://movie/5d776b59ad5437001f79c6f8')).toEqual({});
    expect(parseGuid(null)).toEqual({});
  });

  it('normalises accents, case and punctuation, and needs a year', () => {
    expect(titleKey('Amélie', 2001)).toBe(titleKey('amelie', 2001));
    expect(titleKey('Tom & Jerry!', 1990)).toBe('tom and jerry|1990');
    expect(titleKey('Dune', undefined)).toBeUndefined();
  });
});

describe('buildCleanupReport', () => {
  it('lists never-played and long-unplayed items, leaves out recent plays, and sorts by size', async () => {
    const clients = clientsFor(
      [
        // never played, guid match
        {
          rating_key: 1,
          title: 'Dune',
          year: '2021',
          guid: 'com.plexapp.agents.themoviedb://438631',
          last_played: null,
          play_count: null,
        },
        // played two years ago, title fallback (plex:// guid)
        {
          rating_key: 2,
          title: 'Amelie',
          year: 2001,
          guid: 'plex://movie/x',
          last_played: daysAgo(730),
          play_count: '3',
        },
        // played last month: excluded
        {
          rating_key: 3,
          title: 'Arrival',
          year: 2016,
          guid: 'plex://movie/y',
          last_played: daysAgo(30),
          play_count: 1,
        },
      ],
      [
        {
          rating_key: 4,
          title: 'Andor',
          year: 2022,
          guid: 'com.plexapp.agents.thetvdb://393189',
          last_played: '',
          play_count: 0,
        },
      ],
    );
    const report = await buildCleanupReport(clients, options);

    expect(report.items.map((row) => [row.arr, row.arrId, row.matchedBy])).toEqual([
      ['sonarr', 20, 'tvdb'],
      ['radarr', 10, 'tmdb'],
      ['radarr', 12, 'title'],
    ]);
    expect(report.items[1]).toMatchObject({
      title: 'Dune',
      lastPlayed: null,
      sizeGb: 60,
      deleteWith: 'radarr_delete_movie',
    });
    expect(report.items[2]).toMatchObject({
      playCount: 3,
      lastPlayed: new Date(daysAgo(730) * 1000).toISOString(),
    });
    expect(report.items[0]?.deleteWith).toBe('sonarr_delete_series');
    expect(report.totalItems).toBe(3);
    expect(report.totalBytes).toBe((90 + 60 + 8) * GIB);
    expect(report.unmatched).toEqual([]);
  });

  it('leaves out items below minSizeGb', async () => {
    const clients = clientsFor([
      { rating_key: 1, title: 'Small Film', year: 2020, guid: 'tmdb://999', last_played: null },
      { rating_key: 2, title: 'Dune', year: 2021, guid: 'tmdb://438631', last_played: null },
    ]);
    const report = await buildCleanupReport(clients, {
      ...options,
      minSizeGb: 1,
      mediaType: 'movie',
    });
    expect(report.items.map((row) => row.arrId)).toEqual([10]);
  });

  it('lists unmatched and ambiguous titles separately and never drops them', async () => {
    const clients = clientsFor([
      {
        rating_key: 1,
        title: 'Not In Radarr',
        year: 1999,
        guid: 'plex://movie/z',
        last_played: null,
      },
      { rating_key: 2, title: 'Twin', year: 2010, guid: 'plex://movie/t', last_played: null },
      { rating_key: 3, title: 'No Year', guid: 'plex://movie/n', last_played: null },
      // unmatched but watched recently: not a cleanup candidate, so not listed
      {
        rating_key: 4,
        title: 'Recent Unknown',
        year: 2024,
        guid: 'plex://movie/r',
        last_played: daysAgo(3),
      },
    ]);
    const report = await buildCleanupReport(clients, { ...options, mediaType: 'movie' });
    expect(report.items).toEqual([]);
    expect(report.unmatchedCount).toBe(3);
    expect(report.unmatched.map((row) => [row.title, row.reason])).toEqual([
      ['Not In Radarr', 'not found in Radarr by id or title and year'],
      ['Twin', 'title and year match more than one item'],
      ['No Year', 'no external id and no year to match the title with'],
    ]);
  });

  it('keeps an item off the list when another Plex copy was played recently', async () => {
    const clients = clientsFor(
      [{ rating_key: 1, title: 'Dune', year: 2021, guid: 'tmdb://438631', last_played: null }],
      [],
      [
        {
          rating_key: 9,
          title: 'Dune',
          year: 2021,
          guid: 'tmdb://438631',
          last_played: daysAgo(2),
          play_count: 1,
        },
      ],
    );
    const report = await buildCleanupReport(clients, { ...options, mediaType: 'movie' });
    expect(report.items).toEqual([]);
  });

  it('skips libraries whose arr is not configured, and honours mediaType', async () => {
    const { tautulli, radarr } = clientsFor([]);
    const report = await buildCleanupReport({ tautulli, radarr }, options);
    expect(report.skipped).toEqual(['TV: Sonarr is not configured']);
    expect(tautulli.listLibraryMedia).toHaveBeenCalledTimes(1);

    const onlyShows = clientsFor([]);
    await buildCleanupReport(onlyShows, { ...options, mediaType: 'show' });
    expect(onlyShows.tautulli.listLibraryMedia).toHaveBeenCalledWith(2);
    expect(onlyShows.radarr.listMovies).not.toHaveBeenCalled();
  });

  it('caps items and unmatched at limit while the totals count everything', async () => {
    const clients = clientsFor([
      { rating_key: 1, title: 'Dune', year: 2021, guid: 'tmdb://438631', last_played: null },
      { rating_key: 2, title: 'Arrival', year: 2016, guid: 'tmdb://329865', last_played: null },
    ]);
    const report = await buildCleanupReport(clients, { ...options, mediaType: 'movie', limit: 1 });
    expect(report.items.map((row) => row.arrId)).toEqual([10]);
    expect(report.totalItems).toBe(2);
    expect(report.totalBytes).toBe(90 * GIB);
  });
});

describe('servarr_media_cleanup_report', () => {
  it('is a read tool that calls only read methods on every client', async () => {
    const calls: string[] = [];
    const spy = <T extends object>(name: string, target: T): T =>
      new Proxy(target, {
        get(object, property) {
          const value = Reflect.get(object, property) as unknown;
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            calls.push(`${name}.${String(property)}`);
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        },
      });
    const { tautulli, radarr, sonarr } = clientsFor([
      { rating_key: 1, title: 'Dune', year: 2021, guid: 'tmdb://438631', last_played: null },
    ]);
    const clients: CleanupClients = {
      tautulli: spy('tautulli', tautulli),
      radarr: spy('radarr', radarr),
      sonarr: spy('sonarr', sonarr),
    };
    const tool = createCleanupReportTool(clients);
    expect(tool.effect).toBe('read');
    const report = (await tool.handler({})) as { unwatchedDays: number; items: unknown[] };
    expect(report.unwatchedDays).toBe(365);
    expect(report.items).toHaveLength(1);
    expect(new Set(calls)).toEqual(
      new Set([
        'tautulli.getLibraries',
        'tautulli.listLibraryMedia',
        'radarr.listMovies',
        'sonarr.listSeries',
      ]),
    );
  });
});
