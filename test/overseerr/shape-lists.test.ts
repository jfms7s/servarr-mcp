import { describe, expect, it } from 'vitest';
import {
  summarizeMediaInfo,
  summarizeMediaRequest,
  summarizeMovieDetails,
  summarizeSearchResult,
  summarizeTvDetails,
  summarizeUser,
  summarizePersonDetails,
  summarizeCreditRole,
} from '../../src/overseerr/shape.js';
import type {
  CreditRole,
  MediaInfo,
  MediaRequest,
  MovieDetails,
  OverseerrUser,
  PersonDetails,
  SearchResult,
  TvDetails,
} from '../../src/overseerr/types.js';

describe('summarizeSearchResult', () => {
  it('drops bulky fields and truncates overview', () => {
    const result = {
      id: 550,
      mediaType: 'movie',
      title: 'Fight Club',
      overview: 'A'.repeat(400),
      posterPath: '/path.jpg',
      releaseDate: '1999-10-15',
      voteAverage: 8.8,
      popularity: 15.5,
      mediaInfo: { id: 550, status: 5 },
      externalIds: { imdb: 'tt0137523' },
      spokenLanguages: ['en'],
      runtime: 139,
    } as unknown as SearchResult;

    const summary = summarizeSearchResult(result);

    expect(Object.keys(summary).sort()).toEqual([
      'firstAirDate',
      'id',
      'mediaInfo',
      'mediaType',
      'name',
      'overview',
      'popularity',
      'posterPath',
      'releaseDate',
      'title',
      'voteAverage',
    ]);
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
    expect(JSON.stringify(summary)).not.toContain('externalIds');
  });
});

describe('summarizeMediaInfo', () => {
  it('drops requests array and keeps counts', () => {
    const media = {
      id: 550,
      tmdbId: 550,
      status: 5,
      requests: [{ id: 1, status: 2 }, { id: 2, status: 2 }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-15T00:00:00Z',
    } as unknown as MediaInfo;

    const summary = summarizeMediaInfo(media);

    expect(Object.keys(summary).sort()).toEqual([
      'id',
      'requestCount',
      'status',
      'tmdbId',
      'tvdbId',
      'updatedAt',
    ]);
    expect(summary.requestCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain('requests');
  });

  it('handles missing requests array', () => {
    const media = {
      id: 550,
      status: 5,
    } as unknown as MediaInfo;

    const summary = summarizeMediaInfo(media);

    expect(summary.requestCount).toBe(0);
  });
});

describe('summarizeMovieDetails', () => {
  it('drops productionCompanies and popularity', () => {
    const movie = {
      id: 550,
      title: 'Fight Club',
      overview: 'B'.repeat(350),
      releaseDate: '1999-10-15',
      runtime: 139,
      posterPath: '/path.jpg',
      voteAverage: 8.8,
      voteCount: 20000,
      genres: [{ id: 18, name: 'Drama' }],
      mediaInfo: { id: 550, status: 5 },
      productionCompanies: [{ id: 1, name: 'Fox' }],
      popularity: 15.5,
      budget: 63000000,
    } as unknown as MovieDetails;

    const summary = summarizeMovieDetails(movie);

    expect(Object.keys(summary).sort()).toEqual([
      'backdropPath',
      'genres',
      'id',
      'imdbId',
      'mediaInfo',
      'originalTitle',
      'overview',
      'posterPath',
      'releaseDate',
      'runtime',
      'status',
      'tagline',
      'title',
      'voteAverage',
      'voteCount',
    ]);
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
    expect(JSON.stringify(summary)).not.toContain('productionCompanies');
    expect(JSON.stringify(summary)).not.toContain('popularity');
    expect(JSON.stringify(summary)).not.toContain('budget');
  });
});

describe('summarizeTvDetails', () => {
  it('drops networks and popularity', () => {
    const tv = {
      id: 1399,
      name: 'Breaking Bad',
      overview: 'C'.repeat(350),
      firstAirDate: '2008-01-20',
      lastAirDate: '2013-09-29',
      numberOfEpisodes: 62,
      numberOfSeasons: 5,
      posterPath: '/path.jpg',
      voteAverage: 9.5,
      voteCount: 10000,
      genres: [{ id: 80, name: 'Crime' }],
      seasons: [
        { id: 1, seasonNumber: 1, name: 'Season 1', episodeCount: 7 },
        { id: 2, seasonNumber: 2, name: 'Season 2', episodeCount: 13 },
      ],
      mediaInfo: { id: 1399, status: 5 },
      networks: [{ id: 1, name: 'AMC' }],
      popularity: 50.0,
      originCountry: ['US'],
    } as unknown as TvDetails;

    const summary = summarizeTvDetails(tv);

    expect(Object.keys(summary).sort()).toEqual([
      'backdropPath',
      'firstAirDate',
      'genres',
      'id',
      'lastAirDate',
      'mediaInfo',
      'name',
      'numberOfEpisodes',
      'numberOfSeasons',
      'originalName',
      'overview',
      'posterPath',
      'seasons',
      'status',
      'tagline',
      'voteAverage',
      'voteCount',
    ]);
    expect(summary.seasons).toHaveLength(2);
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
    expect(JSON.stringify(summary)).not.toContain('networks');
    expect(JSON.stringify(summary)).not.toContain('popularity');
    expect(JSON.stringify(summary)).not.toContain('originCountry');
  });
});

describe('summarizeMediaRequest', () => {
  it('drops modifiedBy, serverId, and profileId', () => {
    const request = {
      id: 101,
      status: 2,
      media: { id: 550, status: 5 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-15T00:00:00Z',
      requestedBy: { id: 1, username: 'alice', displayName: 'Alice' },
      modifiedBy: { id: 2, username: 'bob' },
      is4k: false,
      serverId: 1,
      profileId: 2,
      rootFolder: '/media',
      seasons: [{ id: 1, seasonNumber: 1 }],
    } as unknown as MediaRequest;

    const summary = summarizeMediaRequest(request);

    expect(Object.keys(summary).sort()).toEqual([
      'createdAt',
      'id',
      'is4k',
      'media',
      'requestedBy',
      'rootFolder',
      'seasons',
      'status',
      'updatedAt',
    ]);
    expect(summary.requestedBy).toEqual({
      id: 1,
      username: 'alice',
      displayName: 'Alice',
    });
    expect(JSON.stringify(summary)).not.toContain('modifiedBy');
    expect(JSON.stringify(summary)).not.toContain('serverId');
    expect(JSON.stringify(summary)).not.toContain('profileId');
  });

  it('handles missing media gracefully (orphaned request)', () => {
    const request = {
      id: 102,
      status: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-15T00:00:00Z',
      requestedBy: { id: 1, username: 'alice', displayName: 'Alice' },
    } as unknown as MediaRequest;

    const summary = summarizeMediaRequest(request);

    expect(summary.id).toBe(102);
    expect(summary.status).toBe(2);
    expect(summary.media).toBeUndefined();
    expect(Object.keys(summary).sort()).toEqual([
      'createdAt',
      'id',
      'is4k',
      'media',
      'requestedBy',
      'rootFolder',
      'seasons',
      'status',
      'updatedAt',
    ]);
  });
});

describe('summarizeUser', () => {
  it('drops plexUsername', () => {
    const user = {
      id: 1,
      email: 'alice@example.com',
      username: 'alice',
      displayName: 'Alice',
      plexUsername: 'alice_plex',
      permissions: 0,
      requestCount: 5,
      createdAt: '2025-01-01T00:00:00Z',
      avatar: 'https://example.com/avatar.jpg',
    } as unknown as OverseerrUser;

    const summary = summarizeUser(user);

    expect(Object.keys(summary).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'id',
      'permissions',
      'requestCount',
      'username',
    ]);
    expect(JSON.stringify(summary)).not.toContain('plexUsername');
    expect(JSON.stringify(summary)).not.toContain('avatar');
  });
});

describe('summarizePersonDetails', () => {
  it('drops alsoKnownAs, popularity, adult, and homepage; truncates biography', () => {
    const person = {
      id: 1,
      name: 'Brad Pitt',
      biography: 'D'.repeat(350),
      knownForDepartment: 'Acting',
      deathday: '2026-12-18',
      placeOfBirth: 'Springfield, Missouri, USA',
      profilePath: '/path.jpg',
      imdbId: 'nm0000199',
      alsoKnownAs: ['Brad William Pitt', 'Bradley William Pitt'],
      popularity: 100.5,
      adult: false,
      homepage: 'https://bradpitt.com',
      gender: '2',
    } as unknown as PersonDetails;

    const summary = summarizePersonDetails(person);

    expect(Object.keys(summary).sort()).toEqual([
      'biography',
      'deathday',
      'id',
      'imdbId',
      'knownForDepartment',
      'name',
      'placeOfBirth',
      'profilePath',
    ]);
    expect(summary.biography?.length).toBeLessThanOrEqual(303);
    expect(JSON.stringify(summary)).not.toContain('alsoKnownAs');
    expect(JSON.stringify(summary)).not.toContain('popularity');
    expect(JSON.stringify(summary)).not.toContain('adult');
    expect(JSON.stringify(summary)).not.toContain('homepage');
  });
});

describe('summarizeCreditRole', () => {
  it('drops overview and posterPath', () => {
    const credit = {
      id: 550,
      mediaType: 'movie',
      title: 'Fight Club',
      character: 'Tyler Durden',
      overview: 'An underground fight club discovers much more',
      posterPath: '/path.jpg',
      releaseDate: '1999-10-15',
      voteAverage: 8.8,
      job: 'Actor',
      department: 'Acting',
      firstAirDate: undefined,
    } as unknown as CreditRole;

    const summary = summarizeCreditRole(credit);

    expect(Object.keys(summary).sort()).toEqual([
      'character',
      'department',
      'firstAirDate',
      'id',
      'job',
      'mediaType',
      'name',
      'releaseDate',
      'title',
      'voteAverage',
    ]);
    expect(JSON.stringify(summary)).not.toContain('overview');
    expect(JSON.stringify(summary)).not.toContain('posterPath');
  });
});
