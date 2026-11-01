export interface ArrApiErrorOptions {
  product: string;
  method: string;
  path: string;
  status?: number;
  detail: string;
  /** Configured base URL, named only when the connection never landed. */
  baseUrl?: string;
}

/**
 * Drops any userinfo before a base URL goes into a message. SONARR_URL and
 * friends are user-supplied and could carry credentials. loadConfig rejects
 * such a URL, but the client can be built without it, so the message must not
 * rely on that. An unparseable URL is dropped entirely rather than guessed at.
 */
function safeBaseUrl(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    if (!url.username && !url.password) return baseUrl;
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

// scheme://user:pass@ -> scheme://. The userinfo runs up to the last @ before
// the host ends (a slash, ?, # or whitespace), so a raw @ in a password is covered.
// Quotes and angle brackets also end it, so a URL in JSON or HTML is not joined
// to an email address further along.
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s?#"'`<>]*@/gi;

/** True when a URL carries a username or password. An unparseable URL is not judged here. */
export function hasUserinfo(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
}

/**
 * Removes the userinfo from every URL in free text. Detail strings come from
 * fetch and the arrs, and fetch quotes the full URL when it refuses one that
 * carries credentials ("Request cannot be constructed from a URL that includes
 * credentials: http://user:pass@host/...").
 */
export function stripUserinfo(text: string): string {
  return text.replace(USERINFO, '$1');
}

export class ArrApiError extends Error {
  readonly product: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly detail: string;

  constructor(options: ArrApiErrorOptions) {
    const { product, method, path, status, baseUrl } = options;
    const detail = stripUserinfo(options.detail);
    // The URL is only useful when the request never arrived. Once a status
    // comes back the server was plainly reachable, and repeating the URL on
    // every 404 would be noise.
    const at = baseUrl === undefined ? undefined : safeBaseUrl(baseUrl);
    const target = at === undefined ? product : `${product} at ${at}`;
    const message =
      status === undefined
        ? `Cannot reach ${target} for ${method} ${path}: ${detail}`
        : `${product} returned ${status} for ${method} ${path}: ${detail}`;
    super(message);
    this.name = 'ArrApiError';
    this.product = product;
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
