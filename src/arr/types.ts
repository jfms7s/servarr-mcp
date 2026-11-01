// Types the Servarr-family APIs (Sonarr, Radarr, and for the last two Prowlarr) share verbatim.
// Each product's types.ts re-exports the ones it uses, so product imports stay unchanged.

export interface QualityProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export interface RootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
  unmappedFolders?: UnmappedFolder[];
}

export interface UnmappedFolder {
  name?: string;
  path?: string;
  relativePath?: string;
}

export interface Tag {
  id: number;
  label: string;
}

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}
