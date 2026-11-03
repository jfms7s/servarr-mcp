import type {
  DiskSpace,
  HealthCheck,
  QualityProfile,
  RootFolder,
  SystemStatus,
  UnmappedFolder,
} from './types.js';

export interface QualityProfileSummary {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export function summarizeQualityProfile(profile: QualityProfile): QualityProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    upgradeAllowed: profile.upgradeAllowed,
    cutoff: profile.cutoff,
  };
}

export interface RootFolderSummary {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
  unmappedFolderCount: number;
}

/** A root folder without its unmappedFolders list, which *_list_unmapped_folders returns. */
export function summarizeRootFolder(rootFolder: RootFolder): RootFolderSummary {
  return {
    id: rootFolder.id,
    path: rootFolder.path,
    accessible: rootFolder.accessible,
    freeSpace: rootFolder.freeSpace,
    unmappedFolderCount: rootFolder.unmappedFolders?.length ?? 0,
  };
}

/** The media file embedded in a get-by-id record, without its mediaInfo block. */
export interface MediaFileRef {
  id: number;
  relativePath: string;
  size: number;
  quality?: string;
}

export function summarizeMediaFileRef(file: {
  id: number;
  relativePath: string;
  size: number;
  quality?: { quality: { name: string } };
}): MediaFileRef {
  return {
    id: file.id,
    relativePath: file.relativePath,
    size: file.size,
    quality: file.quality?.quality.name,
  };
}

export interface UnmappedFolderSummary {
  rootFolderId: number;
  rootFolderPath: string;
  folderName?: string;
  folderPath?: string;
  relativePath?: string;
}

/** One unmapped folder, flattened with the root folder it sits in. */
export function summarizeUnmappedFolder(
  rootFolder: RootFolder,
  folder: UnmappedFolder,
): UnmappedFolderSummary {
  return {
    rootFolderId: rootFolder.id,
    rootFolderPath: rootFolder.path,
    folderName: folder.name,
    folderPath: folder.path,
    relativePath: folder.relativePath,
  };
}

export interface SystemStatusSummary {
  appName: string;
  version: string;
  branch?: string;
  osName?: string;
  osVersion?: string;
  isDocker?: boolean;
  startTime?: string;
}

/** The version and host facts of /system/status, without paths, auth or build internals. */
export function summarizeSystemStatus(status: SystemStatus): SystemStatusSummary {
  return {
    appName: status.appName,
    version: status.version,
    branch: status.branch,
    osName: status.osName,
    osVersion: status.osVersion,
    isDocker: status.isDocker,
    startTime: status.startTime,
  };
}

export interface HealthCheckSummary {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export function summarizeHealthCheck(check: HealthCheck): HealthCheckSummary {
  return { source: check.source, type: check.type, message: check.message, wikiUrl: check.wikiUrl };
}

export interface DiskSpaceSummary {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export function summarizeDiskSpace(disk: DiskSpace): DiskSpaceSummary {
  return {
    path: disk.path,
    label: disk.label,
    freeSpace: disk.freeSpace,
    totalSpace: disk.totalSpace,
  };
}
