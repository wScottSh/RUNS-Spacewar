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
control words come back zero. This is irrelevant to the pure-math Vectors
(`sqt`/`sin`/`cos`/`mpy`/`idv`/`random` are pure AC/IO subroutines) and to any routine driven by
deposited inputs.

It is **not** irrelevant to Traces, which are the primary instrument (ADR-0012): a Trace is a
scripted match driven by *pinned per-frame control words for both ships*, and headless those
words read as zero. So injecting control words is a **core mechanism of the Oracle**, not a
someday-contingency. The mechanism that keeps the build headless: **deposit** the pinned
control words at the read site each frame, rather than scanning them from a live Type 30 / IOT
011. Pixels are still never read; only the control inputs are supplied.

## Revisit trigger

If depositing control words at the read site ever proves infeasible — the read path cannot be
reached by `deposit` alone — compile the `spacewar()`/`dpy` control reader in (display still
off) and supersede this ADR. Until then, headless with deposited controls stands.
