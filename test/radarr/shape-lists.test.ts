import { describe, expect, it } from 'vitest';
import {
  summarizeBlocklistRecord,
  summarizeCollection,
  summarizeHistoryRecord,
  summarizeMovieFile,
  summarizeQualityProfile,
  summarizeRelease,
} from '../../src/radarr/shape.js';
import type {
  BlocklistRecord,
  Collection,
  HistoryRecord,
  MovieFile,
  QualityProfile,
  Release,
} from '../../src/radarr/types.js';

describe('summarizeQualityProfile', () => {
  it('drops items[] and formatItems[]', () => {
    const profile = {
      id: 6,
      name: 'Ultra-HD',
      upgradeAllowed: false,
      cutoff: 19,
      items: Array.from({ length: 30 }, (_, index) => ({
        quality: { id: index, name: `Quality ${index}`, resolution: 2160 },
        allowed: false,
      })),
      formatItems: [{ format: 2, name: 'HDR', score: 100 }],
    } as unknown as QualityProfile;

    const result = summarizeQualityProfile(profile);

    expect(Object.keys(result).sort()).toEqual(['cutoff', 'id', 'name', 'upgradeAllowed']);
  });
});

describe('summarizeMovieFile', () => {
  it('drops mediaInfo and reports size in GB', () => {
    const file = {
      id: 40,
      movieId: 12,
      relativePath: 'Dune Part Two (2024) Bluray-2160p.mkv',
      path: '/movies/Dune Part Two (2024)/Dune Part Two (2024) Bluray-2160p.mkv',
      size: 53_687_091_200,
      dateAdded: '2026-04-22T10:00:00Z',
      quality: { quality: { id: 19, name: 'Bluray-2160p' } },
      mediaInfo: { videoCodec: 'x265', audioChannels: 7.1, subtitles: 'English/German' },
      sceneName: 'Dune.Part.Two.2024.2160p.UHD.BluRay',
    } as unknown as MovieFile;

    const result = summarizeMovieFile(file);

    expect(Object.keys(result).sort()).toEqual([
      'dateAdded',
      'id',
      'movieId',
      'quality',
      'relativePath',
      'sizeGb',
    ]);
    expect(result.sizeGb).toBe(50);
    expect(result.quality).toBe('Bluray-2160p');
  });
});

describe('summarizeHistoryRecord', () => {
  it('drops the embedded movie object', () => {
    const record = {
      id: 5,
      movieId: 12,
      sourceTitle: 'Dune.Part.Two.2024.2160p',
      eventType: 'downloadFolderImported',
      date: '2026-04-22T10:00:00Z',
      data: { droppedPath: '/downloads/x' },
      movie: { id: 12, title: 'Dune: Part Two', overview: 'C'.repeat(400) },
    } as unknown as HistoryRecord;

    expect(Object.keys(summarizeHistoryRecord(record)).sort()).toEqual([
      'data',
      'date',
      'eventType',
      'id',
      'movieId',
      'sourceTitle',
    ]);
  });
});

describe('summarizeBlocklistRecord', () => {
  it('drops the embedded movie object', () => {
    const record = {
      id: 3,
      movieId: 12,
      sourceTitle: 'Dune.Part.Two.2024.PROPER',
      date: '2026-04-22T10:00:00Z',
      protocol: 'usenet',
      indexer: 'NZBgeek',
      movie: { id: 12, title: 'Dune: Part Two', images: [{ url: '/x.jpg' }] },
    } as unknown as BlocklistRecord;

    expect(Object.keys(summarizeBlocklistRecord(record)).sort()).toEqual([
      'date',
      'id',
      'indexer',
      'movieId',
      'protocol',
      'sourceTitle',
    ]);
  });
});

describe('summarizeCollection', () => {
  it('reduces each member movie to identity and adds a count', () => {
    const collection = {
      id: 2,
      title: 'Dune Collection',
      tmdbId: 726871,
      monitored: true,
      qualityProfileId: 6,
      rootFolderPath: '/movies',
      movies: [
        {
          tmdbId: 438631,
          title: 'Dune',
          monitored: true,
          overview: 'D'.repeat(400),
          images: [{ coverType: 'poster', url: '/x.jpg' }],
          ratings: { tmdb: { votes: 1000, value: 7.8 } },
        },
        { tmdbId: 693134, title: 'Dune: Part Two', monitored: false, overview: 'E'.repeat(400) },
      ],
    } as unknown as Collection;

    const result = summarizeCollection(collection);

    expect(result.movieCount).toBe(2);
    expect(result.movies?.[0]).toEqual({ tmdbId: 438631, title: 'Dune', monitored: true });
    expect(JSON.stringify(result)).not.toContain('poster');
    expect(JSON.stringify(result)).not.toContain('DDDD');
  });

  it('reports zero members when the collection has no movies array', () => {
    const collection = { id: 3, title: 'Empty', tmdbId: 1, monitored: false } as Collection;
    expect(summarizeCollection(collection).movieCount).toBe(0);
  });
});

describe('summarizeRelease', () => {
  it('keeps verbatim rejections and returns exact key set', () => {
    // Raw release payloads are ~5 KB each, and rejections are kept verbatim
    // because they are the exact reasons Radarr declines a release.
    const release = {
      guid: 'abc-123-def',
      title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265',
      indexerId: 2,
      indexer: 'My Indexer',
      size: 53_687_091_200,
      age: 7,
      protocol: 'torrent',
      seeders: 42,
      leechers: 5,
      releaseGroup: 'GROUP',
      edition: 'Extended',
      languages: [{ id: 1, name: 'English' }, { id: 3, name: 'German' }],
      quality: { quality: { id: 19, name: 'Bluray-2160p' } },
      customFormatScore: 95,
      approved: false,
      rejections: [
        'Existing file meets cutoff: Bluray-1080p',
        'Custom format score (95) is below required score (100)',
      ],
      downloadUrl: 'https://example.com/download',
      infoUrl: 'https://example.com/info',
    } as unknown as Release;

    const result = summarizeRelease(release, 1);

    expect(Object.keys(result).sort()).toEqual([
      'ageDays',
      'approved',
      'customFormatScore',
      'edition',
      'guid',
      'indexer',
      'indexerId',
      'languages',
      'leechers',
      'protocol',
      'quality',
      'rank',
      'rejections',
      'releaseGroup',
      'seeders',
      'sizeGb',
      'title',
    ]);
    expect(result.rank).toBe(1);
    expect(result.sizeGb).toBe(50);
    expect(result.ageDays).toBe(7);
    expect(result.quality).toBe('Bluray-2160p');
    expect(result.languages).toEqual(['English', 'German']);
    expect(result.rejections).toEqual([
      'Existing file meets cutoff: Bluray-1080p',
      'Custom format score (95) is below required score (100)',
    ]);
  });

  it('returns empty arrays when optional fields are absent', () => {
    const release = {
      guid: 'xyz-789',
      title: 'Movie.2024.1080p',
      indexerId: 1,
      indexer: 'Indexer',
      size: 5368709120,
      age: 3,
      protocol: 'torrent',
      approved: true,
    } as Release;

    const result = summarizeRelease(release, 2);

    expect(result.languages).toEqual([]);
    expect(result.rejections).toEqual([]);
    expect(result.seeders).toBeUndefined();
    expect(result.leechers).toBeUndefined();
    expect(result.quality).toBeUndefined();
  });
});
