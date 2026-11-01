import { z } from 'zod';
import { LIBRARY_TTL_MS } from '../http/cache.js';

/** Appended to the descriptions of the tools that read the cached whole library. */
export const CACHED_LIBRARY_NOTE =
  ` Results may be up to ${LIBRARY_TTL_MS / 1000} s old (writes made through this server show up at once); ` +
  'pass refresh: true for a fresh read.';

export const refreshInput = z
  .boolean()
  .optional()
  .describe(
    `Download the library again instead of reusing a copy up to ${LIBRARY_TTL_MS / 1000} s old (default false)`,
  );
