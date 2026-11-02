/**
 * The keys of `source` whose value is not undefined, in `keys` order. The bulk editors send
 * only the fields a caller set, so an omitted field is left as it is upstream, never blanked.
 */
export function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}
