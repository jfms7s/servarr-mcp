import { describe, expect, it, vi } from 'vitest';
import type { SonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

function toolsFor(overrides: Partial<SonarrClient>) {
  const client = overrides as SonarrClient;
  const tools = createSonarrTools(client);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createSonarrTools', () => {
  it('registers all 26 tools with unique sonarr_ prefixed names', () => {
    const names = createSonarrTools({} as SonarrClient).map((t) => t.name);
    expect(names).toHaveLength(26);
    expect(names.every((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(new Set(names).size).toBe(26);
  });

  it('gives every tool a non-empty description', () => {
    for (const tool of createSonarrTools({} as SonarrClient)) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('summarises the series list', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({})) as unknown[];
    expect(result).toEqual([expect.objectContaining({ id: 1, title: 'Andor', seasonCount: 0 })]);
  });

  it('returns the full record from get_series', async () => {
    const getSeries = vi.fn().mockResolvedValue({ id: 7, title: 'Severance', path: '/tv' });
    const get = toolsFor({ getSeries });
    await expect(get('sonarr_get_series').handler({ seriesId: 7 })).resolves.toMatchObject({ id: 7 });
    expect(getSeries).toHaveBeenCalledWith(7);
  });

  it('passes the add_series arguments straight through', async () => {
    const addSeries = vi.fn().mockResolvedValue({ id: 3, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] });
    const get = toolsFor({ addSeries });
    await get('sonarr_add_series').handler({
      title: 'Andor',
      tvdbId: 9,
      qualityProfileId: 1,
      rootFolderPath: '/tv',
      searchForMissingEpisodes: true,
    });
    expect(addSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        tvdbId: 9,
        rootFolderPath: '/tv',
        addOptions: expect.objectContaining({ searchForMissingEpisodes: true }),
      }),
    );
  });

  it('defaults delete_series to keeping files', async () => {
    const deleteSeries = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteSeries });
    await get('sonarr_delete_series').handler({ seriesId: 4 });
    expect(deleteSeries).toHaveBeenCalledWith(4, { deleteFiles: false, addImportListExclusion: false });
  });

  it('summarises queue records', async () => {
    const getQueue = vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalRecords: 1,
      records: [{ id: 1, title: 'x', status: 'downloading', size: 100, sizeleft: 50 }],
    });
    const get = toolsFor({ getQueue });
    const result = (await get('sonarr_get_queue').handler({})) as { records: unknown[] };
    expect(result.records).toEqual([expect.objectContaining({ percentComplete: 50 })]);
  });

  it('restricts run_command to the supported command names', async () => {
    const tool = createSonarrTools({} as SonarrClient).find((t) => t.name === 'sonarr_run_command');
    const shape = tool?.inputSchema as { name: { parse: (v: unknown) => unknown } };
    expect(() => shape.name.parse('SeriesSearch')).not.toThrow();
    expect(() => shape.name.parse('DropDatabase')).toThrow();
  });

  it('propagates client errors out of the handler', async () => {
    const listSeries = vi.fn().mockRejectedValue(new Error('down'));
    const get = toolsFor({ listSeries });
    await expect(get('sonarr_list_series').handler({})).rejects.toThrow('down');
  });
});
