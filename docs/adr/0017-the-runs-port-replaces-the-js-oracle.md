# The RUNS port and its compiler replace the JS Oracle harness

Status: accepted (supersedes ADR-0012, ADR-0013, ADR-0015 and ADR-0016; amends ADR-0006 and ADR-0014)

The game is now written in RUNS (`runs/`), and a reference evaluator runs it (`tools/runs.py`). A compiler (`tools/runsc.py`) builds the RUNS text, with a PDP-1 binding (`pdp1/`), back to the original tape image. The image's sha256 matches the one spacewar-c's `macro1` assembles from Ground Truth. The checks run each RUNS routine in the evaluator and compare it with Ground Truth running in SIMH, through spacewar-c's SIMH driver. The JS Oracle harness (`oracle/*.js`, the coverage gate, the Portable Oracle and `decode.js`) is removed. The vectors the checks still read stay in `oracle/`. The removed files are in the history at the parent of commit 9d24f9c.

## Why

ADR-0016 split the game logic into a Conversion that could not execute, because no DIGS evaluator existed, and a Realization that could. Both premises changed. RUNS has an evaluator, so the Conversion executes and is graded directly against Ground Truth. And the Conversion compiles to the original image, so the hash grades the whole of it at once. Grading a Realization through an address-free Portable Oracle (ADR-0015) is no longer the path. The comparisons read Ground Truth's core through the binding, which says where each Record field lives.

## What still holds

- **ADR-0001.** Expected values are observed from Ground Truth executed in SIMH, never from a reimplementation. Every check does this, except `check_square_root`, which reads recorded vectors.
- **ADR-0003, ADR-0005 and ADR-0010.** SIMH and `macro1` are the Substrate and the Assembler, built headless. The checks reach them through spacewar-c.
- **ADR-0007.** The domain is the game's. The checks draw their inputs from what play reaches, plus edge cases.
- **ADR-0008 and ADR-0009.** The recorded vectors stay raw words with their provenance (`oracle/provenance.json`).
- **ADR-0011.** "Verified" is an objective artifact gate. Here the gate is `tools/check_all.sh`: the image's hash, the mutation check, and every check against SIMH.
- **ADR-0014.** No finite suite proves equivalence, and that still holds. The port's equivalence judgments and its loop bounds are evidence, not proof (`INTENT.md`, "Verified").

## What changes

- **ADR-0006.** The witness for assembly is now the image hash. spacewar-c assembles Ground Truth with `macro1`, and the compiled RUNS must produce that exact image.
- **ADR-0012 and ADR-0013.** Branch coverage is no longer the definition of done. The definition is a hash match, each routine matching SIMH, and the mutation check (`tools/check_compiled.py`). The mutation check requires every edit to the RUNS text or the binding to change the image, be refused, or be shown to leave the game the same.
- **ADR-0015 and ADR-0016.** Superseded, for the reasons above.
