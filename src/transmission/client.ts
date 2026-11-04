import type { InstanceConfig } from '../config.js';
import { currentRequestSignal } from '../http/cancellation.js';
import { DEFAULT_TIMEOUT_MS } from '../http/client.js';
import { ArrApiError, hasUserinfo } from '../http/errors.js';
import type {
  TorrentAction,
  TorrentGetArguments,
  TransmissionResponse,
  TransmissionTorrent,
} from './types.js';

const RPC_PATH = '/transmission/rpc';
const SESSION_HEADER = 'X-Transmission-Session-Id';
const PRODUCT = 'Transmission';

/** Fields every list row needs; the detail view adds the second set. */
export const LIST_FIELDS = [
  'hashString',
  'name',
  'status',
  'error',
  'errorString',
  'percentDone',
  'peersConnected',
  'uploadRatio',
  'totalSize',
  'rateDownload',
  'rateUpload',
  'eta',
  'isStalled',
] as const;
export const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'peersSendingToUs',
  'leftUntilDone',
  'addedDate',
  'doneDate',
  'downloadDir',
  'labels',
  'trackerStats',
] as const;

const ACTION_METHODS: Record<TorrentAction, string> = {
  start: 'torrent-start',
  start_now: 'torrent-start-now',
  stop: 'torrent-stop',
  verify: 'torrent-verify',
  reannounce: 'torrent-reannounce',
};

export interface TransmissionClient {
  /** Torrents with the given fields; every torrent when `hashes` is omitted. */
  getTorrents(
    fields: readonly string[],
    hashes?: readonly string[],
  ): Promise<TransmissionTorrent[]>;
  applyAction(action: TorrentAction, hashes: readonly string[]): Promise<void>;
  removeTorrents(hashes: readonly string[], deleteLocalData: boolean): Promise<void>;
}

/**
 * A Transmission JSON-RPC client. The daemon answers the first call with 409 and a
 * `X-Transmission-Session-Id` to echo; the client keeps it and retries once. A second 409 is an
 * error, not a loop. Basic credentials, when configured, go in the Authorization header and
 * never into a message.
 */
export function createTransmissionClient(config: InstanceConfig): TransmissionClient {
  const { baseUrl, username, password } = config;
  const credentialedBaseUrl = hasUserinfo(baseUrl);
  let sessionId: string | undefined;

  const fail = (detail: string, status?: number) =>
    new ArrApiError({
      product: PRODUCT,
      baseUrl: status === undefined ? baseUrl : undefined,
      method: 'POST',
      path: RPC_PATH,
      status,
      detail,
    });

  async function post(
    method: string,
    args: Record<string, unknown>,
    allowRetry: boolean,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const cancelled = currentRequestSignal();
    const signal = cancelled ? AbortSignal.any([timeout, cancelled]) : timeout;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (sessionId) headers[SESSION_HEADER] = sessionId;
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${RPC_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, arguments: args }),
        signal,
      });
    } catch (cause) {
      if (cancelled?.aborted && !timeout.aborted) throw fail('request cancelled by the client');
      if (timeout.aborted) throw fail(`no response within ${DEFAULT_TIMEOUT_MS / 1000} s`);
      const inner = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
      throw fail(inner instanceof Error ? inner.message : String(inner));
    }
    if (response.status === 409) {
      const fresh = response.headers.get(SESSION_HEADER);
      void response.body?.cancel().catch(() => undefined);
      if (!allowRetry || !fresh) {
        throw fail(
          fresh
            ? 'the session id was rejected again after one retry'
            : `the 409 carried no ${SESSION_HEADER} header`,
          409,
        );
      }
      sessionId = fresh;
      return post(method, args, false);
    }
    return response;
  }

  async function call<T>(method: string, args: Record<string, unknown>): Promise<T | undefined> {
    if (credentialedBaseUrl) {
      throw fail(
        'the base URL contains credentials (user:password@); use TRANSMISSION_USERNAME and TRANSMISSION_PASSWORD',
      );
    }
    const response = await post(method, args, true);
    if (response.status === 401) {
      void response.body?.cancel().catch(() => undefined);
      throw fail('Transmission rejected the credentials (set TRANSMISSION_USERNAME/PASSWORD)', 401);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw fail(`unexpected HTTP status for ${method}`, response.status);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw fail('the response body could not be read (timed out or cancelled)', response.status);
    }
    let parsed: TransmissionResponse<T>;
    try {
      parsed = JSON.parse(text) as TransmissionResponse<T>;
    } catch {
      throw fail('response was not valid JSON', response.status);
    }
    if (parsed.result !== 'success') {
      throw fail(`${method} failed: ${String(parsed.result).slice(0, 200)}`, response.status);
    }
    return parsed.arguments;
  }

  return {
    getTorrents: async (fields, hashes) => {
      const args: Record<string, unknown> = { fields };
      if (hashes) args.ids = hashes;
      return (await call<TorrentGetArguments>('torrent-get', args))?.torrents ?? [];
    },
    applyAction: async (action, hashes) => {
      await call(ACTION_METHODS[action], { ids: hashes });
    },
    removeTorrents: async (hashes, deleteLocalData) => {
      await call('torrent-remove', { ids: hashes, 'delete-local-data': deleteLocalData });
    },
  };
}
