# Cheap independent properties sanity-check an exhaustive Vector capture

Status: accepted (amended — demoted from "the acceptance gate" to a capture-wiring sanity
check; the convention-reveal calibration is dropped, see below)

An exhaustive Vector set is captured by **observing the Substrate** — enumerate every input,
record the AC word at halt. By construction the captured set *is* Ground Truth for that
routine; there is nothing to "accept" it against, because nothing was derived. What can still
go wrong is the **capture wiring**: the harness read the wrong register, halted at the wrong
PC, skipped or doubled an input, mis-ordered the enumeration. Cheap independent properties
catch exactly that class of bug.

For `sqt`, all of:

1. **Every input enumerated** over `0..0177777`, none missing, none duplicated.
2. **`√0 = 0`** (boundary).
3. **Monotone non-decreasing** across the whole domain.
4. **Exact at every in-range perfect square** — input `n²` → the encoding of `n`, for all `n`
   with `n² ≤ 0177777`. The strongest strand: hundreds of points where the observed bits must
   match a known mathematical fact, so a systematic capture error (a stuck shift, an
   off-by-one in the read) surfaces immediately.
5. **Max-input boundary** — `0177777` yields the expected top-of-range answer; every answer
   fits the routine's result width.
6. **Manifest complete** (ADR-0008).

These are **observation-wiring sanity**, not a derivation gate. They are an independent
confluence between the captured bits and known facts about the routine's mathematics, so they
would catch a buggy harness mechanically instead of after it contaminated the set.

## What was dropped, and why

The earlier version of this ADR required a **3-way convention-reveal calibration** as
property #1 — apparatus to empirically *reveal* the fixed-point scale ("binary point between
bits 8 and 9") so the recorded answers were read under the right convention. That apparatus
was **armor for a wound the method does not have.** It existed because attempt 1 *derived*
sqt's expected answers from the Translator's documented convention, got the scale wrong, and
needed calibration to catch the error. Pure observation has no convention to get wrong: the
AC word at halt *is* the answer the caller receives, recorded as raw bits (ADR-0008). There
is no scale to reveal because no scale is ever applied — the Realization must reproduce the
*bits*, and the fixed-point reading is documentation, never an assertion. Convention-reveal
calibration is therefore dropped as a requirement. (Where a routine's mathematics affords a
genuinely independent property, as the perfect-square family does for `sqt`, that property is
kept on its own merit — as sanity, not as a convention check.)

## Why

"Nothing asserted, everything checked" applies to the capture itself. The cheap properties
are the checked-ness of the *harness* — they are not the standard of truth (the Substrate
is), and they are not a per-routine acceptance ceremony (ADR-0012 is the spine; this is a
corner serving the pure-math island). Keeping them lean, and dropping the derivation armor,
is what keeps the easy case from being gold-plated.

## Revisit trigger

If a routine's mathematics affords a stronger independent property than its set's, add it as
sanity. If a captured set passes every property yet a Realization later diverges on it, the
divergence names a real gap — capture or coverage — and is fixed at its source, not by
re-introducing convention-reveal armor.
