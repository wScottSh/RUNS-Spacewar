#!/usr/bin/env bash
# Build macro1 assembler from source.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/macro1"
if [ -f macro1 ]; then
  echo "macro1 already built"
  exit 0
fi
make
