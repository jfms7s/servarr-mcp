import { describe, expect, it } from 'vitest';
import { createArrClient } from '../../src/http/client.js';
import { ArrApiError } from '../../src/http/errors.js';

describe('createArrClient network failures', () => {
  it('provides OS-level error detail for a real connection failure', async () => {
    // Point at a valid port nothing is listening on, with no MSW interceptor
    const client = createArrClient({
      product: 'Sonarr',
      baseUrl: 'http://127.0.0.1:54321',
      apiKey: 'test-key',
      apiBase: '/api/v3',
    });

    const error = (await client.get('/series').catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.status).toBeUndefined();
    // Real OS-level error indicators like ECONNREFUSED, ECONNRESET, etc.
    // Should contain indicators of connection failure, not the generic "fetch failed"
    expect(error.detail).toMatch(/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/);
    // Should NOT be the generic "fetch failed" message
    expect(error.detail).not.toBe('fetch failed');
  });
});
