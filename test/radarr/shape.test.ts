import { describe, expect, it } from 'vitest';
import { summarizeMovie, summarizeQueueRecord } from '../../src/radarr/shape.js';
import type { Movie, QueueRecord } from '../../src/radarr/types.js';

const movie = {
  id: 1,
  title: 'Dune',
  year: 2021,
  status: 'released',
  monitored: true,
  qualityProfileId: 3,
  tmdbId: 438631,
  imdbId: 'tt1160419',
  tags: [],
  hasFile: true,
  sizeOnDisk: 2048,
  path: '/movies/Dune',
  runtime: 155,
  overview: 'C'.repeat(500),
  ratings: { tmdb: { value: 7.8 } },
  images: [{ coverType: 'poster', url: 'http://example/p.jpg' }],
} as unknown as Movie;

describe('summarizeMovie', () => {
  it('keeps identifying and actionable fields', () => {
    expect(summarizeMovie(movie)).toMatchObject({
      id: 1,
      title: 'Dune',
      year: 2021,
      status: 'released',
      monitored: true,
      hasFile: true,
      qualityProfileId: 3,
      tmdbId: 438631,
      imdbId: 'tt1160419',
      path: '/movies/Dune',
      runtime: 155,
      sizeOnDisk: 2048,
    });
  });

  it('drops image blobs and truncates a long overview', () => {
    const summary = summarizeMovie(movie);
    expect(summary).not.toHaveProperty('images');
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeQueueRecord', () => {
  it('computes percent complete', () => {
    const summary = summarizeQueueRecord({
      id: 1,
      title: 'Dune.2021',
      status: 'downloading',
      size: 200,
      sizeleft: 50,
    } as QueueRecord);
    expect(summary.percentComplete).toBe(75);
  });
});
