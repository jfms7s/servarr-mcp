import { ArrApiError } from './errors.js';

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

/** How long a request may take, response body included, before it fails. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Release and indexer searches fan out to every indexer, so they get longer. */
export const SEARCH_TIMEOUT_MS = 90_000;
/** Bulk editor PUTs can move many files before answering. */
export const EDITOR_TIMEOUT_MS = 120_000;

export interface RequestOptions {
  /** Overrides the client's timeout for this call. */
  timeoutMs?: number;
}

export interface ArrHttpClient {
  get<T>(path: string, query?: QueryParams, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, query?: QueryParams, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, query?: QueryParams, options?: RequestOptions): Promise<T>;
  del<T>(path: string, query?: QueryParams, options?: RequestOptions): Promise<T>;
}

export interface ArrClientOptions {
  product: string;
  baseUrl: string;
  apiKey: string;
  apiBase: string;
  /** Default per-request timeout; DEFAULT_TIMEOUT_MS when omitted. */
  timeoutMs?: number;
}

const MAX_DETAIL = 200;

function truncate(text: string): string {
  const clean = text.trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}...` : clean;
}

function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

interface ArrValidationFailure {
  propertyName?: string;
  errorMessage?: string;
}

function extractDetail(status: number, product: string, raw: string): string {
  if (status === 401 || status === 403) return `${product} rejected the API key`;
  if (!raw.trim()) return status >= 500 ? 'server error with no response body' : 'no response body';

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      const messages = (parsed as ArrValidationFailure[])
        .map((item) => [item.propertyName, item.errorMessage].filter(Boolean).join(' '))
        .filter((text) => text.length > 0);
      if (messages.length > 0) return truncate(messages.join('; '));
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.error ?? record.title;
      if (typeof message === 'string' && message.length > 0) return truncate(message);
    }
  } catch {
    // fall through to the raw body
  }

  return truncate(raw);
}

function isTimeout(error: unknown): boolean {
  const named = (value: unknown) => value instanceof Error && value.name === 'TimeoutError';
  return named(error) || (error instanceof Error && named(error.cause));
}

export function createArrClient(options: ArrClientOptions): ArrHttpClient {
  const { product, baseUrl, apiKey, apiBase } = options;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: QueryParams,
    requestOptions?: RequestOptions,
  ): Promise<T> {
    const apiPath = `${apiBase}${path}`;
    const url = `${baseUrl}${apiPath}${buildQuery(query)}`;
    const timeoutMs = requestOptions?.timeoutMs ?? defaultTimeoutMs;
    // One signal bounds the whole exchange: the request and the body reads below.
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = () =>
      new ArrApiError({
        product,
        baseUrl,
        method,
        path: apiPath,
        detail: `no response within ${timeoutMs / 1000} s`,
      });

    const headers: Record<string, string> = { 'X-Api-Key': apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      if (isTimeout(cause)) throw timedOut();
      const inner = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
      const detail = inner instanceof Error ? inner.message : String(inner);
      throw new ArrApiError({ product, baseUrl, method, path: apiPath, detail });
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new ArrApiError({
        product,
        method,
        path: apiPath,
        status: response.status,
        detail: extractDetail(response.status, product, raw),
      });
    }

    if (response.status === 204) return undefined as T;

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      if (isTimeout(cause)) throw timedOut();
      throw cause;
    }
    if (!text.trim()) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ArrApiError({
        product,
        method,
        path: apiPath,
        status: response.status,
        detail: `response was not valid JSON: ${truncate(text)}`,
      });
    }
  }

  return {
    get: (path, query, opts) => request('GET', path, undefined, query, opts),
    post: (path, body, query, opts) => request('POST', path, body, query, opts),
    put: (path, body, query, opts) => request('PUT', path, body, query, opts),
    del: (path, query, opts) => request('DELETE', path, undefined, query, opts),
  };
}
