import { describe, expect, it } from 'vitest';
import { MAX_MOVE_BATCH, assertMoveBatchSize } from '../../src/mcp/bulk.js';

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
