#!/usr/bin/env bash
# Clone open-simh into /tmp/simh-sparse (ephemeral; rebuilt each session on Linux).
set -euo pipefail
SIMH=/tmp/simh-sparse
if [ -d "$SIMH/.git" ]; then
  echo "simh already present at $SIMH"
  exit 0
fi
git clone --depth 1 https://github.com/open-simh/simh.git "$SIMH"
