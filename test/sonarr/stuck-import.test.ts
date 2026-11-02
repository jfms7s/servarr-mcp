import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSonarrClient } from '../../src/sonarr/client.js';
import { summarizeQueueRecord } from '../../src/sonarr/shape.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';
import type { QueueRecord } from '../../src/sonarr/types.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const base = 'http://sonarr.test:8989';
const client = createSonarrClient({ baseUrl: base, apiKey: 'k' });
const url = (path: string) => `${base}/api/v3${path}`;

describe('Sonarr queue rows carry the import verdict and the download id', () => {
  it('copies trackedDownloadStatus and downloadId', () => {
    const summary = summarizeQueueRecord({
      id: 1,
      title: 't',
      status: 'completed',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      downloadId: 'ABCDEF0123',
      size: 0,
      sizeleft: 0,
    } as QueueRecord);
    expect(summary).toMatchObject({
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      downloadId: 'ABCDEF0123',
    });
  });
});

describe('sonarr_get_wanted_cutoff', () => {
  it('pages GET /wanted/cutoff with the series and episode file, and reports the current quality', async () => {
    let query: Record<string, string> = {};
    server.use(
      http.get(url('/wanted/cutoff'), ({ request }) => {
        query = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json({
          page: 2,
          pageSize: 5,
          totalRecords: 6,
          records: [
            {
              id: 70,
              seriesId: 7,
              seasonNumber: 1,
              episodeNumber: 3,
              title: 'Ep',
              hasFile: true,
              monitored: true,
              overview: 'A plot.',
              series: { id: 7, title: 'Andor' },
              episodeFile: {
                id: 9,
                relativePath: 'a.mkv',
                size: 1,
                quality: { quality: { id: 4, name: 'HDTV-720p' } },
              },
            },
          ],
        });
      }),
    );
    const tool = createSonarrTools(client).find((t) => t.name === 'sonarr_get_wanted_cutoff');
    expect(tool?.effect).toBe('read');
    const result = (await tool!.handler({ page: 2, pageSize: 5 })) as {
      totalRecords: number;
      records: Array<Record<string, unknown>>;
    };
    expect(query).toEqual({
      page: '2',
      pageSize: '5',
      includeSeries: 'true',
      includeEpisodeFile: 'true',
    });
    expect(result.totalRecords).toBe(6);
    expect(result.records[0]).toMatchObject({
      id: 70,
      seriesTitle: 'Andor',
      currentQuality: 'HDTV-720p',
    });
    expect(result.records[0]).not.toHaveProperty('overview');
    expect(result.records[0]).not.toHaveProperty('episodeFile');
  });
});
