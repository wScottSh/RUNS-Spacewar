# Part 5: Cross-References & Research Index

## How to Read This Document

This file provides lookup tables so any agent can locate the authoritative definition for any concept referenced in the conversion bible. It also indexes the research documents that contain the design reasoning behind the conversion decisions.

---

## RUNS Spec Cross-Reference

Every RUNS concept used in the bible mapped to the spec heading where it's defined.

| Concept | Used In Bible | Spec Location |
|---------|---------------|---------------|
| Record | `02_record_definitions.md` (all Records) | `runs-spec/README.md` § "Records, Processors, Networks" |
| Field | `02_record_definitions.md` (all fields on Records) | `runs-spec/README.md` § "Records, Processors, Networks" |
| Processor | `04_conversion_phases.md` Phases 2, 4, 5 | `runs-spec/README.md` § "Records, Processors, Networks" |
| Network | `04_conversion_phases.md` Phase 6 | `runs-spec/README.md` § "Records, Processors, Networks" |
| Guarded Dispatch | `04_conversion_phases.md` Phase 6 (state-based routing) | `runs-spec/README.md` § "Guarded Dispatch" |
| Runtime Interface | `02_record_definitions.md` § boundary Records | `runs-spec/README.md` § "Architecture: Protocol, Library, Ecosystem" |
| Namespace conventions | `spacewar:` prefix | `runs-spec/README.md` § "Namespace Conventions" |
| `runs:` reserved prefix | Mentioned in Record library_analogue fields | `runs-spec/README.md` § "Namespace Conventions" |
| Protocol / Library / Ecosystem split | `02_record_definitions.md` (Library analogues) | `runs-spec/README.md` § "Architecture: Protocol, Library, Ecosystem" |
| Lifecycle (Discover → Build → Run) | `03_aems_layer.md` § Build-Time Compilation Seam | `runs-spec/README.md` § "Lifecycle: Discover → Build → Run" |
| What RUNS excludes | Rendering, physics, input, scripting | `runs-spec/README.md` § "What RUNS is Not" |
| Expression Language | Processor body notation | `runs-spec/EXPRESSION_LANGUAGE.md` (draft) |
| EGS integration table | AEMS/MAPS/WOCS relationships | `runs-spec/README.md` § "Integration with EGS" |

---

## RUNS Library Cross-Reference

Standard Library fields and primitives used in the bible.

| Library Concept | Used In Bible | Library Location |
|----------------|---------------|------------------|
| `runs:delta_time` | `spacewar:tick_input.delta_time` | `runs-library/README.md` § "Boundary Fields (Runtime Interface)" — Inbound |
| `runs:input_intent` | `spacewar:player_controls` extends this | `runs-library/README.md` § "Boundary Fields (Runtime Interface)" — Inbound |
| `runs:render_transform` | `spacewar:render_object` extends this | `runs-library/README.md` § "Boundary Fields (Runtime Interface)" — Outbound |
| `runs:transform` | Referenced for position/rotation pattern | `runs-library/README.md` § "Game Logic Fields" |
| `runs:velocity` | Referenced for velocity pattern | `runs-library/README.md` § "Game Logic Fields" |
| `runs:angular_velocity` | Referenced for angular velocity pattern | `runs-library/README.md` § "Game Logic Fields" |
| Boundary vs Game Logic distinction | Drives the inbound/outbound/internal scoping | `runs-library/README.md` § "Boundary Fields" (intro paragraph) |
| Game-specific extension pattern | `spacewar:player_controls` extends `runs:input_intent` | `runs-library/README.md` § "Boundary Fields" (paragraph on extensions) |

---

## AEMS Schema Cross-Reference

| AEMS Concept | Used In Bible | Schema Location |
|-------------|---------------|-----------------|
| Entity (kind 30050) | `03_aems_layer.md` § Entities | `aems-schema/README.md` § "Entity (Kind 30050)" |
| Manifestation (kind 30051) | `03_aems_layer.md` § Manifestations | `aems-schema/README.md` § "Manifestation (Kind 30051)" |
| Asset (kind 30052) | `03_aems_layer.md` § Summary (listed as 0 count) | `aems-schema/README.md` § "Asset (Kind 30052)" |
| State (kind 30053) | `03_aems_layer.md` § Summary (listed as 0 count) | `aems-schema/README.md` § "State (Kind 30053)" |
| `entity` tag on Manifestation | `03_aems_layer.md` Manifestation JSON | `aems-schema/README.md` § "Manifestation (Kind 30051)" |
| `property` tag | Needle/Wedge `outline_data` | `aems-schema/README.md` § "Manifestation (Kind 30051)" |
| `d`-tag identifier | All Entities and Manifestations | `aems-schema/README.md` § "Entity (Kind 30050)" |
| Four-layer hierarchy | `03_aems_layer.md` § AEMS/RUNS Boundary Rule | `aems-schema/README.md` § "The Four Layers" |
| What AEMS excludes | Rendering, databases, marketplaces | `aems-schema/README.md` § "What AEMS Deliberately Excludes" |
| AEMS → RUNS integration | Build-time compilation seam | `aems-schema/README.md` § "Ecosystem Connections: AEMS → RUNS" |

---

## AEMS Entity Abstraction Convention Cross-Reference

| Convention Concept | Used In Bible | Convention Location |
|-------------------|---------------|---------------------|
| Verb Test (Test 1) | `03_aems_layer.md` rubric results | `aems-conventions/entity-abstraction.md` § "Test 1: The Verb Test" |
| Cross-Game Test (Test 2) | `03_aems_layer.md` rubric results | `aems-conventions/entity-abstraction.md` § "Test 2: The Cross-Game Test" |
| Substitution Test (Test 3) | `03_aems_layer.md` rubric results | `aems-conventions/entity-abstraction.md` § "Test 3: The Substitution Test" |
| Mechanical Signature (Test 4) | `03_aems_layer.md` rubric results | `aems-conventions/entity-abstraction.md` § "Applying the Rubric" |
| Thin-entity-layer pattern | `03_aems_layer.md` § The Thin-Entity-Layer Pattern | `aems-conventions/entity-abstraction.md` § "Games with Thin Entity Layers" |
| IP-agnostic d-tags | `03_aems_layer.md` (projectile, not torpedo) | `aems-conventions/entity-abstraction.md` § "Entities Have No Tags" |
| Object-Entities vs Agent-Entities | `spacecraft` = Object-Entity | `aems-conventions/entity-abstraction.md` § "Object-Entities" / "Agent-Entities" |
| Ranganathan decomposition | `03_aems_layer.md` boundary rule rationale | `aems-conventions/entity-abstraction.md` § "Medium Transparency" |
| Lumper/Splitter spectrum | Entity granularity decisions | `aems-conventions/entity-abstraction.md` § "The Lumper/Splitter Spectrum" |

---

## MAPS Notation Cross-Reference

MAPS is referenced but not directly implemented in this conversion (Spacewar! has no discrete rule transitions beyond state changes — its richness is entirely continuous physics). Included for completeness.

| MAPS Concept | Relevance | Notation Location |
|-------------|-----------|-------------------|
| Score (state machine) | The `game_tick` guarded dispatch is conceptually a MAPS Score | `maps-notation/README.md` |
| Guard expressions | Guarded Arcs in the Network use MAPS-style guard notation | `runs-spec/README.md` § "Guarded Dispatch" |

---

## Source Code Provenance

| Author | Contribution | Source Lines |
|--------|-------------|-------------|
| **Steve Russell** | Primary author — main game loop, entity system, spaceship calculation, collision, explosions, hyperspace | L659–1333 (core game logic) |
| **Peter Samson** | Expensive Planetarium — real star catalog, display routines | L510–653, L1371–1870, `dislis` macro (L565–621) |
| **Dan Edwards** | Gravity simulation (central star) | L1120–1166 (gravity computation) |
| **Alan Kotok** | Hardware interface, control word handling | L98–107, L830–841 (control word read) |
| **Steve Piner** | Hyperspace feature, randomized risk mechanic | Attributed, code at L1007–1077 (hp1/hp3 routines) |
| **Robert A. Saunders** | Control boxes (custom hardware), testing | Hardware interface, no specific code lines |
| **Adams Associates** | Sine/cosine subroutine (external library contribution) | L190–254 — comment at L190: "sine-cosine subroutine" |
| **BBN (Bolt Beranek & Newman)** | Multiply and divide subroutines (external library contribution) | L257–301 (multiply, comment L258), L346–396 (divide, comment L347) |

**Canonical source**: "spacewar3.1_complete.txt" dated 24 Sep 1962. This is the final version by the original team. The file header reads "macro fio-dec system" (DEC's Macro assembler for PDP-1).

---

## Research Document Index

All files in `runs-spacewar/research/`, in chronological order. These contain the design reasoning that informed the bible but are NOT required for execution.

| Filename | Timestamp | Contents | Key Decisions |
|----------|-----------|----------|---------------|
| `202603201705_spacewar_runs_conversion_analysis.md` | 2026-03-20 17:05 | First-principles analysis of converting Spacewar! 3.1 to RUNS. Identifies 10 game systems, proposes Record types, maps challenges. | Identified the 8 core Records; proposed `state` enum to replace self-modifying dispatch; documented negative-zero behavior; identified star catalog as scrolling cosmetic data |
| `202603201705_spacewar_aems_integration.md` | 2026-03-20 17:05 | How AEMS entities and manifestations apply to Spacewar!. Defines the AEMS/RUNS boundary rule. | Established 3 Entities + 4 Manifestations; defined "AEMS = identity, RUNS = behavior" boundary; removed gameplay constants from Manifestations; applied four-test rubric |
| `202603201731_spacewar_aems_integration.md` | 2026-03-20 17:31 | Updated AEMS integration with starfield scrolling note, `game_config` Record (sense switches), and refined Manifestation property boundaries. | Added `spacewar:game_config` Record; confirmed star catalog is scrolling, not static; refined AEMS property scope to outline_data + design_inspiration only |
| `202603201817_spacewar_runtime_boundary.md` | 2026-03-20 18:17 | Defines the strict game-logic / runtime boundary. Introduces 4 inbound + 3 outbound boundary Records. Proposes `render_object` as data projection. | Established inbound/outbound boundary Record typology; defined platform behavior tables; clarified that rendering decisions cannot flow back into game state; identified `velocity_integrate` as the core integration seam |
| `202603201817_spacewar_gap_analysis.md` | 2026-03-20 18:17 | Gap analysis across all prior research. Examines what was missed, edge cases, and coverage verification. | Verified all 10 game systems are covered; identified count-around prevention pattern; confirmed explosion is NOT an Entity; verified sense switch integration points; confirmed PRNG algorithm |

---

## Bible File Index

Quick-reference for navigating the bible itself.

| File | Lines | Purpose |
|------|-------|---------|
| [`CONVERSION_BIBLE.md`](../CONVERSION_BIBLE.md) | ~86 | Index, workspace layout, summary statistics |
| [`01_source_concordance.md`](01_source_concordance.md) | ~207 | Every source line → RUNS mapping. Constants, switches, entity table, state machine. |
| [`02_record_definitions.md`](02_record_definitions.md) | ~494 | All Records, `fixed18` type, runtime interface, boundary summary. |
| [`03_aems_layer.md`](03_aems_layer.md) | ~230 | 3 Entities, 4 Manifestations, boundary rule, build-time compilation, exclusions. |
| [`04_conversion_phases.md`](04_conversion_phases.md) | ~530 | 8 phases with I/O, work items, edge cases, acceptance criteria, dependency graph. |
| [`05_cross_references.md`](05_cross_references.md) | ~175 | This file. Spec index, research index, provenance, bible file index. |

**Total bible size**: ~1,722 lines across 6 files.
