# Game logic converts first (asserted), then realizes (verified)

Status: accepted

Until now the repository has been the Oracle alone — the *standard*. Introducing game
logic brings in the *subject*, and the subject exists in two distinct forms this project
had been collapsing under one word:

- A **RUNS Conversion** — the game's logic re-expressed as RUNS source (Records,
  Processors, Networks, DIGS bodies). It does **not** execute: there is no DIGS
  evaluator (the RUNS specs state this plainly, and none exists in this workspace).
- A **Realization** — a *playable* recreation built from the Conversion, running on a
  concrete target. This is the only form that executes.

A golden (`*.portable.json`) grades *behaviour*, and behaviour requires *execution*. So
a golden can grade only a Realization, never the Conversion it was built from — grading
a Conversion against a golden is the same category error the glossary just removed. The
Conversion's faithfulness therefore caps at **asserted**; only a graded Realization
reaches **verified**.

## The decision

Every game-logic area ships as **two sequential slices**, never one:

1. **Conversion slice** — the RUNS source for that area: game-defined types, Record
   schemas, DIGS Processor bodies with test vectors written alongside, the Network
   wiring, and static validation (single-assignment, guard partition, coverage of the
   Ground-Truth routine the slice claims). Claim: **asserted**.
2. **Realization slice** — a runnable Build on a chosen target, graded frame-for-frame
   against the portable golden. Claim: **verified**, per Processor, as its vectors and
   frames pass bit-for-bit.

Issue #33 is the gravity **Conversion**; its successor #34 is the gravity
**Realization** that earns the grade.

## Why

The two forms carry different claims, so fusing them into one slice launders the weaker
claim into the stronger. A single slice that both authored the source *and* graded it
would have to stand up an evaluator or a Build in-slice — re-fusing "write the game's
source" with "build the runtime that runs it," the exact scope explosion this repository
keeps paying for.

An **asserted-only** slice is not a retreat from the verification-first creed — it is the
creed applied honestly. Static reading, however careful, caps at *asserted* (`CONTEXT.md`;
ADR-0011); the discipline is satisfied by *labelling the claim correctly*, not by
pretending a read is a run. And the cap is not an absence of checking: the Conversion
slice still runs static validation and per-Processor vectors, and the already-captured
**observed** `sqt` / `mpy` / `sincos` Vectors — witnessed from the Substrate, not
hand-derived (ADR-0008) — are verified-tier sources those bodies are held against.

## Rejected alternative

A single vertical slice that authors the gravity Conversion *and* stands up a minimal
DIGS evaluator (or the JS Realization) so the golden grades it in-slice. Rejected: it
re-fuses source-authoring with runtime-building, and it gates the first Realization on
the whole language toolchain rather than letting a concrete Conversion inform the
evaluator's design first.

## Revisit trigger

If a RUNS Evaluator lands as shared infrastructure, the Conversion slice gains the option
to grade its own bodies directly, and the two slices may merge for areas cheap enough to
convert-and-realize together. The split is a consequence of the evaluator's absence, not
a permanent law.

## Provenance note

This ADR stands on local ground only: the absence of a DIGS evaluator, the executable
nature of the goldens, and this repo's own asserted/verified discipline (`CONTEXT.md`;
ADR-0011). It deliberately imports no external "conversion process" prose — an earlier
such document in `runs-spec` was found to rest on artifacts (a prior conversion's source
and postmortems) that do not exist in this workspace, and has since been removed. The
asserted/verified two-tier this ADR uses is defined independently in the RUNS specs
(DIGS / Network Topology §The Oracle), not in any process guide.
