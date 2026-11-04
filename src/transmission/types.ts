/** Transmission's `status` field (rpc-spec.md, torrent-get). */
export const TorrentStatus = {
  Stopped: 0,
  CheckWait: 1,
  Checking: 2,
  DownloadWait: 3,
  Downloading: 4,
  SeedWait: 5,
  Seeding: 6,
} as const;

export interface TransmissionTrackerStat {
  host?: string;
  announceState?: number;
  lastAnnounceResult?: string;
  lastAnnounceSucceeded?: boolean;
  lastAnnounceTime?: number;
  seederCount?: number;
  leecherCount?: number;
}

/** The torrent-get fields the tools ask for; every one is optional because a client may omit it. */
export interface TransmissionTorrent {
  hashString?: string;
  name?: string;
  status?: number;
  /** 0 ok, 1 tracker warning, 2 tracker error, 3 local error (disk full, permissions). */
  error?: number;
  errorString?: string;
  percentDone?: number;
  peersConnected?: number;
  peersSendingToUs?: number;
  uploadRatio?: number;
  totalSize?: number;
  leftUntilDone?: number;
  rateDownload?: number;
  rateUpload?: number;
  /** Seconds left; negative when unknown. */
  eta?: number;
  addedDate?: number;
  doneDate?: number;
  downloadDir?: string;
  labels?: string[];
  isStalled?: boolean;
  trackerStats?: TransmissionTrackerStat[];
}

export interface TransmissionResponse<T> {
  result: string;
  arguments?: T;
}

export interface TorrentGetArguments {
  torrents?: TransmissionTorrent[];
}

export type TorrentAction = 'start' | 'start_now' | 'stop' | 'verify' | 'reannounce';
