import type { RootFolder, UnmappedFolder } from './types.js';

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
  return { id: file.id, relativePath: file.relativePath, size: file.size, quality: file.quality?.quality.name };
}

export interface UnmappedFolderSummary {
  rootFolderId: number;
  rootFolderPath: string;
  folderName?: string;
  folderPath?: string;
  relativePath?: string;
}

/** One unmapped folder, flattened with the root folder it sits in. */
export function summarizeUnmappedFolder(rootFolder: RootFolder, folder: UnmappedFolder): UnmappedFolderSummary {
  return {
    rootFolderId: rootFolder.id,
    rootFolderPath: rootFolder.path,
    folderName: folder.name,
    folderPath: folder.path,
    relativePath: folder.relativePath,
  };
}
