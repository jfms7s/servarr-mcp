import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type ServarrConfig } from '../src/config.js';
import { PRODUCTS } from '../src/products.js';
import { buildTools } from '../src/tools.js';

const instance = { baseUrl: 'http://localhost', apiKey: 'k' };
const base: ServarrConfig = { transport: 'stdio', port: 3000, host: '127.0.0.1' };

describe('PRODUCTS', () => {
  it('keeps the Sonarr, Radarr, Prowlarr, Overseerr order', () => {
    expect(PRODUCTS.map((product) => product.id)).toEqual([
      'sonarr',
      'radarr',
      'prowlarr',
      'overseerr',
      'tautulli',
    ]);
  });

  const standalone = PRODUCTS.filter((product) => !product.companionOf);

  it.each(standalone.map((product) => [product.id, product] as const))(
    '%s produces its own tools when configured, and loadConfig reads its env pair',
    (id, product) => {
      const names = buildTools({ ...base, [id]: instance }).map((tool) => tool.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((name) => name.startsWith(`${id}_`))).toBe(true);

      const config = loadConfig({
        [`${product.envPrefix}_URL`]: 'http://localhost:1',
        [`${product.envPrefix}_API_KEY`]: 'k',
      });
      expect(config[id]).toEqual({ baseUrl: 'http://localhost:1', apiKey: 'k' });

      if (product.legacyEnvPrefix) {
        const legacy = loadConfig({
          [`${product.legacyEnvPrefix}_URL`]: 'http://localhost:2',
          [`${product.legacyEnvPrefix}_API_KEY`]: 'k',
        });
        expect(legacy[id]).toEqual({ baseUrl: 'http://localhost:2', apiKey: 'k' });
      }
    },
  );

  it('names every product env pair in the no-products error', () => {
    let message = '';
    try {
      loadConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    for (const { envPrefix } of standalone)
      expect(message).toContain(`${envPrefix}_URL/${envPrefix}_API_KEY`);
    expect(message).not.toContain('TAUTULLI');
    expect(message).toContain('OVERSEERR_URL/OVERSEERR_API_KEY');
  });

  it('registers tools in product order', () => {
    const all = Object.fromEntries(PRODUCTS.map((product) => [product.id, instance]));
    const names = buildTools({ ...base, ...all }).map((tool) => tool.name);
    const firstIndex = standalone.map((product) =>
      names.findIndex((name) => name.startsWith(`${product.id}_`)),
    );
    expect(firstIndex.every((index) => index >= 0)).toBe(true);
    expect([...firstIndex].sort((a, b) => a - b)).toEqual(firstIndex);
  });

  it('registers no tautulli_* tools; Tautulli with an arr adds the cleanup report last', () => {
    const tautulliOnly = buildTools({ ...base, tautulli: instance }).map((tool) => tool.name);
    expect(tautulliOnly).toEqual([]);

    const prowlarr = buildTools({ ...base, tautulli: instance, prowlarr: instance });
    expect(prowlarr.some((tool) => tool.name === 'servarr_media_cleanup_report')).toBe(false);

    for (const arr of ['radarr', 'sonarr'] as const) {
      const names = buildTools({ ...base, tautulli: instance, [arr]: instance }).map((t) => t.name);
      expect(names.filter((name) => name.startsWith('tautulli_'))).toEqual([]);
      expect(names.at(-1)).toBe('servarr_media_cleanup_report');
    }
    const arrOnly = buildTools({ ...base, radarr: instance }).map((tool) => tool.name);
    expect(arrOnly).not.toContain('servarr_media_cleanup_report');
  });
});
