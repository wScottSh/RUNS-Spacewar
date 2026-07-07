# Mission: Verifying a Spacewar! Realization against the Original

## Why
Scott is re-deriving Spacewar! 3.1 (1962 PDP-1 assembly) as a new, tech-agnostic Realization intended to outlive any particular stack. The verification strategy *is* the project — nothing is asserted, everything is checked against the original — so he needs to reason correctly about what the Oracle can and cannot guarantee before committing to the next phase (building the Realization).

## Success looks like
- Can explain, unprompted, why branch coverage of Ground Truth proves the *interrogation* was thorough but is not itself the *contract* a Realization is held to.
- Can look at any Oracle artifact and say whether it can anchor a Realization (portable, value-level) or only characterizes the reference (PDP-1-internal).
- Makes a correct, defensible go/no-go call on phase 2, and knows exactly which anchor is missing before the game can be benchmarked.

## Constraints
- Solo project; the domain terminology already lives in `CONTEXT.md` and `docs/adr/` — teaching must adhere to it.
- Deep, not broad: Scott already commands the project vocabulary (Oracle, Ground Truth, Realization, Vector, Trace, Coverage). The gap is in the *relationships between* these, not the definitions.

## Out of scope (for now)
- PDP-1 instruction-set internals, SIMH mechanics, the assembler.
- General software-testing theory beyond what directly sharpens this one distinction.
