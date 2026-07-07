# Oracle → Realization Verification Resources

## Knowledge

- [Inozemtseva & Holmes, "Coverage Is Not Strongly Correlated with Test Suite Effectiveness," ICSE 2014 (PDF)](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf)
  31,000 suites over five 100 KLOC programs. Branch/decision coverage adds no predictive value for fault-detection once suite size is controlled. Use for: why "100% branch coverage" is not a completeness bar for a *contract*.
- [Zhang & Mesbah, "Assertions Are Strongly Correlated with Test Suite Effectiveness," FSE 2015](https://dl.acm.org/doi/10.1145/2786805.2786858)
  It's assertion count/strength — not coverage — that predicts whether a suite catches bugs. Use for: why "a branch ran" ≠ "the value it produced is pinned."
- [Characterization test — Wikipedia](https://en.wikipedia.org/wiki/Characterization_test)
  Characterization/golden-master tests pin *observed behavior*, and were designed for **refactoring the same code**, not re-deriving it on a new machine. Use for: why the technique's portability to a from-scratch Realization is not automatic.
- [Jiang et al., "Automatically Locating ARM Instructions Deviation between Real Devices and CPU Emulators," arXiv:2105.14273](https://arxiv.org/pdf/2105.14273)
  QEMU (mature, decades-hardened) still diverges from real ARM on 155,642 instruction streams / 30% of encodings, 4 confirmed bugs. Use for: the real-world ceiling on "a finite suite certifies equivalence."
- [ProgramBench, "Can Language Models Rebuild Programs From Scratch?" arXiv:2605.03546](https://arxiv.org/html/2605.03546v1)
  Finite behavioral tests are a *lower bound*: failing code is definitively wrong, passing code may still diverge on untested inputs. Use for: framing the Oracle as regression guard vs equivalence proof.

## Primary (the project's own ground truth)

- `CONTEXT.md` — the verification-method glossary (Oracle, Ground Truth, Realization, Vector, Trace, Coverage, Substrate).
- `docs/adr/0012-coverage-is-branch-completeness-instrument-follows-region.md` — the coverage spine; line 91 ("the per-frame object-table snapshot records the truth") is the intended-but-not-yet-frozen game contract.
- `docs/adr/0004-coverage-exhaustive-where-enumerable.md` — where exhaustive Vectors give a bit-identical *proof* vs a boundary sample.
- `oracle/*-vectors.jsonl` — the artifacts that *do* have both anchor-ends (portable input→output goldens).

## Gaps
- No high-trust resource yet on **differential testing harness design** for reimplementations (new code vs live reference on expanding inputs). Needed for phase 2.
