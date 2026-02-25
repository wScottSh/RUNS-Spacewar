# Spacewar! → RUNS: Minimal Primitive Implementation Plan

## Overview

This document proposes a port of **Spacewar!** (PDP-1, 1962)—one of the earliest video games ever created—to the **RUNS** (Record Update Network System) architecture. The goal is to define the **smallest possible primitives** that faithfully capture the original game's mechanics while demonstrating RUNS's viability as a neutral substrate for enduring games.

### Why Spacewar!?

1. **Historical Significance**: The first widely distributed video game; documented source code survives (PDP-1 assembly)
2. **Perfect Scope**: Complex enough to test RUNS (physics, collision, input, multiple entities) but simple enough to prototype quickly
3. **Two-Player Symmetric**: Tests multiplayer state without networking complexity
4. **Rich Mechanics**: Gravity well, thrust, rotation, torpedoes, hyperspace—all from ~4K words of code

## User Review Required

> [!IMPORTANT]
> This is the **first RUNS prototype implementation ever**. We're defining foundational primitives from scratch—no existing library to lean on. Every design decision here sets precedent for the ecosystem.

### Key Design Decisions Requiring Input

1. **Fixed-Point vs Float Arithmetic**: The original used 18-bit fixed-point. Should RUNS primitives specify numeric representation, or leave this to runtime interpretation?

2. **Tick Rate**: Original ran at ~60 Hz (display refresh). Should we bake in a canonical tick rate for determinism, or make it a Network parameter?

3. **Namespace Compliance**: Per updated RUNS Protocol, `runs:` is **reserved exclusively** for Protocol/Standard Library. This implementation uses `spacewar:` as the umbrella prefix for all game-specific Fields/Processors, with a Nostr manifest anchoring provenance.

4. **Collision Resolution Philosophy**: Original used simple overlap detection. Should we define collision as a primitive Processor, or as composable sub-primitives (distance calc → threshold check → event emit)?

5. **Nostr Distribution Strategy**: Should we publish the complete Spacewar! bundle (Network + Processors + initial Records) as a single Nostr event, or as a dependency graph of smaller events?

---

## Original Spacewar! Mechanics Analysis

From the PDP-1 source (`spacewar.lst`), the core mechanics are:

### Entities (Objects in the Game)
| Entity | Count | Behavior |
|--------|-------|----------|
| **Spaceship** | 2 | Player-controlled, thrust/rotate, fires torpedoes, can hyperspace |
| **Torpedo** | Up to 32 per ship | Fired from ships, limited lifetime, affected by gravity |
| **Central Star** | 1 | Gravitational attractor, collision = death |
| **Stars (Background)** | ~400 | Decorative, based on real star catalog |

### Key Constants (from source)
```
tno = 41        ; Number of torpedoes + 1
tvl = sar 4s    ; Torpedo velocity (shift right 4)
rlt = 20        ; Torpedo reload time
tlf = 140       ; Torpedo lifetime
foo = -20000    ; Fuel supply
maa = 10        ; Angular acceleration
sac = sar 4s    ; Ship acceleration
str = 1         ; Star capture radius
me1 = 6000      ; Collision radius
mhs = 10        ; Hyperspace shots available
```

### Physics Model
- **Gravity**: Inverse-square toward central star
- **Thrust**: Impulse in facing direction, consumes fuel
- **Rotation**: Angular velocity accumulates with angular acceleration
- **Torpedoes**: Inherit ship velocity + muzzle velocity, curved by gravity
- **Wrap-around**: Screen edges wrap (toroidal topology)

---

## Proposed RUNS Architecture

### Layer 1: Core Fields (The Vocabulary)

These are the atomic data shapes every Processor reads/writes.

#### Universal Primitives (from `runs-standard-library`)

Per the updated Standard Library, we use **exact** `runs:` schemas where applicable. For 2D games, we adapt the 3D primitives or propose new 2D variants:

```yaml
# Proposed for Standard Library (2D variants)
runs:position_2d:
  type: struct
  fields:
    x: i32  # Fixed-point Q16.16
    y: i32

runs:velocity_2d:
  type: struct
  fields:
    dx: i32
    dy: i32

runs:angle:
  type: i32  # Fixed-point radians, Q16.16

runs:angular_velocity:
  type: i32  # Single-axis rotation for 2D

runs:delta_time:
  type: float  # Frame timestep (runtime-provided)
```

> **Note**: If 2D variants aren't yet in Standard Library, we propose them via PR. For this prototype, we proceed with these shapes.

#### Spacewar-Specific Fields (Umbrella Prefix)

Per RUNS Protocol namespace rules, all game-specific Fields use the `spacewar:` umbrella prefix:

```yaml
spacewar:entity_type:
  type: enum
  values: [ship, torpedo, star, debris]

spacewar:player_id:
  type: u8  # 0 or 1

spacewar:fuel:
  type: i32  # Remaining fuel units

spacewar:torpedo_count:
  type: u8  # Remaining torpedoes

spacewar:hyperspace_charges:
  type: u8  # Remaining hyperspace jumps

spacewar:lifetime:
  type: u16  # Ticks until despawn (for torpedoes/explosions)

spacewar:is_alive:
  type: bool

spacewar:control_state:
  type: bitfield
  bits:
    rotate_ccw: 1
    rotate_cw: 1
    thrust: 1
    fire: 1
    hyperspace: 1
```

#### Nostr Manifest for Spacewar! Bundle

Per RUNS Protocol conventions, the bundle is anchored by a Nostr event manifest:

```json
{
  "kind": 30078,
  "pubkey": "<author_npub>",
  "content": {
    "umbrella": "spacewar:",
    "version": "0.1.0",
    "note_id": "note1xyz...abc",
    "components": [
      "entity_type", "player_id", "fuel", "torpedo_count",
      "hyperspace_charges", "lifetime", "is_alive", "control_state"
    ],
    "dependencies": {
      "runs-standard-library": "0.1.0"
    },
    "description": "Spacewar! (1962) port to RUNS - first prototype implementation"
  }
}
```

---

## AEMS Integration: Entities as Universal Archetypes

Per the EGS architecture, **AEMS** (Asset-Entity-Manifestation-State) defines game objects as durable Nostr events that outlive individual games. Spacewar! demonstrates this by defining ships and torpedoes as universal entities.

### AEMS Layer Structure

```
AEMS (What exists) → RUNS (How it executes) → WOCS (How ecosystem coordinates)
```

**For Spacewar!:**
- **Entities (Kind 30050)**: Immutable archetypes ("wedge ship", "needle ship", "torpedo")
- **Manifestations (Kind 30051)**: Visual/audio interpretations per style ("classic-1962", "modern-hd", "ascii")
- **Asset (Kind 30052)**: Player's instance of a Manifestation (ownership)
- **State (Kind 30053)**: Mutable instance data (current position, fuel, alive status)

### Entity Definitions (Kind 30050)

Following AEMS conventions (see `aems-conventions/README.md`), we use the `std:` prefix for community-ratified universal entities:

**Wedge Ship Entity:**
```json
{
  "kind": 30050,
  "pubkey": "<author_npub>",
  "tags": [
    ["d", "std:spacewar-wedge-ship"],
    ["category", "spacecraft"],
    ["type", "player-controlled"],
    ["origin", "spacewar-1962"]
  ],
  "content": {
    "name": "Wedge Ship",
    "description": "Classic wedge-shaped spacecraft from Spacewar! (1962). Agile fighter with limited fuel and torpedo capacity.",
    "lore": "The iconic triangular ship design from the first computer game."
  }
}
```

**Torpedo Entity:**
```json
{
  "kind": 30050,
  "pubkey": "<author_npub>",
  "tags": [
    ["d", "std:spacewar-torpedo"],
    ["category", "projectile"],
    ["type", "weapon"],
    ["origin", "spacewar-1962"]
  ],
  "content": {
    "name": "Torpedo",
    "description": "Gravity-affected projectile fired from ships. Limited lifetime."
  }
}
```

### Manifestation Definitions (Kind 30051)

Following the pattern from `wScottSh/aems-french-52-deck`, we define multiple visual styles:

#### Classic 1962 Style (Vector Graphics)

```json
{
  "kind": 30051,
  "pubkey": "<author_npub>",
  "tags": [
    ["d", "classic-1962:wedge-ship"],
    ["entity", "<std:spacewar-wedge-ship_event_id>", "std:spacewar-wedge-ship"],
    ["category", "spacecraft"]
  ],
  "content": {
    "style": "Classic 1962 Vector",
    "outline": [
      {"x": 10, "y": 0},   // Nose
      {"x": -5, "y": 8},   // Left wing
      {"x": -5, "y": -8}   // Right wing
    ],
    "thrust_flame": [
      {"x": -5, "y": 0},
      {"x": -8, "y": 2},
      {"x": -8, "y": -2}
    ],
    "color": "white"
  }
}
```

#### ASCII Style (Text Fallback)

```json
{
  "kind": 30051,
  "pubkey": "<author_npub>",
  "tags": [
    ["d", "ascii:wedge-ship"],
    ["entity", "<std:spacewar-wedge-ship_event_id>", "std:spacewar-wedge-ship"],
    ["category", "spacecraft"]
  ],
  "content": {
    "style": "ASCII Text",
    "symbol": "▲",
    "thrust_symbol": "▲*",
    "color": "cyan"
  }
}
```

### AEMS → RUNS Mapping

**How AEMS integrates with RUNS:**

1. **Entities → Record Templates**: AEMS Entities define the "what" (ship, torpedo), RUNS Records instantiate them with Fields
2. **Manifestations → Rendering Hints**: Visual properties in Manifestations guide runtime rendering (outside RUNS logic)
3. **State → RUNS Records**: Mutable State events (kind 30078) serialize current RUNS Record state for persistence
4. **Processors → Game Logic**: RUNS Processors operate on Fields, agnostic to which Entity they came from

**Example: Creating a Ship Instance**

```yaml
# Step 1: Query Nostr for Entity
entity_event = fetch_nostr_event(kind=30001, d="std:spacewar-wedge-ship")

# Step 2: Create RUNS Record from Entity
record = Record(
  id: generate_id(),
  fields: [
    # From AEMS Entity metadata
    aems:entity_ref: entity_event.id,
    aems:entity_d: "std:spacewar-wedge-ship",
    
    # RUNS-specific Fields (not in AEMS)
    runs:position_2d: {x: 0, y: 0},
    runs:velocity_2d: {dx: 0, dy: 0},
    runs:angle: 0,
    spacewar:fuel: 20000,
    spacewar:is_alive: true
  ]
)

# Step 3: Publish State event for persistence
state_event = {
  kind: 30078,
  tags: [
    ["d", "instance-<uuid>"],
    ["entity", entity_event.id, "std:spacewar-wedge-ship"],
    ["manifestation", manifestation_event.id, "classic-1962:wedge-ship"]
  ],
  content: serialize(record.fields)
}
```

### Benefits of AEMS Integration

1. **Universal Vocabulary**: Other games can reference `std:spacewar-wedge-ship` for crossovers/mods
2. **Visual Flexibility**: Multiple Manifestations (classic, HD, ASCII) without changing game logic
3. **Provenance**: Cryptographic proof of which Entity definition a game object uses
4. **Persistence**: State events enable save/load across sessions and runtimes
5. **Interoperability**: A "wedge ship" means the same thing across all AEMS-compliant games

> **Note**: For this prototype, we focus on Entities and Manifestations. State events for save/load are Phase 3.

---

### Layer 2: Primitive Processors (The Pigments)

Each Processor is pure, stateless, and operates on explicit Field inputs/outputs.

#### Math Primitives

These target exact `runs:` Field schemas from the Standard Library:

```text
processor add_vec2
inputs:
  a: runs:position_2d
  b: runs:velocity_2d
outputs:
  result: runs:position_2d

result.x = a.x + b.x
result.y = a.y + b.y
```

> **Distribution**: Published as plain-text Nostr event (kind 30078) with `note_id` for provenance.

```text
processor scale_vec2
inputs:
  v: runs:velocity_2d
  scalar: i32
outputs:
  result: runs:velocity_2d

result.dx = (v.dx * scalar) >> 16
result.dy = (v.dy * scalar) >> 16
```

```text
processor sin_cos
inputs:
  angle: runs:angle
outputs:
  sin: i32
  cos: i32

; Lookup table or Taylor series approximation
; Returns Q16.16 fixed-point values
```

```text
processor distance_squared
inputs:
  a: runs:position_2d
  b: runs:position_2d
outputs:
  result: i32

dx = a.x - b.x
dy = a.y - b.y
result = dx * dx + dy * dy
```

---

#### Physics Primitives

```text
processor integrate_velocity
inputs:
  position: runs:position_2d
  velocity: runs:velocity_2d
  delta_time: runs:delta_time
outputs:
  position: runs:position_2d

position.x += (velocity.dx * delta_time) >> 16
position.y += (velocity.dy * delta_time) >> 16
```

> **Note**: Uses exact `runs:delta_time` from Standard Library.

```text
processor apply_gravity
inputs:
  position: runs:position_2d
  velocity: runs:velocity_2d
  attractor_pos: runs:position_2d
  gravity_strength: i32
outputs:
  velocity: runs:velocity_2d

; Calculate direction to attractor
dx = attractor_pos.x - position.x
dy = attractor_pos.y - position.y

; Distance squared (avoid sqrt for speed)
dist_sq = dx * dx + dy * dy
dist_sq = max(dist_sq, 1)  ; Prevent divide-by-zero

; Inverse-square gravity (simplified)
; accel = G / dist^2, applied in direction of attractor
accel_x = (gravity_strength * dx) / dist_sq
accel_y = (gravity_strength * dy) / dist_sq

velocity.dx += accel_x
velocity.dy += accel_y
```

```text
processor wrap_position
inputs:
  position: runs:position_2d
  bounds: struct { width: i32, height: i32 }
outputs:
  position: runs:position_2d

position.x = position.x mod bounds.width
position.y = position.y mod bounds.height
; Handle negative wrap correctly
if position.x < 0: position.x += bounds.width
if position.y < 0: position.y += bounds.height
```

---

#### Ship Control Primitives

```text
processor apply_rotation
inputs:
  angle: runs:angle
  angular_velocity: runs:angular_velocity
  control: spacewar:control_state
  angular_accel: i32
outputs:
  angle: runs:angle
  angular_velocity: runs:angular_velocity

if control.rotate_ccw:
  angular_velocity -= angular_accel
if control.rotate_cw:
  angular_velocity += angular_accel

angle += angular_velocity
```

```text
processor apply_thrust
inputs:
  velocity: runs:velocity_2d
  angle: runs:angle
  control: spacewar:control_state
  thrust_power: i32
  fuel: spacewar:fuel
outputs:
  velocity: runs:velocity_2d
  fuel: spacewar:fuel

if control.thrust and fuel > 0:
  sin, cos = sin_cos(angle)
  velocity.dx += (thrust_power * cos) >> 16
  velocity.dy += (thrust_power * sin) >> 16
  fuel -= 1
```

---

#### Collision Primitives

```text
processor check_collision
inputs:
  pos_a: runs:position_2d
  pos_b: runs:position_2d
  radius_sum_sq: i32  ; (radius_a + radius_b)^2
outputs:
  collided: bool

dist_sq = distance_squared(pos_a, pos_b)
collided = dist_sq < radius_sum_sq
```

```text
processor collision_response_destroy
inputs:
  collided: bool
  is_alive: spacewar:is_alive
outputs:
  is_alive: spacewar:is_alive

if collided:
  is_alive = false
```

---

#### Torpedo Primitives

```text
processor fire_torpedo
inputs:
  control: spacewar:control_state
  ship_pos: runs:position_2d
  ship_vel: runs:velocity_2d
  ship_angle: runs:angle
  torpedo_count: spacewar:torpedo_count
  torpedo_speed: i32
outputs:
  torpedo_count: spacewar:torpedo_count
  spawn_torpedo: bool
  torpedo_pos: runs:position_2d
  torpedo_vel: runs:velocity_2d

spawn_torpedo = false
if control.fire and torpedo_count > 0:
  torpedo_count -= 1
  spawn_torpedo = true
  torpedo_pos = ship_pos
  
  sin, cos = sin_cos(ship_angle)
  torpedo_vel.dx = ship_vel.dx + (torpedo_speed * cos) >> 16
  torpedo_vel.dy = ship_vel.dy + (torpedo_speed * sin) >> 16
```

```text
processor tick_lifetime
inputs:
  lifetime: spacewar:lifetime
outputs:
  lifetime: spacewar:lifetime
  expired: bool

if lifetime > 0:
  lifetime -= 1
expired = lifetime == 0
```

---

#### Hyperspace Primitive

```text
processor hyperspace_jump
inputs:
  control: spacewar:control_state
  hyperspace_charges: spacewar:hyperspace_charges
  position: runs:position_2d
  velocity: runs:velocity_2d
  bounds: struct { width: i32, height: i32 }
  random_seed: u32
outputs:
  hyperspace_charges: spacewar:hyperspace_charges
  position: runs:position_2d
  velocity: runs:velocity_2d
  jumping: bool

jumping = false
if control.hyperspace and hyperspace_charges > 0:
  hyperspace_charges -= 1
  jumping = true
  
  ; Random new position with uncertainty
  position.x = random(0, bounds.width)
  position.y = random(0, bounds.height)
  
  ; Random velocity impulse (danger of hyperspace)
  velocity.dx += random(-uncertainty, uncertainty)
  velocity.dy += random(-uncertainty, uncertainty)
```

> **Open Question**: Should `random()` be a standardized `runs:` primitive, or runtime-specific?

---

### Layer 3: Records (The Entities)

Each game object is a Record with a unique ID and attached Fields. Records are serialized as plain-text for Nostr distribution.

**AEMS Integration**: Records can optionally reference AEMS Entities via `aems:entity_ref` and `aems:entity_d` Fields, linking game state to universal archetypes.

```yaml
# Record Schema (Plain-Text Format)
Record:
  id: u64  # Unique identifier
  fields:
    - name: string  # Namespaced field name (e.g., "runs:position_2d", "spacewar:fuel")
      value: bytes  # Serialized field data
```

> **Distribution**: Initial game state published as Nostr event (kind 30078) referencing the `spacewar:` umbrella manifest.

#### Initial Game State (Records)

```yaml
records:
  # Central Star
  - id: 1
    fields:
      # AEMS reference (optional)
      aems:entity_ref: "<std:spacewar-star_event_id>"
      aems:entity_d: "std:spacewar-star"
      
      # RUNS Fields
      spacewar:entity_type: star
      runs:position_2d: { x: 0, y: 0 }  # Center of screen
      
  # Player 1 Ship (Wedge)
  - id: 2
    fields:
      # AEMS reference
      aems:entity_ref: "<std:spacewar-wedge-ship_event_id>"
      aems:entity_d: "std:spacewar-wedge-ship"
      aems:manifestation_ref: "<classic-1962:wedge-ship_event_id>"
      aems:manifestation_d: "classic-1962:wedge-ship"
      
      # RUNS Fields
      spacewar:entity_type: ship
      spacewar:player_id: 0
      runs:position_2d: { x: -200 << 16, y: 0 }
      runs:velocity_2d: { dx: 0, dy: 0 }
      runs:angle: 0
      runs:angular_velocity: 0
      spacewar:fuel: 20000
      spacewar:torpedo_count: 32
      spacewar:hyperspace_charges: 3
      spacewar:is_alive: true
      
  # Player 2 Ship (Needle)
  - id: 3
    fields:
      # AEMS reference
      aems:entity_ref: "<std:spacewar-needle-ship_event_id>"
      aems:entity_d: "std:spacewar-needle-ship"
      aems:manifestation_ref: "<classic-1962:needle-ship_event_id>"
      aems:manifestation_d: "classic-1962:needle-ship"
      
      # RUNS Fields
      spacewar:entity_type: ship
      spacewar:player_id: 1
      runs:position_2d: { x: 200 << 16, y: 0 }
      runs:velocity_2d: { dx: 0, dy: 0 }
      runs:angle: 3.14159 << 16  # Facing opposite direction
      runs:angular_velocity: 0
      spacewar:fuel: 20000
      spacewar:torpedo_count: 32
      spacewar:hyperspace_charges: 3
      spacewar:is_alive: true
```

> **Note**: All Field names use proper namespace prefixes:
> - `runs:` for Standard Library schemas
> - `spacewar:` for game-specific Fields
> - `aems:` for AEMS integration Fields (optional, links to universal Entities)

---

### Layer 4: Network (The Wiring)

The Network defines how Processors wire together each tick. Published as plain-text Nostr event.

```yaml
network: spacewar_main
umbrella: spacewar:
version: 0.1.0
tick_rate: 60  # Hz

# Input Phase
- phase: input
  processors:
    - read_player_input:
        for_each: [player_id == 0, player_id == 1]
        outputs: [spacewar:control_state]

# Physics Phase  
- phase: physics
  processors:
    # Ship rotation
    - apply_rotation:
        query: entity_type == ship and is_alive
        inputs: [angle, angular_velocity, control_state]
        outputs: [angle, angular_velocity]
        
    # Ship thrust
    - apply_thrust:
        query: entity_type == ship and is_alive
        inputs: [velocity, angle, control_state, fuel]
        outputs: [velocity, fuel]
        
    # Gravity (all physics objects)
    - apply_gravity:
        query: entity_type in [ship, torpedo]
        inputs: [position, velocity]
        params:
          attractor_pos: { x: 0, y: 0 }
          gravity_strength: 1000
        outputs: [velocity]
        
    # Integration
    - integrate_velocity:
        query: entity_type in [ship, torpedo]
        inputs: [position, velocity]
        outputs: [position]
        
    # Screen wrap
    - wrap_position:
        query: entity_type in [ship, torpedo]
        inputs: [position]
        params:
          bounds: { width: 1024 << 16, height: 768 << 16 }
        outputs: [position]

# Combat Phase
- phase: combat
  processors:
    # Fire torpedoes
    - fire_torpedo:
        query: entity_type == ship and is_alive
        inputs: [control_state, position, velocity, angle, torpedo_count]
        outputs: [torpedo_count]
        spawns: torpedo
        
    # Torpedo lifetime
    - tick_lifetime:
        query: entity_type == torpedo
        inputs: [lifetime]
        outputs: [lifetime]
        
    # Destroy expired torpedoes
    - despawn_expired:
        query: entity_type == torpedo and lifetime == 0
        action: destroy

# Collision Phase
- phase: collision
  processors:
    # Ship-Star collision
    - check_collision:
        cross_product:
          a_query: entity_type == ship
          b_query: entity_type == star
        params:
          radius_sum_sq: 10000
        on_collision:
          - collision_response_destroy: { target: a }
          
    # Ship-Ship collision
    - check_collision:
        cross_product:
          a_query: entity_type == ship and player_id == 0
          b_query: entity_type == ship and player_id == 1
        params:
          radius_sum_sq: 5000
        on_collision:
          - collision_response_destroy: { target: a }
          - collision_response_destroy: { target: b }
          
    # Torpedo-Ship collision
    - check_collision:
        cross_product:
          a_query: entity_type == torpedo
          b_query: entity_type == ship and is_alive
        filter: a.owner != b.player_id  # Don't hit own ship
        params:
          radius_sum_sq: 3000
        on_collision:
          - collision_response_destroy: { target: a }
          - collision_response_destroy: { target: b }
```

---

## Implementation Strategy

### Phase 1: Minimal Viable Prototype (MVP)
1. **Runtime**: Simple JavaScript/TypeScript interpreter in browser
2. **Scope**: Two ships, gravity, thrust, rotation, collision with star
3. **No torpedoes yet**—just physics and death
4. **Goal**: Prove the Record→Processor→Network pipeline works

### Phase 2: Full Mechanics
1. Add torpedoes (spawning Records dynamically)
2. Add hyperspace
3. Add ship-ship and torpedo-ship collisions
4. Add fuel/ammo depletion

### Phase 3: Polish & Distribution
1. Star field background (decorative, not RUNS logic)
2. Ship outlines (rendering is runtime's job, not Processors)
3. Package as Nostr-distributable plain-text Network
4. Test cross-runtime (different interpreters, same Network)

---

## Verification Plan

### Automated Tests
1. **Unit tests** for each Processor (pure functions, easy to test)
2. **Determinism test**: Run identical Networks on two runtimes, compare state after N ticks
3. **Regression test**: Record known-good game sessions, replay and verify

### Manual Verification
1. **Gameplay feel**: Does it feel like Spacewar!? (subjective but important)
2. **Edge cases**: What happens at screen edges, at star center, with 0 fuel?
3. **Performance**: Can we hit 60 Hz on a modest browser?

---

---

## Plain-Text Distribution & Provenance Chains

Per the updated RUNS Protocol, **all distributable artifacts are plain-text Nostr events** for permissionless replication and centuries-scale endurance.

### Distribution Architecture

```
spacewar: umbrella manifest (kind 30078, note_id: note1xyz...abc)
├── dependencies:
│   └── runs-standard-library@0.1.0 (note_id: note1def...456)
│       ├── runs:position_2d schema
│       ├── runs:velocity_2d schema
│       ├── runs:angle schema
│       └── ... (other standard primitives)
├── components:
│   ├── spacewar:entity_type schema
│   ├── spacewar:fuel schema
│   └── ... (other game-specific Fields)
├── processors:
│   ├── add_vec2 (note_id: note1abc...123)
│   ├── apply_gravity (note_id: note1def...456)
│   └── ... (all Processors as separate events)
├── network:
│   └── spacewar_main (note_id: note1ghi...789)
└── initial_state:
    └── records (note_id: note1jkl...012)
```

### Nostr Event Structure

Each component is a separate plain-text event:

**Processor Event Example:**
```json
{
  "kind": 30078,
  "pubkey": "npub1...",
  "created_at": 1737850000,
  "tags": [
    ["d", "spacewar:apply_gravity"],
    ["umbrella", "spacewar:"],
    ["version", "0.1.0"],
    ["depends", "runs-standard-library@0.1.0", "note1def...456"]
  ],
  "content": "processor apply_gravity\ninputs:\n  position: runs:position_2d\n  velocity: runs:velocity_2d\n  attractor_pos: runs:position_2d\n  gravity_strength: i32\noutputs:\n  velocity: runs:velocity_2d\n\n; [processor logic here]\n",
  "id": "note1abc...123",
  "sig": "..."
}
```

**Network Event Example:**
```json
{
  "kind": 30078,
  "pubkey": "npub1...",
  "tags": [
    ["d", "spacewar:main_network"],
    ["umbrella", "spacewar:"],
    ["version", "0.1.0"],
    ["processor", "spacewar:apply_gravity", "note1abc...123"],
    ["processor", "spacewar:fire_torpedo", "note1xyz...789"]
  ],
  "content": "[YAML network definition]",
  "id": "note1ghi...789",
  "sig": "..."
}
```

### Provenance Chain Benefits

1. **Cryptographic Authorship**: Every component signed by creator's Nostr key
2. **Dependency Tracking**: Note IDs create tamper-proof lineage from high-level bundles to atomic primitives
3. **Permissionless Forking**: Anyone can publish variations, provenance shows ancestry
4. **Relay Replication**: Events replicate across Nostr relays without central hosting
5. **Centuries-Scale Survival**: Plain-text + content-addressing = readable by hand if needed

### Tooling Implications

Runtimes must:
- Resolve `spacewar:` umbrella to manifest note_id
- Fetch dependency tree from Nostr relays
- Verify signatures and note_id integrity
- Cache locally for offline play
- Support dynamic resolution (dev) and static flattening (production builds)

---

## Open Questions

1. **Random Number Generation**: Original Spacewar! used a simple linear feedback shift register. Should we standardize an RNG primitive, or leave it to the runtime?

2. **Entity Spawning**: How do Processors spawn new Records mid-tick? Is there a spawn queue that the runtime processes?

3. **Death/Respawn**: When a ship dies, does it respawn automatically, or does the game end? (Original had both modes)

4. **Input Mapping**: How does the runtime translate physical input (keyboard/gamepad) to `spacewar:control_state`? Is this standardized or per-runtime?

---

## Summary

This plan proposes **~15 primitive Processors** and **~12 Field types** to implement Spacewar! on RUNS. The architecture explicitly separates:

- **Protocol** (Field shapes, Processor interfaces) — eternal
- **Implementation** (specific Processor logic) — swappable
- **Runtime** (scheduling, rendering, input) — diverse

The result should be a playable game where:
- The Network is plain-text and Nostr-distributable
- The state (Records) is serializable and resumable
- The logic (Processors) is auditable and replaceable
- No binary blobs, no compile step required

This is the minimum viable demonstration that RUNS works.
