# Known gaps

Findings from the final whole-branch review that were deliberately not fixed
before merge. Each was triaged; none blocks the server from working.

## Needs a decision

### `tsc --noEmit` does not cover `test/**`

`tsconfig.json` sets `include: ["src/**/*"]`, so 15 of 35 TypeScript files are
never typechecked. The tests lean on casts that could drift from the real
shapes with nothing failing.

Adding `test/**` to `include` **breaks `npm run build`**, because `rootDir` is
`src`. The fix is a separate `tsconfig.test.json` extending the base with
`"include": ["src/**/*", "test/**/*"]`, `"noEmit": true`, `"rootDir": "."`, and
pointing the `typecheck` script at it.

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

- **The Docker image has never been built.** Docker is not installed in the
  environment this was developed in. The Dockerfile was reviewed by inspection
  only: multi-stage, `npm ci --omit=dev`, non-root `USER node`, no secrets in
  any layer. Build it once before publishing.
- **No live instance was ever contacted.** Every endpoint path, query parameter
  and response shape was verified against the products' published OpenAPI
  specs, and the whole suite runs against mocked HTTP. Response types are not
  validated at runtime, so a wrong declaration would be silent.
- **`npx servarr-mcp` in the README assumes publication.** Either publish to
  npm or drop those instructions until you do.
