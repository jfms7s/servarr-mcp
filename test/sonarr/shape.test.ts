import { describe, expect, it } from 'vitest';
import { summarizeEpisode, summarizeQueueRecord, summarizeSeries } from '../../src/sonarr/shape.js';
import type { Episode, QueueRecord, Series } from '../../src/sonarr/types.js';

const series = {
  id: 1,
  title: 'Andor',
  status: 'continuing',
  year: 2022,
  monitored: true,
  qualityProfileId: 4,
  tvdbId: 371980,
  tags: [2],
  path: '/tv/Andor',
  overview: 'A'.repeat(500),
  seasons: [
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: false },
  ],
  statistics: { episodeFileCount: 12, episodeCount: 24, sizeOnDisk: 1024 },
  images: [{ coverType: 'poster', url: 'http://example/poster.jpg' }],
} as unknown as Series;

describe('summarizeSeries', () => {
  it('keeps the identifying and actionable fields', () => {
    const summary = summarizeSeries(series);
    expect(summary).toMatchObject({
      id: 1,
      title: 'Andor',
      year: 2022,
      status: 'continuing',
      monitored: true,
      qualityProfileId: 4,
      tvdbId: 371980,
      path: '/tv/Andor',
      seasonCount: 2,
      episodeFileCount: 12,
      episodeCount: 24,
    });
  });

  it('drops image blobs and truncates a long overview', () => {
    const summary = summarizeSeries(series);
    expect(summary).not.toHaveProperty('images');
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeEpisode', () => {
  it('projects the episode down to identity, air date and file state', () => {
    const episode = {
      id: 10,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'Reckoning',
      airDateUtc: '2022-09-21T00:00:00Z',
      hasFile: true,
      monitored: true,
      overview: 'B'.repeat(500),
    } as Episode;

    const summary = summarizeEpisode(episode);
    expect(summary).toMatchObject({
      id: 10,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'Reckoning',
      hasFile: true,
      monitored: true,
    });
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeQueueRecord', () => {
  it('reports progress and surfaces status messages', () => {
    const record = {
      id: 5,
      title: 'Andor.S01E03',
      status: 'downloading',
      size: 100,
      sizeleft: 25,
      timeleft: '00:10:00',
      trackedDownloadState: 'downloading',
      indexer: 'nzbgeek',
      statusMessages: [{ title: 'warn', messages: ['slow'] }],
    } as QueueRecord;

    const summary = summarizeQueueRecord(record);
    expect(summary).toMatchObject({
      id: 5,
      title: 'Andor.S01E03',
      status: 'downloading',
      timeleft: '00:10:00',
      indexer: 'nzbgeek',
      percentComplete: 75,
    });
    expect(summary.statusMessages).toEqual(['slow']);
  });

  it('reports 0 percent complete when size is unknown', () => {
    const summary = summarizeQueueRecord({ id: 1, title: 't', status: 's', size: 0, sizeleft: 0 } as QueueRecord);
    expect(summary.percentComplete).toBe(0);
  });
});
