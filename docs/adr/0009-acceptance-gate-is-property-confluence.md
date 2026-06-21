# An exhaustive Vector set is accepted by a property confluence, anchored on the revealed convention

Status: accepted

A single calibration case proves the calling convention was read correctly *at one
point*; it cannot catch an error that is consistent across the whole domain (an
off-by-one in the fixed-point scale passes calibration and corrupts all records
identically). So an exhaustive Vector set is trusted only when it passes a **property
gate** over the entire enumeration — properties that are an independent confluence
between the captured set and known mathematical facts about the routine.

For `sqt`, all of:

1. **Calibration passes** the 3-way convention-reveal confluence (ADR-0007 posture).
2. **Every input enumerated** over `0..0177777`, none missing.
3. **`√0 = 0`** (boundary).
4. **Monotone non-decreasing** across the whole domain.
5. **Exact at every in-range perfect square** — input `n²` → the encoding of `n`, for
   all `n` with `n² ≤ 0177777`. The strongest strand: it checks the convention at
   hundreds of points, i.e. that the reading taken at calibration *generalises*.
6. **Max-input boundary** — `0177777` yields the expected top-of-range answer; every
   answer fits the routine's result width.
7. **Manifest complete** (ADR-0008).

Every property is expressed **against the convention the machine reveals at calibration,
never a hand-derived scaling.** "Binary point between bits 8 and 9" means the answer is
scaled; guessing that scale is the attempt-1 trap. Calibration *reveals* the scale
empirically; properties 4–6 verify the revealed convention holds consistently across the
domain.

## Why

Exhaustive enumeration is only as trustworthy as the convention it was captured under. A
single green calibration case is necessary but not sufficient — a domain-wide systematic
error hides behind it. Monotonicity and the perfect-square family are exactly the checks
that would have caught attempt 1's convention error *mechanically*, instead of after it
contaminated the set. Anchoring on the revealed convention keeps the gate from smuggling
a Translator-class scaling back in as the standard of truth.

## Revisit trigger

If a routine's mathematics affords a stronger independent property than this set (or if a
captured set passes all seven yet a Realization later diverges on it), tighten the gate
and supersede. The gate is a floor on confidence, not a ceiling.
