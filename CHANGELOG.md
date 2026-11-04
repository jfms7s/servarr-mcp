# Changelog

## v1.1.0 (2026-11-04)

Adds Transmission: four tools, enabled by `TRANSMISSION_URL` alone (96 tools with the four arrs, 97 with Tautulli). Nothing is removed or renamed.

### Added

- `transmission_list_torrents`: status, progress, peers, tracker or local errors (such as a full disk) and ratio, with filters `hash` (an arr queue item's `downloadId`), `nameContains`, `stalled`, `errored`, `seeding` and `ratioAbove`; paginated.
- `transmission_get_torrent`: one torrent by hash, with download directory, labels and each tracker's last announce result.
- `transmission_control_torrents`: start, start_now, stop, verify or reannounce up to 50 torrents; fails before acting if a hash is unknown.
- `transmission_remove_torrent` (destructive): previews and removes nothing without `confirm: true`; the files stay unless `deleteData: true`.
- Config: `TRANSMISSION_URL` (no API key), and optional `TRANSMISSION_USERNAME` / `TRANSMISSION_PASSWORD` for HTTP Basic auth (both or neither). Anyone who can reach the server can start, stop and remove torrents once it is set.

## v1.0.0 (2026-11-03)

A major release: 18 overlapping tools are merged into 6, with no capability lost, and two manual-import tools are added. 108 tools become 92 (93 with Tautulli). Saved client allowlists, prompts and notes that name a removed tool need the new name.

### Breaking: renamed and merged tools

| Old tool(s) | New tool and arguments |
|---|---|
| `overseerr_get_request_count` | `overseerr_list_requests` with `includeCounts: true` (adds `counts`; no extra call without it) |
| `prowlarr_get_system_status`, `prowlarr_get_health`, `prowlarr_get_indexer_stats`, `prowlarr_get_indexer_status` | `prowlarr_get_status` → `{ system, health, indexers }` (indexer stats and backoff joined per indexer, shaped) |
| `sonarr_get_system_status`, `sonarr_get_health`, `sonarr_get_disk_space` | `sonarr_get_status` → `{ system, health, disks }` |
| `radarr_get_system_status`, `radarr_get_health`, `radarr_get_disk_space` | `radarr_get_status` → `{ system, health, disks }` |
| `sonarr_list_quality_profiles`, `sonarr_list_root_folders`, `sonarr_list_tags` | `sonarr_list_options` → `{ qualityProfiles, rootFolders, tags }` |
| `radarr_list_quality_profiles`, `radarr_list_root_folders`, `radarr_list_tags` | `radarr_list_options` → `{ qualityProfiles, rootFolders, tags }` |
| `overseerr_get_movie_recommendations`, `overseerr_get_similar_movies` | `overseerr_get_related { mediaType: 'movie', id, relation: 'recommendations' \| 'similar', page?, language? }` |
| `overseerr_get_tv_recommendations`, `overseerr_get_similar_tv` | `overseerr_get_related { mediaType: 'tv', id, relation, page?, language? }` |
| `overseerr_get_movie_ratings` | `overseerr_get_movie` (now returns `ratings`, or `ratingsUnavailable` when Overseerr has none) |
| `overseerr_get_tv_ratings` | `overseerr_get_tv` (now returns `ratings`, or `ratingsUnavailable`) |
| `overseerr_get_person_credits` | `overseerr_get_person` (now returns `credits`, newest first, `limit` default 50, with totals) |

The status tools now return shaped records: the raw `/system/status`, `/health`, `/diskspace`, `/indexerstats` and `/indexerstatus` payloads are no longer passed through.

### Added

- `sonarr_manual_import` and `radarr_manual_import` (destructive, two-stage): list the files of a stuck download (`downloadId`) or a `folder` with the arr's mapping and rejection reasons; with `confirm: true` and `files`, queue one `ManualImport` built from the arr's own candidates. Rejected files need `overrideRejections: true`; files that would replace one already in the library need `replaceExisting: true`. Checked live against throwaway Sonarr 4.0.20 and Radarr 6.4.4 containers (folder imports; the `downloadId` path is covered by tests only).

### Changed

- `overseerr_create_request`, `radarr_add_movie` and `sonarr_add_series` say when to use which: household requests go through Overseerr so they're tracked and approved; the arr add tools are for direct adds by the owner.
