# Coverage is exhaustive where the input domain is enumerable, branch-complete elsewhere

Status: accepted

"100% coverage" is defined objectively by each routine's **input-domain cardinality** (set by
instruction width), not by judgement:

- **Unary routines** — a single input ≤18 bits (`sqt`, `sin`/`cos`, `random`) — are vectored
  **exhaustively**: every input enumerated, every observed output recorded. The Vector set is
  the *complete function*; any Realization that passes is *provably* bit-identical on that
  routine. (`sqt` max input `177777` = 65,536 cases; `random` = 2¹⁸ states; `sin`/`cos` a
  bounded angle ≤ 2¹⁸.)
- **Binary routines** — `mpy`/`imp`, `idv`/`dvd` at ~2³⁶ operand pairs, neither enumerable nor
  storable — get **full branch coverage** (every conditional skip observed both ways, measured
  mechanically from SIMH traces) **plus a defined structured/boundary sample**: sign
  combinations, zero, ±max, carry/overflow edges, iteration extremes.
- **State routines** — `ss1`, `tcr`, `mex`, `hp1`/`hp3`, and inline integration — have unbounded
  state; covered by **branch coverage + frame Traces** (Plan B).

## Why

The Realization is the century-long, system-agnostic artifact; the Oracle must bound it as
tightly as feasibility allows. So: maximise to *proof* (exhaustive enumeration) wherever the
domain permits, and fall back to *measured* branch coverage only where 2³⁶ makes enumeration
impossible. The standard is machine-computed from SIMH execution traces — every program word
executed, every conditional resolved both ways — so an uncovered path is a named, missing
Vector, not a matter of opinion.

This trace-measured standard governs the **branch-complete** routines (binary and state),
where enumeration is impossible. For routines vectored **exhaustively**, full enumeration
over the game domain already exercises every in-domain branch, so the enumeration *is* the
coverage witness and no separate trace pass is required. And per ADR-0007 the
"uncovered path = missing Vector" rule is bounded to the **game-exercised** domain: a
conditional that resolves only one way across the entire in-domain enumeration (its other
arm reachable solely by out-of-contract input) is *correctly* dead, not a gap.

## Revisit trigger

If a Realization ever passes a binary routine's structured sample yet diverges from the
Substrate on some untested operand class, that class is added to the sample and this ADR's
sample definition tightened (a deliberate supersede, not silent drift).
