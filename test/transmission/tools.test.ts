import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { TransmissionClient } from '../../src/transmission/client.js';
import { createTransmissionTools } from '../../src/transmission/tools.js';
import type { TransmissionTorrent } from '../../src/transmission/types.js';

const H1 = '1'.repeat(40);
const H2 = 'AB'.repeat(20);
const torrents: TransmissionTorrent[] = [
  {
    hashString: H1,
    name: 'Stalled.Show.S01',
    status: 4,
    percentDone: 0.4,
    peersConnected: 0,
    error: 0,
    uploadRatio: 0.1,
  },
  {
    hashString: H2.toLowerCase(),
    name: 'Healthy.Movie',
    status: 4,
    percentDone: 0.5,
    peersConnected: 8,
    error: 0,
    uploadRatio: 0,
  },
  {
    hashString: '3'.repeat(40),
    name: 'Seeded.Movie',
    status: 6,
    percentDone: 1,
    peersConnected: 0,
    error: 0,
    uploadRatio: 2.5,
  },
  {
    hashString: '4'.repeat(40),
    name: 'Full.Disk',
    status: 0,
    percentDone: 0.9,
    peersConnected: 0,
    error: 3,
    errorString: 'No space left on device',
    uploadRatio: -1,
  },
  {
    hashString: '7'.repeat(40),
    name: 'Queued.Show',
    status: 3,
    percentDone: 0,
    peersConnected: 0,
    error: 0,
    uploadRatio: 0,
  },
  {
    hashString: '8'.repeat(40),
    name: 'Verifying.Show',
    status: 2,
    percentDone: 0.3,
    peersConnected: 0,
    error: 0,
    uploadRatio: 0,
  },
  {
    hashString: 'c'.repeat(40),
    name: 'Seed.Only',
    status: 6,
    percentDone: 1,
    peersConnected: 0,
    error: 0,
    uploadRatio: -2,
  },
  {
    hashString: '5'.repeat(40),
    name: 'Paused.Show',
    status: 0,
    percentDone: 0.2,
    peersConnected: 0,
    error: 0,
    uploadRatio: 0,
  },
  {
    hashString: '6'.repeat(40),
    name: 'Bad.Tracker',
    status: 4,
    percentDone: 0.1,
    peersConnected: 3,
    error: 2,
    errorString: 'Tracker gave an error',
    uploadRatio: 0,
  },
];

function fake() {
  const client: TransmissionClient = {
    getTorrents: vi.fn(async (_fields, hashes) =>
      hashes ? torrents.filter((t) => hashes.includes(t.hashString ?? '')) : torrents,
    ),
    applyAction: vi.fn(async () => undefined),
    removeTorrents: vi.fn(async () => undefined),
  };
  const tools = Object.fromEntries(createTransmissionTools(client).map((t) => [t.name, t]));
  const run = (name: string, args: Record<string, unknown>) => {
    const tool = tools[name]!;
    return tool.handler(z.object(tool.inputSchema).parse(args));
  };
  return { client, tools, run };
}

const names = (result: unknown) =>
  (result as { torrents: Array<{ name: string }> }).torrents.map((t) => t.name);

describe('transmission tools', () => {
  it('classifies the four tools', () => {
    const { tools } = fake();
    expect(Object.fromEntries(Object.entries(tools).map(([n, t]) => [n, t.effect]))).toEqual({
      transmission_list_torrents: 'read',
      transmission_get_torrent: 'read',
      transmission_control_torrents: 'write',
      transmission_remove_torrent: 'destructive',
    });
  });

  describe('list', () => {
    it('stalled: true returns only unfinished, running torrents with no peers', async () => {
      expect(names(await fake().run('transmission_list_torrents', { stalled: true }))).toEqual([
        'Stalled.Show.S01',
      ]); // not Queued.Show, Verifying.Show, Paused.Show or the seeders
    });

    it('errored: true returns tracker and local errors with their message', async () => {
      const result = await fake().run('transmission_list_torrents', { errored: true });
      expect(names(result)).toEqual(['Full.Disk', 'Bad.Tracker']);
      expect((result as { torrents: unknown[] }).torrents[0]).toMatchObject({
        error: 'local error',
        errorString: 'No space left on device',
      });
    });

    it('seeding and ratioAbove filter, and combine', async () => {
      const { run } = fake();
      expect(names(await run('transmission_list_torrents', { seeding: true }))).toEqual([
        'Seeded.Movie',
        'Seed.Only',
      ]);
      expect(names(await run('transmission_list_torrents', { ratioAbove: 2 }))).toEqual([
        'Seeded.Movie',
        'Seed.Only',
      ]);
      const inf = (await run('transmission_list_torrents', { hash: 'c'.repeat(40) })) as {
        torrents: Array<{ uploadRatio?: unknown }>;
      };
      expect(inf.torrents[0]?.uploadRatio).toBe('infinite');
      expect(
        names(await run('transmission_list_torrents', { ratioAbove: 2, stalled: true })),
      ).toEqual([]);
    });

    it('matches nameContains without case, and pages with totalMatched', async () => {
      const { run } = fake();
      expect(names(await run('transmission_list_torrents', { nameContains: 'MOVIE' }))).toEqual([
        'Healthy.Movie',
        'Seeded.Movie',
      ]);
      const page = (await run('transmission_list_torrents', { limit: 2, offset: 1 })) as {
        totalMatched: number;
        torrents: unknown[];
      };
      expect(page.totalMatched).toBe(9);
      expect(page.torrents).toHaveLength(2);
    });

    it('looks a hash up in either case and asks the daemon for that id only', async () => {
      const { client, run } = fake();
      expect(names(await run('transmission_list_torrents', { hash: H2 }))).toEqual([
        'Healthy.Movie',
      ]);
      expect(client.getTorrents).toHaveBeenCalledWith(expect.anything(), [H2.toLowerCase()]);
    });

    it('rejects a malformed hash', () => {
      expect(() => fake().run('transmission_list_torrents', { hash: 'nope' })).toThrow();
    });
  });

  describe('get', () => {
    it('finds a torrent by a hash in either case', async () => {
      const { run } = fake();
      for (const given of [H2, H2.toLowerCase()])
        expect(await run('transmission_get_torrent', { hash: given })).toMatchObject({
          name: 'Healthy.Movie',
        });
    });

    it('says so when the hash is unknown', async () => {
      await expect(
        fake().run('transmission_get_torrent', { hash: '9'.repeat(40) }),
      ).rejects.toThrow(/no torrent with hash 9{40}/);
    });
  });

  describe('control', () => {
    it('applies the action to the normalised, de-duplicated hashes', async () => {
      const { client, run } = fake();
      await run('transmission_control_torrents', {
        hashes: [H2, H2.toLowerCase(), H1],
        action: 'stop',
      });
      expect(client.applyAction).toHaveBeenCalledWith('stop', [H2.toLowerCase(), H1]);
    });

    it('applies nothing when any hash is unknown', async () => {
      const { client, run } = fake();
      await expect(
        run('transmission_control_torrents', { hashes: [H1, '9'.repeat(40)], action: 'start' }),
      ).rejects.toThrow(/no torrent with hash 9{40}/);
      expect(client.applyAction).not.toHaveBeenCalled();
    });

    it('rejects an unknown action and an empty list', () => {
      const { run } = fake();
      expect(() =>
        run('transmission_control_torrents', { hashes: [H1], action: 'delete' }),
      ).toThrow();
      expect(() => run('transmission_control_torrents', { hashes: [], action: 'stop' })).toThrow();
    });
  });

  describe('remove', () => {
    it('without confirm removes nothing and previews the torrent', async () => {
      const { client, run } = fake();
      const result = await run('transmission_remove_torrent', { hash: H1, deleteData: true });
      expect(client.removeTorrents).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        removed: false,
        wouldDeleteData: true,
        torrent: { name: 'Stalled.Show.S01' },
      });
    });

    it('confirm: false is not a confirmation', async () => {
      const { client, run } = fake();
      await run('transmission_remove_torrent', { hash: H1, confirm: false });
      expect(client.removeTorrents).not.toHaveBeenCalled();
    });

    it('with confirm and deleteData sends delete-local-data true', async () => {
      const { client, run } = fake();
      await run('transmission_remove_torrent', { hash: H2, deleteData: true, confirm: true });
      expect(client.removeTorrents).toHaveBeenCalledWith([H2.toLowerCase()], true);
    });

    it('keeps the files by default', async () => {
      const { client, run } = fake();
      await run('transmission_remove_torrent', { hash: H1, confirm: true });
      expect(client.removeTorrents).toHaveBeenCalledWith([H1], false);
    });

    it('fails on an unknown hash before removing', async () => {
      const { client, run } = fake();
      await expect(
        run('transmission_remove_torrent', { hash: '9'.repeat(40), confirm: true }),
      ).rejects.toThrow();
      expect(client.removeTorrents).not.toHaveBeenCalled();
    });
  });
});
