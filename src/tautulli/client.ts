import type { InstanceConfig } from '../config.js';
import { createArrClient, type QueryParams } from '../http/client.js';
import { ArrApiError } from '../http/errors.js';
import type {
  TautulliEnvelope,
  TautulliLibrary,
  TautulliMediaInfoPage,
  TautulliMediaItem,
} from './types.js';

const API_BASE = '/api/v2';
/** Rows per get_library_media_info call. */
export const MEDIA_INFO_PAGE = 1000;
/** Hard stop for one library: 100 pages of 1000 rows. */
const MAX_PAGES = 100;

export interface TautulliClient {
  getLibraries(): Promise<TautulliLibrary[]>;
  /** Every movie or show in one library section, paged through get_library_media_info. */
  listLibraryMedia(sectionId: number | string): Promise<TautulliMediaItem[]>;
}

/**
 * A thin Tautulli client over the shared HTTP client. Tautulli takes its key as the `apikey`
 * query parameter. The shared client never puts the query string into an error (only the path),
 * so the key stays out of tool output. A 200 whose envelope says `result: "error"` is an error.
 */
export function createTautulliClient(config: InstanceConfig): TautulliClient {
  const http = createArrClient({
    product: 'Tautulli',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: API_BASE,
  });

  const redact = (text: string) => text.split(config.apiKey).join('[redacted]');

  async function call<T>(cmd: string, params: QueryParams = {}): Promise<T> {
    let envelope: TautulliEnvelope<T> | undefined;
    try {
      envelope = await http.get<TautulliEnvelope<T> | undefined>('', {
        ...params,
        cmd,
        apikey: config.apiKey,
      });
    } catch (error) {
      // The shared client keeps the query string out of its messages, but an upstream error
      // body (a proxy page, a stack trace) can quote the request URL, key included.
      if (error instanceof Error) error.message = redact(error.message);
      throw error;
    }
    const response = envelope?.response;
    if (!response || response.result !== 'success' || response.data == null) {
      throw new ArrApiError({
        product: 'Tautulli',
        method: 'GET',
        path: `${API_BASE}?cmd=${cmd}`,
        status: 200,
        // Never echo the key, even if a message quotes the request back.
        detail: redact(
          response?.message?.trim() ||
            (response?.result === 'success'
              ? 'the response carried no data'
              : 'the response did not report success'),
        ),
      });
    }
    return response.data;
  }

  return {
    getLibraries: () => call<TautulliLibrary[]>('get_libraries'),
    listLibraryMedia: async (sectionId) => {
      // A missing row means a copy whose plays the report never sees, so read until an empty
      // page (or the reported total) rather than trusting a short page or a loose total.
      const items: TautulliMediaItem[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await call<TautulliMediaInfoPage>('get_library_media_info', {
          section_id: sectionId,
          start: items.length,
          length: MEDIA_INFO_PAGE,
        });
        const rows = Array.isArray(result.data) ? result.data : [];
        if (rows.length === 0) return items;
        items.push(...rows);
        const total = Number(result.recordsFiltered ?? result.recordsTotal);
        if (Number.isInteger(total) && total > 0 && items.length >= total) return items;
      }
      throw new ArrApiError({
        product: 'Tautulli',
        method: 'GET',
        path: `${API_BASE}?cmd=get_library_media_info`,
        status: 200,
        detail: `library ${sectionId} has more than ${MAX_PAGES * MEDIA_INFO_PAGE} items; not reading a partial library`,
      });
    },
  };
}
