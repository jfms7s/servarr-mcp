import { normalizeTitle } from './paths.js';

export interface DuplicateKeys<Item> {
  /** The upstream metadata id (tvdbId, tmdbId): two records with the same one are exact duplicates. */
  idOf: (item: Item) => number;
  title: (item: Item) => string;
  year: (item: Item) => number | undefined;
  /** The root folder the record lives under. */
  rootOf: (item: Item) => string | undefined;
}

export interface DuplicateGroups<Item> {
  /** Records sharing one metadata id, keyed by it, in first-seen order. */
  exact: Array<{ id: number; items: Item[] }>;
  /**
   * Distinct titles (more than one metadata id) with the same normalised title and year under
   * more than one root folder: likely misplaced copies. Titles that normalise to nothing are skipped.
   */
  misplaced: Item[][];
}

/** Groups in first-seen order; a null key leaves the item out. */
function groupBy<Item, Key>(items: readonly Item[], keyOf: (item: Item) => Key | null) {
  const groups = new Map<Key, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/** The duplicate rule both *_find_duplicate_* tools share; each shapes the groups itself. */
export function findDuplicates<Item>(
  items: readonly Item[],
  { idOf, title, year, rootOf }: DuplicateKeys<Item>,
): DuplicateGroups<Item> {
  const exact = Array.from(groupBy(items, idOf).entries())
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({ id, items: group }));

  const byTitleYear = groupBy(items, (item) => {
    const normalized = normalizeTitle(title(item));
    return normalized === '' ? null : `${normalized}:${year(item)}`;
  });
  const misplaced = Array.from(byTitleYear.values())
    .filter((group) => group.length > 1)
    .filter((group) => new Set(group.map(idOf)).size > 1)
    .filter((group) => new Set(group.map(rootOf)).size > 1);

  return { exact, misplaced };
}
