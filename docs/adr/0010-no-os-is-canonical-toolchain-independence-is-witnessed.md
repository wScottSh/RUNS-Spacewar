# No OS is canonical; toolchain platform-independence is a witnessed property

Status: accepted (applies the project's confluence principle — agreement across independent
paths is the witness — to the toolchain; builds on ADR-0006)

The Assembler (`macro1.c`) and Substrate (SIMH) are portable C; only their *build
recipes* were OS-specific (the `.cmd` / `.sh` / `Makefile` triplets in `tools/`). The
agent harness treated the host OS as canonical and so cast its Linux sandbox as a
"workaround" — re-bootstrapping a parallel Linux toolchain against a Windows host, two
recipes drifting apart.

We reject anointing *any* operating system as canonical. **The canonical artifacts are
the assembled core Image and the observed Vectors**, both OS-invariant for frozen integer
PDP-1 semantics. Platform-independence is not assumed — it is a property *witnessed* by
**cross-environment confluence**: the same Ground Truth, assembled and run on two
environments, must yield an identical core Image and identical Vectors. This is the same
confluence principle the project uses to fix the domain bound (ADR-0007) — agreement across
independent paths is the witness — turned on the toolchain itself.

Per-run faithfulness remains the **listing ↔ core** cross-check of ADR-0006 — now required
to hold in *whatever* environment executes — because no published reference Image exists
(ADR-0006) to anchor on externally.

## Why

The project's entire thesis is "assume nothing, witness everything." A toolchain whose
portability is *assumed* is the one place that thesis was being violated by default.
Witnessing it converts a hidden assumption into a tested property: if any
platform-dependent behaviour exists (C undefined behaviour, int-width assumptions, listing
line-endings, uninitialised memory), confluence fails loudly and early instead of
corrupting Vectors silently. The cost is real work up front; paying it is the only call
consistent with the discipline the rest of the repo already holds.

## Rejected alternatives

- **Anoint Windows canonical (host-native MSVC).** Makes every other environment a
  workaround and couples the project to one developer's machine — the disease we are
  curing.
- **Anoint Linux/Docker canonical.** Same disease, other OS; and it silently trusts that a
  Linux build equals what the PDP-1 paper tape encoded, which nothing checks.
- **Bake one toolchain, skip the witness.** Cheaper today, but it *assumes* the very
  property the project exists never to assume.

## Revisit trigger

If cross-environment confluence ever fails, platform-independence is false for this
toolchain: pin the divergence out (fixed compiler flags, UB fix), or fall back to
declaring a single confluence-witnessed environment canonical and supersede this ADR.
