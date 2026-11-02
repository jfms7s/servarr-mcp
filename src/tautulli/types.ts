// Tautulli API v2 (`/api/v2?apikey=&cmd=`). Every response is wrapped in an envelope and an
// application error still answers HTTP 200 with result "error". Tautulli is loose with types:
// ids, years and sizes arrive as numbers or numeric strings, and empty values as "" or null.

export interface TautulliEnvelope<T> {
  response: {
    result: 'success' | 'error' | string;
    message?: string | null;
    data: T;
  };
}

export type Loose = number | string | null | undefined;

/** One entry of get_libraries. */
export interface TautulliLibrary {
  section_id: number | string;
  section_name: string;
  /** movie, show, artist or photo */
  section_type: string;
}

/** One row of get_library_media_info: a movie, or a show (aggregated over its episodes). */
export interface TautulliMediaItem {
  rating_key: number | string;
  title: string;
  year?: Loose;
  media_type?: string;
  /** Legacy agents carry the external id (com.plexapp.agents.themoviedb://603?lang=en); plex:// guids do not. */
  guid?: string | null;
  /** Unix seconds; null or "" when never played. */
  last_played?: Loose;
  play_count?: Loose;
  file_size?: Loose;
}

/** get_library_media_info's data: a DataTables page. */
export interface TautulliMediaInfoPage {
  recordsTotal?: Loose;
  recordsFiltered?: Loose;
  data: TautulliMediaItem[];
}
