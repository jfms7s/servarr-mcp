import type { RootFolder, UnmappedFolder } from './types.js';

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
