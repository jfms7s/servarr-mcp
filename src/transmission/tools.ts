import { z } from 'zod';
import { listWindow, pageOf } from '../arr/paging.js';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import { DETAIL_FIELDS, LIST_FIELDS, type TransmissionClient } from './client.js';
import {
  isSeeding,
  isStalled,
  normalizeHash,
  ratioValue,
  summarizeTorrent,
  summarizeTorrentDetail,
} from './shape.js';
import type { TorrentAction } from './types.js';

/** Transmission's hashString: SHA-1 (40 hex) or, for a v2-only torrent, SHA-256 (64). */
const hash = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i, 'a 40 or 64 character hex torrent hash')
  .describe(
    'Torrent hash (hashString), in either case. An arr queue item carries it as downloadId.',
  );

const ACTIONS = ['start', 'start_now', 'stop', 'verify', 'reannounce'] as const;
const MAX_HASHES = 50;

export function createTransmissionTools(client: TransmissionClient): ToolDefinition[] {
  async function findOne(raw: string) {
    const wanted = normalizeHash(raw);
    const [torrent] = await client.getTorrents(DETAIL_FIELDS, [wanted]);
    if (!torrent) throw new Error(`Transmission has no torrent with hash ${wanted}`);
    return torrent;
  }

  return [
    defineTool({
      name: 'transmission_list_torrents',
      effect: 'read',
      description:
        'List Transmission torrents: hash, name, status, percentDone, peersConnected, stalled, ' +
        'error/errorString (a tracker error, or a local one such as a full disk), uploadRatio and ' +
        'rates. Filters combine. Use transmission_get_torrent for trackers and paths. To find the ' +
        "torrent behind a stuck arr queue item, pass the item's downloadId as hash.",
      inputSchema: {
        hash: hash.optional(),
        nameContains: z.string().min(1).optional().describe('Case-insensitive part of the name'),
        stalled: z
          .boolean()
          .optional()
          .describe(
            'true: only downloading torrents with no connected peer (not paused, queued or verifying)',
          ),
        errored: z
          .boolean()
          .optional()
          .describe('true: only torrents with a tracker or local error'),
        seeding: z.boolean().optional().describe('true: only torrents seeding or queued to seed'),
        ratioAbove: z
          .number()
          .min(0)
          .optional()
          .describe('Only torrents with a larger upload ratio'),
        ...listWindow,
      },
      handler: async (args) => {
        const torrents = await client.getTorrents(
          LIST_FIELDS,
          args.hash ? [normalizeHash(args.hash)] : undefined,
        );
        const needle = args.nameContains?.toLowerCase();
        const matched = torrents.filter(
          (torrent) =>
            (needle === undefined || (torrent.name ?? '').toLowerCase().includes(needle)) &&
            (args.stalled === undefined || isStalled(torrent) === args.stalled) &&
            (args.errored === undefined || ((torrent.error ?? 0) !== 0) === args.errored) &&
            (args.seeding === undefined || isSeeding(torrent) === args.seeding) &&
            (args.ratioAbove === undefined || ratioValue(torrent) > args.ratioAbove),
        );
        const { rows, ...window } = pageOf(matched.map(summarizeTorrent), args);
        return { ...window, torrents: rows };
      },
    }),

    defineTool({
      name: 'transmission_get_torrent',
      effect: 'read',
      description:
        'Get one torrent by hash: everything transmission_list_torrents shows plus download ' +
        'directory, labels, dates and each tracker with its last announce result. This is where ' +
        'to read why a torrent is stalled (no seeders, tracker refused, disk full).',
      inputSchema: { hash },
      handler: async ({ hash: raw }) => summarizeTorrentDetail(await findOne(raw)),
    }),

    defineTool({
      name: 'transmission_control_torrents',
      effect: 'write',
      description:
        'Start, stop, verify or reannounce torrents by hash. start queues like the UI; start_now ' +
        'skips the queue. Nothing is deleted. Unknown hashes fail the whole call before anything runs.',
      inputSchema: {
        hashes: z.array(hash).min(1).max(MAX_HASHES).describe('Torrent hashes'),
        action: z.enum(ACTIONS).describe('What to do with them'),
      },
      handler: async ({ hashes, action }) => {
        const wanted = [...new Set(hashes.map(normalizeHash))];
        const found = new Set(
          (await client.getTorrents(['hashString'], wanted)).map((t) =>
            t.hashString?.toLowerCase(),
          ),
        );
        const missing = wanted.filter((h) => !found.has(h));
        if (missing.length > 0) {
          throw new Error(`Transmission has no torrent with hash ${missing.join(', ')}`);
        }
        await client.applyAction(action as TorrentAction, wanted);
        return { action, hashes: wanted };
      },
    }),

    defineTool({
      name: 'transmission_remove_torrent',
      effect: 'destructive',
      description:
        'Remove one torrent from Transmission. Without confirm: true nothing is removed and the ' +
        'torrent is returned as a preview. deleteData: true also deletes the downloaded files from ' +
        'disk, which an arr that has not imported them yet will lose; by default the files stay. ' +
        'To drop a stuck arr queue item, prefer sonarr_delete_queue_item / radarr_delete_queue_item.',
      inputSchema: {
        hash,
        deleteData: z
          .boolean()
          .optional()
          .describe('Also delete the downloaded data (default false)'),
        confirm: z.boolean().optional().describe('Must be true to remove anything'),
      },
      handler: async ({ hash: raw, deleteData = false, confirm }) => {
        const torrent = await findOne(raw);
        const summary = summarizeTorrentDetail(torrent);
        if (confirm !== true) {
          return {
            removed: false,
            wouldDeleteData: deleteData,
            torrent: summary,
            note: 'Nothing was removed. Call again with confirm: true to remove it.',
          };
        }
        await client.removeTorrents([normalizeHash(raw)], deleteData);
        return { removed: true, deletedData: deleteData, torrent: summary };
      },
    }),
  ];
}
