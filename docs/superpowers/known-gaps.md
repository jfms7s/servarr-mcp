# Known gaps

Findings from the final whole-branch review that were deliberately not fixed
before merge. Each was triaged; none blocks the server from working.

## Accepted, with reasoning

- **Test breadth.** Roughly half the client methods and most tools have no
  behavioural test. Every untested method was hand-audited against the upstream
  OpenAPI specs during review and found correct, and the non-trivial logic (the
  read-modify-write tools, the queue-item defaults, the transport lifecycle) is
  now covered. The remainder are thin delegations.
- **`response.text()` is read on 401/403 and discarded.** This looks wasteful
  but is deliberate: it guarantees an API key echoed back in an auth-failure
  body can never reach an error message.
- **Prowlarr secret redaction is upstream's doing, not ours — on one
  remaining path.** Provider `fields[]` arrays hold tracker passkeys and
  download-client passwords; Prowlarr replaces them with `********`
  server-side before serialising. The list tools no longer return `fields[]`
  at all, so this now applies only to `prowlarr_get_indexer`, which returns
  the full record by design (get-by-id does, per the spec) and is the one
  input `prowlarr_test_indexer` round-trips back to Prowlarr. If upstream
  ever stopped redacting, that one tool would hand real credentials to the
  model.
- **Bare id parameter descriptions** ("Sonarr series id") do not name the tool
  that supplies the id. The tools that genuinely need cross-referencing — the
  add/lookup/grab chains — all have it.

## Unverified

- **Destructive write paths have never run against a live instance.** The
  write path itself is proven: `sonarr_run_command` (`RefreshSeries` on one
  series) was POSTed through the deployed server to real Sonarr, and
  `sonarr_get_command` followed the returned command from `started` to
  `completed`. What has not run live are the PUT and DELETE tools --
  `update_*`, `monitor_episodes` and every `delete_*`. The one Critical bug
  found during the build was in that territory (`delete_queue_item`
  defaulting to removing downloads from the client); it is fixed and
  regression-tested, but against mocked HTTP.
- **Response types are not validated at runtime.** Paths, query parameters and
  response shapes were checked against the published OpenAPI specs, and the
  live reads above returned what the types declare. A wrong declaration on an
  untested endpoint would still be silent.
