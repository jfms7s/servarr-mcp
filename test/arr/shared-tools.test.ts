import { describe, expect, it } from 'vitest';
import { findDuplicates } from '../../src/arr/duplicates.js';
import { pickDefined } from '../../src/arr/payload.js';
import { capPreviews, MAX_PREVIEW, rankAndFilterReleases } from '../../src/arr/releases.js';

describe('rankAndFilterReleases', () => {
  const releases = ['Show.S01.MeGusta', 'Show.S01.Other', 'Show.S01.megusta.REPACK'].map(
    (title, index) => ({ title, approved: index !== 0 }),
  );
  const summarize = (release: { title: string; approved: boolean }, rank: number) => ({
    ...release,
    rank,
  });

  it('ranks over the full list before filtering, then caps', () => {
    const result = rankAndFilterReleases(releases, summarize, {
      titleContains: 'MEGUSTA',
      approvedOnly: true,
    });
    expect(result).toEqual({
      total: 3,
      matched: 1,
      returned: 1,
      releases: [{ title: 'Show.S01.megusta.REPACK', approved: true, rank: 3 }],
    });
  });

  it('defaults the limit to 20 and honours a smaller one', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `r${i}`, approved: true }));
    expect(rankAndFilterReleases(many, summarize, {}).returned).toBe(20);
    expect(rankAndFilterReleases(many, summarize, { limit: 5 })).toMatchObject({
      total: 30,
      matched: 30,
      returned: 5,
    });
  });
});

describe('capPreviews', () => {
  it(`returns at most ${MAX_PREVIEW} previews with the full count`, () => {
    const result = capPreviews(
      Array.from({ length: 150 }, (_, i) => i),
      (n) => n * 2,
    );
    expect(result.total).toBe(150);
    expect(result.shown).toBe(MAX_PREVIEW);
    expect(result.previews.at(-1)).toBe(198);
  });
});

describe('pickDefined', () => {
  it('keeps set fields, including false and empty arrays, and drops undefined ones', () => {
    const source = { monitored: false, tags: [], rootFolderPath: undefined, moveFiles: true };
    expect(pickDefined(source, ['monitored', 'tags', 'rootFolderPath'])).toEqual({
      monitored: false,
      tags: [],
    });
  });
});

describe('findDuplicates', () => {
  const item = (id: number, metaId: number, title: string, root: string) => ({
    id,
    metaId,
    title,
    year: 2020,
    root,
  });
  const keys = {
    idOf: (i: ReturnType<typeof item>) => i.metaId,
    title: (i: ReturnType<typeof item>) => i.title,
    year: (i: ReturnType<typeof item>) => i.year,
    rootOf: (i: ReturnType<typeof item>) => i.root,
  };

  it('groups exact duplicates by metadata id and misplaced copies by title+year across roots', () => {
    const items = [
      item(1, 10, 'Dune', '/a'),
      item(2, 10, 'Dune', '/a'),
      item(3, 11, 'Dune!', '/b'),
      item(4, 12, 'Solo', '/a'),
      item(5, 13, 'Solo', '/a'),
    ];
    const { exact, misplaced } = findDuplicates(items, keys);
    expect(exact.map(({ id, items: group }) => [id, group.map((i) => i.id)])).toEqual([
      [10, [1, 2]],
    ]);
    // Solo: two ids but one root, so not misplaced.
    expect(misplaced.map((group) => group.map((i) => i.id))).toEqual([[1, 2, 3]]);
  });

  it('skips titles that normalise to nothing', () => {
    const items = [item(1, 1, '!!!', '/a'), item(2, 2, '???', '/b')];
    expect(findDuplicates(items, keys).misplaced).toEqual([]);
  });
});
