import { TorrentStatus, type TransmissionTorrent } from './types.js';

const STATUS_NAMES: Record<number, string> = {
  [TorrentStatus.Stopped]: 'stopped',
  [TorrentStatus.CheckWait]: 'queued to verify',
  [TorrentStatus.Checking]: 'verifying',
  [TorrentStatus.DownloadWait]: 'queued to download',
  [TorrentStatus.Downloading]: 'downloading',
  [TorrentStatus.SeedWait]: 'queued to seed',
  [TorrentStatus.Seeding]: 'seeding',
};

const ERROR_KINDS: Record<number, string> = {
  1: 'tracker warning',
  2: 'tracker error',
  3: 'local error',
};

/** A hash as Transmission reports it (lowercase), whatever case the caller used. */
export function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase();
}

export function isComplete(torrent: TransmissionTorrent): boolean {
  return (torrent.percentDone ?? 0) >= 1;
}

/**
 * Downloading, unfinished and with no peer to get data from. A paused, queued or verifying
 * torrent has no peers either, but it is not stalled.
 */
export function isStalled(torrent: TransmissionTorrent): boolean {
  return (
    !isComplete(torrent) &&
    torrent.status === TorrentStatus.Downloading &&
    (torrent.peersConnected ?? 0) === 0
  );
}

/** Transmission reports -1 for a ratio not yet known and -2 for an infinite one. */
const RATIO_INFINITE = -2;

/** The ratio as a number for comparing; infinite beats any threshold, unknown matches none. */
export function ratioValue(torrent: TransmissionTorrent): number {
  const value = torrent.uploadRatio;
  if (value === RATIO_INFINITE) return Infinity;
  return value === undefined || value < 0 ? -1 : value;
}

export function isSeeding(torrent: TransmissionTorrent): boolean {
  return torrent.status === TorrentStatus.Seeding || torrent.status === TorrentStatus.SeedWait;
}

function percent(fraction: number | undefined): number | undefined {
  return fraction === undefined ? undefined : Math.round(fraction * 1000) / 10;
}

function ratio(value: number | undefined): number | 'infinite' | undefined {
  if (value === RATIO_INFINITE) return 'infinite';
  return value === undefined || value < 0 ? undefined : Math.round(value * 100) / 100;
}

export function summarizeTorrent(torrent: TransmissionTorrent) {
  const failing = (torrent.error ?? 0) !== 0;
  return {
    hash: torrent.hashString,
    name: torrent.name,
    status: STATUS_NAMES[torrent.status ?? -1] ?? `unknown (${torrent.status})`,
    percentDone: percent(torrent.percentDone),
    peersConnected: torrent.peersConnected,
    stalled: isStalled(torrent),
    ...(failing && {
      error: ERROR_KINDS[torrent.error ?? 0] ?? `error ${torrent.error}`,
      errorString: torrent.errorString || undefined,
    }),
    uploadRatio: ratio(torrent.uploadRatio),
    totalSize: torrent.totalSize,
    rateDownload: torrent.rateDownload,
    rateUpload: torrent.rateUpload,
    eta: torrent.eta !== undefined && torrent.eta >= 0 ? torrent.eta : undefined,
  };
}

function iso(epochSeconds: number | undefined): string | undefined {
  return epochSeconds && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : undefined;
}

export function summarizeTorrentDetail(torrent: TransmissionTorrent) {
  return {
    ...summarizeTorrent(torrent),
    downloadDir: torrent.downloadDir,
    labels: torrent.labels,
    leftUntilDone: torrent.leftUntilDone,
    peersSendingToUs: torrent.peersSendingToUs,
    addedAt: iso(torrent.addedDate),
    doneAt: iso(torrent.doneDate),
    trackers: (torrent.trackerStats ?? []).map((tracker) => ({
      host: tracker.host,
      lastAnnounceResult: tracker.lastAnnounceResult || undefined,
      lastAnnounceSucceeded: tracker.lastAnnounceSucceeded,
      lastAnnounceAt: iso(tracker.lastAnnounceTime),
      seeders:
        tracker.seederCount !== undefined && tracker.seederCount >= 0
          ? tracker.seederCount
          : undefined,
      leechers:
        tracker.leecherCount !== undefined && tracker.leecherCount >= 0
          ? tracker.leecherCount
          : undefined,
    })),
  };
}
