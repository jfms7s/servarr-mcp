import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

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

  it('throws when the url is not parseable', () => {
    expect(() => loadConfig({ SONARR_URL: 'not a url', SONARR_API_KEY: 'k' })).toThrow(ConfigError);
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
});
