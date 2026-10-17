import { z } from 'zod';

// Client-side paging for arr endpoints that return a whole list in one
// response (episodes, episode files, calendars). Same shape as
// sonarr_list_series: { totalMatched, offset, limit, <rows> }.

export const DEFAULT_LIST_LIMIT = 100;

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
