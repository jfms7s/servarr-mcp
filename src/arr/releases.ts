export interface ReleaseFilters {
  titleContains?: string;
  approvedOnly?: boolean;
  limit?: number;
}

export interface RankedReleases<Summary> {
  total: number;
  matched: number;
  returned: number;
  releases: Summary[];
}

/** The release search tools' default page size. */
export const DEFAULT_RELEASE_LIMIT = 20;

/**
 * Summarises releases with their rank in upstream's preference order, then filters by title
 * substring (case-insensitive) and approval, then caps at `limit`. Ranking runs over the full
 * list first, so a release keeps upstream's rank after the filters drop the ones ahead of it.
 */
export function rankAndFilterReleases<
  Release,
  Summary extends { title: string; approved: boolean },
>(
  releases: readonly Release[],
  summarize: (release: Release, rank: number) => Summary,
  { titleContains, approvedOnly, limit = DEFAULT_RELEASE_LIMIT }: ReleaseFilters,
): RankedReleases<Summary> {
  let filtered = releases.map((release, index) => summarize(release, index + 1));
  if (titleContains) {
    const needle = titleContains.toLowerCase();
    filtered = filtered.filter((release) => release.title.toLowerCase().includes(needle));
  }
  if (approvedOnly) filtered = filtered.filter((release) => release.approved);

  const matched = filtered.length;
  const returned = Math.min(limit, matched);
  return { total: releases.length, matched, returned, releases: filtered.slice(0, returned) };
}

/** The rename-preview tools return at most this many previews, with the full count. */
export const MAX_PREVIEW = 100;

export function capPreviews<Preview, Summary>(
  previews: readonly Preview[],
  summarize: (preview: Preview) => Summary,
): { total: number; shown: number; previews: Summary[] } {
  const shown = previews.slice(0, MAX_PREVIEW).map(summarize);
  return { total: previews.length, shown: shown.length, previews: shown };
}
