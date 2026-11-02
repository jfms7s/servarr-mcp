import { describe, expect, it } from 'vitest';
import type { ServarrConfig } from '../src/config.js';
import { annotationsFor } from '../src/mcp/types.js';
import { buildTools } from '../src/tools.js';

const instance = { baseUrl: 'http://localhost', apiKey: 'k' };
const base: ServarrConfig = { transport: 'stdio', port: 3000, host: '127.0.0.1' };

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

    expect(names.filter((n) => n.startsWith('sonarr_'))).toHaveLength(34);
    expect(names.filter((n) => n.startsWith('radarr_'))).toHaveLength(32);
    expect(names.filter((n) => n.startsWith('prowlarr_'))).toHaveLength(14);
    expect(names.filter((n) => n.startsWith('overseerr_'))).toHaveLength(28);
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
    expect(names).toHaveLength(28);
  });

  describe('effects and annotations', () => {
    const all = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
      overseerr: instance,
    });

    it('classifies every tool', () => {
      for (const tool of all) {
        expect(['read', 'write', 'destructive'], tool.name).toContain(tool.effect);
        expect(typeof annotationsFor(tool.effect).readOnlyHint, tool.name).toBe('boolean');
      }
    });

    it('marks every delete, update, bulk edit, grab and import tool destructive', () => {
      const destructive = all.filter((t) =>
        /_(delete_|update_|bulk_edit_|grab_release$|import_folder$)/.test(t.name),
      );
      expect(destructive.length).toBeGreaterThan(0);
      for (const tool of destructive)
        expect(annotationsFor(tool.effect), tool.name).toEqual({
          readOnlyHint: false,
          destructiveHint: true,
        });
    });

    it('never marks a destructive tool read-only', () => {
      for (const tool of all.filter((t) => t.effect === 'destructive')) {
        expect(annotationsFor(tool.effect).readOnlyHint, tool.name).toBe(false);
      }
    });
  });
});
