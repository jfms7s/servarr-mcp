export interface InstanceConfig {
  baseUrl: string;
  apiKey: string;
}

export type TransportMode = 'stdio' | 'http' | 'both';

export interface ServarrConfig {
  sonarr?: InstanceConfig;
  radarr?: InstanceConfig;
  prowlarr?: InstanceConfig;
  overseerr?: InstanceConfig;
  transport: TransportMode;
  port: number;
  token?: string;
}

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

  try {
    new URL(rawUrl);
  } catch {
    throw new ConfigError(`${product}: ${prefix}_URL is not a valid URL: ${rawUrl}`);
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
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`SERVARR_MCP_PORT must be an integer between 1 and 65535 (got: ${raw})`);
  }
  return port;
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

  if ((transport === 'http' || transport === 'both') && !token) {
    throw new ConfigError(
      `SERVARR_MCP_TOKEN is required when SERVARR_MCP_TRANSPORT is "${transport}"`,
    );
  }

  return { sonarr, radarr, prowlarr, overseerr, transport, port: readPort(env), token };
}
