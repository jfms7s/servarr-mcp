export interface InstanceConfig {
  baseUrl: string;
  apiKey: string;
}

export type TransportMode = 'stdio' | 'http';

/**
 * The products this server knows, in registration order (which is also tool order in
 * tools/list). Adding a product is one entry here plus its factory in src/products.ts.
 * Kept free of product imports: the product modules import InstanceConfig from here.
 */
export interface ProductSettings {
  readonly id: string;
  readonly label: string;
  /** Read first: `<envPrefix>_URL` / `<envPrefix>_API_KEY`. */
  readonly envPrefix: string;
  /** An older prefix still accepted when envPrefix is unset; both set and different is an error. */
  readonly legacyEnvPrefix?: string;
  /**
   * Set for a product with no tools of its own: it only feeds cross-product tools, so it needs
   * one of these products configured too, and on its own it does not count as configured.
   */
  readonly companionOf?: readonly string[];
}

export const PRODUCT_SETTINGS = [
  { id: 'sonarr', label: 'Sonarr', envPrefix: 'SONARR' },
  { id: 'radarr', label: 'Radarr', envPrefix: 'RADARR' },
  { id: 'prowlarr', label: 'Prowlarr', envPrefix: 'PROWLARR' },
  // Overseerr and Jellyseerr merged into Seerr, which serves the same /api/v1. The module,
  // its tools and its label keep the Overseerr name; the env accepts both spellings.
  { id: 'overseerr', label: 'Overseerr', envPrefix: 'SEERR', legacyEnvPrefix: 'OVERSEERR' },
  // Plays from Tautulli feed servarr_media_cleanup_report only; there are no tautulli_* tools.
  { id: 'tautulli', label: 'Tautulli', envPrefix: 'TAUTULLI', companionOf: ['radarr', 'sonarr'] },
] as const satisfies readonly ProductSettings[];

export type ProductId = (typeof PRODUCT_SETTINGS)[number]['id'];

/** One optional instance per product, e.g. config.sonarr. */
export type ProductInstances = { [Id in ProductId]?: InstanceConfig };

interface BaseConfig extends ProductInstances {
  port: number;
  host: string;
}

/** The HTTP transport cannot be configured without its bearer token. */
export type ServarrConfig =
  | (BaseConfig & { transport: 'stdio'; token?: string })
  | (BaseConfig & { transport: 'http'; token: string });

/** Shorter bearer tokens are allowed, with a startup warning (see weakTokenWarning). */
export const MIN_TOKEN_LENGTH = 32;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TRANSPORTS: readonly TransportMode[] = ['stdio', 'http'];

function readInstance(
  env: NodeJS.ProcessEnv,
  product: string,
  prefix: string,
): InstanceConfig | undefined {
  const rawUrl = env[`${prefix}_URL`]?.trim();
  const apiKey = env[`${prefix}_API_KEY`]?.trim();

  if (!rawUrl && !apiKey) return undefined;
  if (!rawUrl)
    throw new ConfigError(`${product}: ${prefix}_API_KEY is set but ${prefix}_URL is not`);
  if (!apiKey)
    throw new ConfigError(`${product}: ${prefix}_URL is set but ${prefix}_API_KEY is not`);

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

/** The product's instance from envPrefix, else legacyEnvPrefix; both set must agree. */
function readProductInstance(
  env: NodeJS.ProcessEnv,
  { label, envPrefix, legacyEnvPrefix }: ProductSettings,
): InstanceConfig | undefined {
  const current = readInstance(env, label, envPrefix);
  if (!legacyEnvPrefix) return current;
  const legacy = readInstance(env, label, legacyEnvPrefix);
  if (
    current &&
    legacy &&
    (current.baseUrl !== legacy.baseUrl || current.apiKey !== legacy.apiKey)
  ) {
    // Neither value is echoed: the URL may carry a hostname worth keeping out of logs, the key is secret.
    throw new ConfigError(
      `${label}: ${envPrefix}_URL/${envPrefix}_API_KEY and ` +
        `${legacyEnvPrefix}_URL/${legacyEnvPrefix}_API_KEY are both set and differ; ` +
        `keep one pair (${envPrefix}_* is preferred)`,
    );
  }
  return current ?? legacy;
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
  const instances: ProductInstances = {};
  for (const product of PRODUCT_SETTINGS) {
    const instance = readProductInstance(env, product);
    if (instance) instances[product.id] = instance;
  }

  const settings: readonly ProductSettings[] = PRODUCT_SETTINGS;
  const standalone = settings.filter((product) => !product.companionOf);
  for (const product of settings) {
    const needs = product.companionOf;
    if (!needs || !instances[product.id as ProductId]) continue;
    if (needs.some((id) => instances[id as ProductId])) continue;
    const pairs = settings
      .filter((other) => needs.includes(other.id))
      .sort((a, b) => needs.indexOf(a.id) - needs.indexOf(b.id))
      .map((other) => `${other.envPrefix}_URL/${other.envPrefix}_API_KEY`);
    throw new ConfigError(
      `${product.label}: ${product.envPrefix}_URL is set, but ${product.label} only feeds ` +
        `reports that also need ${pairs.join(' or ')}`,
    );
  }
  if (!standalone.some((product) => instances[product.id as ProductId])) {
    const pairs = standalone.map((product) => {
      const pair = `${product.envPrefix}_URL/${product.envPrefix}_API_KEY`;
      const legacy = product.legacyEnvPrefix;
      return legacy ? `${pair} (or ${legacy}_URL/${legacy}_API_KEY)` : pair;
    });
    throw new ConfigError(`No products configured. Set at least one of ${pairs.join(', ')}.`);
  }

  const transport = readTransport(env);
  const token = env.SERVARR_MCP_TOKEN?.trim() || undefined;

  const base: BaseConfig = {
    ...instances,
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
