# Spacewar! 3.1 → RUNS Conversion Bible

## What This Is

This is the authoritative, self-contained specification for converting Spacewar! 3.1 (PDP-1, 24 Sep 1962) into a fully RUNS-compliant game. An agent with only this document, the part files below, and the source code can execute the full conversion without any prior session context.

**Spacewar! 3.1** is the canonical version of the first real-time video game, written by Steve Russell, Peter Samson, Dan Edwards, Alan Kotok, Steve Piner, and Robert A. Saunders at MIT for the PDP-1 minicomputer. The source is 1,870 lines of PDP-1 Macro assembler implementing two spaceships, torpedoes, gravity, hyperspace, and Peter Samson's Expensive Planetarium (~500 real stars). It is the earliest complete video game source code that survives.

**This conversion** produces a RUNS-compliant representation of Spacewar! 3.1 — portable across any runtime (web browser, N64 ROM, future targets) — while preserving bit-identical gameplay behavior. The AEMS entity layer, RUNS record/processor/network layer, and runtime interface boundary are all defined.

---

## The Self-Containment Contract

> An agent reading only this index, the 5 part files in `conversion/`, and the source code in `source/spacewar3.1_complete.txt` has everything needed to execute any conversion phase. The research documents in `research/` contain reasoning and rationale but are not required for execution.

---

## Workspace Layout

| Path | Contents |
|------|----------|
| `runs-spacewar/CONVERSION_BIBLE.md` | **This file** — index and entry point |
| `runs-spacewar/conversion/01_source_concordance.md` | Every source line (L1–1870) mapped to its RUNS equivalent |
| `runs-spacewar/conversion/02_record_definitions.md` | All Record types, Fields, types, boundary interface |
| `runs-spacewar/conversion/03_aems_layer.md` | 3 Entities, 4 Manifestations, AEMS/RUNS boundary rule |
| `runs-spacewar/conversion/04_conversion_phases.md` | 8 phases with inputs, outputs, acceptance criteria |
| `runs-spacewar/conversion/05_cross_references.md` | Spec/Library/AEMS cross-reference index + research index |
| `runs-spacewar/source/spacewar3.1_complete.txt` | Canonical PDP-1 Macro assembler source (1,870 lines) |
| `runs-spacewar/research/` | Design reasoning artifacts (5 timestamped documents) |

### Spec Dependencies (Relative to Repo Root)

| Spec | Path |
|------|------|
| RUNS Protocol | `runs-spec/README.md` |
| RUNS Library | `runs-library/README.md` |
| AEMS Schema | `aems-schema/README.md` |
| AEMS Entity Abstraction | `aems-conventions/entity-abstraction.md` |
| MAPS Notation | `maps-notation/README.md` |

---

## Table of Contents

### [Part 1: Source Code Concordance](conversion/01_source_concordance.md)
Every line of the 1,870-line source mapped to its RUNS equivalent. Includes the game constants table, sense switch map, and macro classification. The ground truth for "where does this code go?"

### [Part 2: Record Definitions & Runtime Interface](conversion/02_record_definitions.md)
Complete definitions for all 8 Record types, the `spacewar:fixed18` type specification, and the runtime interface boundary (4 inbound, 3 outbound Records) with platform behavior tables.

### [Part 3: AEMS Entity Layer](conversion/03_aems_layer.md)
The 3 Entities (`spacecraft`, `projectile`, `gravity-source`), 4 Manifestations (`spacewar:needle`, `spacewar:wedge`, `spacewar:torpedo`, `spacewar:central-star`), the AEMS/RUNS boundary rule, and the build-time compilation seam.

### [Part 4: Conversion Phases](conversion/04_conversion_phases.md)
8 sequential phases from type system through verification. Each phase has explicit inputs, outputs, source lines consumed, step-by-step work items, and acceptance criteria. Designed for phase-by-phase execution by any agent.

### [Part 5: Cross-References & Research Index](conversion/05_cross_references.md)
Lookup tables mapping every RUNS/AEMS/MAPS concept to its spec location. Index of all research documents with one-line descriptions.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Source lines | 1,870 |
| RUNS Records | 8 types |
| RUNS Processors | ~18 (math + entity + system) |
| RUNS Networks | 2 (`game_tick`, `ship_update`) |
| AEMS Entities | 3 |
| AEMS Manifestations | 4 |
| Boundary Records | 7 (4 inbound, 3 outbound) |
| Conversion Phases | 8 |
| PDP-1 sense switches | 6 |
| Star catalog entries | ~500 |
