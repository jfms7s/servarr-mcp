// History `data` maps are undocumented upstream and differ per product and
// event type, so they are filtered by pattern rather than by an allow-list.

/** Query parameters that carry credentials in indexer and tracker URLs. */
const SECRET_PARAMS = new Set([
  'apikey',
  'api_key',
  'passkey',
  'token',
  'auth',
  'key',
  'sig',
  'signature',
]);
const SECRET_PAIR = /\b(apikey|api_key|passkey|token)=[^&\s]+/gi;

function scrubValue(value: string): string {
  if (!value.includes('://')) return value.replace(SECRET_PAIR, '$1=REDACTED');
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    return value.replace(SECRET_PAIR, '$1=REDACTED');
  }
}

/**
 * Drops URL-valued keys (download and info links embed indexer API keys) and
 * strips credentials from any other value, keeping the diagnostic detail:
 * import reasons, paths, client and indexer names.
 */
export function redactHistoryData(
  data: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!data) return data;
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/url$/i.test(key)) continue;
    kept[key] = typeof value === 'string' ? scrubValue(value) : value;
  }
  return kept;
}
