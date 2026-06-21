#!/usr/bin/env bash
# Clone open-simh into /tmp/simh-sparse (ephemeral; rebuilt each session on Linux).
set -euo pipefail
if [ -d /tmp/simh-sparse/.git ]; then
  echo "simh already present at /tmp/simh-sparse"
  exit 0
fi
git clone --depth 1 https://github.com/open-simh/simh.git /tmp/simh-sparse
