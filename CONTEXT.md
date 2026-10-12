# Spacewar! 3.1 → RUNS

Re-deriving Spacewar! 3.1 (1962 PDP-1 assembly) as RUNS source, under a verification-first discipline: nothing is asserted, everything is checked against the original. This context's language is currently the *verification method*; game-domain terms (ship, torpedo, gravity, sense switch, object table) will be added as the source is read against the Oracle.

## Language

### Verification method

**Oracle**:
The comprehensive, source-grounded characterization test suite that pins the original's exact behaviour — 100% coverage, all green. It is the *suite*, not a program, and it is deliverable zero: it exists before any realization. A realization earns its life by passing it.
_Avoid_: emulator, reference implementation, golden master, gold model

**Portable Oracle**:
The Oracle's frozen assertions re-expressed in **address-free, non-PDP-1 terms** — named game-state fields, no core addresses — the form a Realization on any substrate can be graded against. Decoded *from* the (PDP-1-shaped) Oracle, and held to the **same witnessing standard**: every field it asserts is grounded in observed Ground Truth, never in a reading of the Translator. Not a convenience serialization — it is the operational definition of game-state identity across substrates. It is a **lossy projection**: machine-timing/implementation words are dropped by *white-box argument from the source*, leaving a **named residual**. A *complete* Portable Oracle — one whose passing would *prove* a Realization equivalent — is **impossible, not deferred** (ADR-0014); its drops are engineering arguments, and the read-set/"is this word used?" analysis is *inclusion-only*, never a completeness witness.
_Avoid_: decoded dump, translation (unqualified), the fingerprint (when it risks sounding like a mere hash), "complete/perfect Portable Oracle" (a category error — ADR-0014)

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

**RUNS Conversion**:
The re-expression of the game's logic as RUNS source — Records, Processors, Networks, and DIGS bodies. **Not playable.** Authored from Ground Truth; the *subject a Realization is built from*, never the Realization itself. Its faithfulness claim caps at **asserted** — static checks (single-assignment, guard partition, concordance coverage) are real but never reach *verified*; only an oracle grading a Realization built from it does that.
_Avoid_: Realization (the playable thing built from it), port, translation (unqualified)

**Realization**:
A *playable* recreation of the game — new code on a different substrate, authored/compiled **from** the RUNS Conversion. The runnable *subject* the goldens grade — never Ground Truth (the standard), never the RUNS Conversion (its source). Every Realization is either the **Exact Realization** (bit-exact) or a **Variant** (any deviation) — the two partition this term exhaustively.
_Avoid_: port, conversion (that is the RUNS source it is built from), implementation, the source (when it risks meaning Ground Truth)

**Exact Realization**:
A from-scratch recreation of the game as new code on a **different substrate**, bit-exact to Ground Truth in the *discretized math* — the same deterministic fixed-point expressions of the formulas (never float-swapped), so its per-frame game state matches exactly, field for field, **once machine-artifact words are decoded to game meaning** (ADR-0007). The *subject* the frozen goldens grade, never the standard of correctness (that is Ground Truth). Bit-exactness is a *design axiom* asserted **by construction** — the goldens can only *falsify* it, never prove it across all inputs. Distinct from the **Substrate** running the **Image** (also bit-exact, but that is Ground Truth executing itself, not a recreation).
_Avoid_: Golden Realization, emulator, the port, gold master

**Variant**:
Any Realization that is **not** the Exact Realization — *any* variation from the original, at any magnitude, from a **float-swap Variant** (fixed-point replaced by floats) to a **Chess Variant** (a wholly different game). The deviation may be **observable** (it diverges in the graded game state) or **non-observable** (indistinguishable in the graded state, yet built from different expressions, so not bit-exact by construction). Not graded by the goldens; what it does with representation is "the variant author's decision" (ADR-0007).
_Avoid_: fork, mod, port

**Vector**:
A recorded input→output pair for a single original routine, *observed* from the Substrate (never hand-derived). The instrument for the **pure-math island** — the `jda` subroutines (`sqt`, `sin`/`cos`, `mpy`/`imp`, `idv`/`dvd`) — whose branches are reached by enumerating inputs at the entry point, exhaustively where the domain is ≤2¹⁸. Not the instrument for the entangled majority. (ADR-0012.)
_Avoid_: test case, fixture, sample

**Trace** _(the primary instrument)_:
A full object-table snapshot per frame, captured from a scripted, pinned, fixed-seed match. The instrument for the **entangled majority** — every routine whose branches are reachable only by playing the game (`ss1`, `tcr`, `mex`, hyperspace, gravity, the collision test, the main loop's self-modification). The match is constructed to drive a target branch; the per-frame snapshot *is* the characterization. Coverage is measured on the union of all matches' traces. (ADR-0012.)
_Avoid_: log, dump, replay

**Frame seam**:
The per-frame point at which game state is captured and graded: **main-loop entry** — the object table fully settled from the prior frame, before this frame reads input or draws. In Ground Truth it is the `ml0` address (`0o1444`); a Realization has no addresses, so its seam is the *same logical point* defined semantically (start-of-frame). Grading is 1:1 **labelled lockstep**: frame N of a Realization is graded against frame N of the Portable Oracle, and a label mismatch is a frame-alignment failure before any word is compared. The `boot` frame is the initialization anchor (a divergence there is an init bug, not a physics bug).
_Avoid_: tick (unqualified), step, main loop (when it risks meaning the routine, not the seam)

**Pinned inputs**:
The fixed conditions a Trace (or any reproducible run) requires: the `ran` PRNG seed, the six sense switches, and the per-frame control words for both ships. Unpinned, behaviour is not reproducible and nothing can be green.
_Avoid_: config, settings

**Coverage**:
Objective completeness of the Oracle: **every reachable branch of Ground Truth, observed both ways, over the game-scoped input domain (ADR-0007), measured mechanically from SIMH execution traces** — never the Substrate's total input space, never judgement. One definition, *instrument-independent*, measured on the union of every scenario's trace; uncovered branches self-identify as named missing scenarios. Driven to **exhaustive** (every input enumerated) on the pure-math island where the domain is ≤2¹⁸; **branch-complete + boundary sample** where it is ~2³⁶; **branch-complete via Traces** for unbounded state. (ADR-0012 is the spine; ADR-0004 the region→strength mapping.)
_Avoid_: test coverage, percent done

## Flagged ambiguities

- **"Oracle" ≠ "Substrate."** The Substrate (emulator) *produces* observed values; the Oracle is the *suite of tests* asserting them. The emulator can run forever and prove nothing; the Oracle is what holds.
- **"Source"** is dangerously overloaded: it can mean Ground Truth (the `.txt`), the masswerk Translator, or the `.runs` RUNS Conversion files. Always qualify it.
- **"Portable Oracle" ≠ "RUNS Record."** The Portable Oracle is the address-free *expression of the Oracle* — a verification artifact that is the *standard* a Realization is graded against. A RUNS Record (`spacewar:object`) and its Processors are the *subject* (the RUNS Conversion), built **against** the Oracle. They may deliberately share portable field vocabulary so grading lines up field-for-field, but the Oracle is the standard and the Record is measured against it — never the reverse. Decode produces the Portable Oracle; it does **not** define the Record.
- **"Complete Oracle" is a category error — do not reopen (ADR-0014).** "100% coverage" means **branch-completeness of Ground Truth** (achievable, mechanically measured). It does **not** mean **proof that a Realization is equivalent** to the original — that is *impossible* for unbounded state (Rice's theorem; Moore 1956; FSM-conformance requires a bounded-state fault model). The residual is a **mathematical floor, not unfinished work**. The only honest question is ever *how tight a best-effort*, never *best-effort vs. complete*. Conflating these two is the recurring mistake this project keeps re-litigating; ADR-0014 exists to stop it, with sources.

## Example dialogue

> **Dev:** The gravity Processor is written — is it done?
> **Expert:** Does it pass its Vectors?
> **Dev:** I read the masswerk gravity page and it matches what that says.
> **Expert:** That's the Translator, not Ground Truth. The Translator can be wrong. Done means the Substrate ran the original gravity routine on pinned inputs and your Processor reproduced those observed outputs — every branch.
> **Dev:** And if I can't isolate the routine to get a Vector?
> **Expert:** Most routines you don't — only the pure-math `jda` island gets Vectors. Everything entangled is characterized by a Trace: a pinned, fixed-seed match driven to walk the routine's branches, with the object table snapshotted each frame. What you never do is promote a reading of the Translator to a green test. Ever.
