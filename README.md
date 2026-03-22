# Spacewar! 3.1 → RUNS

**The first game ever written for a computer, converted to the first game ever written in RUNS.**

🏠 **[EGS Overview](https://github.com/enduring-game-standard)**
· ⚡ **[RUNS Spec](https://github.com/enduring-game-standard/runs-spec)**
· 📦 **[AEMS](https://github.com/enduring-game-standard/aems-schema)**
· 🎼 **[MAPS](https://github.com/enduring-game-standard/maps-notation)**

> **Status**: Source complete. Awaiting first runtime.

---

## What This Is

Spacewar! 3.1 (24 September 1962) — the original two-player space combat game by Steve Russell, Martin Graetz, and Wayne Wiitanen — fully converted to [RUNS](https://github.com/enduring-game-standard/runs-spec) source files.

Every line of the original 1,870-line PDP-1 assembly has been mapped to a RUNS equivalent: types, records, enums, processors, networks, AEMS entity events, and static data. The game logic is complete. What's missing is a runtime to compile and execute it.

**This is a proving ground.** If RUNS can express a real game — with gravity physics, toroidal wrapping, diamond-shaped collision detection, escalating hyperspace risk, and six configurable sense switches — then it can express anything.

## Source Files

```
src/
├── types/        1 file    18-bit fixed-point type specification
├── records/     12 files   Game state, entity schema, boundary interface
├── enums/        3 files   Entity states, match lifecycle, render types
├── processors/  24 files   6 math · 11 entity · 7 system
├── networks/     2 files   Game tick topology + ship update pipeline
├── aems/         2 files   3 Entity events + 4 Manifestation events
├── data/         4 files   Star catalog (469 stars) · init values · ship outlines
├── docs/         2 files   Outline format guide · runtime contract
└── tests/        1 file    Verification report + test vectors
```

**51 files. 24 Processors. 2 Networks. All game logic. Zero runtime code.**

## How It Works

```
       INBOUND                    GAME LOGIC                    OUTBOUND
  ┌──────────────┐          ┌───────────────────┐         ┌──────────────┐
  │ tick_input    │          │                   │         │ render_list  │
  │ controls × 2  │────────▶│   game_tick.runs   │────────▶│ match_result │
  │ display_config│          │                   │         │ starfield    │
  └──────────────┘          └───────────────────┘         └──────────────┘
                                     │
                            24 Processors execute
                            in 6 ordered phases:
                            ┌─────────────────────┐
                            │ 1. Entity dispatch   │ ← per-entity, slot order
                            │ 2. Spawn processing  │
                            │ 3. Collision detect   │ ← diamond hitbox
                            │ 4. Match logic        │ ← scoring truth table
                            │ 5. World state        │ ← starfield scroll
                            │ 6. Output projection  │ ← render list
                            └─────────────────────┘
```

The runtime provides input each frame. The Network transforms state. The runtime renders output. Game logic never touches the screen. The runtime never touches game state. The boundary is absolute.

## The Conversion

The `conversion/` directory contains the complete scholarly analysis:

| Document | What It Covers |
|----------|---------------|
| [CONVERSION_BIBLE.md](CONVERSION_BIBLE.md) | Master index and approach |
| [01_source_concordance.md](conversion/01_source_concordance.md) | Line-by-line PDP-1 source analysis |
| [02_record_definitions.md](conversion/02_record_definitions.md) | All Record schemas with field-level docs |
| [03_aems_layer.md](conversion/03_aems_layer.md) | Entity/Manifestation analysis (4-test rubric) |
| [04_conversion_phases.md](conversion/04_conversion_phases.md) | 8-phase conversion plan with acceptance criteria |

## What's Needed: A Runtime

This repo contains all game logic but zero executable code. To play Spacewar!, someone must build a RUNS runtime — a program that:

1. **Parses** `.runs` source files
2. **Compiles** the expression language into executable form
3. **Executes** the `game_tick` Network each frame
4. **Renders** the output (ships, torpedoes, explosions, stars)

See [`src/docs/runtime_contract.md`](src/docs/runtime_contract.md) for the complete runtime specification — everything a runtime implementer needs to build a working game from these source files.

The first runtime target is **web** (browser-based). But any platform works: desktop, mobile, embedded, a Raspberry Pi wired to a CRT.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Expression language | Imperative syntax, pure semantics — executable math with branching |
| Integer width | 32-bit signed, wrapping overflow |
| Error semantics | Saturating (div/0 → MAX_VALUE) |
| Network topology | Ordered phases — deterministic by declaration |
| AEMS boundary | Ship outlines on Manifestations; all behavior in RUNS |
| Collision model | Diamond (Manhattan) hitbox — original behavior preserved |
| Scoring | Surviving ship gets +1; both alive = tie (both +1) |

## The Bigger Picture

Spacewar! was the first game that could be shared — copied from one PDP-1 to another on paper tape, modified by anyone who could read the source. It was the original open-source game, sixty years before the term existed.

This conversion restores that property. The RUNS source is plain text. Anyone can read it. Anyone can modify it. Anyone can build a runtime for it. The game logic belongs to everyone and depends on no one.

That's what [Enduring Game Standard](https://github.com/enduring-game-standard) is for.

---

**MIT License** — Open for implementation, extension, critique.
