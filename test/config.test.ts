import { describe, expect, it } from 'vitest';
import { ConfigError, MIN_TOKEN_LENGTH, loadConfig, weakTokenWarning } from '../src/config.js';

const base = {
  SONARR_URL: 'http://localhost:8989',
  SONARR_API_KEY: 'sonarr-key',
};

describe('loadConfig', () => {
  it('enables a product when both url and key are present', () => {
    const config = loadConfig({ ...base });
    expect(config.sonarr).toEqual({ baseUrl: 'http://localhost:8989', apiKey: 'sonarr-key' });
    expect(config.radarr).toBeUndefined();
    expect(config.prowlarr).toBeUndefined();
  });

  it('strips a trailing slash from the base url', () => {
    const config = loadConfig({ ...base, SONARR_URL: 'http://localhost:8989/' });
    expect(config.sonarr?.baseUrl).toBe('http://localhost:8989');
  });

  it('throws when a product has a url but no key', () => {
    expect(() => loadConfig({ SONARR_URL: 'http://localhost:8989' })).toThrow(ConfigError);
  });

  it('throws when a product has a key but no url', () => {
    expect(() => loadConfig({ SONARR_API_KEY: 'k' })).toThrow(ConfigError);
  });

  it('throws when no product is configured at all', () => {
    expect(() => loadConfig({})).toThrow(/at least one/i);
  });

  it('keeps the exact no-products message', () => {
    expect(() => loadConfig({})).toThrow(
      'No products configured. Set at least one of SONARR_URL/SONARR_API_KEY, ' +
        'RADARR_URL/RADARR_API_KEY, PROWLARR_URL/PROWLARR_API_KEY, OVERSEERR_URL/OVERSEERR_API_KEY.',
    );
  });

  it('loads Overseerr configuration', () => {
    const config = loadConfig({
      ...base,
      OVERSEERR_URL: 'http://localhost:5055',
      OVERSEERR_API_KEY: 'overseerr-key',
    });
    expect(config.overseerr).toEqual({
      baseUrl: 'http://localhost:5055',
      apiKey: 'overseerr-key',
    });
  });

  it('counts Overseerr toward "at least one product configured"', () => {
    const config = loadConfig({
      OVERSEERR_URL: 'http://localhost:5055',
      OVERSEERR_API_KEY: 'overseerr-key',
    });
    expect(config.overseerr).toBeDefined();
    expect(config.sonarr).toBeUndefined();
  });

  it('throws when the url is not parseable', () => {
    expect(() => loadConfig({ SONARR_URL: 'not a url', SONARR_API_KEY: 'k' })).toThrow(ConfigError);
  });

  it('rejects a url with credentials without echoing them', () => {
    const load = () => loadConfig({ SONARR_URL: 'http://u:p4ss@h:8989', SONARR_API_KEY: 'k' });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/must not contain credentials/);
    expect(load).not.toThrow(/p4ss/);
    expect(load).not.toThrow(/u:/);
  });

  it('rejects a url with only a username', () => {
    expect(() => loadConfig({ SONARR_URL: 'http://admin@h:8989', SONARR_API_KEY: 'k' })).toThrow(
      /must not contain credentials/,
    );
  });

  it.each(['localhost:8989', 'http:8989', 'https:host:8989', 'ftp://h'])(
    'rejects a url without http:// or https://: %s',
    (url) => {
      const load = () => loadConfig({ SONARR_URL: url, SONARR_API_KEY: 'k' });
      expect(load).toThrow(ConfigError);
      expect(load).toThrow(/must start with http:\/\/ or https:\/\//);
    },
  );

  it.each(['HTTPS://h:8989/sonarr', 'http://[::1]:8989'])('accepts %s', (url) => {
    expect(loadConfig({ SONARR_URL: url, SONARR_API_KEY: 'k' }).sonarr).toBeDefined();
  });

  it.each(['http://h/sonarr?x=1', 'http://h/#a', 'http://h/sonarr?', 'http://h/#'])(
    'rejects a url with a query string or fragment: %s',
    (url) => {
      expect(() => loadConfig({ SONARR_URL: url, SONARR_API_KEY: 'k' })).toThrow(
        /must not contain a query string or fragment/,
      );
    },
  );

  it('accepts a url with a path and trims its trailing slash', () => {
    const config = loadConfig({ SONARR_URL: 'http://h:8989/sonarr/', SONARR_API_KEY: 'k' });
    expect(config.sonarr?.baseUrl).toBe('http://h:8989/sonarr');
  });

  it('does not echo an unparseable url', () => {
    const load = () => loadConfig({ SONARR_URL: 'http://u:p4ss@h:99999', SONARR_API_KEY: 'k' });
    expect(load).toThrow(/SONARR_URL is not a valid URL/);
    expect(load).not.toThrow(/p4ss/);
  });

  it('defaults to stdio transport on port 3000', () => {
    const config = loadConfig({ ...base });
    expect(config.transport).toBe('stdio');
    expect(config.port).toBe(3000);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'carrier-pigeon' })).toThrow(
      ConfigError,
    );
  });

  it('requires a token when the http transport is enabled', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'http' })).toThrow(/token/i);
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'both' })).toThrow(/token/i);
  });

  it('accepts the http transport when a token is set', () => {
    const config = loadConfig({
      ...base,
      SERVARR_MCP_TRANSPORT: 'http',
      SERVARR_MCP_TOKEN: 'secret',
      SERVARR_MCP_PORT: '8080',
    });
    expect(config.transport).toBe('http');
    expect(config.token).toBe('secret');
    expect(config.port).toBe(8080);
  });

  it('binds the http transport to loopback by default', () => {
    expect(loadConfig({ ...base }).host).toBe('127.0.0.1');
  });

  it('honours SERVARR_MCP_HOST', () => {
    expect(loadConfig({ ...base, SERVARR_MCP_HOST: ' 0.0.0.0 ' }).host).toBe('0.0.0.0');
    expect(loadConfig({ ...base, SERVARR_MCP_HOST: '*' }).host).toBe('*');
  });

  it('treats a blank SERVARR_MCP_HOST as unset, like the other variables', () => {
    expect(loadConfig({ ...base, SERVARR_MCP_HOST: ' ' }).host).toBe('127.0.0.1');
  });

  it('warns about a token shorter than the minimum without echoing it', () => {
    const short = 'x'.repeat(MIN_TOKEN_LENGTH - 1);
    const warning = weakTokenWarning(short);
    expect(warning).toMatch(/at least 32/);
    expect(warning).toContain('31 characters');
    expect(warning).not.toContain(short);
  });

  it('does not warn about a token of the minimum length or when there is none', () => {
    expect(weakTokenWarning('x'.repeat(MIN_TOKEN_LENGTH))).toBeUndefined();
    expect(weakTokenWarning(undefined)).toBeUndefined();
  });

  it('still loads a short token, so an existing deployment keeps starting', () => {
    const config = loadConfig({
      ...base,
      SERVARR_MCP_TRANSPORT: 'http',
      SERVARR_MCP_TOKEN: 'short',
    });
    expect(config.token).toBe('short');
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_PORT: 'eighty' })).toThrow(ConfigError);
  });

  it('loads all three products together', () => {
    const config = loadConfig({
      ...base,
      RADARR_URL: 'http://localhost:7878',
      RADARR_API_KEY: 'radarr-key',
      PROWLARR_URL: 'http://localhost:9696',
      PROWLARR_API_KEY: 'prowlarr-key',
    });
    expect(config.radarr?.apiKey).toBe('radarr-key');
    expect(config.prowlarr?.baseUrl).toBe('http://localhost:9696');
  });

  it.each(['0x50', '3000.0', '1e3', '80 0', '+80'])(
    'rejects a port that is not a plain integer: %s',
    (port) => {
      expect(() => loadConfig({ ...base, SERVARR_MCP_PORT: port })).toThrow(ConfigError);
    },
  );

  it('accepts a plain integer port', () => {
    expect(loadConfig({ ...base, SERVARR_MCP_PORT: '8080' }).port).toBe(8080);
  });
});
