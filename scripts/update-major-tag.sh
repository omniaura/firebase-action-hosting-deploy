#!/usr/bin/env bash
#
# Moves the floating major-version tag (e.g. `v1`) to the just-released commit so
# consumers pinning `uses: omniaura/firebase-action-hosting-deploy@v1` pick up
# the new release. Run by semantic-release's @semantic-release/exec successCmd
# after the `vX.Y.Z` tag has been created and pushed.
set -euo pipefail

VERSION="${1:?usage: update-major-tag.sh <version>}"
MAJOR="v${VERSION%%.*}"

echo "Updating major tag ${MAJOR} -> ${VERSION}"
git tag -f -a "${MAJOR}" -m "${MAJOR} -> v${VERSION}"
git push -f origin "refs/tags/${MAJOR}"
