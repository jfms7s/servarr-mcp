import { describe, expect, it } from 'vitest';
import { redactHistoryData } from '../../src/mcp/redact.js';

describe('redactHistoryData', () => {
  it('passes undefined through', () => {
    expect(redactHistoryData(undefined)).toBeUndefined();
  });

  it('drops every key ending in url, whatever its case', () => {
    expect(
      redactHistoryData({
        downloadUrl: 'http://a/x',
        nzbInfoUrl: 'http://b/y',
        DownloadUrl: 'http://c/z',
        url: 'http://d',
        indexer: 'X',
      }),
    ).toEqual({ indexer: 'X' });
  });

  it('strips credentials from URL values in other keys', () => {
    const result = redactHistoryData({
      source: 'https://user:pw@tracker.example/announce?passkey=P1&ApiKey=A1&token=T1&keep=yes',
    });
    const url = new URL(result!.source!);
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.searchParams.get('keep')).toBe('yes');
    for (const leaked of ['P1', 'A1', 'T1', 'pw']) expect(result!.source).not.toContain(leaked);
  });

  it('scrubs credential parameters in values that are not URLs', () => {
    expect(redactHistoryData({ message: 'grabbed via passkey=abc and token=def' })).toEqual({
      message: 'grabbed via passkey=REDACTED and token=REDACTED',
    });
  });

  it('leaves plain values untouched', () => {
    const data = { reason: 'Not an upgrade', droppedPath: '/downloads/x', releaseGroup: 'GRP' };
    expect(redactHistoryData(data)).toEqual(data);
  });
});
