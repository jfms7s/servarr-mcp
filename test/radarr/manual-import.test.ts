import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://radarr.test:7878';
const url = (path: string) => `${base}/api/v3${path}`;

function tool() {
  const client = createRadarrClient({ baseUrl: base, apiKey: 'k' });
  const found = createRadarrTools(client).find((t) => t.name === 'radarr_manual_import');
  if (!found) throw new Error('radarr_manual_import is not registered');
  return found;
}

const quality = { quality: { id: 7, name: 'Bluray-1080p' }, revision: { version: 1, real: 0 } };
const languages = [{ id: 1, name: 'English' }];
// Rows as Radarr v6 returns them from GET /manualimport (trimmed).
const mapped = {
  id: 21,
  path: '/downloads/Movie.1999/Movie.1999.mkv',
  relativePath: 'Movie.1999.mkv',
  folderName: 'Movie.1999',
  name: 'Movie.1999',
  size: 2000,
  movie: { id: 1, title: 'Movie', year: 1999, overview: 'long', images: [] },
  releaseGroup: 'GRP',
  quality,
  languages,
  qualityWeight: 20,
  customFormats: [],
  indexerFlags: 0,
  rejections: [{ reason: 'Unable to determine if file is a sample', type: 'permanent' }],
};
const unknown = {
  id: 22,
  path: '/downloads/Other/Other.mkv',
  size: 1000,
  quality,
  rejections: [{ reason: 'Unknown Movie', type: 'permanent' }],
};

function serveCandidates(capture: { query?: Record<string, string>; posts: unknown[] }) {
  server.use(
    http.get(url('/manualimport'), ({ request }) => {
      capture.query = Object.fromEntries(new URL(request.url).searchParams);
      return HttpResponse.json([mapped, unknown]);
    }),
    http.post(url('/command'), async ({ request }) => {
      capture.posts.push(await request.json());
      return HttpResponse.json({ id: 88, name: 'ManualImport', status: 'queued' });
    }),
  );
}

describe('radarr_manual_import', () => {
  it('without confirm lists shaped candidates with rejections and posts nothing', async () => {
    const capture: { query?: Record<string, string>; posts: unknown[] } = { posts: [] };
    serveCandidates(capture);
    const result = (await tool().handler({ folder: '/downloads', movieId: 1 })) as {
      candidates: unknown[];
    };
    expect(capture.query).toEqual({
      folder: '/downloads',
      movieId: '1',
      filterExistingFiles: 'true',
    });
    expect(capture.posts).toEqual([]);
    expect(result.candidates).toEqual([
      {
        path: mapped.path,
        size: 2000,
        quality: 'Bluray-1080p',
        languages: ['English'],
        releaseGroup: 'GRP',
        movie: { id: 1, title: 'Movie', year: 1999 },
        rejections: ['Unable to determine if file is a sample'],
      },
      expect.objectContaining({ path: unknown.path, rejections: ['Unknown Movie'] }),
    ]);
  });

  it('needs exactly one of downloadId or folder, before any request', async () => {
    await expect(tool().handler({ movieId: 1 })).rejects.toThrow(/exactly one/);
  });

  it('refuses a rejected file without overrideRejections, then posts the Radarr payload with it', async () => {
    const capture: { posts: unknown[] } = { posts: [] };
    serveCandidates(capture);
    await expect(
      tool().handler({ downloadId: 'HASH9', confirm: true, files: [mapped.path] }),
    ).rejects.toThrow(/pass overrideRejections/);
    expect(capture.posts).toEqual([]);

    const result = await tool().handler({
      downloadId: 'HASH9',
      confirm: true,
      files: [mapped.path],
      overrideRejections: true,
    });
    expect(capture.posts).toEqual([
      {
        name: 'ManualImport',
        importMode: 'auto',
        files: [
          {
            path: mapped.path,
            folderName: 'Movie.1999',
            movieId: 1,
            quality,
            languages,
            releaseGroup: 'GRP',
            indexerFlags: 0,
            downloadId: 'HASH9',
          },
        ],
      },
    ]);
    expect(result).toMatchObject({ commandId: 88, files: [mapped.path] });
  });

  it('refuses unlisted paths and files matched to no movie, importing nothing', async () => {
    const capture: { posts: unknown[] } = { posts: [] };
    serveCandidates(capture);
    await expect(
      tool().handler({
        folder: '/downloads',
        confirm: true,
        files: ['/etc/passwd', unknown.path],
        overrideRejections: true,
      }),
    ).rejects.toThrow(/passwd: not among the candidates[\s\S]*Other\.mkv: Radarr matched no movie/);
    expect(capture.posts).toEqual([]);
  });
});
