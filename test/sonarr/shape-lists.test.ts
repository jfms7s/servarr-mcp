import { describe, expect, it } from 'vitest';
import {
  summarizeBlocklistRecord,
  summarizeEpisodeFile,
  summarizeHistoryRecord,
  summarizeQualityProfile,
  summarizeRelease,
} from '../../src/sonarr/shape.js';
import type {
  BlocklistRecord,
  EpisodeFile,
  HistoryRecord,
  QualityProfile,
  Release,
} from '../../src/sonarr/types.js';

// Each fixture below carries the fields we want PLUS the bulky ones Sonarr
// really sends. A shaping function that returns its input unchanged -- which
// is what these tools did before -- passes any assertion about the wanted
// fields being present. Only asserting the exact key set catches it, so that
// is what every test here does.

describe('summarizeQualityProfile', () => {
  it('drops items[] and formatItems[], the reason this shaping exists', () => {
    const profile = {
      id: 4,
      name: 'HD-1080p',
      upgradeAllowed: true,
      cutoff: 9,
      // Sonarr sends one entry per known quality, each with nested children.
      items: Array.from({ length: 24 }, (_, index) => ({
        quality: { id: index, name: `Quality ${index}`, source: 'web', resolution: 1080 },
        allowed: index % 2 === 0,
        items: [],
      })),
      formatItems: [{ format: 1, name: 'Surround Sound', score: 50 }],
      minFormatScore: 0,
      cutoffFormatScore: 0,
    } as unknown as QualityProfile;

    const result = summarizeQualityProfile(profile);

    expect(Object.keys(result).sort()).toEqual(['cutoff', 'id', 'name', 'upgradeAllowed']);
    expect(result).toEqual({ id: 4, name: 'HD-1080p', upgradeAllowed: true, cutoff: 9 });
  });
});

describe('summarizeEpisodeFile', () => {
  it('drops mediaInfo and keeps the quality name rather than the nested object', () => {
    const file = {
      id: 77,
      seriesId: 1,
      seasonNumber: 2,
      relativePath: 'Season 02/andor.s02e01.mkv',
      path: '/tv/Andor/Season 02/andor.s02e01.mkv',
      size: 3_221_225_472,
      dateAdded: '2026-04-22T10:00:00Z',
      quality: { quality: { id: 9, name: 'WEBDL-1080p' }, revision: { version: 1, real: 0 } },
      mediaInfo: {
        audioBitrate: 640000,
        audioChannels: 5.1,
        audioCodec: 'EAC3',
        videoCodec: 'x265',
        videoBitDepth: 10,
        runTime: '46:12',
        scanType: 'Progressive',
        subtitles: 'English/Spanish/French',
      },
      sceneName: 'Andor.S02E01.2160p.WEB-DL',
      releaseGroup: 'NTb',
    } as unknown as EpisodeFile;

    const result = summarizeEpisodeFile(file);

    expect(Object.keys(result).sort()).toEqual([
      'dateAdded',
      'id',
      'quality',
      'relativePath',
      'seasonNumber',
      'seriesId',
      'sizeGb',
    ]);
    expect(result.quality).toBe('WEBDL-1080p');
    expect(result.sizeGb).toBe(3);
  });

  it('survives a file with no quality block', () => {
    const file = {
      id: 78,
      seriesId: 1,
      seasonNumber: 1,
      relativePath: 'x.mkv',
      path: '/tv/x.mkv',
      size: 0,
      dateAdded: '2026-04-22T10:00:00Z',
    } as EpisodeFile;

    expect(summarizeEpisodeFile(file).quality).toBeUndefined();
  });
});

describe('summarizeHistoryRecord', () => {
  it('drops the embedded series and episode objects', () => {
    const record = {
      id: 5,
      episodeId: 12,
      seriesId: 1,
      sourceTitle: 'Andor.S02E01.1080p.WEB-DL',
      eventType: 'downloadFolderImported',
      date: '2026-04-22T10:00:00Z',
      data: { droppedPath: '/downloads/x', importedPath: '/tv/x' },
      series: { id: 1, title: 'Andor', images: [{ coverType: 'poster', url: '/x.jpg' }] },
      episode: { id: 12, title: 'Ep', overview: 'B'.repeat(400) },
      quality: { quality: { id: 9, name: 'WEBDL-1080p' } },
    } as unknown as HistoryRecord;

    const result = summarizeHistoryRecord(record);

    expect(Object.keys(result).sort()).toEqual([
      'data',
      'date',
      'episodeId',
      'eventType',
      'id',
      'seriesId',
      'sourceTitle',
    ]);
    expect(result.data).toEqual({ droppedPath: '/downloads/x', importedPath: '/tv/x' });
  });
});

describe('summarizeBlocklistRecord', () => {
  it('drops the embedded series object', () => {
    const record = {
      id: 3,
      seriesId: 1,
      sourceTitle: 'Andor.S02E01.PROPER',
      date: '2026-04-22T10:00:00Z',
      protocol: 'torrent',
      indexer: 'Nyaa',
      series: { id: 1, title: 'Andor', seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }] },
      quality: { quality: { id: 9, name: 'WEBDL-1080p' } },
      languages: [{ id: 1, name: 'English' }],
    } as unknown as BlocklistRecord;

    const result = summarizeBlocklistRecord(record);

    expect(Object.keys(result).sort()).toEqual([
      'date',
      'id',
      'indexer',
      'protocol',
      'seriesId',
      'sourceTitle',
    ]);
  });
});

describe('summarizeRelease', () => {
  it('keeps rejections verbatim and reshapes languages, quality, and sizeGb', () => {
    const release = {
      guid: 'abc123',
      title: 'Series.S01E01.1080p.WEB-DL',
      indexerId: 2,
      indexer: 'TorrentSite',
      size: 5_368_709_120,
      age: 3,
      protocol: 'torrent',
      seeders: 45,
      leechers: 12,
      releaseGroup: 'GROUP',
      languages: [{ id: 1, name: 'English' }],
      quality: { quality: { id: 9, name: 'WEBDL-1080p' } },
      customFormatScore: 50,
      approved: true,
      rejections: ['Not an upgrade', 'Already in queue'],
      fullSeason: false,
      seasonNumber: 1,
      // Extraneous fields that should be dropped
      extraField: 'should not appear',
    } as unknown as Release;

    const result = summarizeRelease(release, 1);

    expect(Object.keys(result).sort()).toEqual([
      'ageDays',
      'approved',
      'customFormatScore',
      'fullSeason',
      'guid',
      'indexer',
      'indexerId',
      'leechers',
      'protocol',
      'quality',
      'rank',
      'rejections',
      'releaseGroup',
      'seeders',
      'sizeGb',
      'title',
      'languages',
    ].sort());
    expect(result.sizeGb).toBe(5);
    expect(result.quality).toBe('WEBDL-1080p');
    expect(result.languages).toEqual(['English']);
    expect(result.rejections).toEqual(['Not an upgrade', 'Already in queue']);
  });
});
