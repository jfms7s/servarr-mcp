import { describe, expect, it } from 'vitest';
import { ArrApiError, describeError } from '../../src/http/errors.js';

describe('ArrApiError', () => {
  it('formats a message with status, method and path', () => {
    const error = new ArrApiError({
      product: 'Sonarr',
      method: 'GET',
      path: '/api/v3/series/42',
      status: 404,
      detail: 'series not found',
    });
    expect(error.message).toBe('Sonarr returned 404 for GET /api/v3/series/42: series not found');
    expect(error.name).toBe('ArrApiError');
    expect(error.status).toBe(404);
  });

  it('formats a message without a status as unreachable', () => {
    const error = new ArrApiError({
      product: 'Radarr',
      method: 'GET',
      path: '/api/v3/movie',
      detail: 'connect ECONNREFUSED 127.0.0.1:7878',
    });
    expect(error.message).toBe(
      'Cannot reach Radarr for GET /api/v3/movie: connect ECONNREFUSED 127.0.0.1:7878',
    );
  });
});

describe('describeError', () => {
  it('returns the message of an ArrApiError', () => {
    const error = new ArrApiError({
      product: 'Sonarr',
      method: 'GET',
      path: '/api/v3/health',
      status: 401,
      detail: 'Sonarr rejected the API key',
    });
    expect(describeError(error)).toBe(error.message);
  });

  it('returns the message of a plain Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(describeError('kaboom')).toBe('kaboom');
    expect(describeError(42)).toBe('42');
  });
});
