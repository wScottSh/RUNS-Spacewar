# Spacewar! × AEMS: Entity Abstraction & RUNS Record Integration

## The Question

When a RUNS Record holds data that originates as an AEMS Manifestation — like a ship outline or a star catalog — how does the AEMS layer integrate with the RUNS layer? What are Spacewar!'s Entities? What are Manifestations? And what does the seam between "AEMS data compiled at build time" and "RUNS Records processed at tick time" actually look like?

---

## Part 1: Spacewar! Through the Entity-Abstraction Rubric

### The Thin-Entity-Layer Pattern

Entity-abstraction.md explicitly names this pattern: *"the more a game's identity lives in its mechanics rather than its objects, the thinner its AEMS layer and the richer its MAPS layer."* Spacewar! is the thinnest possible case. The game has almost no objects — its depth lives entirely in the physics (gravity, thrust, momentum) and the state machine (hyperspace risk/reward).

Let me run every **thing** in Spacewar! through the four-test rubric honestly.

### Inventory of Things in Spacewar!

| Thing | Is it a thing or a mechanic? |
|-------|------------------------------|
| Spaceship | **Thing** — player controls it, it persists across frames |
| Torpedo | **Thing** — launched, has lifetime, collides |
| Central star | **Thing** — has position, exerts gravity, destroys ships |
| Explosion | Borderline — it's a visual effect with a countdown, but it occupies an entity slot and participates in collision. **Thing.** |
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

**Verdict: Entity `vehicle` (or more precisely `spacecraft`).** 3.5/4. The spaceship is a universal archetype. The needle and the wedge are Manifestations.

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
| **Cross-Game Test** | Gravity sources appear in Angry Birds (Space), Katamari Damacy (sort of), Star Control, Kerbal Space Program. Environmental hazards appear everywhere. | ✅ |
| **Substitution Test** | Swap Spacewar!'s star into a space dogfight game → meaningful | ✅ |
| **Mechanical Signature** | {fixed position, gravity field, destroy-on-contact, visual beacon} | Distinct cluster |

**Verdict: Entity `gravity-source` or `environmental-hazard`.** 3/4. The central star is a Manifestation of a broader archetype. The verb test is weakest because the player doesn't directly interact with it — but the entity-abstraction doc includes `obstacle` entities with the verb "none (blocked by / navigate around)," which is exactly this pattern.

I'd propose `gravity-source` as the Entity. It's specific enough to carry meaning, broad enough to be useful across space games.

#### Explosion

| Test | Result |
|------|--------|
| **Verb Test** | None — it's a consequence, not an interaction target |
| **Cross-Game Test** | Explosions are universal, but they're usually effects, not entities |
| **Substitution Test** | Meaningless — you can't "swap" an explosion between games in a meaningful way |
| **Mechanical Signature** | {radiating particles, countdown, spawned from collision/timeout} |

**Verdict: NOT an Entity.** 1/4. Explosions are visual effects with a lifecycle. In Spacewar!'s code, they occupy entity slots purely because the PDP-1's object table doesn't distinguish between "game objects" and "visual effects." In a RUNS port, an explosion is a **State transition** — an object entering a "destroyed" state that the runtime renders as particles.

This is an important architectural insight: the original code's flat entity table forced explosions into the same data structure as ships and torpedoes. AEMS + RUNS gives us the vocabulary to separate them. An explosion is not a thing you own or encounter — it's a condition.

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

> These are IP-agnostic. Any space combat game can reference `spacecraft` and `projectile`. `gravity-source` is less universal but still domain-neutral — it serves Kerbal, Angry Birds Space, and any gravity-based puzzle game.

### Manifestations (Kind 30051)

Here's where Spacewar!'s specific data lives:

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
    ["property", "angular_acceleration", "10", "integer"],
    ["property", "design_inspiration", "Buck Rogers spaceship", "string"]
  ],
  "content": {
    "game": "Spacewar! 3.1 (24 Sep 1962)",
    "name": "The Wedge",
    "description": "One of the two original Spacewar! spaceships, designed to evoke classic science fiction aesthetics."
  }
}
```

Both ships share identical gameplay constants (fuel, torpedoes, acceleration) — these live on RUNS Records (`spacewar:game_constants`), not on the Manifestations. The only Manifestation-level difference between the two ships is the `outline_data` — the visual identity.

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
    "description": "A fixed gravitational source at the center of the playing field that destroys ships on contact."
  }
}
```

Capture radius, position, and gravity strength are game logic constants — RUNS Records.

#### The Expensive Planetarium (Star Catalog)

This is the most interesting case. Peter Samson's star catalog is **not a game entity** — no player interacts with it, no Processor reads it for game logic. It's pure cosmetic data. But it has extraordinary historical and astronomical value.

The entity-abstraction rubric would say: this fails all four tests (no verb, no cross-game mechanical role, no meaningful substitution, no mechanical signature). It's not an Entity. It's not even a Manifestation of a game entity.

**But it IS data that should live on the commons.** The AEMS standard doesn't have a category for "dataset with cultural value" — and it shouldn't. The star catalog belongs as:

1. A **static data Record** in the RUNS source (`spacewar:star_catalog`) — compiled at build time
2. Optionally, published as a **standalone Nostr event** (not kind 30050–30053) for discoverability and attribution

```json
{
  "kind": 30023,
  "tags": [
    ["d", "spacewar:expensive-planetarium"],
    ["title", "The Expensive Planetarium — Star Catalog"],
    ["author", "Peter Samson"],
    ["date", "1962-03-13"],
    ["source", "American Ephemeris and Nautical Almanac"],
    ["game", "spacewar"]
  ],
  "content": "Astronomical star positions for the Spacewar! background display. ~500 stars catalogued by Bayer/Flamsteed designation..."
}
```

> Kind 30023 is NIP-23 (long-form content). This is a reasonable fit for authored reference data.

---

## Part 3: The Seam — How AEMS Manifestations Become RUNS Records

### The Build-Time Compilation Model

The AEMS schema is explicit: *"A Manifestation is the layer that a RUNS build process compiles into type definitions: it provides the concrete properties that Processors act on at runtime."*

The RUNS spec is equally explicit: *"AEMS Manifestations become compiled lookup tables."*

Here is exactly how this works for Spacewar!:

```
BUILD TIME:
┌──────────────────────────────┐
│  Nostr Relay (or local cache)│
│                              │
│  spacewar:needle  (kind 30051)──┐
│  spacewar:wedge   (kind 30051)──┤
│  spacewar:torpedo (kind 30051)──┤  Manifestation
│  spacewar:central-star (30051)──┘  Properties
│                              │
└──────────────┬───────────────┘
               │ build tool resolves
               ▼
┌──────────────────────────────┐
│  RUNS Source (plain-text)     │
│                              │
│  record spacewar:object       │
│    fields:                    │
│      outline_data: [from Manifestation]
│      max_fuel: [from Manifestation]
│      thrust_scale: [from Manifestation]
│      ...                      │
│                              │
│  Compiled lookup table:       │
│    needle_config = {          │
│      outline: [111131, ...]   │
│      fuel: 20000              │
│    }                          │
│    wedge_config = {           │
│      outline: [013113, ...]   │
│      fuel: 20000              │
│    }                          │
└──────────────┬───────────────┘
               │ runtime compiles
               ▼
┌──────────────────────────────┐
│  Compiled Binary              │
│  (no Nostr dependency)        │
│  Self-contained game          │
└──────────────────────────────┘

RUNTIME:
  Game tick loop reads Records.
  Processors transform them.
  No Nostr. No AEMS queries.
  The outline data IS the Record field value.
```

### What "Compiled Into" Means Concretely

A RUNS Record is a plain container with typed Fields. When the game initializes, it creates Records populated with data that *originated* from AEMS Manifestations but is now local:

```text
record spacewar:ship_config
fields:
  outline:       spacewar:outline_data    # from Manifestation property "outline_data"
  max_fuel:      int                      # from Manifestation property "max_fuel"
  max_torpedoes: int                      # from Manifestation property "max_torpedoes"
  thrust_scale:  spacewar:fixed18         # from Manifestation property "thrust_scale"
  angular_accel: int                      # from Manifestation property "angular_acceleration"
  hyperspace_shots: int                   # from Manifestation property "hyperspace_shots"
```

At build time, the build tool:
1. Queries the relay for `spacewar:needle` and `spacewar:wedge` (kind 30051)
2. Reads each `property` tag
3. Generates compiled constants / lookup tables from those properties
4. Bakes them into the binary

At runtime, when a match starts:
1. Ship 1's Record is populated with `needle_config` values
2. Ship 2's Record is populated with `wedge_config` values
3. From this point forward, the data is just Record Fields — Processors don't know or care that it came from AEMS

> **The boundary is clean.** AEMS provides the *definitions*. RUNS holds the *runtime data*. The connection is build-time resolution, not runtime coupling.

---

## Part 4: The Hard Reasoning

### Is the Outline Data a Property or an Asset?

The ship outlines (`ot1`, `ot2`) are encoded as octal-digit drawing instructions. Each octal digit (0–7) maps to a drawing directive (direction + pen-up/pen-down). The "outline compiler" at runtime converts these into PDP-1 machine code.

In AEMS terms, the outline data is:
- **Not an Asset** — nobody "owns" a particular ship shape
- **Not State** — it doesn't change during gameplay
- A **Manifestation property** — it is the game-specific interpretation of how the `spacecraft` Entity looks in Spacewar!

This is exactly the Ranganathan decomposition:
- **Personality**: spacecraft (Entity)
- **Matter**: octal-encoded outline data (Manifestation property)
- **Energy**: the outline compiler that transforms data into display (runtime concern)
- **Space**: the ship's position on screen (RUNS Record field, updated per tick)
- **Time**: the ship's current state (mutable, per-frame)

The Personality lives on the Entity. The Matter lives on the Manifestation. Everything else is RUNS Records and runtime.

### Why the Star Catalog Doesn't Fit AEMS (And That's Correct)

The Expensive Planetarium is cosmetic data. No game rule references it. No Processor reads star positions. The entity-abstraction rubric correctly identifies it as failing all four tests.

But the star catalog has immense *cultural* value:
- Peter Samson hand-catalogued ~500 stars from the American Ephemeris and Nautical Almanac
- Each entry preserves the Bayer/Flamsteed designation (`87 Taur, Aldebaran`)
- It is the first known instance of real astronomical data in a video game
- It is attributable to a specific creator (Samson) on a specific date (3/13/62)

AEMS is for **game entities** — things players own, encounter, or interact with. The star catalog is not a game entity. Forcing it into AEMS would violate the protocol's restraint principle.

The right home for this data is:
1. **In the RUNS source**: as a `spacewar:star_catalog` static data Record, compiled at build time
2. **On Nostr**: as a long-form content event (NIP-23) for discoverability and attribution — not as an AEMS event

This demonstrates protocol discipline. Not everything that matters fits in every layer. The star catalog matters. It just doesn't belong in the entity layer.

### Could Another Game Import Spacewar!'s Entities?

This is the acid test. If the AEMS layer is correct, a **different game** should be able to:

1. **Discover** entity `spacecraft` on relays
2. **Find** Manifestation `spacewar:needle` referencing it
3. **Build** a local version of the needle for their own game

Game B (say, a modern space dogfighter) would:
- Query relays for `spacecraft` Entities → find the universal archetype
- Discover `spacewar:needle` among many Manifestations → see its `outline_data`, `max_fuel`, etc.
- Create their **own** Manifestation (`gameb:fighter`) referencing the same `spacecraft` Entity
- Optionally import the `outline_data` property and render it with modern techniques (3D extrusion of the 2D outline? Vector glow?)

Or more ambitiously:
- A **player** in Game B could own an Asset (kind 30052) referencing `spacewar:needle`
- Game B, recognizing the `spacecraft` Entity reference, offers the player a local equivalent
- The player's needle-shaped ship persists even if Spacewar! is no longer actively played

This is the AEMS promise working at its most primitive level. Spacewar!'s ships are the simplest possible case — 7 octal words of outline data. But the mechanism is the same one that would let a Dark Souls Estus Flask become a Minecraft Splash Potion.

---

## Part 5: Summary — The AEMS Layer for Spacewar!

| AEMS Layer | Spacewar! Content | Count |
|------------|-------------------|-------|
| **Entities** (30050) | `spacecraft`, `projectile`, `gravity-source` | 3 |
| **Manifestations** (30051) | `spacewar:needle`, `spacewar:wedge`, `spacewar:torpedo`, `spacewar:central-star` | 4 |
| **Assets** (30052) | None at build time; potentially created per-match if persistent play is added | 0 |
| **State** (30053) | None at build time; in-match state lives in RUNS Records | 0 |
| **Not AEMS** | Star catalog, explosion visual, game constants, match scoring | — |

The Entity layer is exactly three items. The Manifestation layer is exactly four items. This is the **thinnest possible AEMS layer** — and that's the correct answer. Spacewar! is a mechanics-first game. Its AEMS layer is thin. Its MAPS layer (gravity mechanics, hyperspace risk, momentum-based combat) would be rich.

### RUNS Records vs. AEMS Manifestation Properties

| Data | Where It Lives | When It's Read |
|------|---------------|----------------|
| Ship outline (`ot1`, `ot2`) | AEMS Manifestation property → compiled into RUNS Record → used by runtime | Build time |
| Ship fuel/torpedoes/thrust | AEMS Manifestation property → compiled into RUNS game constants | Build time |
| Star catalog | RUNS static data Record (not AEMS) | Build time |
| Ship position/velocity per-frame | RUNS Record fields, updated by Processors every tick | Runtime |
| Player score | RUNS Record field (`spacewar:match_state`) | Runtime |
| Hyperspace uncertainty | RUNS Record field updated per hyperspace use | Runtime |

The seam is clean: **Manifestation properties are compiled INTO Record initial values at build time. From that point, RUNS owns the data.** There is no runtime AEMS dependency. The gameplay tick loop never touches Nostr.

---

## Open Questions

1. **Entity granularity for `spacecraft` vs. `vehicle`**: Is `spacecraft` too narrow? The vehicle verb cluster (pilot → rotate, thrust, fire) also covers aircraft, submarines, and tanks. Should the Entity be `vehicle` with `spacecraft` as a Manifestation-level characterization? The Cross-Game Test says: vehicles appear in many games, spacecraft in fewer. But `vehicle` might be too broad for discoverability. What's the right granularity?

2. **Game constants as Manifestation properties vs. a separate game-manifest**: Should torpedo lifetime, fuel capacity, and collision radius live on individual Manifestations? Or should there be a `spacewar:game-config` manifest (not an AEMS event, just a RUNS configuration Record) that holds shared constants? The current proposal puts them on Manifestations because that's where the data enters the system — but shared constants feel repetitive across two identical-stats ships.

3. **AEMS provenance for the star catalog**: The Expensive Planetarium is not an AEMS entity, but it has stronger provenance than most game data (named author, dated creation, cited source material). Should there be a convention for "attributed data that isn't an entity" — or is NIP-23 (long-form content) sufficient?

4. **Explosion as entity vs. state**: The analysis concludes explosions are states, not entities. But the original Spacewar! code treats them as full entity-table occupants. Does this distinction matter for a faithful port? Answer: the RUNS port should model explosions as objects with type `explosion` in the entity table — but NOT create an AEMS Entity for them. The RUNS-level object type doesn't require an AEMS Entity. Not every object type is an archetype.

5. **RUNS Record initialization from AEMS**: The spec says Manifestations become "compiled lookup tables." What does the build tool's dependency manifest look like? Does it declare `depends: [spacewar:needle@<relay_hint>]`? This is a tooling question, not a protocol question — but Spacewar! would be a good test case for defining the manifest format.
