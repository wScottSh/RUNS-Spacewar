# Vector granularity follows the original's own entry points

Status: accepted

A **Vector** is captured only at an entry point the original assembly actually provides:

- **Value Vectors** for the math `jda` subroutines (`sin`/`cos`, `mpy`/`imp`, `sqt`, `idv`/`dvd`)
  — AC/IO in, AC out.
- **State Vectors** for the dispatched calc routines (`ss1` ship, `tcr` torpedo, `mex` explosion,
  `hp1`/`hp3` hyperspace) — object-table state in, object-table state out, with the harness
  reconstructing the slot's pointer setup the main loop performs.

Inline blocks that have **no entry point** — gravity (inside `ss1`, ~L1118–1216), the collision
test (inside the main loop, ~L870–904) — are **not** given synthetic isolated Vectors. They are
verified *transitively* within their enclosing routine's Vector, and pinned by frame-level Traces
(Plan B).

Consequently: **the original's subroutine/dispatch structure drives the RUNS Processor
decomposition.** Where the 1962 authors drew a `jda`/dispatch seam, that is a natural Processor
with a free Vector. Where they inlined, RUNS may inline too — rather than imposing a finer,
modern-ECS split the source does not support.

## Why

Keeps the harness honest and simple, avoids fragile mid-routine state reconstruction, and
resists shaping the game by a decomposition ungrounded in Ground Truth — which is exactly the
confident-but-unverified move that produced attempt 1.

## The trade-off, and what forces a revisit

The cost is accepted with eyes open: some Processors are gated only **in aggregate** (within an
enclosing Vector), not in isolation. This stands *by choice, not by drift*.

**Revisit trigger:** if a discrepancy ever cannot be localized to a specific inline block because
its enclosing Vector is too coarse to tell where the divergence lives, that is the evidence that
this granularity is naive. The deliberate response is then to add synthetic mid-routine entry
(set up the block's live preconditions, run entry-PC → exit-PC) for that block — and **supersede
this ADR**. Until that evidence exists, the coarser gate is correct.
