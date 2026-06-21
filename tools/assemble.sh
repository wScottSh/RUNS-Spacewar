#!/usr/bin/env bash
# Assemble Spacewar 3.1 into RIM tape + symbol listing.
# -r : pure RIM-format tape (required for SIMH load)
# -d : dump symbol table into .lst
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
MACRO1="$HERE/macro1/macro1"
SRC="$ROOT/source/spacewar3.1_complete.txt"
WORK="$ROOT/build/spacewar31.mac"

mkdir -p "$ROOT/build"
# macro1 writes its .rim/.lst next to the input, so assemble a copy in build/
# to keep source/ clean.
cp "$SRC" "$WORK"
"$MACRO1" -r -d "$WORK"
echo "Assembled: $ROOT/build/spacewar31.rim"
