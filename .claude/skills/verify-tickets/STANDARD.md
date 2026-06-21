# The Standard — what a Spacewar Oracle ticket must carry

Derived from **EPIC #5** (the ticket schema) and the canonical **ADRs** (the witness,
strength, and coverage-unit definitions).

## Authority layering (the precedence rule)

- **EPIC #5 is the authority on *which* ticket exists and *what it owns*** — its class,
  line range, seam, hard branches, and whether it sits in the one-way / correctly-dead
  register. Live-read it each run (`gh issue view 5`); never copy it.
- **The ADRs are the authority on *what a valid witness / DoD is*** — the coverage unit,
  the per-region strength, the data-faithfulness witness. They are canon.
- **On conflict, the ADR wins.** The EPIC can carry stale phrasing inherited from a
  superseded ADR. It does — see the T-IMAGE precedent at the bottom. A verifier that
  trusts the EPIC blindly will demand an impossible check and send an AFK agent into the
  exact loop this skill exists to prevent.

## Universal — every ticket, regardless of class

1. **Class declared and correct** — M (Vector) / E (Trace) / D (Witness) / non-line-range.
2. **References resolve** — the source line range exists in `source/spacewar3.1_complete.txt`;
   the cited masswerk Translator section exists and is cited *as guide, never authority*
   (CONTEXT.md *Translator*); the governing ADR(s) exist; CONTEXT.md terms (Vector, Trace,
   Witness, Pinned inputs, Ground Truth, Substrate, Image) are used correctly.
3. **Self-contained / order-independent** — no "see previous ticket," no reliance on
   conversation context. A cold agent can grab it in any order and act on it alone (INVEST
   *Independent*).
4. **DoD is a mechanical gate, phrased in the coverage unit** — and the unit is fixed, not
   vague: **decision coverage — every named conditional-skip observed resolving both ways,
   measured from SIMH execution traces** (ADR-0012). Multiway branches (`dispatch`, computed
   jumps) are phrased as **edges — each realized target observed ≥ once** (ADR-0012). A DoD
   that reads "looks done," "matches masswerk," or asserts a result without a mechanical
   observation **fails** (CONTEXT.md *Oracle*; the anti-loop bar — a judgment-free process
   must be able to decide done).
5. **Dead-branch safe** — if the ticket owns a branch in the EPIC's *one-way /
   correctly-dead* register, its DoD must assert the branch resolves **only its one way**
   and must **not** demand covering the unreachable arm (ADR-0007). Demanding the impossible
   is the worst DoD failure: it is unsatisfiable, so the agent loops forever.

## Per class — required fields, and the strength/witness fixed by ADR-0004

Strength is **set objectively by input-domain cardinality, not chosen** (ADR-0004). A
ticket whose claimed strength contradicts its domain is wrong on its face.

**M — Vector (pure-math island).** Fields: routine, entry signature, line range, domain
cardinality, instrument = **Vector**, Translator ref.
- Unary, domain ≤ 2¹⁸ → strength must be **exhaustive** (the proof claim). A unary ticket
  claiming "sampled" is wrong.
- Binary, domain ~ 2³⁶ → strength must be **branch-complete + boundary sample**. A binary
  ticket claiming "exhaustive" is impossible — flag it.
- DoD names the skip-sites to light, both ways. "Observe the Substrate, never hand-derive."

**E — Trace (entangled majority).** Fields: routine(s), line range, seam, instrument =
**Trace**, the **pinned inputs** (the `ran` seed; the sense switches it must pin **both
ways**; the test-word bits; the per-frame control words for both ships), the **hard
branch(es)** the match must drive, Translator ref.
- **Inline check:** an E ticket must **not** propose isolating an inlined block (gravity
  inside `ss1`, the collision test inside the main loop) as its own Vector. Inlined blocks
  are covered **transitively** by the enclosing Trace (ADR-0012). A ticket that splits them
  out contradicts the spine.

**D — Witness (data, no branches).** Field: witness method = **listing ↔ core byte
identity** (ADR-0006), Translator ref. *Not* "byte-for-byte against a published image" —
that witness was superseded (see below).

**Non-line-range (T-IMAGE / T-METER / T-OC-OUTPUT / T-COVERAGE).** Its specific obligation
as the EPIC states it — but checked against the live ADRs for the correct witness.

## Set completeness (checked once, before the per-ticket loop)

The produced backlog must realize the EPIC's own falsifiable DoD:
- **Clause A** — every ticket ID the EPIC's partition names exists as an issue.
- **Clause B** — the four non-line-range tickets (T-IMAGE, T-METER, T-OC-OUTPUT,
  T-COVERAGE) each exist as their own issue; a perfect partition alone silently drops them.
A missing ticket is an order-independence hole in the backlog, not a per-ticket defect.

## The T-IMAGE precedent (why the authority rule exists)

EPIC #5's T-IMAGE says "cross-check the `.rim` byte-for-byte against the **published
Spacewar 3.1 image**." **ADR-0006 says that image does not exist** for stock 3.1 and
supersedes that clause: the witness is **listing ↔ core identity**. The EPIC is quoting the
superseded ADR-0003. When this skill reaches T-IMAGE, it corrects the DoD to the ADR-0006
witness — and notes the stale phrasing for the EPIC author to fix separately.
