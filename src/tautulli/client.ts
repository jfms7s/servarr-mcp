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
    const envelope = await http.get<TautulliEnvelope<T> | undefined>('', {
      ...params,
      cmd,
      apikey: config.apiKey,
    });
    const response = envelope?.response;
    if (!response || response.result !== 'success') {
      throw new ArrApiError({
        product: 'Tautulli',
        method: 'GET',
        path: `${API_BASE}?cmd=${cmd}`,
        status: 200,
        // Never echo the key, even if a message quotes the request back.
        detail: redact(response?.message?.trim() || 'the response did not report success'),
      });
    }
    return response.data;
  }

  return {
    getLibraries: () => call<TautulliLibrary[]>('get_libraries'),
    listLibraryMedia: async (sectionId) => {
      const items: TautulliMediaItem[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await call<TautulliMediaInfoPage>('get_library_media_info', {
          section_id: sectionId,
          start: page * MEDIA_INFO_PAGE,
          length: MEDIA_INFO_PAGE,
        });
        const rows = result?.data ?? [];
        items.push(...rows);
        const total = Number(result?.recordsFiltered ?? result?.recordsTotal);
        if (rows.length < MEDIA_INFO_PAGE || (Number.isFinite(total) && items.length >= total))
          break;
      }
      return items;
    },
  };
}
