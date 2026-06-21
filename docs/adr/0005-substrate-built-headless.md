# Substrate is built headless — no Type 30 display

Status: accepted

The SIMH `pdp1` Substrate is compiled from source (open-simh, MSVC `cl` on this Windows host)
**without display support** (`USE_DISPLAY` undefined): no Type 30 CRT, no SDL. The Oracle observes
object-table memory through `examine`/`deposit`/breakpoints, so rendered pixels are not part of
Ground Truth and the display is pure overhead.

## Why

A headless build is the accuracy-neutral, dependency-free path. The frozen CPU still computes every
ship/torpedo/gravity value into memory exactly as on hardware — only the visual scan-out is skipped,
and the Oracle never reads pixels. It also sidesteps the entire SDL/video toolchain on a host that
has only a C compiler (no `make`, no package manager).

One behavioural consequence is accepted with eyes open: the Spacewar control-switch IOT
(`spacewar()`, device 011) lives in the display module, so headless it reads as idle — both ships'
control words come back zero. This is irrelevant to the math-library Vectors (Plan A:
`sqt`/`sin`/`cos`/`mpy`/`idv`/`random` are pure AC/IO subroutines) and to any routine driven by
deposited inputs.

## Revisit trigger

Plan B frame Traces require pinned per-frame control inputs for both ships. When that work starts,
inject control words by **depositing** them at the read site (keeping the build headless) — or, if
that proves infeasible, compile the `spacewar()`/`dpy` control reader in and supersede this ADR.
Until Plan B needs live controls, headless stands.
