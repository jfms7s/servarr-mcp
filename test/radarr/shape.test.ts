import { describe, expect, it } from 'vitest';
import { summarizeMovie, summarizeQueueRecord, summarizeRenamePreview, summarizeUnmappedFolder } from '../../src/radarr/shape.js';
import type { Movie, QueueRecord, RenameMovieResource } from '../../src/radarr/types.js';

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
  genres: ['sci-fi', 'action'],
  originalLanguage: { id: 1, name: 'English' },
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

  it('includes genres and extracts originalLanguage name', () => {
    const summary = summarizeMovie(movie);
    expect(summary.genres).toEqual(['sci-fi', 'action']);
    expect(summary.originalLanguage).toBe('English');
  });

  it('handles missing originalLanguage gracefully', () => {
    const movieNoLang = { ...movie, originalLanguage: undefined };
    const summary = summarizeMovie(movieNoLang);
    expect(summary.originalLanguage).toBeUndefined();
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

  it('copies the movie id', () => {
    const summary = summarizeQueueRecord({ id: 1, movieId: 42, title: 't', status: 's', size: 0, sizeleft: 0 } as QueueRecord);
    expect(summary.movieId).toBe(42);
  });
});

describe('summarizeRenamePreview', () => {
  it('keeps the ids and both paths, nothing else', () => {
    const preview = {
      id: 1,
      movieId: 5,
      movieFileId: 100,
      existingPath: '/old/Dune.mkv',
      newPath: '/new/Dune (2021).mkv',
      extra: 'dropped',
    } as unknown as RenameMovieResource;
    expect(summarizeRenamePreview(preview)).toEqual({
      id: 1,
      movieId: 5,
      movieFileId: 100,
      existingPath: '/old/Dune.mkv',
      newPath: '/new/Dune (2021).mkv',
    });
  });
});

describe('summarizeUnmappedFolder', () => {
  it('flattens the folder with its root folder', () => {
    expect(
      summarizeUnmappedFolder(
        { id: 3, path: '/movies', accessible: true },
        { name: 'Dune', path: '/movies/Dune', relativePath: 'Dune' },
      ),
    ).toEqual({
      rootFolderId: 3,
      rootFolderPath: '/movies',
      folderName: 'Dune',
      folderPath: '/movies/Dune',
      relativePath: 'Dune',
    });
  });
});
