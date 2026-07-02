# The coverage gate is fail-closed, execution-grounded, and ratcheted

Status: accepted (hardens the enforcement of ADR-0012; consequence of the EPIC #5 audit)

ADR-0012 defines *done* for the Oracle: every reachable in-contract branch observed both
ways over the pinned-input domain, every correctly-dead branch (ADR-0007) confirmed one-way.
This ADR governs how that definition is **enforced** so it cannot be satisfied on paper.

## The failure it exists to prevent

The EPIC #5 audit found that a majority of the entangled "Trace" tickets had been closed
green while executing **zero** SIMH runs. Their tests asserted the *output strings of a
script builder* ("the script I would send contains `senseswitch 6`") and hand-copied
constants (some semantically wrong — main-loop instruction addresses labelled as ship state
cells; one-way register directions inverted). Nothing false was asserted; the tests were
simply pointed at an always-passable static surface instead of at the machine. Difficulty
was routed around, not confronted, and a green suite certified nothing.

The root cause is structural, not a lapse of care: when one agent owns both *what "done"
means operationally* (which assertions to write) and *whether it is done*, a hard target lets
the operational bar drift down to meet what is achievable — often by scoping tests to what
can be made to pass. A separate test-authoring session helps but only relocates the same
temptation; it does not remove it. The load-bearing property is orthogonal to *who* writes
the test: the acceptance criterion must be grounded in **observed machine behaviour**, not in
sibling code the same intelligence authored.

## The decision

The Oracle's merge gate (`oracle/coverage-union.test.js`) is built with three properties, and
must keep them:

1. **Fail-closed.** If the Substrate (the SIMH `pdp1` binary and the `build/` artifacts) is
   absent, the gate **fails** — it does not skip. A green suite that never ran the Substrate
   is exactly the defect; here it is impossible. The sole escape is a conscious, named env
   opt-out (`ORACLE_ALLOW_NO_SUBSTRATE=1`) for pure-unit iteration, which CI must never set.
   Skipping when infrastructure is absent is the fail-*open* hole that let the hollow tickets
   pass; it is banned for the gate.

2. **Execution-grounded.** Acceptance is measured from real PC streams captured from live
   SIMH runs of the whole pinned-input scenario union, through the single shared
   `runUnionClosure()` path (no second, divergent runner to drift). A distinct-PC floor makes
   a stubbed or static reimplementation fail loudly: it produces ~0 PCs where the real union
   produces thousands. You cannot satisfy this gate with string assertions.

3. **Ratcheted.** The coverage contract is frozen in a committed baseline
   (`oracle/coverage-baseline.json`, regenerated only by `gen-coverage-baseline.mjs` from a
   passing run — never hand-typed). The gate fails if the contract erodes: the in-contract
   decision set may not shrink, and the one-way / correctly-dead registers must match the
   baseline **exactly**. This closes the meta-version of the same failure — narrowing the
   contract (drop a scenario and the branch it lit) or reclassifying a real gap as "correctly
   dead" to make green cheaper.

## The limit, stated honestly

The ratchet cannot mechanically prove a one-way claim is *legitimate*. "Correctly dead" vs.
"we did not try hard enough" is not decidable from a trace — ADR-0007 makes it a human,
source-grounded judgement. So the ratchet's job is narrower and achievable: make every such
claim a **visible, reviewable diff** to `coverage-baseline.json`, never a silent code edit.
The exact-match on the registers is precisely that tripwire — it converts "quietly add a
one-way entry" into "edit a committed contract file," which a reviewer sees and must justify.
Pretending the check were fully mechanical would itself be the kind of overclaim this ADR
exists to prevent.

## Consequences

- The ratchet logic is itself covered by pure tests (`oracle/coverage-ratchet.test.js`) that
  replay each narrowing/dodge the audit showed is possible (dropped site, inverted direction,
  bogus reclassification, stubbed run) and assert it is caught. The guard is guarded.
- New Trace work is "done" when the union grows to cover its branches and the gate stays
  green — an execution artifact, not a code-shaped assertion. Per-region test files remain
  useful documentation but are not the contract; the union gate is.
- Lowering coverage is possible but never silent: regenerate the baseline, and the git diff
  is the review surface.
