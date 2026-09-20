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
