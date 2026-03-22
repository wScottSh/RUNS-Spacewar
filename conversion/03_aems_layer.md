# Part 3: AEMS Entity Layer

## How to Read This Document

This file defines the AEMS (Asset-Entity-Manifestation-State) layer for Spacewar! 3.1. AEMS answers **"what is this thing?"** — identity, archetype, recognizability across games. RUNS answers **"how does this thing behave?"** — physics, state transitions, game logic constants.

Cross-references:
- AEMS Schema: `aems-schema/README.md` — kind 30050 (Entity), kind 30051 (Manifestation) formats
- Entity Abstraction Convention: `aems-conventions/entity-abstraction.md` — the 4-test rubric, thin-entity-layer pattern
- Record definitions: `02_record_definitions.md` — where RUNS game logic constants live

---

## The AEMS/RUNS Boundary Rule

> **AEMS Manifestation properties define what a thing IS (visual identity, recognizability). RUNS Records define how a thing BEHAVES (physics constants, game logic). If changing a value changes how the game plays without changing what the thing looks like, it's RUNS. If changing a value changes what the thing looks like without changing how it plays, it's AEMS.**

The chess-knight test (from `aems-conventions/entity-abstraction.md`):
- Entity: `chess-knight` — the universal archetype
- Manifestation: Staunton-style, carved wood, 3.5 inches — the visual identity
- RUNS: L-shaped movement, captures by displacement — the game rules

A chess variant where the knight moves differently doesn't need a new Entity or Manifestation. It needs different RUNS logic. Applied to Spacewar!: a variant with faster torpedoes doesn't need new AEMS events — it needs different `spacewar:game_constants` values.

---

## The Thin-Entity-Layer Pattern

Spacewar! has the thinnest possible AEMS layer. From `aems-conventions/entity-abstraction.md` § Games with Thin Entity Layers:

> *"The more a game's identity lives in its mechanics rather than its objects, the thinner its AEMS layer and the richer its MAPS layer."*

Spacewar!'s depth lives entirely in its physics (gravity, thrust, momentum) and its state machine (hyperspace risk/reward). The game has almost no objects — its richness is mechanical.

| Thing in Spacewar! | Entity? | Why |
|-------------------|---------|-----|
| Spaceship | **Yes** — player-controlled, persists across frames | Entity: `spacecraft` |
| Torpedo | **Yes** — launched object, has lifetime, collides | Entity: `projectile` |
| Central star | **Yes** — fixed position, exerts gravity, destroys on contact | Entity: `gravity-source` |
| Explosion | **No** — a state transition, not a persistent object | RUNS state (`exploding` enum value) |
| Hyperspace | **No** — a state transition of the ship | RUNS state (`hyperspace_in` / `hyperspace_out`) |
| Star catalog | **No** — cosmetic backdrop with no gameplay interaction | RUNS data Record |
| Ship outline | **No** — visual art data, not a separate thing | AEMS Manifestation property |

---

## Four-Test Rubric Results

### Spacecraft

Applied rubric from `aems-conventions/entity-abstraction.md` § Four Tests:

| Test | Result |
|------|--------|
| **Verb Test** | `pilot → rotate, thrust, fire, hyperspace` — **vehicle** verb cluster (matches `aems-conventions/entity-abstraction.md` table) |
| **Cross-Game Test** | Spaceships in Asteroids, Galaga, Star Control, FTL, Elite, hundreds more — ✅ |
| **Substitution Test** | Swap Spacewar!'s wedge into Asteroids? Meaningful — ✅ |
| **Mechanical Signature** | {rotational movement, thrust, limited fuel, weapon mount, collision hull} — distinct cluster |

**Verdict: Entity `spacecraft`.** 3.5/4. The spaceship is a universal archetype.

### Projectile

| Test | Result |
|------|--------|
| **Verb Test** | `fire → travels → impacts → destroys` — **projectile** verb cluster |
| **Cross-Game Test** | Projectiles in every shooter — ✅ |
| **Substitution Test** | Swap a Spacewar! torpedo into Asteroids → it IS the bullet — ✅ |
| **Mechanical Signature** | {linear travel, lifetime-limited, collision kills, fired from vehicle} — ✅ |

**Verdict: Entity `projectile`.** 4/4. Not `torpedo` — the entity-abstraction convention's IP boundary principle says d-tags must be IP-agnostic.

### Gravity Source

| Test | Result |
|------|--------|
| **Verb Test** | `none` — environmental hazard, passive force. Matches `obstacle` verb pattern in entity-abstraction table |
| **Cross-Game Test** | Gravity sources in Angry Birds Space, Star Control, Kerbal Space Program — ✅ |
| **Substitution Test** | Swap into a space dogfight game → meaningful — ✅ |
| **Mechanical Signature** | {fixed position, gravity field, destroy-on-contact, visual beacon} — distinct |

**Verdict: Entity `gravity-source`.** 3/4. Verb test weakest (passive), but the entity-abstraction doc includes passive obstacles.

### Explosion — NOT an Entity

| Test | Result |
|------|--------|
| **Verb Test** | None — consequence, not interaction target |
| **Cross-Game Test** | Explosions are universal effects, not entities |
| **Substitution Test** | Can't meaningfully "swap" an explosion between games |
| **Mechanical Signature** | {radiating particles, countdown} — but no persistent identity |

**Verdict: NOT an Entity.** 1/4. The board-game test: in a board game version, you'd declare "destroyed" and remove the piece — no explosion token. In the PDP-1 code, explosions occupy entity slots because the flat object table doesn't distinguish "game objects" from "visual effects." AEMS + RUNS gives us the vocabulary the original code lacked.

---

## Entities (Kind 30050)

Three IP-agnostic Entities. Published to Nostr relays. Any space combat game can reference them.

```json
{
  "kind": 30050,
  "tags": [["d", "spacecraft"], ["name", "Spacecraft"]],
  "content": {
    "description": "A player-controlled vehicle capable of thrust, rotation, and weapon fire in a space environment."
  }
}
```

```json
{
  "kind": 30050,
  "tags": [["d", "projectile"], ["name", "Projectile"]],
  "content": {
    "description": "A launched object that travels through space and damages targets on impact."
  }
}
```

```json
{
  "kind": 30050,
  "tags": [["d", "gravity-source"], ["name", "Gravity Source"]],
  "content": {
    "description": "A fixed or mobile object that exerts gravitational attraction on nearby entities."
  }
}
```

---

## Manifestations (Kind 30051)

Four game-specific implementations. Each references a parent Entity via the `entity` tag. Only identity-defining properties appear here — no gameplay constants.

### The Needle (Ship 1)

```json
{
  "kind": 30051,
  "tags": [
    ["d", "spacewar:needle"],
    ["entity", "<spacecraft_id>", "spacecraft"],
    ["game", "spacewar"],
    ["property", "outline_data", "111131 111111 111111 111163 311111 146111 111114 700000", "spacewar:outline"],
    ["property", "design_inspiration", "Redstone rocket / Buck Rogers", "string"]
  ],
  "content": {
    "game": "Spacewar! 3.1 (24 Sep 1962)",
    "name": "The Needle",
    "description": "One of the two original Spacewar! spaceships, designed to evoke the PGM-11 Redstone missile. Stored as octal-encoded drawing instructions for the PDP-1 outline compiler."
  }
}
```

Source: `ot1` (L1338–1345). The outline data IS the Needle's visual identity — it's what makes the Needle the Needle, not just any spacecraft.

### The Wedge (Ship 2)

```json
{
  "kind": 30051,
  "tags": [
    ["d", "spacewar:wedge"],
    ["entity", "<spacecraft_id>", "spacecraft"],
    ["game", "spacewar"],
    ["property", "outline_data", "013113 113111 116313 131111 161151 111633 365114 700000", "spacewar:outline"],
    ["property", "design_inspiration", "Buck Rogers spaceship", "string"]
  ],
  "content": {
    "game": "Spacewar! 3.1 (24 Sep 1962)",
    "name": "The Wedge",
    "description": "One of the two original Spacewar! spaceships, designed to evoke classic science fiction aesthetics."
  }
}
```

Source: `ot2` (L1348–1355).

**Why no gameplay properties on ship Manifestations**: Both ships share identical gameplay constants (fuel, torpedoes, acceleration, collision radius). These live on RUNS Records (`spacewar:game_constants`), not Manifestations. The only Manifestation-level difference between the two ships is the `outline_data` — the visual identity. Two ships with different outlines but identical RUNS constants play identically but look different.

### The Torpedo

```json
{
  "kind": 30051,
  "tags": [
    ["d", "spacewar:torpedo"],
    ["entity", "<projectile_id>", "projectile"],
    ["game", "spacewar"]
  ],
  "content": {
    "game": "Spacewar! 3.1",
    "name": "Torpedo",
    "description": "A single-shot projectile rendered as a point on the PDP-1 CRT display."
  }
}
```

No properties at all. Torpedo velocity (`tvl`, L78), lifetime (`tlf`, L80), reload time (`rlt`, L79), and gravity warpage (`the`, L88) are all game logic constants in `spacewar:game_constants`. A variant with faster torpedoes doesn't need a new Manifestation — it needs different RUNS constants.

### The Central Star

```json
{
  "kind": 30051,
  "tags": [
    ["d", "spacewar:central-star"],
    ["entity", "<gravity_source_id>", "gravity-source"],
    ["game", "spacewar"]
  ],
  "content": {
    "game": "Spacewar! 3.1",
    "name": "Central Star",
    "description": "A fixed gravitational source at the center of the playing field, rendered as a dotted circle on the PDP-1 CRT display."
  }
}
```

Capture radius (`str`, L84), gravity strength, and position are game logic constants in `spacewar:game_constants` — RUNS Records.

---

## What's NOT AEMS

| Thing | Why Not AEMS | Where It Lives |
|-------|-------------|---------------|
| Explosions | State transition — "what happens to a thing," not "a thing" | `spacewar:object.state = exploding` (RUNS Record) |
| Hyperspace | State transition of the ship | `spacewar:object.state = hyperspace_in/out` (RUNS Record) |
| Star catalog | Cosmetic data, no gameplay interaction | `spacewar:star_catalog` (RUNS data Record) |
| Game constants | How things behave, not what they are | `spacewar:game_constants` (RUNS Record) |
| Sense switches | Configuration, not identity | `spacewar:game_config` (RUNS inbound boundary Record) |
| Scores | Mutable match state | `spacewar:match_result` (RUNS outbound boundary Record) |

---

## Build-Time Compilation Seam

AEMS Manifestation data is compiled into RUNS Record initial values at build time. At runtime, no Nostr queries occur — the game reads Records.

```
BUILD TIME:
┌─────────────────────────────────┐
│  Nostr Relay (or local cache)    │
│                                  │
│  spacewar:needle  (kind 30051)───┐
│  spacewar:wedge   (kind 30051)───┤  Manifestation
│  spacewar:torpedo (kind 30051)───┤  Identity Data
│  spacewar:central-star (30051)───┘  (outlines only)
│                                  │
│  spacewar:game_constants (RUNS)──┐
│  spacewar:star_catalog   (RUNS)──┤  Game Logic
│  spacewar:ship_update    (RUNS)──┤  & Data Records
│  spacewar:gravity        (RUNS)──┘
│                                  │
└──────────────┬───────────────────┘
               │ build tool resolves both
               ▼
┌─────────────────────────────────┐
│  Compiled Binary                 │
│  (no Nostr dependency)           │
│                                  │
│  needle_outline = [111131, ...]  │  ← from AEMS Manifestation
│  wedge_outline  = [013113, ...]  │  ← from AEMS Manifestation
│  fuel_capacity  = -20000         │  ← from RUNS Record
│  thrust_scale   = sar_4s         │  ← from RUNS Record
│  star_data      = [...]          │  ← from RUNS Record
│                                  │
└─────────────────────────────────┘

RUNTIME:
  Game tick loop reads Records.
  Processors transform them.
  No Nostr. No AEMS queries.
  The outline data IS the Record field value.
```

At match start:
1. Ship 1's `spacewar:ship_config` is populated with needle outline data
2. Ship 2's `spacewar:ship_config` is populated with wedge outline data
3. From this point forward, everything is RUNS Records and Processors

---

## Summary

| AEMS Layer | Spacewar! Content | Count |
|------------|-------------------|-------|
| **Entities** (30050) | `spacecraft`, `projectile`, `gravity-source` | 3 |
| **Manifestations** (30051) | `spacewar:needle`, `spacewar:wedge`, `spacewar:torpedo`, `spacewar:central-star` | 4 |
| **Assets** (30052) | None — potentially for persistent play in a future variant | 0 |
| **State** (30053) | None — in-match state lives in RUNS Records | 0 |

The Entity layer is three items. The Manifestation layer is four items. This is the correct answer for a mechanics-first game with a thin entity layer.
