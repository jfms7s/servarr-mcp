import { z } from 'zod';

// Shared guard for <prefix>_manual_import. The candidate rows and the command's file payload
// differ per product (Sonarr maps a file to a series and episodes, Radarr to a movie), so each
// product keeps its own handler; what they share is the input, its validation and the rule
// that stage two may only import files the arr itself listed in stage one.

/** A rejection as the arr returns it: `{ reason, type }` (type `permanent` or `temporary`). */
export type ManualImportRejection = string | { reason?: string; type?: string };

export interface ManualImportCandidateBase {
  path: string;
  rejections?: ManualImportRejection[];
}

export const manualImportModes = ['auto', 'move', 'copy'] as const;
export type ManualImportMode = (typeof manualImportModes)[number];

/** The input both tools share; each adds its own optional seriesId or movieId. */
export function manualImportInput() {
  return {
    downloadId: z
      .string()
      .min(1)
      .optional()
      .describe('Download id of a queue row (from the get_queue tool); give this or folder'),
    folder: z
      .string()
      .min(1)
      .optional()
      .describe('Absolute folder path to scan for files; give this or downloadId'),
    confirm: z
      .boolean()
      .optional()
      .describe('true imports the listed files; without it the tool only lists candidates'),
    files: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('With confirm: the candidate paths to import, exactly as stage one listed them'),
    overrideRejections: z
      .boolean()
      .optional()
      .describe('With confirm: also import listed files the arr rejected (default false)'),
    replaceExisting: z
      .boolean()
      .optional()
      .describe(
        'With confirm: also import files whose episode or movie already has a file in the library, replacing it (default false)',
      ),
    importMode: z
      .enum(manualImportModes)
      .optional()
      .describe(
        'auto (default: move from a download client, as the arr would), move, or copy (keep the original)',
      ),
  };
}

export interface ManualImportSource {
  downloadId?: string;
  folder?: string;
}

/** At most this many candidates are listed in stage one; total gives the full count. */
export const MAX_CANDIDATES = 100;

export const EXISTING_FILE =
  'already has a file in the library, which the import would replace; pass replaceExisting: true to replace it';

/** Exactly one of downloadId or folder; a raw-shape input schema cannot express this. */
export function checkSource({ downloadId, folder }: ManualImportSource): void {
  if ((downloadId === undefined) === (folder === undefined))
    throw new Error('Give exactly one of downloadId or folder');
}

export function rejectionReasons(rejections: ManualImportRejection[] | undefined): string[] {
  return (rejections ?? []).map((rejection) =>
    typeof rejection === 'string' ? rejection : (rejection.reason ?? 'Rejected'),
  );
}

/**
 * The command files for stage two, in the order the paths were given (duplicates dropped).
 * Every path must be one the arr listed; a rejected one needs overrideRejections; `toFile`
 * builds the payload from the arr's own candidate, or returns why it cannot (a file the arr
 * matched to no series or movie cannot be imported, whatever the flag). One bad path refuses
 * the whole call, so nothing is imported half way.
 */
export function buildImportFiles<T extends ManualImportCandidateBase, F>(
  candidates: T[],
  paths: string[],
  options: { overrideRejections?: boolean; toFile: (candidate: T) => F | string },
): { paths: string[]; files: F[] } {
  const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const problems: string[] = [];
  const selected: string[] = [];
  const files: F[] = [];
  for (const path of new Set(paths)) {
    const candidate = byPath.get(path);
    if (!candidate) {
      problems.push(`${path}: not among the candidates for this download or folder`);
      continue;
    }
    const reasons = rejectionReasons(candidate.rejections);
    if (reasons.length > 0 && !options.overrideRejections) {
      problems.push(
        `${path}: rejected (${reasons.join('; ')}); pass overrideRejections: true to import it anyway`,
      );
      continue;
    }
    const file = options.toFile(candidate);
    if (typeof file === 'string') {
      problems.push(`${path}: ${file}`);
      continue;
    }
    selected.push(path);
    files.push(file);
  }
  if (problems.length > 0)
    throw new Error(
      `Nothing imported: ${problems.length} file(s) cannot be imported.\n${problems.join('\n')}`,
    );
  return { paths: selected, files };
}
