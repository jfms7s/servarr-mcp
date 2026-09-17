# servarr-mcp — Design

**Date:** 2026-09-17
**Status:** Approved

## Purpose

An MCP server that exposes Sonarr, Radarr, and Prowlarr to an LLM client, for
both conversational library control ("add season 2 of The Expanse", "what's
stuck in the queue?") and agentic monitoring ("check health, retry failed
downloads").

## Scope

Three products, one server:

| Product  | Role             | API version    |
| -------- | ---------------- | -------------- |
| Sonarr   | TV series        | v3 (`/api/v3`) |
| Radarr   | Movies           | v3 (`/api/v3`) |
| Prowlarr | Indexers, search | v1 (`/api/v1`) |

Sonarr 5.x and Radarr 5.x still serve their APIs under `/api/v3`. The `#v5`
in the published docs URL refers to the application version, not the API
version.

Full read/write is in scope, including destructive operations (delete series,
delete files, remove queue items). No artificial safe-mode restriction.

## Architecture

A single Node.js/TypeScript package built on the official MCP TypeScript SDK
(`@modelcontextprotocol/sdk`), internally divided into per-product modules
with shared infrastructure.

```
src/
  index.ts              # entrypoint: config -> register enabled products -> start transport
  config.ts             # env parsing + validation, per-product optionality
  http/
    client.ts           # shared fetch wrapper: base URL, X-Api-Key, JSON, error mapping
    errors.ts           # ArrApiError and mapping to MCP tool errors
  mcp/
    server.ts           # MCP server construction, tool registration helper
    transport.ts        # stdio + streamable HTTP transport selection
    auth.ts             # bearer token middleware (HTTP transport only)
  sonarr/
    client.ts           # typed Sonarr client over http/client
    types.ts            # Series, Episode, QueueRecord, ... (hand-written subset)
    tools.ts            # MCP tool definitions
  radarr/               # same shape
  prowlarr/             # same shape
test/
  ...                   # vitest + msw, mirrors src layout
```

Each product module depends only on `http/` and the MCP SDK — never on
another product module. This keeps the boundary clean enough that a product
could later be extracted into its own package without untangling anything.

### Component contracts

**`http/client.ts`** — `createArrClient({ baseUrl, apiKey, apiBase })` returns
`{ get, post, put, delete }` taking a path and optional query/body. It injects
the `X-Api-Key` header, resolves paths against `${baseUrl}${apiBase}`, parses
JSON, and throws `ArrApiError` on non-2xx. It knows nothing about any specific
product.

**`<product>/client.ts`** — one method per endpoint the tool layer needs,
typed against `<product>/types.ts`. Pure data access, no MCP awareness. E.g.
`listSeries()`, `addSeries(payload)`, `deleteSeries(id, opts)`.

**`<product>/tools.ts`** — exports an array of tool definitions
(`{ name, description, inputSchema, handler }`). Handlers call the client and
shape the result for the LLM. This is the only layer that imports MCP types.

**`config.ts`** — parses env into
`{ sonarr?: InstanceConfig, radarr?: InstanceConfig, prowlarr?: InstanceConfig, transport, port, token? }`.
A product is enabled when both its URL and API key are set. Partial setups
(e.g. Sonarr + Prowlarr, no Radarr) are valid and register only those tools.
Startup fails with a clear message if a product has one env var but not the
other, or if HTTP transport is selected with no token.

## Configuration

| Variable                 | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `SONARR_URL`             | e.g. `http://localhost:8989`                      |
| `SONARR_API_KEY`         | Sonarr API key                                    |
| `RADARR_URL`             | e.g. `http://localhost:7878`                      |
| `RADARR_API_KEY`         | Radarr API key                                    |
| `PROWLARR_URL`           | e.g. `http://localhost:9696`                      |
| `PROWLARR_API_KEY`       | Prowlarr API key                                  |
| `SERVARR_MCP_TRANSPORT`  | `stdio` (default) \| `http` \| `both`             |
| `SERVARR_MCP_PORT`       | HTTP listen port, default `3000`                  |
| `SERVARR_MCP_TOKEN`      | Bearer token, required when HTTP transport is on  |

One instance per product. Multi-instance support is explicitly out of scope.

## Transports

- **stdio** (default) — runs as a local subprocess under an MCP client. No
  app-level auth; the subprocess boundary is the trust boundary.
- **streamable HTTP** — for running alongside the arr stack (e.g. in a
  container). Every request must carry `Authorization: Bearer <token>`
  matching `SERVARR_MCP_TOKEN`; comparison is constant-time. Requests without
  a valid token get `401` before reaching any tool.
- **both** — one process serving both, for mixed local/remote use.

## Tool surface

Fine-grained, roughly 1:1 with endpoints, namespaced by product. This is a
curated subset — each product's API has ~250 operations, the vast majority of
which are configuration CRUD (notifications, import lists, metadata providers,
custom formats) that an LLM has no business driving. What follows is the
intended surface.

### Sonarr

| Tool                         | Endpoint                          |
| ---------------------------- | --------------------------------- |
| `sonarr_list_series`         | `GET /series`                     |
| `sonarr_get_series`          | `GET /series/{id}`                |
| `sonarr_lookup_series`       | `GET /series/lookup?term=`        |
| `sonarr_add_series`          | `POST /series`                    |
| `sonarr_update_series`       | `PUT /series/{id}`                |
| `sonarr_delete_series`       | `DELETE /series/{id}`             |
| `sonarr_list_episodes`       | `GET /episode?seriesId=`          |
| `sonarr_get_episode`         | `GET /episode/{id}`               |
| `sonarr_monitor_episodes`    | `PUT /episode/monitor`            |
| `sonarr_list_episode_files`  | `GET /episodefile?seriesId=`      |
| `sonarr_delete_episode_file` | `DELETE /episodefile/{id}`        |
| `sonarr_get_calendar`        | `GET /calendar?start=&end=`       |
| `sonarr_get_queue`           | `GET /queue`                      |
| `sonarr_delete_queue_item`   | `DELETE /queue/{id}`              |
| `sonarr_get_history`         | `GET /history`                    |
| `sonarr_get_wanted_missing`  | `GET /wanted/missing`             |
| `sonarr_get_blocklist`       | `GET /blocklist`                  |
| `sonarr_delete_blocklist_item` | `DELETE /blocklist/{id}`        |
| `sonarr_run_command`         | `POST /command`                   |
| `sonarr_get_command`         | `GET /command/{id}`               |
| `sonarr_list_quality_profiles` | `GET /qualityprofile`           |
| `sonarr_list_root_folders`   | `GET /rootfolder`                 |
| `sonarr_list_tags`           | `GET /tag`                        |
| `sonarr_get_system_status`   | `GET /system/status`              |
| `sonarr_get_health`          | `GET /health`                     |
| `sonarr_get_disk_space`      | `GET /diskspace`                  |

`sonarr_run_command` covers the command-dispatch endpoints (`SeriesSearch`,
`EpisodeSearch`, `MissingEpisodeSearch`, `RefreshSeries`, `RescanSeries`,
`RenameFiles`) via a discriminated `name` field rather than one tool each —
they share a single endpoint and differ only in payload.

### Radarr

Mirrors Sonarr with movies in place of series/episodes:
`radarr_list_movies`, `radarr_get_movie`, `radarr_lookup_movie`
(`GET /movie/lookup?term=`), `radarr_add_movie`, `radarr_update_movie`,
`radarr_delete_movie`, `radarr_list_movie_files`, `radarr_delete_movie_file`,
`radarr_get_calendar`, `radarr_get_queue`, `radarr_delete_queue_item`,
`radarr_get_history`, `radarr_get_wanted_missing`, `radarr_get_blocklist`,
`radarr_delete_blocklist_item`, `radarr_run_command`, `radarr_get_command`,
`radarr_list_quality_profiles`, `radarr_list_root_folders`, `radarr_list_tags`,
`radarr_get_system_status`, `radarr_get_health`, `radarr_get_disk_space`,
plus `radarr_list_collections` (`GET /collection`).

### Prowlarr

| Tool                           | Endpoint                      |
| ------------------------------ | ----------------------------- |
| `prowlarr_search`              | `GET /search?query=`          |
| `prowlarr_grab_release`        | `POST /search`                |
| `prowlarr_list_indexers`       | `GET /indexer`                |
| `prowlarr_get_indexer`         | `GET /indexer/{id}`           |
| `prowlarr_test_indexer`        | `POST /indexer/test`          |
| `prowlarr_get_indexer_stats`   | `GET /indexerstats`           |
| `prowlarr_get_indexer_status`  | `GET /indexerstatus`          |
| `prowlarr_list_categories`     | `GET /indexer/categories`     |
| `prowlarr_get_history`         | `GET /history`                |
| `prowlarr_list_applications`   | `GET /applications`           |
| `prowlarr_list_download_clients` | `GET /downloadclient`       |
| `prowlarr_run_command`         | `POST /command`               |
| `prowlarr_get_system_status`   | `GET /system/status`          |
| `prowlarr_get_health`          | `GET /health`                 |

### Response shaping

Arr APIs return large objects with fields irrelevant to an LLM (image URLs,
per-season statistics blobs, full quality-profile definitions inline). List
tools return a trimmed projection of each record; `get`-by-id tools return the
full record. This keeps a `list_series` call over a 200-show library from
flooding the context window.

`add_series` / `add_movie` require `qualityProfileId` and `rootFolderPath`,
which the caller will rarely know. Their tool descriptions point at
`list_quality_profiles` and `list_root_folders` so the LLM can resolve them in
a prior turn.

## Error handling

`http/client.ts` throws `ArrApiError` carrying status, endpoint, and the
response body's message when present. The tool layer catches it and returns an
MCP tool error with a message the LLM can act on — `Sonarr returned 404 for
GET /api/v3/series/42: series not found` — never a raw stack trace.

Distinguished cases:

- **Connection refused / DNS failure** — "Cannot reach Sonarr at
  `<url>`; is it running?" Common enough (container restart, wrong port) to
  deserve its own message.
- **401/403** — "Sonarr rejected the API key." Never echoes the key itself.
- **4xx with a validation body** — arr validation errors come back as an array
  of `{ propertyName, errorMessage }`; these are flattened into the message so
  a failed `add_series` explains which field was wrong.
- **5xx / unparseable body** — status plus raw text, truncated.

Errors are returned as tool errors, not thrown — a failed call should let the
LLM retry or explain, not kill the session.

## Testing

Vitest with `msw` intercepting HTTP. No live arr instance needed to run the
suite.

- **Client tests** per product — correct path/method/query construction, the
  `X-Api-Key` header, response parsing, and each `ArrApiError` branch.
- **Tool tests** per product — input schema validation (bad input rejected
  before any HTTP call), the happy path shaping, and error propagation to an
  MCP tool error.
- **Config tests** — product enablement, partial-config failures, transport
  validation, missing-token rejection.
- **Auth tests** — bearer middleware accepts the right token, rejects wrong
  and missing ones, and is not applied to stdio.

Fixtures are trimmed real response shapes captured from the OpenAPI schemas,
kept in `test/fixtures/<product>/`.

## Tooling

npm, TypeScript (strict), ESLint, Vitest, Prettier. Node 20+. Ships as an
npm-installable CLI (`npx servarr-mcp`) plus a Dockerfile for the HTTP
deployment case.

## Out of scope

- Multiple instances of the same product
- Lidarr, Readarr, Bazarr, Whisparr
- Configuration CRUD (notifications, import lists, custom formats, indexer
  management in Sonarr/Radarr — Prowlarr owns indexers)
- OAuth or per-user auth on the HTTP transport; one shared bearer token only
- Caching or rate limiting
