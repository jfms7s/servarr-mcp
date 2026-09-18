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
 * friends are user-supplied and could carry credentials; nothing else in this
 * codebase lets a secret reach an error string and this must not be the
 * exception. An unparseable URL is dropped entirely rather than guessed at.
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

export class ArrApiError extends Error {
  readonly product: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly detail: string;

  constructor(options: ArrApiErrorOptions) {
    const { product, method, path, status, detail, baseUrl } = options;
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
