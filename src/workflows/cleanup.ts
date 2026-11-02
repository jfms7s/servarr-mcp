import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { RadarrClient } from '../radarr/client.js';
import type { SonarrClient } from '../sonarr/client.js';
import type { TautulliClient } from '../tautulli/client.js';
import type { Loose, TautulliMediaItem } from '../tautulli/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;

export type CleanupMediaType = 'movie' | 'show';
export type MatchedBy = 'tmdb' | 'tvdb' | 'title';

export interface CleanupClients {
  tautulli: TautulliClient;
  radarr?: Pick<RadarrClient, 'listMovies'>;
  sonarr?: Pick<SonarrClient, 'listSeries'>;
}

export interface CleanupOptions {
  unwatchedDays: number;
  minSizeGb: number;
  mediaType: CleanupMediaType | 'all';
  limit: number;
  /** Injected in tests. */
  now?: Date;
}

export interface CleanupRow {
  arr: 'radarr' | 'sonarr';
  /** The Radarr movie id or Sonarr series id to pass to the delete tool. */
  arrId: number;
  title: string;
  year?: number;
  mediaType: CleanupMediaType;
  matchedBy: MatchedBy;
  /** Latest play across every Plex copy (ISO), or null when never played. */
  lastPlayed: string | null;
  playCount: number;
  sizeOnDisk: number;
  sizeGb: number;
  /** Previews first, deletes only with its own confirm flag. */
  deleteWith: 'radarr_delete_movie' | 'sonarr_delete_series';
}

export interface UnmatchedRow {
  title: string;
  year?: number;
  mediaType: CleanupMediaType;
  lastPlayed: string | null;
  playCount: number;
  reason: string;
}

export interface CleanupReport {
  unwatchedDays: number;
  /** Items last played before this (or never) count as unwatched. */
  cutoff: string;
  minSizeGb: number;
  totalItems: number;
  totalBytes: number;
  totalGb: number;
  items: CleanupRow[];
  unmatchedCount: number;
  unmatched: UnmatchedRow[];
  skipped: string[];
  note: string;
}

function toNumber(value: Loose): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** tmdb/tvdb id from a legacy Plex agent guid or a tmdb:// / tvdb:// guid; plex:// guids carry none. */
export function parseGuid(guid: string | null | undefined): { tmdb?: number; tvdb?: number } {
  if (!guid) return {};
  const match = /^(?:com\.plexapp\.agents\.)?(themoviedb|tmdb|thetvdb|tvdb):\/\/(\d+)/i.exec(guid);
  if (!match?.[1] || !match[2]) return {};
  const id = Number(match[2]);
  return /tvdb/i.test(match[1]) ? { tvdb: id } : { tmdb: id };
}

/**
 * Lowercased, accents, punctuation and a leading article dropped, "&" read as "and":
 * "The Amélie & Co." -> "amelie and co". Letters of every script are kept.
 */
export function normalizeTitle(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim()
      // "The Matrix" in Plex is "Matrix" in some arr setups; leading articles never decide a match.
      .replace(/^(the|a|an) /, '')
  );
}

export function titleKey(title: string, year: number | undefined): string | undefined {
  if (year === undefined) return undefined;
  const normalised = normalizeTitle(title);
  return normalised ? `${normalised}|${year}` : undefined;
}

interface ArrItem {
  id: number;
  title: string;
  year?: number;
  sizeOnDisk: number;
  externalId: number;
}

interface ArrIndex {
  arr: 'radarr' | 'sonarr';
  externalKind: 'tmdb' | 'tvdb';
  byExternal: Map<number, ArrItem>;
  /** undefined value: two items share the key, so a title match would be a guess. */
  byTitle: Map<string, ArrItem | undefined>;
}

function indexArr(arr: ArrIndex['arr'], externalKind: ArrIndex['externalKind'], items: ArrItem[]) {
  const index: ArrIndex = { arr, externalKind, byExternal: new Map(), byTitle: new Map() };
  for (const item of items) {
    if (item.externalId) index.byExternal.set(item.externalId, item);
    const key = titleKey(item.title, item.year);
    if (key) index.byTitle.set(key, index.byTitle.has(key) ? undefined : item);
  }
  return index;
}

type Match = { item: ArrItem; matchedBy: MatchedBy } | { reason: string };

function matchItem(index: ArrIndex, media: TautulliMediaItem): Match {
  const ids = parseGuid(media.guid);
  const external = ids[index.externalKind];
  if (external !== undefined) {
    const item = index.byExternal.get(external);
    if (item) return { item, matchedBy: index.externalKind };
  }
  const key = titleKey(media.title, toNumber(media.year));
  if (!key) return { reason: 'no external id and no year to match the title with' };
  if (!index.byTitle.has(key))
    return {
      reason: `not found in ${index.arr === 'radarr' ? 'Radarr' : 'Sonarr'} by id or title and year`,
    };
  const item = index.byTitle.get(key);
  if (!item) return { reason: 'title and year match more than one item' };
  return { item, matchedBy: 'title' };
}

const iso = (seconds: number | undefined) =>
  seconds ? new Date(seconds * 1000).toISOString() : null;

interface Grouped {
  index: ArrIndex;
  item: ArrItem;
  matchedBy: MatchedBy;
  mediaType: CleanupMediaType;
  lastPlayed: number | undefined;
  playCount: number;
}

/**
 * Ranks unwatched media by the space deleting it would free. Reads only: Tautulli's libraries
 * and play data, Radarr's movies and Sonarr's series (both from the clients' cached library).
 * Every Plex copy of the same arr item (a 4K library next to the main one) is folded into one
 * row, so a copy watched recently keeps the item off the list.
 */
export async function buildCleanupReport(
  clients: CleanupClients,
  options: CleanupOptions,
): Promise<CleanupReport> {
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - options.unwatchedDays * DAY_MS;
  const minBytes = options.minSizeGb * GIB;
  const wanted = (type: CleanupMediaType) =>
    options.mediaType === 'all' || options.mediaType === type;

  const skipped: string[] = [];
  const libraries = (await clients.tautulli.getLibraries()).filter((library) => {
    const type = library.section_type;
    if (type !== 'movie' && type !== 'show') return false;
    if (!wanted(type)) return false;
    const arrMissing = type === 'movie' ? !clients.radarr : !clients.sonarr;
    if (arrMissing) {
      skipped.push(
        `${library.section_name}: ${type === 'movie' ? 'Radarr' : 'Sonarr'} is not configured`,
      );
      return false;
    }
    return true;
  });

  const needsMovies = libraries.some((library) => library.section_type === 'movie');
  const needsShows = libraries.some((library) => library.section_type === 'show');
  const [movies, series, media] = await Promise.all([
    needsMovies && clients.radarr ? clients.radarr.listMovies() : Promise.resolve([]),
    needsShows && clients.sonarr ? clients.sonarr.listSeries() : Promise.resolve([]),
    Promise.all(
      libraries.map(async (library) => ({
        type: library.section_type as CleanupMediaType,
        items: await clients.tautulli.listLibraryMedia(library.section_id),
      })),
    ),
  ]);

  const indexes: Record<CleanupMediaType, ArrIndex> = {
    movie: indexArr(
      'radarr',
      'tmdb',
      movies.map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year || undefined,
        sizeOnDisk: movie.sizeOnDisk ?? 0,
        externalId: movie.tmdbId,
      })),
    ),
    show: indexArr(
      'sonarr',
      'tvdb',
      series.map((show) => ({
        id: show.id,
        title: show.title,
        year: show.year || undefined,
        sizeOnDisk: show.statistics?.sizeOnDisk ?? 0,
        externalId: show.tvdbId,
      })),
    ),
  };

  const grouped = new Map<string, Grouped>();
  const unmatched: UnmatchedRow[] = [];
  /** Titles (any year) of copies played within the window that matched no single arr item. */
  const recentUnmatchedTitles = new Set<string>();
  for (const { type, items } of media) {
    const index = indexes[type];
    for (const entry of items) {
      const lastPlayed = toNumber(entry.last_played) || undefined;
      const playCount = toNumber(entry.play_count) ?? 0;
      const match = matchItem(index, entry);
      if ('reason' in match) {
        const recent = lastPlayed !== undefined && lastPlayed * 1000 >= cutoffMs;
        // A recent play on a copy we could not pin to one arr item may still be a copy of a
        // ranked item (a wrong or missing year is the usual reason a match fails): hold back
        // every arr item with the same title, whatever its year.
        const title = normalizeTitle(entry.title);
        if (recent && title) recentUnmatchedTitles.add(`${type}:${title}`);
        if (!recent) {
          unmatched.push({
            title: entry.title,
            year: toNumber(entry.year),
            mediaType: type,
            lastPlayed: iso(lastPlayed),
            playCount,
            reason: match.reason,
          });
        }
        continue;
      }
      const key = `${index.arr}:${match.item.id}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.lastPlayed = Math.max(existing.lastPlayed ?? 0, lastPlayed ?? 0) || undefined;
        existing.playCount += playCount;
        // An id match is the stronger claim; keep it when the copies disagree.
        if (existing.matchedBy === 'title') existing.matchedBy = match.matchedBy;
      } else {
        grouped.set(key, {
          index,
          item: match.item,
          matchedBy: match.matchedBy,
          mediaType: type,
          lastPlayed,
          playCount,
        });
      }
    }
  }

  const rows: CleanupRow[] = [...grouped.values()]
    .filter((g) => g.lastPlayed === undefined || g.lastPlayed * 1000 < cutoffMs)
    .filter((g) => !recentUnmatchedTitles.has(`${g.mediaType}:${normalizeTitle(g.item.title)}`))
    .filter((g) => g.item.sizeOnDisk > 0 && g.item.sizeOnDisk >= minBytes)
    .map((g): CleanupRow => ({
      arr: g.index.arr,
      arrId: g.item.id,
      title: g.item.title,
      year: g.item.year,
      mediaType: g.mediaType,
      matchedBy: g.matchedBy,
      lastPlayed: iso(g.lastPlayed),
      playCount: g.playCount,
      sizeOnDisk: g.item.sizeOnDisk,
      sizeGb: Math.round((g.item.sizeOnDisk / GIB) * 100) / 100,
      deleteWith: g.index.arr === 'radarr' ? 'radarr_delete_movie' : 'sonarr_delete_series',
    }))
    .sort((a, b) => b.sizeOnDisk - a.sizeOnDisk);

  const totalBytes = rows.reduce((sum, row) => sum + row.sizeOnDisk, 0);
  return {
    unwatchedDays: options.unwatchedDays,
    cutoff: new Date(cutoffMs).toISOString(),
    minSizeGb: options.minSizeGb,
    totalItems: rows.length,
    totalBytes,
    totalGb: Math.round((totalBytes / GIB) * 100) / 100,
    items: rows.slice(0, options.limit),
    unmatchedCount: unmatched.length,
    unmatched: unmatched.slice(0, options.limit),
    skipped,
    note:
      'Nothing was deleted. Rows matched by title (matchedBy: "title") are a best guess: check them ' +
      'before acting. To delete, call deleteWith with arrId; it previews first and deletes files ' +
      'only with its own confirm flag.',
  };
}

export function createCleanupReportTool(clients: CleanupClients): ToolDefinition {
  return defineTool({
    name: 'servarr_media_cleanup_report',
    effect: 'read',
    description:
      'Answer "what can I delete to free space?": movies and shows in Plex that nobody has played ' +
      'within unwatchedDays (or ever), joined to their Radarr movie or Sonarr series, ranked by ' +
      'size on disk. Plays come from Tautulli; every Plex copy of a title counts. Each row gives ' +
      'arrId, sizeOnDisk, lastPlayed, matchedBy (tmdb, tvdb, or title when only title and year ' +
      'matched; check those) and deleteWith, the tool that deletes it after a preview. Plex ' +
      'items that match nothing are listed under unmatched. Read-only: deletes nothing.',
    inputSchema: {
      unwatchedDays: z
        .number()
        .int()
        .min(0)
        .max(36500)
        .optional()
        .describe('Count an item as unwatched when its last play is older than this (default 365)'),
      minSizeGb: z
        .number()
        .min(0)
        .optional()
        .describe('Leave out items smaller than this many GiB (default 0)'),
      mediaType: z
        .enum(['movie', 'show', 'all'])
        .optional()
        .describe('Movies (Radarr), shows (Sonarr) or both (default all)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Most rows to return in items and in unmatched (default 50, at most 100); totals count ' +
            'all. To see past the limit, raise minSizeGb or narrow mediaType',
        ),
    },
    handler: ({ unwatchedDays, minSizeGb, mediaType, limit }) =>
      buildCleanupReport(clients, {
        unwatchedDays: unwatchedDays ?? 365,
        minSizeGb: minSizeGb ?? 0,
        mediaType: mediaType ?? 'all',
        limit: limit ?? 50,
      }),
  });
}
