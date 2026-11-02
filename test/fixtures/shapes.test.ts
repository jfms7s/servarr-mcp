// Runs the OpenAPI-generated fixtures through the summarisers. Every property the upstream
// schema declares is set in a fixture, so an undefined summary field means the code reads
// a name upstream does not declare (or declares elsewhere). Regenerate the fixtures with
// scripts/fixtures/generate.mjs when an upstream spec changes.
import { describe, expect, it } from 'vitest';
import { summarizeMediaRequest, summarizeMovieDetails } from '../../src/overseerr/shape.js';
import type { MediaRequest, MovieDetails } from '../../src/overseerr/types.js';
import { summarizeIndexer, summarizeIndexerDetail } from '../../src/prowlarr/shape.js';
import type { Indexer } from '../../src/prowlarr/types.js';
import * as radarr from '../../src/radarr/shape.js';
import type { Movie, QueueRecord as RadarrQueueRecord } from '../../src/radarr/types.js';
import * as sonarr from '../../src/sonarr/shape.js';
import type { Episode, QueueRecord as SonarrQueueRecord, Series } from '../../src/sonarr/types.js';
import { loadFixture, undefinedKeys } from './load.js';

function expectFullyMapped<T>(
  records: T[],
  summarize: (record: T) => object,
  undeclared: string[] = [],
) {
  expect(records.length).toBeGreaterThan(1);
  for (const record of records) expect(undefinedKeys(summarize(record))).toEqual(undeclared);
}

describe('Radarr fixtures (MovieResource, QueueResource)', () => {
  const movies = loadFixture<Movie>('radarr', 'movie');
  const queue = loadFixture<RadarrQueueRecord>('radarr', 'queue');

  it('fill every field of the movie list summary', () => {
    expectFullyMapped(movies, (movie) => radarr.summarizeMovie(movie));
  });

  it('fill every field of the movie detail', () => {
    expectFullyMapped(movies, radarr.summarizeMovieDetail);
  });

  it('declare both path and rootFolderPath, which the filters and duplicate finder read', () => {
    for (const movie of movies) {
      expect(typeof movie.path).toBe('string');
      expect(typeof movie.rootFolderPath).toBe('string');
    }
  });

  it('fill every field of the queue summary', () => {
    expectFullyMapped(queue, radarr.summarizeQueueRecord);
  });
});

describe('Sonarr fixtures (SeriesResource, EpisodeResource, QueueResource)', () => {
  const series = loadFixture<Series>('sonarr', 'series');
  const episodes = loadFixture<Episode>('sonarr', 'episode');
  const queue = loadFixture<SonarrQueueRecord>('sonarr', 'queue');

  it('fill every field of the series list summary', () => {
    expectFullyMapped(series, (record) => sonarr.summarizeSeries(record));
  });

  it('fill every field of the series detail', () => {
    expectFullyMapped(series, sonarr.summarizeSeriesDetail);
  });

  it('declare both path and rootFolderPath', () => {
    for (const record of series) {
      expect(typeof record.path).toBe('string');
      expect(typeof record.rootFolderPath).toBe('string');
    }
  });

  it('fill every field of the episode summary and detail', () => {
    expectFullyMapped(episodes, (episode) => sonarr.summarizeEpisode(episode));
    expectFullyMapped(episodes, sonarr.summarizeEpisodeDetail);
  });

  it('fill every field of the queue summary', () => {
    expectFullyMapped(queue, sonarr.summarizeQueueRecord);
  });
});

describe('Prowlarr fixtures (IndexerResource)', () => {
  const indexers = loadFixture<Indexer>('prowlarr', 'indexer');

  it('fill every field of the indexer summary and detail', () => {
    expectFullyMapped(indexers, summarizeIndexer);
    expectFullyMapped(indexers, summarizeIndexerDetail);
  });
});

describe('Overseerr/Seerr fixtures (MediaRequest, MovieDetails)', () => {
  it('fill every field of the request summary', () => {
    // seerr-api.yml's MediaRequest schema leaves out `seasons`, but the server sends it:
    // server/entity/MediaRequest.ts declares `public seasons: SeasonRequest[]` (v3.5.1).
    // Any other missing field fails here.
    expectFullyMapped(loadFixture<MediaRequest>('overseerr', 'request'), summarizeMediaRequest, [
      'seasons',
    ]);
  });

  it('fill every field of the movie details summary', () => {
    expectFullyMapped(loadFixture<MovieDetails>('overseerr', 'movie'), summarizeMovieDetails);
  });
});
