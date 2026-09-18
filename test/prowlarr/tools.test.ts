import { describe, expect, it, vi } from 'vitest';
import type { ProwlarrClient } from '../../src/prowlarr/client.js';
import { createProwlarrTools } from '../../src/prowlarr/tools.js';

function toolsFor(overrides: Partial<ProwlarrClient>) {
  const tools = createProwlarrTools(overrides as ProwlarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createProwlarrTools', () => {
  it('registers all 14 tools with unique prowlarr_ prefixed names', () => {
    const names = createProwlarrTools({} as ProwlarrClient).map((t) => t.name);
    expect(names).toHaveLength(14);
    expect(names.every((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(new Set(names).size).toBe(14);
  });

  it('summarises search results with size in gigabytes', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        guid: 'g1',
        title: 'Dune.2021.2160p',
        indexer: 'nzbgeek',
        indexerId: 1,
        size: 1024 ** 3 * 5,
        seeders: 20,
        publishDate: '2026-01-01T00:00:00Z',
        protocol: 'usenet',
        categories: [{ id: 2000, name: 'Movies' }],
      },
    ]);
    const get = toolsFor({ search });
    const result = (await get('prowlarr_search').handler({ query: 'dune' })) as Array<{
      sizeGb: number;
      categories?: string[];
    }>;
    expect(result[0]?.sizeGb).toBe(5);
    expect(result[0]?.categories).toEqual(['Movies']);
  });

  it('grabs a release by guid and indexer id', async () => {
    const grabRelease = vi.fn().mockResolvedValue({});
    const get = toolsFor({ grabRelease });
    await get('prowlarr_grab_release').handler({ guid: 'g1', indexerId: 1 });
    expect(grabRelease).toHaveBeenCalledWith({ guid: 'g1', indexerId: 1 });
  });

  it('requires a non-empty search query', () => {
    const tool = createProwlarrTools({} as ProwlarrClient).find((t) => t.name === 'prowlarr_search');
    const shape = tool?.inputSchema as { query: { parse: (v: unknown) => unknown } };
    expect(() => shape.query.parse('')).toThrow();
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ listIndexers: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('prowlarr_list_indexers').handler({})).rejects.toThrow('down');
  });
});
