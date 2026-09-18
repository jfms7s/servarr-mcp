import { describe, expect, it } from 'vitest';
import type { ServarrConfig } from '../src/config.js';
import { buildTools } from '../src/tools.js';

const instance = { baseUrl: 'http://localhost', apiKey: 'k' };
const base: ServarrConfig = { transport: 'stdio', port: 3000 };

describe('buildTools', () => {
  it('registers only the configured products', () => {
    const names = buildTools({ ...base, sonarr: instance }).map((t) => t.name);
    expect(names.some((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(names.some((n) => n.startsWith('radarr_'))).toBe(false);
    expect(names.some((n) => n.startsWith('prowlarr_'))).toBe(false);
  });

  it('registers every product when all three are configured', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
    }).map((t) => t.name);

    expect(names.filter((n) => n.startsWith('sonarr_'))).toHaveLength(28);
    expect(names.filter((n) => n.startsWith('radarr_'))).toHaveLength(26);
    expect(names.filter((n) => n.startsWith('prowlarr_'))).toHaveLength(14);
  });

  it('produces globally unique tool names', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
    }).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers a partial stack without the missing product', () => {
    const names = buildTools({ ...base, sonarr: instance, prowlarr: instance }).map((t) => t.name);
    expect(names.some((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(names.some((n) => n.startsWith('radarr_'))).toBe(false);
  });
});
