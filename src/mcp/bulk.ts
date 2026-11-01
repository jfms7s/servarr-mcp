/**
 * Radarr and Sonarr do not move files inside the editor call: the editor (and a single-item PUT with
 * moveFiles) queues a BulkMove/Move command and returns at once, and the files move in the background.
 * The cap is kept to bound the blast radius of one failed background move (permissions, a full disk):
 * at most this many records end up pointing at the new root while their files stay at the old one.
 */
export const MAX_MOVE_BATCH = 10;

export function assertMoveBatchSize(ids: readonly number[], moveFiles: boolean | undefined, toolName: string): void {
  if (!moveFiles || ids.length <= MAX_MOVE_BATCH) return;

  throw new Error(
    `${toolName} accepts at most ${MAX_MOVE_BATCH} ids per call when moveFiles is true (got ${ids.length}), ` +
      'to limit how many records one failed background move can leave pointing at the wrong folder. Split ' +
      `the ids into batches of ${MAX_MOVE_BATCH} or fewer, and poll each batch's moveCommandId until it ` +
      'completes before sending the next.',
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

interface CommandSummary {
  id: number;
  name: string;
}

export interface TrackedMove<T> {
  result: T;
  /** The background move command to poll with *_get_command, or null when none was found. */
  moveCommandId: number | null;
  moveCommandNote?: string;
}

const NO_MOVE_COMMAND =
  'No move command was found on the command queue. Check the records with the get tools before retrying.';

function commandName(name: string): string {
  return name.replace(/Command$/, '');
}

async function highestCommandId(listCommands: () => Promise<CommandSummary[]>): Promise<number | undefined> {
  try {
    return Math.max(0, ...(await listCommands()).map((command) => command.id));
  } catch {
    return undefined;
  }
}

/**
 * Runs a file-moving write and finds the move command it queued. The arr returns the updated records,
 * not the command, so this snapshots the highest command id before the write and afterwards picks the
 * newest command with one of `names` above it. Command ids only grow, so no clock comparison is needed.
 * Only one move normally runs at a time; when none is found (or the list can't be read) the id is null
 * and the write's result is still returned. A failed write is rethrown untouched.
 */
export async function trackMoveCommand<T>(
  listCommands: () => Promise<CommandSummary[]>,
  names: readonly string[],
  run: () => Promise<T>,
): Promise<TrackedMove<T>> {
  const baseline = await highestCommandId(listCommands);
  const result = await run();
  if (baseline === undefined) return { result, moveCommandId: null, moveCommandNote: NO_MOVE_COMMAND };

  let commands: CommandSummary[];
  try {
    commands = await listCommands();
  } catch {
    return { result, moveCommandId: null, moveCommandNote: NO_MOVE_COMMAND };
  }

  const wanted = new Set(names.map(commandName));
  const move = commands
    .filter((command) => command.id > baseline && wanted.has(commandName(command.name)))
    .sort((a, b) => b.id - a.id)[0];
  return move === undefined
    ? { result, moveCommandId: null, moveCommandNote: NO_MOVE_COMMAND }
    : { result, moveCommandId: move.id };
}
