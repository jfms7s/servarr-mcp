import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://sonarr.test:8989';
const url = (path: string) => `${base}/api/v3${path}`;

function tool() {
  const client = createSonarrClient({ baseUrl: base, apiKey: 'k' });
  const found = createSonarrTools(client).find((t) => t.name === 'sonarr_manual_import');
  if (!found) throw new Error('sonarr_manual_import is not registered');
  return found;
}

const quality = { quality: { id: 4, name: 'HDTV-720p' }, revision: { version: 1, real: 0 } };
const languages = [{ id: 1, name: 'English' }];
// Rows as Sonarr v4 returns them from GET /manualimport (trimmed).
const mapped = {
  id: 11,
  path: '/downloads/Show.S01E01/Show.S01E01.mkv',
  relativePath: 'Show.S01E01/Show.S01E01.mkv',
  folderName: 'Show.S01E01',
  name: 'Show.S01E01',
  size: 1000,
  series: { id: 1, title: 'Show', overview: 'long', images: [] },
  seasonNumber: 1,
  episodes: [{ id: 19, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', overview: 'x' }],
  releaseGroup: 'GRP',
  quality,
  languages,
  qualityWeight: 8,
  customFormats: [],
  indexerFlags: 0,
  releaseType: 'singleEpisode',
  downloadId: 'HASH1',
  rejections: [],
};
const rejected = {
  ...mapped,
  id: 12,
  path: '/downloads/Show.S01E02/Show.S01E02.mkv',
  folderName: 'Show.S01E02',
  episodes: [{ id: 20, seasonNumber: 1, episodeNumber: 2 }],
  rejections: [{ reason: 'Unable to determine if file is a sample', type: 'permanent' }],
};
const unknown = {
  id: 13,
  path: '/downloads/Other.S01E01/Other.S01E01.mkv',
  size: 1000,
  quality,
  languages: [{ id: 0, name: 'Unknown' }],
  rejections: [{ reason: 'Unknown Series', type: 'permanent' }],
};

function serveCandidates(capture?: { query?: Record<string, string>; posts: unknown[] }) {
  server.use(
    http.get(url('/manualimport'), ({ request }) => {
      if (capture) capture.query = Object.fromEntries(new URL(request.url).searchParams);
      return HttpResponse.json([mapped, rejected, unknown]);
    }),
    http.post(url('/command'), async ({ request }) => {
      capture?.posts.push(await request.json());
      return HttpResponse.json({ id: 77, name: 'ManualImport', status: 'queued' });
    }),
  );
}

describe('sonarr_manual_import', () => {
  it('without confirm lists shaped candidates with rejections and posts nothing', async () => {
    const capture = { posts: [] as unknown[] } as {
      query?: Record<string, string>;
      posts: unknown[];
    };
    serveCandidates(capture);
    const result = (await tool().handler({ downloadId: 'HASH1', seriesId: 1 })) as {
      candidates: unknown[];
      confirmRequired: boolean;
    };
    expect(capture.query).toEqual({
      downloadId: 'HASH1',
      seriesId: '1',
      filterExistingFiles: 'true',
    });
    expect(capture.posts).toEqual([]);
    expect(result.confirmRequired).toBe(true);
    expect(result.candidates).toEqual([
      {
        path: mapped.path,
        size: 1000,
        quality: 'HDTV-720p',
        languages: ['English'],
        releaseGroup: 'GRP',
        series: { id: 1, title: 'Show' },
        seasonNumber: 1,
        episodes: [{ id: 19, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' }],
        replacesExistingFile: false,
        rejections: [],
      },
      expect.objectContaining({
        path: rejected.path,
        rejections: ['Unable to determine if file is a sample'],
      }),
      expect.objectContaining({ path: unknown.path, rejections: ['Unknown Series'] }),
    ]);
  });

  it('ignores files without confirm', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    await tool().handler({ folder: '/downloads', files: [mapped.path] });
    expect(capture.posts).toEqual([]);
  });

  it('needs exactly one of downloadId or folder, before any request', async () => {
    // No handlers: any request would fail with onUnhandledRequest: 'error'.
    await expect(tool().handler({})).rejects.toThrow(/exactly one of downloadId or folder/);
    await expect(tool().handler({ downloadId: 'H', folder: '/downloads' })).rejects.toThrow(
      /exactly one of downloadId or folder/,
    );
  });

  it('refuses confirm without files', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    await expect(tool().handler({ folder: '/downloads', confirm: true })).rejects.toThrow(
      /needs files/,
    );
    expect(capture.posts).toEqual([]);
  });

  it('posts one ManualImport built from the arr candidate, with the payload Sonarr expects', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    const result = await tool().handler({
      downloadId: 'HASH1',
      confirm: true,
      files: [mapped.path, mapped.path],
    });
    expect(capture.posts).toEqual([
      {
        name: 'ManualImport',
        importMode: 'auto',
        files: [
          {
            path: mapped.path,
            folderName: 'Show.S01E01',
            seriesId: 1,
            episodeIds: [19],
            quality,
            languages,
            releaseGroup: 'GRP',
            indexerFlags: 0,
            releaseType: 'singleEpisode',
            downloadId: 'HASH1',
          },
        ],
      },
    ]);
    expect(result).toMatchObject({ commandId: 77, status: 'queued', files: [mapped.path] });
  });

  it('refuses a path the arr did not list, and imports nothing', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    await expect(
      tool().handler({
        folder: '/downloads',
        confirm: true,
        files: [mapped.path, '/downloads/invented.mkv'],
      }),
    ).rejects.toThrow(/invented\.mkv: not among the candidates/);
    expect(capture.posts).toEqual([]);
  });

  it('refuses a rejected file unless overrideRejections is set', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    await expect(
      tool().handler({ folder: '/downloads', confirm: true, files: [rejected.path] }),
    ).rejects.toThrow(
      /rejected \(Unable to determine if file is a sample\); pass overrideRejections/,
    );
    expect(capture.posts).toEqual([]);

    await tool().handler({
      folder: '/downloads',
      confirm: true,
      files: [rejected.path],
      overrideRejections: true,
      importMode: 'copy',
    });
    expect(capture.posts).toEqual([
      expect.objectContaining({
        name: 'ManualImport',
        importMode: 'copy',
        files: [expect.objectContaining({ path: rejected.path, seriesId: 1, episodeIds: [20] })],
      }),
    ]);
  });

  it('refuses a file Sonarr matched to no series, even with overrideRejections', async () => {
    const capture = { posts: [] as unknown[] };
    serveCandidates(capture);
    await expect(
      tool().handler({
        folder: '/downloads',
        confirm: true,
        files: [unknown.path],
        overrideRejections: true,
      }),
    ).rejects.toThrow(/matched no series; pass seriesId/);
    expect(capture.posts).toEqual([]);
  });

  it('refuses to replace an episode file already in the library unless replaceExisting is set', async () => {
    const owned = {
      ...mapped,
      episodes: [{ id: 19, seasonNumber: 1, episodeNumber: 1, hasFile: true, episodeFileId: 5 }],
    };
    const posts: unknown[] = [];
    server.use(
      http.get(url('/manualimport'), () => HttpResponse.json([owned])),
      http.post(url('/command'), async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json({ id: 78, name: 'ManualImport', status: 'queued' });
      }),
    );
    const listed = (await tool().handler({ folder: '/downloads' })) as {
      candidates: Array<{ replacesExistingFile: boolean }>;
    };
    expect(listed.candidates[0]?.replacesExistingFile).toBe(true);
    await expect(
      tool().handler({
        folder: '/downloads',
        confirm: true,
        files: [owned.path],
        overrideRejections: true,
      }),
    ).rejects.toThrow(/already has a file in the library.*replaceExisting/);
    expect(posts).toEqual([]);
    await tool().handler({
      folder: '/downloads',
      confirm: true,
      files: [owned.path],
      replaceExisting: true,
    });
    expect(posts).toHaveLength(1);
  });

  it('lists at most 100 candidates with the total', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ ...mapped, path: `/d/${i}.mkv` }));
    server.use(http.get(url('/manualimport'), () => HttpResponse.json(many)));
    const result = (await tool().handler({ folder: '/d' })) as {
      total: number;
      candidates: unknown[];
    };
    expect(result.total).toBe(130);
    expect(result.candidates).toHaveLength(100);
  });
});
