import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { ProwlarrClient } from './client.js';
import {
  summarizeApplication,
  summarizeDownloadClient,
  summarizeHistoryRecord,
  summarizeIndexer,
  summarizeRelease,
} from './shape.js';

export function createProwlarrTools(client: ProwlarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'prowlarr_search',
      description:
        'Search configured indexers for releases. Returns release guids that can be handed to ' +
        'prowlarr_grab_release. Use prowlarr_list_indexers and prowlarr_list_categories to ' +
        'find the ids for the optional filters.',
      inputSchema: {
        query: z.string().min(1).describe('Search term'),
        indexerIds: z
          .array(z.number().int())
          .optional()
          .describe('Restrict to these indexer ids (default: all enabled)'),
        categories: z
          .array(z.number().int())
          .optional()
          .describe('Restrict to these newznab category ids, e.g. 2000 for movies'),
        limit: z.number().int().min(1).max(200).optional().describe('Max results (default 100)'),
      },
      handler: async (args) => (await client.search(args)).map(summarizeRelease),
    }),

    defineTool({
      name: 'prowlarr_grab_release',
      description:
        'Send a release to the download client configured in Prowlarr. Get guid and indexerId ' +
        'from prowlarr_search. This bypasses Sonarr and Radarr: they will not track or import ' +
        'the download. For a TV episode or movie, use sonarr_grab_release or ' +
        'radarr_grab_release instead.',
      inputSchema: {
        guid: z.string().min(1).describe('Release guid from prowlarr_search'),
        indexerId: z.number().int().describe('Indexer id from prowlarr_search'),
      },
      handler: ({ guid, indexerId }) => client.grabRelease({ guid, indexerId }),
    }),

    defineTool({
      name: 'prowlarr_list_indexers',
      description:
        'List configured indexers with their protocol, priority and enabled state. Use ' +
        'prowlarr_get_indexer for one indexer\'s full configuration, including its fields.',
      inputSchema: {},
      handler: async () => (await client.listIndexers()).map(summarizeIndexer),
    }),

    defineTool({
      name: 'prowlarr_get_indexer',
      description: 'Get details about a specific configured indexer.',
      inputSchema: {
        indexerId: z.number().int().describe('The indexer id'),
      },
      handler: ({ indexerId }) => client.getIndexer(indexerId),
    }),

    defineTool({
      name: 'prowlarr_test_indexer',
      description: 'Test the connectivity of a configured indexer to its source.',
      inputSchema: {
        indexerId: z.number().int().describe('The indexer id to test'),
      },
      handler: async ({ indexerId }) => {
        const indexer = await client.getIndexer(indexerId);
        return client.testIndexer(indexer);
      },
    }),

    defineTool({
      name: 'prowlarr_get_indexer_stats',
      description:
        'Get query and grab statistics for each indexer, including failure counts and response times.',
      inputSchema: {},
      handler: () => client.getIndexerStats(),
    }),

    defineTool({
      name: 'prowlarr_get_indexer_status',
      description:
        'Get the health/backoff status of configured indexers. Reports which indexers are ' +
        'temporarily disabled due to failures.',
      inputSchema: {},
      handler: () => client.getIndexerStatus(),
    }),

    defineTool({
      name: 'prowlarr_list_categories',
      description:
        'List newznab categories supported by configured indexers. Use these ids with ' +
        'prowlarr_search to filter by content type (2000-range: movies, 5000-range: TV, ' +
        '3000-range: audio, 7000-range: books).',
      inputSchema: {},
      handler: () => client.listCategories(),
    }),

    defineTool({
      name: 'prowlarr_get_history',
      description: 'Get the history of indexer queries and grabs.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
        pageSize: z.number().int().min(1).optional().describe('Results per page (default 20)'),
        eventType: z.number().int().optional().describe('Filter by event type'),
      },
      handler: async (args) => {
        const response = await client.getHistory(args);
        return { ...response, records: response.records.map(summarizeHistoryRecord) };
      },
    }),

    defineTool({
      name: 'prowlarr_list_applications',
      description:
        'List the *arr applications (Sonarr, Radarr, etc.) that Prowlarr syncs indexers to.',
      inputSchema: {},
      handler: async () => (await client.listApplications()).map(summarizeApplication),
    }),

    defineTool({
      name: 'prowlarr_list_download_clients',
      description: 'List download clients configured in Prowlarr.',
      inputSchema: {},
      handler: async () => (await client.listDownloadClients()).map(summarizeDownloadClient),
    }),

    defineTool({
      name: 'prowlarr_run_command',
      description:
        'Run an administrative command. ApplicationIndexerSync pushes Prowlarr indexer ' +
        'configuration to connected apps like Sonarr and Radarr. IndexerHealthCheck ' +
        're-checks whether configured indexers are reachable.',
      inputSchema: {
        name: z
          .enum(['ApplicationIndexerSync', 'IndexerHealthCheck'])
          .describe('Command name'),
      },
      handler: ({ name }) => client.runCommand({ name }),
    }),

    defineTool({
      name: 'prowlarr_get_system_status',
      description: 'Get the Prowlarr application version, name, and host information.',
      inputSchema: {},
      handler: () => client.getSystemStatus(),
    }),

    defineTool({
      name: 'prowlarr_get_health',
      description: 'Get health check results for Prowlarr and any detected issues.',
      inputSchema: {},
      handler: () => client.getHealth(),
    }),
  ];
}
