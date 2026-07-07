# Oracle → Realization Verification Glossary

The canonical language for reasoning about what the Spacewar! Oracle can and cannot guarantee. Base project terms (Oracle, Ground Truth, Realization, Vector, Trace, Coverage, Substrate) are defined authoritatively in `CONTEXT.md` and are treated as **known** — Scott commands them. This file adds only the *relational* distinctions that sharpen how those terms interact.

## Terms

_(Terms are promoted here only once demonstrated. Candidates currently being taught — pending demonstration — are listed at the bottom.)_

### Established (deferring to CONTEXT.md)
**Oracle**, **Ground Truth**, **Realization**, **Vector**, **Trace**, **Coverage**, **Substrate**, **Exact Realization**, **Variant** — see `CONTEXT.md`. Assumed known.

**Realization partition** *(relational)*:
*Realization* splits **exhaustively** into the **Exact Realization** (bit-exact by construction) and **Variant** (*any* deviation, at any magnitude). A Variant's deviation may be **observable** (it diverges in the graded game state) or **non-observable** (passes every golden yet is not bit-exact by construction). The non-observable case is why the goldens can only *falsify* Exactness, never *prove* it — observation can't distinguish a non-observable Variant from the Exact Realization.
_Avoid_: Golden Realization (deprecated alias for Exact Realization)

---

## Established (relational — defined here)

**Reference-internal** vs **Portable** assertion:
An assertion expressed in PDP-1 PC / register / core-address terms (non-transferable — e.g. the raw `mtb` word `002310`, a calc-routine pointer) vs one in input→output / decoded observable-state terms (transferable). A frozen raw word is **not** automatically portable: if its value is a machine artifact it stays reference-internal until a **witnessed decode** gives it a game-side end to shackle to.

---

## Candidates (being taught — not yet promoted)

- **Interrogation-completeness** vs **Contract** — did I probe every branch of the original, vs is there a portable assertion a Realization is graded against.
- **Two-ended anchor** — an assertion attached to Ground Truth at one end *and* to the Realization at the other; only such assertions hold the Realization.
- **Fact/encoding weld** — a single object-table word carrying both a game fact and its PDP-1 machine encoding (e.g. `mtb` = "normal" *and* the core address of the calc routine).
- **Witnessed decode** — a game-meaning mapping *read off Substrate execution* (a Trace), not asserted from the Translator's prose; the discipline that lets a decode layer stay on the right side of the creed.
