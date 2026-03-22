# Spacewar! × AEMS: Entity Abstraction & RUNS Record Integration

## The Question

When a RUNS Record holds data that originates as an AEMS Manifestation — like a ship outline — how does the AEMS layer integrate with the RUNS layer? What are Spacewar!'s Entities? What are Manifestations? And where exactly is the boundary between "what a thing IS" (AEMS) and "how a thing BEHAVES" (RUNS)?

---

## Part 1: Spacewar! Through the Entity-Abstraction Rubric

### The Thin-Entity-Layer Pattern

Entity-abstraction.md explicitly names this pattern: *"the more a game's identity lives in its mechanics rather than its objects, the thinner its AEMS layer and the richer its MAPS layer."* Spacewar! is the thinnest possible case. The game has almost no objects — its depth lives entirely in the physics (gravity, thrust, momentum) and the state machine (hyperspace risk/reward).

### Inventory of Things in Spacewar!

| Thing | Is it a thing or a mechanic? |
|-------|------------------------------|
| Spaceship | **Thing** — player controls it, it persists across frames |
| Torpedo | **Thing** — launched, has lifetime, collides |
| Central star | **Thing** — has position, exerts gravity, destroys ships |
| Explosion | **State transition** — a visual consequence of destruction, not a persistent object |
| Hyperspace state | **Mechanic** — a state transition of the ship, not a separate object |
| Star catalog | **Data** — cosmetic backdrop with no gameplay interaction |
| Ship outline | **Data** — visual art asset, the shape of the ship |

### Running the Four Tests

#### Spaceship

| Test | Result |
|------|--------|
| **Verb Test** | `pilot → rotate, thrust, fire, hyperspace` → **vehicle** verb cluster |
| **Cross-Game Test** | Spaceships appear in Asteroids, Galaga, Star Control, FTL, Elite, hundreds more | ✅ |
| **Substitution Test** | Swap Spacewar!'s wedge into Asteroids? Meaningful. | ✅ |
| **Mechanical Signature** | {rotational movement, thrust, limited fuel, weapon mount, collision hull} | Distinct cluster |

**Verdict: Entity `spacecraft`.** 3.5/4. The spaceship is a universal archetype. The needle and the wedge are Manifestations.

#### Torpedo

| Test | Result |
|------|--------|
| **Verb Test** | `fire → travels → impacts → destroys` → **projectile** verb cluster |
| **Cross-Game Test** | Projectiles in every shooter ever made | ✅ |
| **Substitution Test** | Swap a Spacewar! torpedo into Asteroids → meaningful (it IS the bullet) | ✅ |
| **Mechanical Signature** | {linear travel, lifetime-limited, collision kills, fired from vehicle} | ✅ |

**Verdict: Entity `projectile`.** 4/4. Not `torpedo` — that's too specific. The entity-abstraction IP boundary principle says Entity d-tags should be IP-agnostic. `projectile` is the universal role. Spacewar!'s specific torpedo (gravity-warped, lifetime-counted, single-shot) is a Manifestation.

#### Central Star

| Test | Result |
|------|--------|
| **Verb Test** | `none (environmental hazard)` — player doesn't interact with it directly, it exerts passive force |
| **Cross-Game Test** | Gravity sources appear in Angry Birds (Space), Star Control, Kerbal Space Program. Environmental hazards appear everywhere. | ✅ |
| **Substitution Test** | Swap Spacewar!'s star into a space dogfight game → meaningful | ✅ |
| **Mechanical Signature** | {fixed position, gravity field, destroy-on-contact, visual beacon} | Distinct cluster |

**Verdict: Entity `gravity-source`.** 3/4. The central star is a Manifestation of a broader archetype. The verb test is weakest because the player doesn't directly interact with it — but the entity-abstraction doc includes `obstacle` entities with the verb "none (blocked by / navigate around)," which is exactly this pattern.

#### Explosion

| Test | Result |
|------|--------|
| **Verb Test** | None — it's a consequence, not an interaction target |
| **Cross-Game Test** | Explosions are universal, but they're usually effects, not entities |
| **Substitution Test** | Meaningless — you can't "swap" an explosion between games in a meaningful way |
| **Mechanical Signature** | {radiating particles, countdown, spawned from collision/timeout} |

**Verdict: NOT an Entity.** 1/4. An explosion is a state transition — an object entering a "destroyed" state that the runtime renders as particles.

The board-game test clinches this. In a board game version of Spacewar!, you wouldn't have an "explosion token" on the table. You'd vocally declare "destroyed," apply the rules, and remove the killed piece from the board. The explosion is the logic of removal, not a thing. The visual representation (particle scatter, screen flash) is a runtime rendering concern.

In the original PDP-1 code, explosions occupy entity slots because the flat object table doesn't distinguish between "game objects" and "visual effects." This is an architectural limitation of the PDP-1, not a design truth. AEMS + RUNS gives us the vocabulary to express what the original code conflated: the explosion is RUNS state-change logic, not an AEMS entity.

---

## Part 2: The AEMS Layer for Spacewar!

### Entities (Kind 30050)

Three Entities emerge from the rubric:

```json
{ "kind": 30050, "tags": [["d", "spacecraft"], ["name", "Spacecraft"]],
  "content": {"description": "A player-controlled vehicle capable of thrust, rotation, and weapon fire in a space environment."} }

{ "kind": 30050, "tags": [["d", "projectile"], ["name", "Projectile"]],
  "content": {"description": "A launched object that travels through space and damages targets on impact."} }

{ "kind": 30050, "tags": [["d", "gravity-source"], ["name", "Gravity Source"]],
  "content": {"description": "A fixed or mobile object that exerts gravitational attraction on nearby entities."} }
```

These are IP-agnostic. Any space combat game can reference `spacecraft` and `projectile`. `gravity-source` is less universal but still domain-neutral — it serves Kerbal, Angry Birds Space, and any gravity-based puzzle game.

### Manifestations (Kind 30051)

Manifestations carry only what's needed for **recognition and identity** — what makes this particular interpretation of the archetype distinct from others. Game logic constants (fuel capacity, thrust scale, collision radius) are RUNS's domain, not AEMS's.

The analogy: a chess knight's Entity says "knight." Its Manifestation says "Staunton-style carved piece, 3.5 inches tall." The L-shaped movement rule lives in MAPS/RUNS. A chess variant where the knight moves differently doesn't need a new Entity or Manifestation — it needs different RUNS logic.

#### The Needle (Spaceship 1)

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

#### The Wedge (Spaceship 2)

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

The outline data is the only thing that distinguishes the needle from the wedge at the identity level. Everything else — fuel, torpedoes, thrust, collision radius — is game logic. Those constants define *how the game plays*, not *what the thing is*. They belong on RUNS Records.

#### The Torpedo

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

No gameplay properties on the Manifestation. Torpedo velocity, lifetime, reload time, and gravity warpage are all game logic — they define how the torpedo *behaves*, not what it *is*. A variant of Spacewar! with faster torpedoes doesn't need a new Manifestation; it needs different RUNS constants.

#### The Central Star

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

Capture radius and gravity strength are game logic constants — RUNS Records.

---

## Part 3: The AEMS/RUNS Boundary — Precisely

### The Principle

**AEMS answers: "What is this thing?"** — its identity, its archetype, its recognizability across games.

**RUNS answers: "How does this thing behave?"** — its physics, its game logic, its constants, its state transitions.

The chess knight test: the Entity says `chess-knight`. The Manifestation says `Staunton-style, 3.5 inches, carved wood`. RUNS says `moves in L-shape, captures by displacement`. A chess variant where the knight moves differently changes the RUNS logic. The Entity and Manifestation don't change — the thing is still a knight.

Applied to Spacewar!:

| Data | AEMS or RUNS? | Why |
|------|--------------|-----|
| "This is a spacecraft" | **AEMS Entity** | What it IS |
| "This is the Needle, shaped like a Redstone rocket" | **AEMS Manifestation** | How this game interprets the archetype |
| Ship outline data (`ot1`) | **AEMS Manifestation property** | Visual identity — the Needle looks like a Needle |
| Fuel capacity (20,000) | **RUNS Record** | Game logic constant — how fast you run out of fuel |
| Thrust scale (`sar 4s`) | **RUNS Record** | Game logic constant — how fast you accelerate |
| Collision radius (6,000) | **RUNS Record** | Game logic constant — how close is "too close" |
| Angular acceleration (10) | **RUNS Record** | Game logic constant — how fast you turn |
| Torpedo velocity (`sar 4s`) | **RUNS Record** | Game logic constant |
| Torpedo lifetime (96 frames) | **RUNS Record** | Game logic constant |
| Hyperspace shots (8) | **RUNS Record** | Game logic constant |
| Ship position per frame | **RUNS Record field** | Runtime state — changes every tick |
| Ship velocity per frame | **RUNS Record field** | Runtime state — changes every tick |
| Player score | **RUNS Record field** | Runtime state |
| Explosion visual | **RUNS state transition + runtime rendering** | Not a thing — a consequence |

### The Star Catalog — A RUNS Record on the Commons

Peter Samson's Expensive Planetarium — ~500 real stars catalogued from the American Ephemeris and Nautical Almanac, dated 3/13/62 — is not a game entity. No player interacts with it. No Processor reads star positions for game logic. It is pure cosmetic data.

But it has extraordinary historical and astronomical value:
- Hand-catalogued by a named author (Peter Samson)
- Each entry preserves the Bayer/Flamsteed designation (`87 Taur, Aldebaran`)
- First known instance of real astronomical data in a video game
- Sourced from a published astronomical reference

The star catalog belongs as a **RUNS static data Record**. Since all RUNS primitives (Records, Processors, Networks) are published as interlinked Nostr events, the star catalog gets attribution, discoverability, and provenance natively. No special convention needed — the RUNS event publication model handles this.

The starfield also **scrolls**: the background routine (`bck`, L629–649) advances a right-margin pointer (`fpr`) by 1 unit every 20 frames, scrolling the starfield left. The scroll is frame-synchronized with the game tick. No gameplay Processor reads star positions — the scrolling is purely visual. A `spacewar:starfield_state` outbound boundary Record carries the scroll offset from game logic to runtime.

```text
record spacewar:star_catalog
fields:
  stars: spacewar:star_entry[]

record spacewar:star_entry
fields:
  x:          int               # screen coordinate (from mark macro)
  y:          int               # screen coordinate
  brightness: int               # tier (1-4, determines CRT intensity)
  designation: string           # e.g. "87 Taur, Aldebaran"
```

Published as a Nostr event, this Record carries Samson's attribution in the event metadata. Anyone who discovers `spacewar:star_catalog` on a relay can read the data, trace its provenance, and use it — in a new Spacewar! variant, in an astronomy tool, in a history-of-computing exhibit. The RUNS event model gives this data everything AEMS would have given it, without forcing it into an entity hierarchy where it doesn't belong.

---

## Part 4: The Build-Time Compilation Seam

### How Manifestation Data Becomes Record Data

The AEMS schema states: *"A Manifestation is the layer that a RUNS build process compiles into type definitions."* The RUNS spec states: *"AEMS Manifestations become compiled lookup tables."*

For Spacewar!, the flow:

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
│  Self-contained game             │
│                                  │
│  needle_outline = [111131, ...]  │  ← from AEMS Manifestation
│  wedge_outline  = [013113, ...]  │  ← from AEMS Manifestation
│  fuel_capacity  = 20000          │  ← from RUNS Record
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

At runtime, when a match starts:
1. Ship 1's Record is populated with needle outline + shared game constants
2. Ship 2's Record is populated with wedge outline + shared game constants
3. From this point forward, everything is RUNS Records and Processors — nothing knows or cares about AEMS

### Where Game Constants Live

A `spacewar:game_constants` Record holds all the gameplay-defining values:

```text
record spacewar:game_constants
fields:
  max_fuel:           int     # 20000 (octal -20000 in original)
  max_torpedoes:      int     # 32 (octal 41 - 1)
  torpedo_velocity:   spacewar:fixed18  # sar 4s
  torpedo_lifetime:   int     # 96 (octal 140)
  torpedo_reload:     int     # 16 (octal 20)
  angular_accel:      int     # 10 (octal)
  thrust_scale:       spacewar:fixed18  # sar 4s
  collision_radius:   int     # 6000 (octal, ~3072 decimal)
  capture_radius:     int     # 1
  gravity_warpage:    spacewar:fixed18  # sar 9s
  hyperspace_shots:   int     # 8 (octal 10)
  hyperspace_delay:   int     # 32 (octal 40)
  hyperspace_breakout: int    # 64 (octal 100)
  hyperspace_recharge: int    # 128 (octal 200)
  hyperspace_uncertainty: int # 16384 (octal 40000)
```

This is a RUNS Record, published as a Nostr event. Anyone who wants to make a Spacewar! variant can fork this Record and change any constant. The Entity and Manifestation don't change — the thing is still a needle-shaped spacecraft firing torpedoes near a star. The variant is just a different game using the same things.

Separate from the gameplay constants, six PDP-1 sense switches create **game configuration flags** that alter rules at the session level:

```text
record spacewar:game_config
fields:
  angular_damping:    bool    # SW1: zero angular momentum per frame
  heavy_star:         bool    # SW2: double gravity
  rapid_fire:         bool    # SW3: skip reload timer
  disable_background: bool    # SW4: no Expensive Planetarium
  star_teleport:      bool    # SW5: star captures → teleport, not explode
  disable_gravity:    bool    # SW6: no gravity, no background
  game_count:         int     # number of rounds (from operator panel)
```

This is an inbound boundary Record — the runtime reads physical switch/toggle/menu state and writes these booleans before the game starts. The game logic reads them. `game_count` was previously on `match_state` but logically belongs here (it's set before play, not during).

---

## Part 5: Edge Cases

### Edge Case 1: What if someone wants to import the Needle into a different game?

Game B discovers `spacewar:needle` on a relay. It reads the `spacecraft` Entity reference and says "I know what a spacecraft is — I can render one." It reads the `outline_data` property and either:
- Renders the 2D outline directly (faithful to the original)
- Extrudes it into 3D
- Uses it as a silhouette reference and substitutes modern art

The outline data on the Manifestation is the **recognizability anchor** — it's what makes the Needle the Needle, not just any spacecraft. Without it, the Manifestation is indistinguishable from any other `spacecraft`. With it, a receiving game can recognize "this is the Spacewar! Needle" and do something meaningful with that knowledge.

But Game B doesn't need Spacewar!'s fuel capacity or torpedo lifetime. Game B has its own physics, its own constants. It gets those from its own RUNS Records. The AEMS Manifestation gives it the *identity*; RUNS gives it the *game logic*. Clean separation.

### Edge Case 2: What if someone makes a Spacewar! variant with different gravity?

They fork the `spacewar:gravity` Processor and the `spacewar:game_constants` Record. They publish new RUNS events. The AEMS layer doesn't change at all — same Entities, same Manifestations. The variant plays differently because the RUNS logic is different, not because the things are different.

This is the chess-knight analogy extended: a chess variant where knights move three squares instead of L-shaped doesn't need new chess pieces. It needs new rules.

### Edge Case 3: What about the ship outlines — are they game logic or identity?

The ship outlines are a boundary case worth examining carefully.

**The Ranganathan decomposition:**
- **Personality**: spacecraft (Entity)
- **Matter**: octal-encoded outline data (Manifestation property — it IS the ship's visual identity)
- **Energy**: the outline compiler that transforms data into display (runtime concern)
- **Space**: the ship's position on screen (RUNS Record field, updated per tick)
- **Time**: the ship's current state (mutable, per-frame RUNS state)

The outline data defines what the Needle *looks like*. It's not game logic — swapping outline data doesn't change how the ship flies, shoots, or hyperspace-jumps. Two ships with identical outlines but different RUNS constants would play differently. Two ships with different outlines but identical RUNS constants would play identically but look different.

Visual identity is Manifestation-level data. The outline data stays on the Manifestation.

### Edge Case 4: What if someone makes a third ship shape?

They publish a new Manifestation:

```json
{
  "kind": 30051,
  "tags": [
    ["d", "spacewar:arrow"],
    ["entity", "<spacecraft_id>", "spacecraft"],
    ["game", "spacewar"],
    ["property", "outline_data", "...", "spacewar:outline"]
  ],
  "content": {
    "name": "The Arrow",
    "description": "A community-created third ship for Spacewar! variants."
  }
}
```

No RUNS changes needed. The RUNS `spacewar:ship_update` Network reads from whatever outline data the Record contains. The new ship plays identically to the needle and wedge (same RUNS logic) but looks different. If the creator also wants different behavior (faster turning, more fuel), they fork the RUNS constants too.

This is the composability promise: AEMS handles identity, RUNS handles behavior. Both are independently extensible.

### Edge Case 5: "Ship hacks" — the earliest modding community

Historically, Spacewar! had a vibrant culture of "ship hacks" — players at MIT and other PDP-1 installations modified the outline data to create custom ship shapes. The outlines were intentionally hackable: octal-digit strings where each digit was a drawing instruction.

In the AEMS/RUNS model, every ship hack is a new Manifestation. The hacker publishes their outline data on Nostr; anyone can discover and use it. The RUNS logic is untouched. This maps perfectly to what actually happened — players changed how ships looked, not how they played.

The modding culture of 1962 was already operating under the AEMS/RUNS separation in practice. They just didn't have the vocabulary for it.

### Edge Case 6: Explosions that matter for gameplay

In Spacewar! 3.1, explosions are visually spectacular but mechanically simple — a countdown with random particle display. The explosion occupies an entity slot, but no other game logic reads the explosion's state. Nothing dodges explosions. Nothing is damaged by explosion proximity. The explosion is pure visual feedback for a destruction event.

If a Spacewar! variant wanted explosions to have gameplay impact (e.g., splash damage, screen push), the explosion would STILL not become an AEMS Entity. It would become a richer RUNS state transition — a Processor that writes splash damage Fields to nearby objects. The thing that exploded is still the Entity (spacecraft or torpedo). The explosion is what happens to it.

The board-game test holds: even with splash damage, a board game wouldn't add explosion tokens. You'd declare the destruction, measure radius, apply damage to nearby pieces, and remove the destroyed piece. The explosion is a rule, not a thing.

---

## Part 6: Summary — The Complete AEMS Layer

| AEMS Layer | Spacewar! Content | Count |
|------------|-------------------|-------|
| **Entities** (30050) | `spacecraft`, `projectile`, `gravity-source` | 3 |
| **Manifestations** (30051) | `spacewar:needle`, `spacewar:wedge`, `spacewar:torpedo`, `spacewar:central-star` | 4 |
| **Assets** (30052) | None — potentially created per-match if persistent play is added | 0 |
| **State** (30053) | None — in-match state lives in RUNS Records | 0 |

### What Lives Where

| Data | Layer | Published As |
|------|-------|-------------|
| "This is a spacecraft" | AEMS Entity | Kind 30050 Nostr event |
| "This is the Needle (outline data)" | AEMS Manifestation | Kind 30051 Nostr event |
| Fuel capacity, thrust, collision | RUNS Record (`spacewar:game_constants`) | RUNS Nostr event |
| Star catalog (~500 stars) | RUNS Record (`spacewar:star_catalog`) | RUNS Nostr event |
| Sin/cos routine | RUNS Processor (`spacewar:sin`) | RUNS Nostr event |
| Ship update logic | RUNS Network (`spacewar:ship_update`) | RUNS Nostr event |
| Per-frame position/velocity | RUNS Record fields (runtime-mutable) | Not published — ephemeral |
| Explosion visual | RUNS state transition + runtime rendering | Not a separate entity |

The Entity layer is exactly three items. The Manifestation layer is exactly four items. This is the correct answer for a mechanics-first game. Spacewar!'s depth lives in its MAPS/RUNS layers (gravity mechanics, hyperspace risk, momentum-based combat), not its AEMS layer.

Everything — AEMS events and RUNS events alike — lives on Nostr as interlinked, attributed, discoverable data. The teenager in 2125 who finds `spacewar:needle` on a relay can trace the full provenance chain: Entity → Manifestation → the RUNS Records and Processors that make it playable. No heroes required. The substrate endures because the protocols were designed for it.
