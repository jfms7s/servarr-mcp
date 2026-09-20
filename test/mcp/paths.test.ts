import { describe, expect, it } from 'vitest';
import { isWithinRoot } from '../../src/mcp/paths.js';

describe('isWithinRoot', () => {
  it('matches a path inside the root', () => {
    expect(isWithinRoot('/mnt/media/movies/Dune (2021)', '/mnt/media/movies')).toBe(true);
  });

  it('matches the root itself', () => {
    expect(isWithinRoot('/mnt/media/movies', '/mnt/media/movies')).toBe(true);
  });

  it('does not match a sibling that shares the root as a name prefix', () => {
    expect(isWithinRoot('/mnt/media/movies-animation/Up (2009)', '/mnt/media/movies')).toBe(false);
    expect(isWithinRoot('/mnt/media/movies-anime/Akira (1988)', '/mnt/media/movies')).toBe(false);
  });

  it('ignores trailing separators on either side', () => {
    expect(isWithinRoot('/mnt/media/movies/Dune (2021)', '/mnt/media/movies/')).toBe(true);
    expect(isWithinRoot('/mnt/media/movies/', '/mnt/media/movies')).toBe(true);
  });

  it('handles Windows-style separators', () => {
    expect(isWithinRoot('D:\\Media\\Movies\\Dune (2021)', 'D:\\Media\\Movies')).toBe(true);
    expect(isWithinRoot('D:\\Media\\Movies-Anime\\Akira (1988)', 'D:\\Media\\Movies')).toBe(false);
  });

  it('is false when the path is missing', () => {
    expect(isWithinRoot(undefined, '/mnt/media/movies')).toBe(false);
  });
});
