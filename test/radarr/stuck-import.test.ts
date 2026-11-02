import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRadarrClient } from '../../src/radarr/client.js';
import { summarizeQueueRecord } from '../../src/radarr/shape.js';
import { createRadarrTools } from '../../src/radarr/tools.js';
import type { QueueRecord } from '../../src/radarr/types.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://radarr.test:7878';
const client = createRadarrClient({ baseUrl: base, apiKey: 'k' });
const url = (path: string) => `${base}/api/v3${path}`;

describe('Radarr queue rows carry the import verdict and the download id', () => {
  it('copies trackedDownloadStatus and downloadId', () => {
    const summary = summarizeQueueRecord({
      id: 1,
      movieId: 4,
      title: 't',
      status: 'completed',
      trackedDownloadStatus: 'error',
      downloadId: 'ABCDEF0123',
      size: 0,
      sizeleft: 0,
    } as QueueRecord);
    expect(summary).toMatchObject({
      movieId: 4,
      trackedDownloadStatus: 'error',
      downloadId: 'ABCDEF0123',
    });
  });
});

describe('radarr_get_wanted_cutoff', () => {
  it('pages GET /wanted/cutoff and reports the current quality', async () => {
    let query: Record<string, string> = {};
    server.use(
      http.get(url('/wanted/cutoff'), ({ request }) => {
        query = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json({
          page: 1,
          pageSize: 10,
          totalRecords: 1,
          records: [
            {
              id: 4,
              title: 'Arrival',
              year: 2016,
              status: 'released',
              monitored: true,
              hasFile: true,
              qualityProfileId: 1,
              tmdbId: 329865,
              tags: [],
              overview: 'A plot.',
              movieFile: {
                id: 3,
                relativePath: 'a.mkv',
                size: 1,
                quality: { quality: { id: 4, name: 'HDTV-720p' } },
              },
            },
          ],
        });
      }),
    );
    const tool = createRadarrTools(client).find((t) => t.name === 'radarr_get_wanted_cutoff');
    expect(tool?.effect).toBe('read');
    const result = (await tool!.handler({ page: 1, pageSize: 10 })) as {
      records: Array<Record<string, unknown>>;
    };
    expect(query).toEqual({ page: '1', pageSize: '10' });
    expect(result.records[0]).toMatchObject({ id: 4, currentQuality: 'HDTV-720p' });
    expect(result.records[0]).not.toHaveProperty('overview');
  });
});
