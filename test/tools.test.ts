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
    expect(names.some((n) => n.startsWith('overseerr_'))).toBe(false);
  });

  it('registers every product when all four are configured', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
      overseerr: instance,
    }).map((t) => t.name);

    expect(names.filter((n) => n.startsWith('sonarr_'))).toHaveLength(26);
    expect(names.filter((n) => n.startsWith('radarr_'))).toHaveLength(24);
    expect(names.filter((n) => n.startsWith('prowlarr_'))).toHaveLength(14);
    expect(names.filter((n) => n.startsWith('overseerr_'))).toHaveLength(25);
  });

  it('produces globally unique tool names', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
      overseerr: instance,
    }).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers a partial stack without the missing product', () => {
    const names = buildTools({ ...base, sonarr: instance, prowlarr: instance }).map((t) => t.name);
    expect(names.some((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(names.some((n) => n.startsWith('radarr_'))).toBe(false);
    expect(names.some((n) => n.startsWith('overseerr_'))).toBe(false);
  });

  it('registers overseerr when configured', () => {
    const names = buildTools({ ...base, overseerr: instance }).map((t) => t.name);
    expect(names.every((n) => n.startsWith('overseerr_'))).toBe(true);
    expect(names).toHaveLength(25);
  });
});
