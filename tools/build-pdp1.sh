#!/usr/bin/env bash
# Build a headless SIMH pdp1 binary from open-simh source on Linux.
# Requires: gcc, /tmp/simh-sparse cloned via fetch-simh.sh
set -euo pipefail
SIMH=/tmp/simh-sparse
OUT=$SIMH/pdp1
if [ -f "$OUT" ]; then
  echo "pdp1 already built at $OUT"
  exit 0
fi
gcc -O2 -D_GNU_SOURCE \
  -I"$SIMH" -I"$SIMH/PDP1" \
  "$SIMH"/scp.c "$SIMH"/sim_console.c "$SIMH"/sim_fio.c "$SIMH"/sim_timer.c \
  "$SIMH"/sim_sock.c "$SIMH"/sim_tmxr.c "$SIMH"/sim_ether.c "$SIMH"/sim_tape.c \
  "$SIMH"/sim_disk.c "$SIMH"/sim_serial.c "$SIMH"/sim_video.c "$SIMH"/sim_imd.c \
  "$SIMH"/sim_card.c \
  "$SIMH"/PDP1/pdp1_lp.c "$SIMH"/PDP1/pdp1_cpu.c "$SIMH"/PDP1/pdp1_stddev.c \
  "$SIMH"/PDP1/pdp1_sys.c "$SIMH"/PDP1/pdp1_dt.c "$SIMH"/PDP1/pdp1_drm.c \
  "$SIMH"/PDP1/pdp1_clk.c "$SIMH"/PDP1/pdp1_dcs.c \
  -o "$OUT" -lm -lpthread
echo "pdp1 built at $OUT"
