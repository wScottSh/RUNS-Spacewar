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

**Vector** _(Plan A — gates a Processor)_:
A recorded input→output pair for a single original routine, *observed* from the Substrate (never hand-derived). A Realization's Processor is done when it reproduces its routine's Vectors over every branch.
_Avoid_: test case, fixture, sample

**Trace** _(Plan B — integration backstop)_:
A full object-table snapshot per frame, captured from a scripted, fixed-seed, fixed-input match. Catches integration and slot-order behaviour that isolated Vectors hide. Built after Vectors.
_Avoid_: log, dump, replay

**Pinned inputs**:
The fixed conditions a Trace (or any reproducible run) requires: the `ran` PRNG seed, the six sense switches, and the per-frame control words for both ships. Unpinned, behaviour is not reproducible and nothing can be green.
_Avoid_: config, settings

**Coverage**:
Objective completeness of the Oracle, fixed by input-domain size, not judgement. **Exhaustive** (every input enumerated) where the domain is ≤2¹⁸ and enumerable; **branch-complete + boundary-sampled** where it is ~2³⁶; **branch-complete + Traces** for unbounded state. Always *measured* from SIMH execution traces — uncovered paths self-identify as named missing Vectors. (See ADR 0004.)
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
> **Expert:** Then it's not an A-problem yet. We capture it in a Trace once the pieces exist. But we don't promote a reading of the Translator to a green test. Ever.
