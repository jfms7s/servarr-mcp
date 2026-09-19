# servarr-mcp

An MCP server exposing Sonarr, Radarr, Prowlarr, and Overseerr to an LLM client. Connect Claude or another MCP-compatible LLM to your media stack and ask it to search for content, manage your library, check download status, and more — all via natural language.

This server reaches Sonarr and Radarr at their `/api/v3` endpoints, and Prowlarr at `/api/v1`. (Note: Sonarr's published documentation often references "v5" in the URL, but that is the *application* version, not the API version — use v3.)

**Important:** This server grants any connected MCP client full read/write access to your media stack, including the ability to permanently delete series, movies, and files on disk. Any LLM you connect can invoke destructive tools. Understand this before enabling it, and configure your MCP client with appropriate safeguards.

## Install

**Prerequisites:** Node.js 20 or later.

### From Source

Clone the repository, install dependencies, and build:

```bash
git clone https://github.com/jfms7s/servarr-mcp.git
cd servarr-mcp
npm ci
npm run build
```

Then run the server:

```bash
node dist/index.js
```

The server will start on a stdio interface, expecting MCP protocol messages. Use this command in your MCP client's configuration (see the Claude Desktop / Claude Code Setup section below).

### With Docker

Use the published container image (`linux/amd64` and `linux/arm64`), pinned to a release tag such as `v0.1.2`, or `latest`:

```bash
docker run --rm -p 3000:3000 \
  -e SERVARR_MCP_TOKEN=a-long-random-secret \
  -e SONARR_URL=http://sonarr:8989 \
  -e SONARR_API_KEY=your-sonarr-api-key \
  -e RADARR_URL=http://radarr:7878 \
  -e RADARR_API_KEY=your-radarr-api-key \
  -e PROWLARR_URL=http://prowlarr:9696 \
  -e PROWLARR_API_KEY=your-prowlarr-api-key \
  -e OVERSEERR_URL=http://overseerr:5055 \
  -e OVERSEERR_API_KEY=your-overseerr-api-key \
  ghcr.io/jfms7s/servarr-mcp:v0.1.2
```

**Note:** The image defaults to the HTTP transport (`SERVARR_MCP_TRANSPORT=http`), which requires `SERVARR_MCP_TOKEN` — without it the container exits at startup. The URLs must be reachable from *inside* the container: `localhost` there is the container itself, not your host. Use the arr containers' names on a shared Docker network (as above), or their LAN addresses. For many variables, use `--env-file`:

```bash
docker run --rm -p 3000:3000 --env-file .env ghcr.io/jfms7s/servarr-mcp:latest
```

Where `.env` contains your configuration lines (one per line: `VAR_NAME=value`).

#### Building the Docker Image Locally

If you want to build the image locally:

```bash
docker build -t servarr-mcp .
docker run --rm -p 3000:3000 --env-file .env servarr-mcp
```

## Configuration

The server reads configuration from environment variables. Each product is **independently optional** — you can configure only the ones you use. The server will fail to start only if *no* products are configured.

| Variable | Example | Required | Purpose |
|----------|---------|----------|---------|
| `SONARR_URL` | `http://localhost:8989` | No | Base URL of your Sonarr instance |
| `SONARR_API_KEY` | `abc123def456` | Only if `SONARR_URL` is set | API key from Sonarr Settings → General |
| `RADARR_URL` | `http://localhost:7878` | No | Base URL of your Radarr instance |
| `RADARR_API_KEY` | `abc123def456` | Only if `RADARR_URL` is set | API key from Radarr Settings → General |
| `PROWLARR_URL` | `http://localhost:9696` | No | Base URL of your Prowlarr instance |
| `PROWLARR_API_KEY` | `abc123def456` | Only if `PROWLARR_URL` is set | API key from Prowlarr Settings → General |
| `OVERSEERR_URL` | `http://localhost:5055` | No | Base URL of your Overseerr instance |
| `OVERSEERR_API_KEY` | `abc123def456` | Only if `OVERSEERR_URL` is set | API key from Overseerr Settings → General |
| `SERVARR_MCP_TRANSPORT` | `stdio` or `http` or `both` | No | Transport mode (default `stdio`) |
| `SERVARR_MCP_PORT` | `3000` | No | Port for HTTP transport (default `3000`) |
| `SERVARR_MCP_TOKEN` | `a-long-random-secret` | Required if transport is `http` or `both` | Bearer token for HTTP client authentication |

### Example: Sonarr and Prowlarr only

If you only want to use Sonarr and Prowlarr, set only these:

```bash
export SONARR_URL=http://localhost:8989
export SONARR_API_KEY=your-sonarr-key
export PROWLARR_URL=http://localhost:9696
export PROWLARR_API_KEY=your-prowlarr-key
node dist/index.js
```

The server will register 40 tools (26 Sonarr + 14 Prowlarr) and start normally. Radarr and Overseerr tools will not be available.

## Claude Desktop / Claude Code Setup

### From Source

Add this to your `claude_desktop_config.json` or Claude Code MCP server configuration:

```json
{
  "mcpServers": {
    "servarr": {
      "command": "node",
      "args": ["/path/to/servarr-mcp/dist/index.js"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key",
        "RADARR_URL": "http://localhost:7878",
        "RADARR_API_KEY": "your-radarr-api-key",
        "PROWLARR_URL": "http://localhost:9696",
        "PROWLARR_API_KEY": "your-prowlarr-api-key",
        "OVERSEERR_URL": "http://localhost:5055",
        "OVERSEERR_API_KEY": "your-overseerr-api-key"
      }
    }
  }
}
```

Replace `/path/to/servarr-mcp/dist/index.js` with the absolute path to the built server in your cloned repository. Replace `your-*-api-key` with your actual API keys from each application's Settings → General → API Key.

### With Docker

```json
{
  "mcpServers": {
    "servarr": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--add-host=host.docker.internal:host-gateway",
        "--env",
        "SERVARR_MCP_TRANSPORT=stdio",
        "--env",
        "SONARR_URL=http://host.docker.internal:8989",
        "--env",
        "SONARR_API_KEY=your-sonarr-api-key",
        "--env",
        "RADARR_URL=http://host.docker.internal:7878",
        "--env",
        "RADARR_API_KEY=your-radarr-api-key",
        "--env",
        "PROWLARR_URL=http://host.docker.internal:9696",
        "--env",
        "PROWLARR_API_KEY=your-prowlarr-api-key",
        "--env",
        "OVERSEERR_URL=http://host.docker.internal:5055",
        "--env",
        "OVERSEERR_API_KEY=your-overseerr-api-key",
        "ghcr.io/jfms7s/servarr-mcp:latest"
      ]
    }
  }
}
```

Two things differ from the source setup. `SERVARR_MCP_TRANSPORT=stdio` is required: the image defaults to HTTP, and without the override it would neither speak stdio nor start at all (HTTP needs a token). And `localhost` inside the container is the container itself, so the arr apps on your host are reached through `host.docker.internal`, which the `--add-host` flag maps to the host on Linux (Docker Desktop provides it already). Replace `your-*-api-key` with your actual API keys from each application's Settings → General → API Key.

## Remote / HTTP Deployment

For a remote setup (e.g., accessing Sonarr from a separate machine), use the HTTP transport:

### From Source

```bash
export SERVARR_MCP_TRANSPORT=http
export SERVARR_MCP_PORT=3000
export SERVARR_MCP_TOKEN=your-shared-bearer-token
node dist/index.js
```

### With Docker

```bash
docker run --rm -p 3000:3000 \
  -e SERVARR_MCP_TRANSPORT=http \
  -e SERVARR_MCP_PORT=3000 \
  -e SERVARR_MCP_TOKEN=your-shared-bearer-token \
  -e SONARR_URL=http://sonarr:8989 \
  -e SONARR_API_KEY=your-sonarr-api-key \
  ghcr.io/jfms7s/servarr-mcp:latest
```

The server will listen on the specified port on all interfaces, authenticated with a single bearer token. Control which interfaces can reach it using your container networking, firewall, or reverse proxy configuration.

Two routes are served:

| Route | Auth | Purpose |
| --- | --- | --- |
| `/mcp` | Bearer token required | The MCP endpoint |
| `/healthz` | None | Liveness/readiness probes; returns `200 ok` |

`/healthz` is deliberately unauthenticated so an orchestrator's probes can reach it — a probe cannot present a token, and `/mcp` answers an unauthenticated request with `401`, which a probe reads as a failing container. It reports only that this process is still serving. It deliberately does *not* check your Sonarr, Radarr or Prowlarr instances, so an outage in one of those will not get this container restarted or pulled out of service.

### ⚠️ Security Warning

**The HTTP transport is dangerous.** It uses a single shared bearer token for authentication and grants full read/write access to your entire media stack, including the ability to delete series, movies, and files on disk. **Never expose this over the open internet.** The HTTP interface must be:

1. Behind a VPN
2. Protected by a reverse proxy with additional authentication (e.g., basic auth, OAuth)
3. On a trusted LAN only

A compromised bearer token gives an attacker complete control to delete your library. Use HTTP only in environments you fully control.

## Tools

This server exposes 89 tools across the four products.

### Sonarr (26 tools)

| Tool | Purpose |
|------|---------|
| `sonarr_list_series` | List all TV series in the Sonarr library |
| `sonarr_get_series` | Get the full record for one series, including all seasons |
| `sonarr_lookup_series` | Search TheTVDB for series matching a search term |
| `sonarr_add_series` | Add a new series to Sonarr |
| `sonarr_delete_series` | **Destructive:** Remove a series from Sonarr (optionally delete files) |
| `sonarr_update_series` | Update series settings (monitored, quality profile, tags, season folders) |
| `sonarr_list_episodes` | List episodes for a series or season |
| `sonarr_get_episode` | Get the full record for one episode |
| `sonarr_monitor_episodes` | Set monitored state for one or more episodes |
| `sonarr_list_episode_files` | List downloaded episode files for a series |
| `sonarr_delete_episode_file` | **Destructive:** Permanently delete an episode file |
| `sonarr_get_queue` | List items currently downloading or awaiting import |
| `sonarr_delete_queue_item` | **Destructive:** Remove an item from the download queue |
| `sonarr_get_calendar` | List episodes airing in a date range |
| `sonarr_get_history` | List download, import, and grab event history |
| `sonarr_get_wanted_missing` | List wanted but missing episodes |
| `sonarr_get_blocklist` | List releases on the blocklist |
| `sonarr_delete_blocklist_item` | **Destructive:** Remove a release from the blocklist |
| `sonarr_run_command` | Trigger a background command (search, rescan, refresh) |
| `sonarr_get_command` | Poll the status of a background command |
| `sonarr_list_quality_profiles` | List available quality profiles |
| `sonarr_list_root_folders` | List configured root folders |
| `sonarr_list_tags` | List all tags available for series organization |
| `sonarr_get_system_status` | Get Sonarr version and system information |
| `sonarr_get_health` | Check Sonarr health status and warnings |
| `sonarr_get_disk_space` | List disk space on drives containing series |

### Radarr (24 tools)

| Tool | Purpose |
|------|---------|
| `radarr_list_movies` | List all movies in the Radarr library |
| `radarr_get_movie` | Get the full record for one movie |
| `radarr_lookup_movie` | Search TMDB for movies matching a search term |
| `radarr_add_movie` | Add a new movie to Radarr |
| `radarr_update_movie` | Update movie settings (monitored, quality profile, tags, availability) |
| `radarr_delete_movie` | **Destructive:** Remove a movie from Radarr (optionally delete files) |
| `radarr_list_movie_files` | List downloaded movie files for a movie |
| `radarr_delete_movie_file` | **Destructive:** Permanently delete a movie file |
| `radarr_get_calendar` | List movies with releases in a date range |
| `radarr_get_queue` | List items currently downloading or awaiting import |
| `radarr_delete_queue_item` | **Destructive:** Remove an item from the download queue |
| `radarr_get_history` | List download, import, and grab event history |
| `radarr_get_wanted_missing` | List wanted but missing movies |
| `radarr_get_blocklist` | List releases on the blocklist |
| `radarr_delete_blocklist_item` | **Destructive:** Remove a release from the blocklist |
| `radarr_list_collections` | List all movie collections |
| `radarr_run_command` | Trigger a background command (search, rescan, refresh) |
| `radarr_get_command` | Poll the status of a background command |
| `radarr_list_quality_profiles` | List available quality profiles |
| `radarr_list_root_folders` | List configured root folders |
| `radarr_list_tags` | List all tags available for movie organization |
| `radarr_get_system_status` | Get Radarr version and system information |
| `radarr_get_health` | Check Radarr health status and warnings |
| `radarr_get_disk_space` | List disk space on drives containing movies |

### Prowlarr (14 tools)

| Tool | Purpose |
|------|---------|
| `prowlarr_search` | Search configured indexers for releases |
| `prowlarr_grab_release` | Send a release to the download client |
| `prowlarr_list_indexers` | List configured indexers with protocol and status |
| `prowlarr_get_indexer` | Get details about a specific indexer |
| `prowlarr_test_indexer` | Test connectivity of an indexer |
| `prowlarr_get_indexer_stats` | Get query and grab statistics for each indexer |
| `prowlarr_get_indexer_status` | Get health and backoff status of indexers |
| `prowlarr_list_categories` | List newznab categories supported by indexers |
| `prowlarr_get_history` | Get history of indexer queries and grabs |
| `prowlarr_list_applications` | List *arr applications synced by Prowlarr |
| `prowlarr_list_download_clients` | List download clients configured in Prowlarr |
| `prowlarr_run_command` | Run administrative commands (sync, health check) |
| `prowlarr_get_system_status` | Get Prowlarr version and system information |
| `prowlarr_get_health` | Get health check results for Prowlarr |

### Overseerr (25 tools)

| Tool | Purpose |
|------|---------|
| `overseerr_search` | Search Overseerr for movies, TV shows, and people by title |
| `overseerr_discover_movies` | Discover popular and upcoming movies from TMDB |
| `overseerr_discover_tv` | Discover popular and upcoming TV shows from TMDB |
| `overseerr_get_trending` | List currently trending movies and TV shows |
| `overseerr_get_movie` | Get full Overseerr/TMDB details for one movie |
| `overseerr_get_tv` | Get full Overseerr/TMDB details for one TV series |
| `overseerr_get_movie_recommendations` | Get movies recommended based on a given movie |
| `overseerr_get_similar_movies` | Get movies similar to a given movie |
| `overseerr_get_tv_recommendations` | Get TV shows recommended based on a given show |
| `overseerr_get_similar_tv` | Get TV shows similar to a given show |
| `overseerr_get_movie_ratings` | Get Rotten Tomatoes and IMDB ratings for a movie |
| `overseerr_get_tv_ratings` | Get Rotten Tomatoes ratings for a TV show |
| `overseerr_get_person` | Get biography and details for a person |
| `overseerr_get_person_credits` | Get a person's combined movie and TV credits |
| `overseerr_list_requests` | List media requests with optional filtering and sorting |
| `overseerr_get_request` | Get one media request by id |
| `overseerr_get_request_count` | Get counts of requests by status |
| `overseerr_create_request` | Request that a movie or TV show be added |
| `overseerr_update_request_status` | Approve or decline a pending media request |
| `overseerr_retry_request` | Retry a failed request to Sonarr or Radarr |
| `overseerr_delete_request` | **Destructive:** Permanently remove a media request |
| `overseerr_list_media` | List media items known to Overseerr with their availability status |
| `overseerr_delete_media` | **Destructive:** Remove a media item from Overseerr |
| `overseerr_list_users` | List Overseerr users |
| `overseerr_get_system_status` | Get Overseerr version and update status |

## Finding Your API Key

In each application's web UI:

1. Go to **Settings**
2. Click **General**
3. Scroll to the **API Key** field
4. Copy the entire string

This is a sensitive credential — treat it like a password. Do not commit it to version control or share it.

## Development

### Prerequisites

- Node.js 20 or later
- npm 10+

### Running Tests

```bash
npm test
```

### Linting and Type Checking

```bash
npm run lint
npm run typecheck
```

### Building

```bash
npm run build
```

This emits compiled JavaScript to `dist/index.js`.

### Running Locally

First build the project, then run it:

```bash
npm run build
```

Then start the server with your configuration:

```bash
# Set up environment variables
export SONARR_URL=http://localhost:8989
export SONARR_API_KEY=your-key
# ... other env vars

node dist/index.js
```
