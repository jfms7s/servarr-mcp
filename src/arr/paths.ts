function trimTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

/**
 * The path an item gets when moved under `root`: its current folder name (or `fallbackName`,
 * for an item with no path) joined to `root` in the root's own separator style. Either
 * separator style is accepted in `currentPath`, and trailing separators on `root` are dropped.
 */
export function relocatePath(
  currentPath: string | undefined,
  fallbackName: string | undefined,
  root: string,
  noun: 'series' | 'movie',
): string {
  const folderName = currentPath?.split(/[/\\]+/).filter(Boolean).pop() ?? fallbackName;
  if (!folderName) {
    throw new Error(
      'Cannot determine folder name: current path is empty and folderName is not set. ' +
        `Ensure the ${noun} has a valid path before relocating.`,
    );
  }
  // A root with backslashes and no forward slash is a Windows root: join with a backslash.
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${trimTrailingSeparators(root)}${separator}${folderName}`;
}

/**
 * Whether `path` is the root folder itself or sits inside it. Compares whole path segments,
 * so `/media/movies` does not match `/media/movies-animation/...`. Either separator style works.
 */
export function isWithinRoot(path: string | undefined, root: string): boolean {
  if (path === undefined) return false;

  const cleanPath = trimTrailingSeparators(path);
  const cleanRoot = trimTrailingSeparators(root);

  if (cleanPath === cleanRoot) return true;
  return cleanPath.startsWith(`${cleanRoot}/`) || cleanPath.startsWith(`${cleanRoot}\\`);
}

/**
 * Title key for grouping likely copies of the same title: compatibility-decomposed, lowercased,
 * with everything but letters and digits removed (any script, so non-Latin titles keep their
 * characters). An empty result means the title carries no usable key.
 */
export function normalizeTitle(title: string): string {
  return title.normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The root folder an item lives under: the longest of `roots` that contains `path`, else the
 * item's own `rootFolderPath`, else the parent directory of `path` (either separator style).
 */
export function rootFolderOf(
  path: string | undefined,
  roots: readonly string[],
  rootFolderPath?: string,
): string | undefined {
  const containing = roots
    .filter((root) => isWithinRoot(path, root))
    .sort((a, b) => trimTrailingSeparators(b).length - trimTrailingSeparators(a).length)[0];
  if (containing !== undefined) return trimTrailingSeparators(containing);
  if (rootFolderPath !== undefined) return trimTrailingSeparators(rootFolderPath);
  if (path === undefined) return undefined;

  const cleanPath = trimTrailingSeparators(path);
  const lastSeparator = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'));
  if (lastSeparator < 0) return cleanPath;
  // A top-level item such as `/Dune` sits directly under the filesystem root.
  return cleanPath.slice(0, lastSeparator) || cleanPath.slice(0, 1);
}
