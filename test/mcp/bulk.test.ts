import { describe, expect, it, vi } from 'vitest';
import { MAX_MOVE_BATCH, assertMoveBatchSize, assertMoveFilesChosen, trackMoveCommand } from '../../src/mcp/bulk.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('assertMoveBatchSize', () => {
  it('allows a batch up to the limit when files are moved', () => {
    expect(() => assertMoveBatchSize(ids(MAX_MOVE_BATCH), true, 'radarr_bulk_edit_movies')).not.toThrow();
  });

  it('rejects a larger batch when files are moved, naming the limit and the tool', () => {
    expect(() => assertMoveBatchSize(ids(MAX_MOVE_BATCH + 1), true, 'radarr_bulk_edit_movies')).toThrow(
      new RegExp(`radarr_bulk_edit_movies.*${MAX_MOVE_BATCH}`),
    );
  });

  it('does not limit batches that do not move files', () => {
    expect(() => assertMoveBatchSize(ids(500), false, 'radarr_bulk_edit_movies')).not.toThrow();
    expect(() => assertMoveBatchSize(ids(500), undefined, 'radarr_bulk_edit_movies')).not.toThrow();
  });
});

describe('assertMoveFilesChosen', () => {
  it('rejects a root-folder change without moveFiles, naming the tool and both choices', () => {
    expect(() => assertMoveFilesChosen('/archive', undefined, 'sonarr_update_series')).toThrow(
      /sonarr_update_series.*moveFiles: true.*moveFiles: false/s,
    );
  });

  it('allows a root-folder change with either explicit choice', () => {
    expect(() => assertMoveFilesChosen('/archive', true, 'sonarr_update_series')).not.toThrow();
    expect(() => assertMoveFilesChosen('/archive', false, 'sonarr_update_series')).not.toThrow();
  });

  it('does not require moveFiles when the root folder is not changed', () => {
    expect(() => assertMoveFilesChosen(undefined, undefined, 'sonarr_update_series')).not.toThrow();
  });
});

describe('trackMoveCommand', () => {
  const names = ['BulkMoveMovie', 'MoveMovie'];
  const command = (id: number, name: string) => ({ id, name, status: 'queued' });

  it('returns the newest move command queued after the baseline', async () => {
    const listCommands = vi
      .fn()
      .mockResolvedValueOnce([command(40, 'BulkMoveMovie'), command(41, 'RefreshMovie')])
      .mockResolvedValueOnce([
        command(40, 'BulkMoveMovie'),
        command(41, 'RefreshMovie'),
        command(42, 'BulkMoveMovie'),
        command(43, 'RescanMovie'),
      ]);
    const run = vi.fn().mockResolvedValue('done');

    await expect(trackMoveCommand(listCommands, names, run)).resolves.toEqual({
      result: 'done',
      moveCommandId: 42,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(listCommands).toHaveBeenCalledTimes(2);
  });

  it('matches names with or without the Command suffix', async () => {
    const listCommands = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([command(7, 'MoveMovieCommand')]);
    const tracked = await trackMoveCommand(listCommands, names, async () => 'done');
    expect(tracked.moveCommandId).toBe(7);
  });

  it('ignores a move command that was already there before the call', async () => {
    const before = [command(40, 'BulkMoveMovie')];
    const listCommands = vi.fn().mockResolvedValue(before);
    const tracked = await trackMoveCommand(listCommands, names, async () => 'done');
    expect(tracked).toMatchObject({ result: 'done', moveCommandId: null });
    expect(tracked.moveCommandNote).toMatch(/no move command/i);
  });

  it('still returns the write result when the command list cannot be read', async () => {
    const listCommands = vi.fn().mockRejectedValue(new Error('boom'));
    const run = vi.fn().mockResolvedValue('done');
    const tracked = await trackMoveCommand(listCommands, names, run);
    expect(tracked).toMatchObject({ result: 'done', moveCommandId: null });
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not swallow a failed write', async () => {
    const listCommands = vi.fn().mockResolvedValue([]);
    await expect(
      trackMoveCommand(listCommands, names, () => Promise.reject(new Error('rejected'))),
    ).rejects.toThrow('rejected');
  });
});
