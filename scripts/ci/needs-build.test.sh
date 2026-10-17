#!/usr/bin/env bash
# Tests for needs-build.sh against a throwaway git repo. Run: bash scripts/ci/needs-build.test.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/needs-build.sh"
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q && git config user.email t@t && git config user.name t
commit() { echo "$RANDOM" >> "$1"; git add "$1"; git commit -qm "$1"; git rev-parse HEAD; }
base=$(commit README.md)
docs=$(commit docs.md)
code=$(commit src.ts)

fail=0
check() {
  local want=$1; shift
  local got
  got=$(env "$@" bash "$script")
  if [ "$got" != "build=$want" ]; then echo "FAIL: $* -> $got (want $want)"; fail=1; fi
}
check false EVENT=push REF=refs/heads/main BEFORE="$base" SHA="$docs"
check true  EVENT=push REF=refs/heads/main BEFORE="$docs" SHA="$code"
check true  EVENT=push REF=refs/heads/main BEFORE="$base" SHA="$code"
check true  EVENT=push REF=refs/tags/v1.0.0 BEFORE="$base" SHA="$docs"
check true  EVENT=workflow_dispatch REF=refs/heads/main BEFORE= SHA="$docs"
check true  EVENT=push REF=refs/heads/main BEFORE=0000000000000000000000000000000000000000 SHA="$docs"
[ "$fail" = 0 ] && echo "needs-build.test: all passed"
exit "$fail"
