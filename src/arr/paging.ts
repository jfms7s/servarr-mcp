import { z } from 'zod';

// Client-side paging for arr endpoints that return a whole list in one
// response (episodes, episode files, calendars). Same shape as
// sonarr_list_series: { totalMatched, offset, limit, <rows> }.

export const DEFAULT_LIST_LIMIT = 100;

/** Server-side paging input for the arr endpoints that page themselves (history, wanted, blocklist). */
export const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export const listWindow = {
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum results to return (default ${DEFAULT_LIST_LIMIT})`),
  offset: z.number().int().min(0).optional().describe('Skip this many results (default 0)'),
};

export function pageOf<T>(
  rows: T[],
  { offset = 0, limit = DEFAULT_LIST_LIMIT }: { offset?: number; limit?: number },
): { totalMatched: number; offset: number; limit: number; rows: T[] } {
  return { totalMatched: rows.length, offset, limit, rows: rows.slice(offset, offset + limit) };
}
