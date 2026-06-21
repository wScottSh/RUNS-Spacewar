# Spacewar! 3.1 → RUNS

Re-deriving Spacewar! 3.1 (1962 PDP-1 assembly) as RUNS source, under a verification-first discipline: nothing is asserted, everything is checked against the original. This context's language is currently the *verification method*; game-domain terms (ship, torpedo, gravity, sense switch, object table) will be added as the source is read against the Oracle.

## Language

### Verification method

**Oracle**:
The comprehensive, source-grounded characterization test suite that pins the original's exact behaviour — 100% coverage, all green. It is the *suite*, not a program, and it is deliverable zero: it exists before any realization. A realization earns its life by passing it.
_Avoid_: emulator, reference implementation, golden master, gold model

**Ground Truth**:
The original PDP-1 assembly (`source/spacewar3.1_complete.txt`), executed as itself. The sole authority on what Spacewar *does*. When in doubt, defer to it — and we are always in doubt.
_Avoid_: spec, reference, original (when ambiguous)

**Translator**:
The masswerk "Inside Spacewar" documentation (`source/masswerk/`). Consulted to interpret *what* a routine does and *how to read* an observed value. A guide, never an authority — it can be wrong about Ground Truth.
_Avoid_: spec, documentation (unqualified)

**Substrate**:
SIMH (the reference PDP-1 simulator) running the assembled Image, driven by its built-in `examine`/`deposit`/breakpoint/step primitives to read state and inject inputs. Chosen for accuracy and instrumentation, not allegiance to a stack. Its CPU semantics are **frozen** — we observe, never alter how any instruction computes.
_Avoid_: emulator (unqualified), VM, "the Gerasimov emulator"

**Assembler**:
`macro1.c`, the canonical PDP-1 Macro assembler. Turns Ground Truth into the Image plus a symbol-resolved listing the harness uses to address routines and variables. A general tool, like the Substrate — not part of what is verified.
_Avoid_: compiler

**Image** (`.rim`):
The assembled binary core image — the only thing the Substrate executes, exactly as the PDP-1 loaded paper tape. Produced from Ground Truth by the Assembler and cross-checked **byte-for-byte** against the published Spacewar image before any Vector is trusted.
_Avoid_: binary (unqualified), tape, ROM

**Realization**:
A RUNS/DIGS expression of the game. The *subject* of the Oracle, never its source. The thing being verified.
_Avoid_: port, conversion, implementation, the source (when it risks meaning Ground Truth)

**Vector**:
A recorded input→output pair for a single original routine, *observed* from the Substrate (never hand-derived). The instrument for the **pure-math island** — the `jda` subroutines (`sqt`, `sin`/`cos`, `mpy`/`imp`, `idv`/`dvd`) — whose branches are reached by enumerating inputs at the entry point, exhaustively where the domain is ≤2¹⁸. Not the instrument for the entangled majority. (ADR-0012.)
_Avoid_: test case, fixture, sample

**Trace** _(the primary instrument)_:
A full object-table snapshot per frame, captured from a scripted, pinned, fixed-seed match. The instrument for the **entangled majority** — every routine whose branches are reachable only by playing the game (`ss1`, `tcr`, `mex`, hyperspace, gravity, the collision test, the main loop's self-modification). The match is constructed to drive a target branch; the per-frame snapshot *is* the characterization. Coverage is measured on the union of all matches' traces. (ADR-0012.)
_Avoid_: log, dump, replay

**Pinned inputs**:
The fixed conditions a Trace (or any reproducible run) requires: the `ran` PRNG seed, the six sense switches, and the per-frame control words for both ships. Unpinned, behaviour is not reproducible and nothing can be green.
_Avoid_: config, settings

**Coverage**:
Objective completeness of the Oracle: **every reachable branch of Ground Truth, observed both ways, over the game-scoped input domain (ADR-0007), measured mechanically from SIMH execution traces** — never the Substrate's total input space, never judgement. One definition, *instrument-independent*, measured on the union of every scenario's trace; uncovered branches self-identify as named missing scenarios. Driven to **exhaustive** (every input enumerated) on the pure-math island where the domain is ≤2¹⁸; **branch-complete + boundary sample** where it is ~2³⁶; **branch-complete via Traces** for unbounded state. (ADR-0012 is the spine; ADR-0004 the region→strength mapping.)
_Avoid_: test coverage, percent done

## Flagged ambiguities

- **"Oracle" ≠ "Substrate."** The Substrate (emulator) *produces* observed values; the Oracle is the *suite of tests* asserting them. The emulator can run forever and prove nothing; the Oracle is what holds.
- **"Source"** is dangerously overloaded: it can mean Ground Truth (the `.txt`), the masswerk Translator, or future `.runs` Realization files. Always qualify it.

## Example dialogue

> **Dev:** The gravity Processor is written — is it done?
> **Expert:** Does it pass its Vectors?
> **Dev:** I read the masswerk gravity page and it matches what that says.
> **Expert:** That's the Translator, not Ground Truth. The Translator can be wrong. Done means the Substrate ran the original gravity routine on pinned inputs and your Processor reproduced those observed outputs — every branch.
> **Dev:** And if I can't isolate the routine to get a Vector?
> **Expert:** Most routines you don't — only the pure-math `jda` island gets Vectors. Everything entangled is characterized by a Trace: a pinned, fixed-seed match driven to walk the routine's branches, with the object table snapshotted each frame. What you never do is promote a reading of the Translator to a green test. Ever.
