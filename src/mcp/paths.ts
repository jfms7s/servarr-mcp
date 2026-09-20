function trimTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/, '');
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
