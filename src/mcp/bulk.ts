/**
 * Radarr and Sonarr move files synchronously inside the editor call, so a large batch can outlast
 * the MCP client's request timeout. The move usually still finishes, but the caller sees an error
 * and cannot tell what happened. Capping the batch keeps every call inside the timeout.
 */
export const MAX_MOVE_BATCH = 10;

export function assertMoveBatchSize(ids: readonly number[], moveFiles: boolean | undefined, toolName: string): void {
  if (!moveFiles || ids.length <= MAX_MOVE_BATCH) return;

  throw new Error(
    `${toolName} moves files synchronously, so it accepts at most ${MAX_MOVE_BATCH} ids per call when ` +
      `moveFiles is true (got ${ids.length}). Split the ids into batches of ${MAX_MOVE_BATCH} or fewer and ` +
      'send them one call at a time.',
  );
}

/**
 * A root-folder change without moveFiles makes Radarr and Sonarr repoint every record at the new
 * root while the files stay where they are, so the next rescan reports them all missing. The
 * arr's own default is that repoint, so the caller has to choose it explicitly.
 */
export function assertMoveFilesChosen(
  rootFolderPath: string | undefined,
  moveFiles: boolean | undefined,
  toolName: string,
): void {
  if (rootFolderPath === undefined || moveFiles !== undefined) return;

  throw new Error(
    `${toolName} changes rootFolderPath, so moveFiles must be given explicitly. Pass moveFiles: true to ` +
      'move the files with the records, or moveFiles: false to repoint the records only (the files stay ' +
      'where they are and the arr will report them missing after a rescan).',
  );
}
