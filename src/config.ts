export interface InstanceConfig {
  baseUrl: string;
  apiKey: string;
}

export type TransportMode = 'stdio' | 'http' | 'both';

interface BaseConfig {
  sonarr?: InstanceConfig;
  radarr?: InstanceConfig;
  prowlarr?: InstanceConfig;
  overseerr?: InstanceConfig;
  port: number;
  host: string;
}

/** The HTTP transport cannot be configured without its bearer token. */
export type ServarrConfig =
  | (BaseConfig & { transport: 'stdio'; token?: string })
  | (BaseConfig & { transport: 'http' | 'both'; token: string });

/** Shorter bearer tokens are allowed, with a startup warning (see weakTokenWarning). */
export const MIN_TOKEN_LENGTH = 32;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TRANSPORTS: readonly TransportMode[] = ['stdio', 'http', 'both'];

function readInstance(
  env: NodeJS.ProcessEnv,
  product: string,
  prefix: string,
): InstanceConfig | undefined {
  const rawUrl = env[`${prefix}_URL`]?.trim();
  const apiKey = env[`${prefix}_API_KEY`]?.trim();

  if (!rawUrl && !apiKey) return undefined;
  if (!rawUrl) throw new ConfigError(`${product}: ${prefix}_API_KEY is set but ${prefix}_URL is not`);
  if (!apiKey) throw new ConfigError(`${product}: ${prefix}_URL is set but ${prefix}_API_KEY is not`);

  // Neither message echoes the value: it may carry credentials.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`${product}: ${prefix}_URL is not a valid URL`);
  }
  // fetch refuses a URL with userinfo on every request, so such a URL can never work.
  if (url.username || url.password) {
    throw new ConfigError(
      `${product}: ${prefix}_URL must not contain credentials (user:password@); use the API key only`,
    );
  }
  // `localhost:8989` parses with the scheme "localhost:" and only fails on the first call.
  // `http:8989` parses too (as http://8989/), so the raw value must spell out the slashes.
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !/^https?:\/\//i.test(rawUrl)) {
    throw new ConfigError(`${product}: ${prefix}_URL must start with http:// or https://`);
  }
  // The client appends /api/... to the base URL, which a query or fragment would swallow.
  // The raw value is checked too: a bare trailing ? or # parses to an empty search or hash.
  if (url.search || url.hash || /[?#]/.test(rawUrl)) {
    throw new ConfigError(`${product}: ${prefix}_URL must not contain a query string or fragment`);
  }

  return { baseUrl: rawUrl.replace(/\/+$/, ''), apiKey };
}

function readTransport(env: NodeJS.ProcessEnv): TransportMode {
  const raw = env.SERVARR_MCP_TRANSPORT?.trim();
  if (!raw) return 'stdio';
  if (!TRANSPORTS.includes(raw as TransportMode)) {
    throw new ConfigError(
      `SERVARR_MCP_TRANSPORT must be one of ${TRANSPORTS.join(', ')} (got: ${raw})`,
    );
  }
  return raw as TransportMode;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env.SERVARR_MCP_PORT?.trim();
  if (!raw) return 3000;
  // Digits only: Number() would also accept 0x50, 3000.0 and 1e3.
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`SERVARR_MCP_PORT must be an integer between 1 and 65535 (got: ${raw})`);
  }
  return port;
}

function readHost(env: NodeJS.ProcessEnv): string {
  // `*` means every interface, IPv4 and IPv6 (see startHttp).
  // Loopback unless told otherwise: run from source, the HTTP transport should not be
  // reachable from the LAN by accident. The image sets `*` so a Service can reach the pod.
  return env.SERVARR_MCP_HOST?.trim() || '127.0.0.1';
}

/**
 * A warning for a bearer token shorter than MIN_TOKEN_LENGTH, or undefined. A warning rather
 * than a startup failure so that an existing deployment with a shorter token keeps starting;
 * the message never echoes the token.
 */
export function weakTokenWarning(token: string | undefined): string | undefined {
  if (token === undefined || token.length >= MIN_TOKEN_LENGTH) return undefined;
  return (
    `SERVARR_MCP_TOKEN is ${token.length} characters; use at least ${MIN_TOKEN_LENGTH} ` +
    '(for example `openssl rand -hex 32`)'
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServarrConfig {
  const sonarr = readInstance(env, 'Sonarr', 'SONARR');
  const radarr = readInstance(env, 'Radarr', 'RADARR');
  const prowlarr = readInstance(env, 'Prowlarr', 'PROWLARR');
  const overseerr = readInstance(env, 'Overseerr', 'OVERSEERR');

  if (!sonarr && !radarr && !prowlarr && !overseerr) {
    throw new ConfigError(
      'No products configured. Set at least one of SONARR_URL/SONARR_API_KEY, ' +
        'RADARR_URL/RADARR_API_KEY, PROWLARR_URL/PROWLARR_API_KEY, OVERSEERR_URL/OVERSEERR_API_KEY.',
    );
  }

  const transport = readTransport(env);
  const token = env.SERVARR_MCP_TOKEN?.trim() || undefined;

  const base: BaseConfig = {
    sonarr,
    radarr,
    prowlarr,
    overseerr,
    port: readPort(env),
    host: readHost(env),
  };

  if (transport === 'stdio') return { ...base, transport, token };
  if (!token) {
    throw new ConfigError(
      `SERVARR_MCP_TOKEN is required when SERVARR_MCP_TRANSPORT is "${transport}"`,
    );
  }
  return { ...base, transport, token };
}
