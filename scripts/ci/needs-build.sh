#!/usr/bin/env bash
# Prints build=true|false for the build-push job. Only a push to main whose every changed file
# is Markdown skips the image build; tags, manual runs, and pushes whose base commit is unknown
# (a force-push, a new ref) always build.
# Inputs (env): EVENT, REF, BEFORE, SHA.
set -euo pipefail

build=true
if [ "$EVENT" = push ] && [ "$REF" = refs/heads/main ] && git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
  if ! git diff --name-only "$BEFORE" "$SHA" | grep -qv '\.md$'; then
    build=false
  fi
fi
echo "build=$build"
