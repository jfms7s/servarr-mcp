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

  it('names the configured base URL when the connection never landed', () => {
    // The spec requires the URL here, and it is load-bearing: Node supplies a
    // hostname only for DNS failures. On ECONNREFUSED -- a live host on the
    // wrong port, or a restarting container -- its message is a bare
    // "connect ECONNREFUSED <ip>:<port>" that never reveals which configured
    // URL produced it. Without this the reader cannot tell a misconfigured
    // URL from a down service.
    const error = new ArrApiError({
      product: 'Radarr',
      baseUrl: 'http://media-center-radarr.media-center.svc.cluster.local:7878',
      method: 'GET',
      path: '/api/v3/movie',
      detail: 'connect ECONNREFUSED 10.43.206.224:7878',
    });
    expect(error.message).toBe(
      'Cannot reach Radarr at http://media-center-radarr.media-center.svc.cluster.local:7878 ' +
        'for GET /api/v3/movie: connect ECONNREFUSED 10.43.206.224:7878',
    );
  });

  it('strips credentials from a base URL before putting it in a message', () => {
    // SONARR_URL is user-supplied and could carry userinfo. Every other
    // secret-handling path in this codebase is defensive to the point of
    // reading and discarding 401 bodies; this must not be the hole.
    const error = new ArrApiError({
      product: 'Sonarr',
      baseUrl: 'http://admin:hunter2@sonarr.local:8989',
      method: 'GET',
      path: '/api/v3/series',
      detail: 'connect ECONNREFUSED 10.0.0.1:8989',
    });
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('admin');
    expect(error.message).toContain('http://sonarr.local:8989');
  });

  it('omits the URL when it is unknown', () => {
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

  it('leaves messages that carry a status alone -- the request reached the server', () => {
    const error = new ArrApiError({
      product: 'Sonarr',
      baseUrl: 'http://sonarr.local:8989',
      method: 'GET',
      path: '/api/v3/series/42',
      status: 404,
      detail: 'series not found',
    });
    expect(error.message).toBe('Sonarr returned 404 for GET /api/v3/series/42: series not found');
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
