import { describe, expect, it } from 'vitest';
import { isWithinRoot, normalizeTitle, rootFolderOf } from '../../src/mcp/paths.js';

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

describe('normalizeTitle', () => {
  it('lowercases and drops punctuation and spaces', () => {
    expect(normalizeTitle('Star Wars: Andor!')).toBe('starwarsandor');
  });

  it('keeps non-Latin letters, so unrelated non-Latin titles stay distinct', () => {
    expect(normalizeTitle('進撃の巨人')).toBe('進撃の巨人');
    expect(normalizeTitle('進撃の巨人')).not.toBe(normalizeTitle('鬼滅の刃'));
  });

  it('folds accents and compatibility forms', () => {
    expect(normalizeTitle('Amélie')).toBe(normalizeTitle('Amelie'));
    expect(normalizeTitle('ＤＵＮＥ')).toBe('dune');
  });

  it('is empty for a title with no letters or digits', () => {
    expect(normalizeTitle('!!! ...')).toBe('');
  });
});

describe('rootFolderOf', () => {
  const roots = ['/movies', '/movies-4k', '/movies/anime'];

  it('picks the longest root folder that contains the path', () => {
    expect(rootFolderOf('/movies/anime/Akira (1988)', roots)).toBe('/movies/anime');
    expect(rootFolderOf('/movies-4k/Dune (2021)', roots)).toBe('/movies-4k');
    expect(rootFolderOf('/movies/Dune (2021)', roots)).toBe('/movies');
  });

  it('falls back to the stored root folder path, then to the parent directory', () => {
    expect(rootFolderOf('/elsewhere/Dune (2021)', roots, '/elsewhere')).toBe('/elsewhere');
    expect(rootFolderOf('/elsewhere/Dune (2021)', roots)).toBe('/elsewhere');
    expect(rootFolderOf('D:\\Media\\Dune (2021)', [])).toBe('D:\\Media');
  });

  it('uses the stored root folder path when the path is missing', () => {
    expect(rootFolderOf(undefined, roots, '/movies')).toBe('/movies');
    expect(rootFolderOf(undefined, roots)).toBeUndefined();
  });
});
