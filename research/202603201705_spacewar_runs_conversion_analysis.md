# Spacewar! 3.1 → RUNS Conversion: Deep Analysis

## What This Document Is

A first-principles analysis of what it would take to express the canonical Spacewar! 3.1 (24 Sep 1962) as a RUNS-compliant game. Every challenge is real. Every solution is honest about what RUNS can handle cleanly, what requires design decisions, and what stress-tests the spec in useful ways.

This is the oldest surviving video game source code worth studying. If RUNS can express Spacewar!, it proves something about the protocol's range — from the first game to modern ones.

---

## Part 1: What Spacewar! Actually Is (Technically)

### The Hardware It Was Written For

The PDP-1 is an 18-bit ones-complement computer with 4K words of core memory, no stack, no index registers, and a Type 30 CRT display that can plot 20,000 points per second. There is no framebuffer — every visible pixel must be redrawn every frame by the program itself.

Key architectural facts that shaped the code:
- **18-bit word**: every value is 17 data bits + 1 sign bit, ones-complement
- **No index registers**: the machine uses self-modifying code *by necessity* — you modify the address field of instructions to iterate over arrays
- **No hardware multiply/divide** (in version 3.1): implemented in software via BBN subroutines using repeated shifts
- **Fixed-point arithmetic**: all positions, velocities, and trig values use fixed-point with the binary point at context-dependent locations (right of bit 0 for sin/cos output, right of bit 3 for sin/cos input, etc.)
- **No stack**: subroutine calls use `jda` (jump and deposit accumulator), which stores the return address in the first word of the subroutine itself — self-modifying code as calling convention

### The Game Systems (Decomposed)

I've identified **nine distinct game systems** in the 1870 lines of source:

| # | System | Lines | RUNS Equivalent |
|---|--------|-------|-----------------|
| 1 | **Macro/math library** | 1–396 | Primitive Processors (`sin`, `cos`, `multiply`, `divide`, `sqrt`, `random`) |
| 2 | **Outline compiler** | 398–507 | Ship rendering — a *runtime concern*, not game logic |
| 3 | **Star display (central star)** | 510–561 | Runtime concern (display) + gravity source (game logic) |
| 4 | **Expensive Planetarium** | 565–653 | Pure runtime concern (cosmetic starfield) |
| 5 | **Main game loop & entity table** | 659–941 | The core Network topology + Record definitions |
| 6 | **Collision detection** | 868–903 | A Processor |
| 7 | **Explosion/torpedo/hyperspace calcs** | 946–1077 | Processors with state-machine transitions |
| 8 | **Spaceship calc** | 1079–1333 | The deepest Processor bundle — input handling, physics, thrust, gravity, torpedo launch, hyperspace entry |
| 9 | **Data: outlines + star catalog** | 1336–1870 | Static data Records (ship shapes + ~500 catalogued stars) |
| 10 | **Sense switch configuration** | Throughout (`szs 10`–`szs 60`) | An inbound boundary Record (`spacewar:game_config`) — 6 booleans controlling gravity, background, torpedo reload, angular damping, star capture behavior |

### The Entity Table: Spacewar!'s Proto-ECS

This is the most architecturally significant structure for RUNS conversion. The code at lines 663–715 defines a **parallel-array entity table** — the exact same structure that modern ECS architectures would reinvent 50 years later.

The constant `nob=30` (octal 30 = decimal 24) declares 24 object slots. Each object has properties stored in **parallel arrays**, indexed by slot number:

| Property | Symbol | Description |
|----------|--------|-------------|
| Calc routine | `mtb` | Pointer to the object's update routine (`ss1`, `ss2`, `tcr`, `mex`, `hp1`, `hp3`, or 0 for inactive) |
| Position X | `nx1` | `mtb + nob` |
| Position Y | `ny1` | `nx1 + nob` |
| Lifetime counter | `na1` | Explosion duration or torpedo life |
| Instruction count | `nb1` | CPU cycles consumed (for frame-rate budgeting) |
| Velocity X | `ndx` | Change in X per frame |
| Velocity Y | `ndy` | Change in Y per frame |
| Angular velocity | `nom` | Only meaningful for ships (slots 0–1) |
| Angle | `nth` | Only meaningful for ships |
| Fuel | `nfu` | Only meaningful for ships |
| Torpedoes remaining | `ntr` | Only meaningful for ships |
| Outline program | `not` | Only meaningful for ships |
| Previous control word | `nco` | Only meaningful for ships |
| Hyperspace state 1–4 | `nh1`–`nh4` | Only meaningful for ships |

The first two slots (0 and 1) are always the two spaceships. Slots 2–23 are torpedoes and explosions. An object is **active** when its `mtb` entry is non-zero; the calc routine pointer doubles as the active flag.

> **This is already an ECS.** The "entity" is a slot index. The "components" are the parallel arrays. The "systems" are the calc routines dispatched per-entity. Spacewar! invented ECS in 1962.

---

## Part 2: The RUNS Conversion — System by System

### 2.1 Records (The Entity Definition)

The Spacewar! object table maps directly to RUNS Records. A `spacewar:object` Record type:

```text
record spacewar:object
fields:
  state:          spacewar:object_state  # enum: empty, ship, torpedo, exploding, hyperspace_in, hyperspace_out
  collidable:     bool                   # derived: true for ship and torpedo only
  position_x:     spacewar:fixed18       # 18-bit fixed-point
  position_y:     spacewar:fixed18
  velocity_x:     spacewar:fixed18
  velocity_y:     spacewar:fixed18
  angle:          spacewar:fixed18       # angular position (fixed-point radians)
  angular_vel:    spacewar:fixed18       # angular velocity
  lifetime:       int                    # countdown timer (torp life, explosion duration)
  fuel:           int                    # remaining fuel (ships only)
  torpedoes:      int                    # remaining torpedoes (ships only)
  control_word:   spacewar:controls      # current input state
  prev_control:   spacewar:controls      # previous frame's input state (for edge detection)
  hyperspace_1:   int                    # saved calc routine (for return from hyperspace)
  hyperspace_2:   int                    # hyperspace shots remaining
  hyperspace_3:   int                    # hyperspace cooldown timer
  hyperspace_4:   int                    # hyperspace uncertainty accumulator
```

The `state` enum replaces the original's self-modifying-code dispatch mechanism: each entity slot's calc routine address (`ss1`, `ss2`, `tcr`, `mex`, `hp1`, `hp3`, or `0`) maps to one enum value. The `collidable` boolean replaces the original's sign-bit overload (`400000` on the calc routine address = non-collidable). State transitions that wrote new calc routine addresses into `mtb[i]` become writes to the `state` field.

The two ship shapes (`ot1`, `ot2`) and scoring state (`\1sc`, `\2sc`) would be separate Records:

```text
record spacewar:ship_config
fields:
  outline:        spacewar:outline_data  # the ship shape (octal-encoded drawing instructions)
  player_id:      int                    # 0 or 1

record spacewar:match_state  
fields:
  state:            enum[playing, round_over, match_over, restart_countdown]
  score_1:          int
  score_2:          int
  rounds_remaining: int                  # \gct — games-to-play counter (from game_config)
  restart_timer:    int                  # \ntd — frames until next round begins (0 if not counting)
```

The game lifecycle is richer than a simple win/loss: scores persist across rounds, a timed countdown occurs between rounds, and tied scores force extra rounds. `rounds_remaining` comes from the operator panel (`lat` instruction, bits 6–11) at game start — it belongs in `spacewar:game_config` as initial configuration.

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

### 2.2 The Central Star and Gravity

Lines 1122–1166 compute gravitational acceleration. The physics:

1. Compute `r²` as `(x/2048)² + (y/2048)²` (using the software multiply subroutine)
2. Subtract the capture radius — if `r² < str`, the ship is inside the star → destruction
3. Compute `√r²` and scale the gravitational force as `1/r²` (via divide)
4. Apply as acceleration components `bx` and `by` (proportional to `-x/r³` and `-y/r³`)

This is a clean Processor:

```text
processor spacewar:gravity
inputs:
  position_x:  spacewar:fixed18
  position_y:  spacewar:fixed18
  capture_radius: int
outputs:
  accel_x:     spacewar:fixed18
  accel_y:     spacewar:fixed18
  captured:    bool
```

> **Challenge**: The original uses integer division and fixed-point approximations that produce *specific* gravitational curves. A RUNS port must reproduce these *exactly*, not substitute idealized Newtonian gravity. The behavior IS the game.

### 2.3 Collision Detection

Lines 868–903: a simple O(n²) pairwise check using Manhattan distance with an L1-norm threshold:

1. `|Δx| < me1` (6000) AND `|Δy| < me1` AND `|Δx| + |Δy| < me2 + me1` (9000)
2. On collision: replace both objects' calc routines with `mex` (explosion), set explosion duration

This maps to a Processor that takes the full entity list:

```text
processor spacewar:collision_detect
inputs:
  objects: spacewar:object[]
outputs:
  objects: spacewar:object[]   # with colliding pairs set to explosion state
```

> **Challenge**: The original modifies the entity table mid-iteration (self-modifying the calc routine pointer). RUNS's functional style handles this cleanly — the output is a new object list with collisions resolved.

### 2.4 Spaceship Physics (The Big One)

Lines 1079–1333 are the spaceship calc routine — the densest Processor in the game. It does:

1. **Read control word** (4 bits: rotate-CCW, rotate-CW, thrust, fire-torpedo)
2. **Update angular velocity** (`mom += maa * direction`)
3. **Wrap angle** to [0, 2π) in fixed-point
4. **Compute sin/cos** of heading → `\sn`, `\cs`
5. **Compute gravity** (lines 1122–1166)
6. **Apply thrust** (if thrusting AND fuel > 0): accelerate along heading
7. **Integrate velocity** into position (using `diff` macro — velocity damped by `sar 3s`)
8. **Compute ship outline vertices** from heading sin/cos
9. **Display ship** (runtime concern)
10. **Display exhaust flame** (if thrusting)
11. **Edge-detect fire button** (compare current vs. previous control word) → launch torpedo
12. **Torpedo launch**: find empty slot, initialize torpedo with ship's heading velocity + ship velocity
13. **Check hyperspace entry** (both buttons pressed simultaneously)

This naturally decomposes into a bundle of sub-Processors:

```text
network spacewar:ship_update
inputs:
  ship: spacewar:object
  controls: spacewar:controls
  constants: spacewar:game_constants
  objects: spacewar:object[]     # for finding empty torpedo slots
outputs:
  ship: spacewar:object
  spawn_requests: spacewar:spawn_request[]  # torpedoes to spawn
```

Sub-Processors:
- `spacewar:rotation_update` — angular velocity + angle wrap
- `spacewar:gravity` — gravitational acceleration
- `spacewar:thrust` — acceleration along heading, fuel consumption
- `spacewar:velocity_integrate` — position update with velocity damping
- `spacewar:torpedo_launch` — edge detection + spawn request
- `spacewar:hyperspace_check` — hyperspace entry conditions

### 2.5 Hyperspace

This is a **state machine** — exactly what RUNS handles via guarded Arcs in Networks. The three states:

| State | Calc routine | Behavior |
|-------|-------------|----------|
| `hp1` (invisible transit) | Randomize position, assign random velocity, set random angle. Wait for `hd1` frames. | No display, no collision |
| `hp3` (breakout) | Display ship, count down `hd2` frames. On exit: accumulate uncertainty (`\mh4 += hur`), random chance of exploding. | Visible, no collision |
| Normal (`ss1`/`ss2`) | Regular ship update | Full behavior |

In RUNS:

```yaml
network spacewar:hyperspace_behavior
arcs:
  - guard: ship.state == "hyperspace_in"
    processor: spacewar:hyperspace_transit
  - guard: ship.state == "hyperspace_out"
    processor: spacewar:hyperspace_breakout
  - guard: ship.state == "ship"
    processor: spacewar:ship_update
```

> **No protocol extension needed.** This is exactly the guarded dispatch pattern from the RUNS spec.

### 2.6 Torpedo and Explosion Calcs

**Torpedo** (`tcr`, lines 985–1005): extremely simple — apply gravity warpage to velocity, display, count down lifetime. When lifetime expires, convert to explosion.

**Explosion** (`mex`, lines 950–983): generate random particles radiating from the explosion center, display them, count down duration. When finished, deactivate the slot.

Both are clean Processors. The explosion uses the `random` macro extensively for particle scatter — the PRNG must be identical to preserve behavior.

### 2.7 The Random Number Generator

This is a 3-instruction masterpiece (lines 170–177):

```
lac ran         / load current random state
rar 1s          / rotate right 1 bit
xor (355670     / XOR with magic constant
add (355670     / add same magic constant
dac ran         / store new state
```

This PRNG is deterministic and must be preserved *exactly* — it determines hyperspace destinations, explosion particle patterns, and whether hyperspace kills you. Different PRNG = different game.

```text
processor spacewar:random
inputs:
  state: spacewar:fixed18
outputs:
  state: spacewar:fixed18
  value: spacewar:fixed18
```

### 2.8 The Expensive Planetarium (Peter Samson's Starfield)

Lines 1371–1870: ~500 real stars catalogued by astronomical designation (Aldebaran, Rigel, Betelgeuse, Sirius...) with screen coordinates. Organized into four brightness tiers (`1j`–`4j`), each rendered at different CRT intensity levels.

This is cosmetic data that **scrolls**. The background routine (`bck`, L629–649) advances a right-margin pointer (`fpr`) by 1 unit every 20 frames, scrolling the starfield left. The scroll is frame-synchronized (driven by the game tick counter, not the render loop). No gameplay Processor reads star positions — the scrolling is purely visual.

```text
record spacewar:star_catalog
fields:
  stars: spacewar:star_entry[]

record spacewar:starfield_state
fields:
  scroll_offset:  int    # current fpr value (wrapping)
  scroll_counter: int    # bkc countdown, fires scroll advance every 20 frames
```

The `spacewar:starfield_state` is an outbound boundary Record — game logic writes it, the runtime reads it to render the starfield at the correct scroll position.

> This data is historically magnificent. Samson hand-catalogued the entire visible sky from MIT's latitude. It should be preserved as a `spacewar:` data Record with full attribution.

### 2.9 Ship Outlines (JIT-Compiled Rendering)

Lines 1338–1356 encode ship shapes as octal-encoded drawing instructions. The "outline compiler" (lines 398–507) is a **JIT compiler** — it reads the outline data at game start and generates PDP-1 machine code in memory that draws the ship rotated to the current heading.

This is entirely a **runtime concern**. The outline data is the artistic asset; the transformation from outline data to rendered pixels is what a runtime provides. In RUNS terms, the outline data is a Field on the ship Record, and the runtime transforms it into display.

---

## Part 3: The Hard Challenges (Brutally Honest)

### Challenge 1: Fixed-Point Arithmetic Identity

Spacewar! is a fixed-point game on 18-bit ones-complement hardware. The game's *feel* — the way ships accelerate, the gravitational curve near the star, the torpedo drift, the hyperspace uncertainty — all emerge from the specific bit-level behavior of these arithmetic operations.

**The problem**: RUNS DIGS_EXPRESSION_LANGUAGE.md lists `fixed16_mul` as an example but doesn't define a fixed-point type system. Spacewar! needs:
- 18-bit ones-complement integers (not twos-complement!)
- Context-dependent binary point positions (not a single fixed format)
- Specific overflow/underflow behavior of the PDP-1 (ones-complement wrapping, negative zero)
- **Negative zero handling**: The PDP-1 has two representations of zero (+0 and -0, `777777₈`). `cma` (complement) of +0 produces -0. Sign tests (`sma`, `spa`) treat -0 as negative. Add, multiply, and divide normalize -0 → +0; subtract does NOT ((-0) - (+0) = -0). The `ddd` constant at L87 is explicitly -0, used as a sentinel value. The `spacewar:fixed18` type spec must document these behaviors.

**The solution**: Define `spacewar:fixed18` as a game-specific type. This is explicitly allowed by the spec: *"the type system is open — Processors define whatever input/output shapes their logic requires."* The Processor bodies operate on `spacewar:fixed18` using defined operations that replicate PDP-1 ones-complement arithmetic, including negative-zero semantics.

> **Verdict**: RUNS handles this cleanly. The type system's openness is load-bearing here.

### Challenge 2: Self-Modifying Code as Dispatch Mechanism

The original code uses self-modifying instructions for *everything*: array indexing, subroutine returns, and most critically, **entity dispatch**. Each entity's `mtb` slot contains a pointer to its calc routine (`ss1`, `ss2`, `tcr`, `mex`, `hp1`, `hp3`). The main loop loads this pointer and jumps to it.

This is a classic dispatch table — a state machine where the entity's "type" is encoded as a function pointer.

**The RUNS solution**: This is exactly what guarded Arcs and `state` enums handle. The self-modifying code is not an essential complexity — it's an accidental complexity forced by the PDP-1's lack of index registers. The *intent* is dispatch-by-type, and RUNS Networks express intent cleanly.

> **Verdict**: RUNS is better than the original here. The original's dispatch mechanism is an artifact of hardware limitations, not a design choice.

### Challenge 3: The Main Loop's Frame-Rate Budget

Lines 665 and 940: the main loop tracks a timing budget (`\mtc`) that counts down per frame. Each calc routine reports how many instructions it consumed, and the loop burns the remaining budget in a busy-wait. This produces a consistent frame rate despite variable object counts.

**The problem**: This is deeply entangled with PDP-1 instruction timing. A RUNS port can't (and shouldn't) replicate busy-waiting.

**The solution**: The frame-rate budget is a runtime concern. The RUNS Network processes all entities per tick; the runtime decides tick rate. This is explicitly within RUNS's architecture — the runtime manages scheduling.

> **Verdict**: Clean separation. The budget system is hardware-specific and doesn't affect game logic.

### Challenge 4: Display as Side Effect

The original code **interleaves display commands with game logic**. The spaceship calc routine computes position, then immediately issues `dpy` instructions to plot the ship. There is no separation between "compute state" and "render state."

**The problem**: RUNS requires Processors to be pure — no side effects. Display is the most obvious side effect in the original code.

**The solution**: Split every calc routine into "compute new state" and "produce render output." The ship's computed vertices (`\sx1`, `\sy1`, etc.) become output Fields on the Record. The runtime reads these Fields for rendering.

This is the most significant structural change from the original, but it's exactly what RUNS is designed for. The outline data + heading angle → vertex positions is a Processor. Plotting those vertices to screen is a runtime service.

> **Verdict**: This is the hardest refactor. Almost every routine has display calls baked in. But the separation is correct — the interleaving was never "correct design"; it was necessary because the PDP-1 had no framebuffer.

### Challenge 5: Toroidal Wrapping (Implicit in the Display)

The PDP-1's Type 30 CRT display silently wraps coordinates that overflow the 10-bit display range. Ships that move off one edge appear on the opposite side. This wrapping is **not in the game code** — it's a free hardware behavior.

**The problem**: A RUNS port must make wrapping explicit. Without it, objects vanish at screen edges instead of wrapping.

**The solution**: Add a `spacewar:wrap_position` Processor at the end of the movement chain:

```text
processor spacewar:wrap_position
inputs:
  position_x: spacewar:fixed18
  position_y: spacewar:fixed18
outputs:
  position_x: spacewar:fixed18
  position_y: spacewar:fixed18
```

This wraps coordinates modulo the display range. It's one additional Processor that the original got "for free" from hardware.

> **Verdict**: Easy fix, but easy to miss. A canonical RUNS port must document that this behavior was implicit in the original.

### Challenge 6: The PRNG Must Be Bit-Identical

The random number generator is used for:
- Hyperspace destination (position offset)
- Hyperspace re-entry velocity
- Hyperspace death probability
- Explosion particle directions
- Central star display (cosmetic jitter)

If the PRNG produces different sequences, hyperspace becomes a fundamentally different gamble. Two players who agree "we play Spacewar!" must get the same hyperspace behavior.

**The solution**: The PRNG Processor must implement the exact algorithm: rotate-right-1, XOR 355670₈, add 355670₈, all in 18-bit ones-complement. This is expressible in the RUNS expression language (it requires bitwise operations, which are in the required expressiveness table).

> **Verdict**: RUNS can handle this. The expression language's bitwise operation requirement exists precisely for cases like this.

### Challenge 7: What's Game Logic vs What's Runtime?

Drawing the line:

| Element | Game Logic (Processor) | Runtime |
|---------|----------------------|---------|
| Ship position/velocity update | ✓ | |
| Gravity computation | ✓ | |
| Collision detection | ✓ | |
| Torpedo launch/lifecycle | ✓ | |
| Hyperspace state machine | ✓ | |
| Explosion lifecycle | ✓ | |
| PRNG | ✓ | |
| Ship outline rendering | | ✓ |
| Exhaust flame rendering | | ✓ |
| Explosion particle display | | ✓ |
| Starfield display | | ✓ |
| Central star display | | ✓ |
| Frame-rate budgeting | | ✓ |
| Input reading (IOT/switches) | | ✓ |
| Toroidal display wrapping | Explicit Processor needed | |

The test from the spec: *"does the simulation outcome write to a Record/Field that any game logic Processor reads? If yes → game logic."* Gravity writes acceleration that movement reads → game logic. Explosion particles reach no other Processor → runtime.

> **One gray area**: the central star's *display* is runtime, but its *gravity* is game logic. In the original, these are tangled together. RUNS cleanly separates them — the star is a Record with a position, gravity reads that position, display reads that position independently.

---

## Part 4: The Network Topology

Here's how the complete game wires together as a RUNS Network:

```yaml
network spacewar:game_tick
runtime_interface:
  requires:                              # runtime provides BEFORE tick
    tick_input:      spacewar:tick_input
    p1_controls:     spacewar:player_controls
    p2_controls:     spacewar:player_controls
    display_config:  spacewar:display_config
    game_config:     spacewar:game_config

  produces:                              # game logic provides AFTER tick
    render_list:     spacewar:render_object[]
    match_result:    spacewar:match_result
    starfield_state: spacewar:starfield_state
```

```
[Runtime: Input] → spacewar:read_controls
                         ↓
              spacewar:game_tick (top-level Network)
              ├── for each object:
              │   ├── guard: state == ship → spacewar:ship_update bundle
              │   │   ├── spacewar:rotation_update
              │   │   ├── spacewar:gravity (if !game_config.disable_gravity)
              │   │   ├── spacewar:thrust
              │   │   ├── spacewar:velocity_integrate
              │   │   ├── spacewar:wrap_position
              │   │   ├── spacewar:torpedo_launch → spawn_requests
              │   │   └── spacewar:hyperspace_check
              │   ├── guard: state == torpedo → spacewar:torpedo_update
              │   │   ├── spacewar:gravity_warp (torpedo version)
              │   │   └── spacewar:lifetime_tick
              │   ├── guard: state == exploding → spacewar:explosion_tick
              │   ├── guard: state == hyperspace_in → spacewar:hyperspace_transit
              │   └── guard: state == hyperspace_out → spacewar:hyperspace_breakout
              ├── spacewar:process_spawns (insert spawned torpedoes)
              ├── spacewar:collision_detect (pairwise on all active, collidable objects)
              ├── spacewar:check_restart (both ships dead + both out of torps)
              ├── spacewar:update_scores
              ├── spacewar:advance_starfield_scroll
              └── spacewar:build_render_list
                         ↓
              [Runtime: Render from render_list + starfield_state]
```

Four Records in. Three Records out. Seven boundary Records total.

Every box is a named, inspectable Processor. The guarded dispatch is explicit Network wiring. The topology IS the game architecture — readable, composable, forkable.

---

## Part 5: What This Conversion Proves About RUNS

### What RUNS Handles Cleanly

1. **Entity tables / ECS** — Records with typed Fields are a natural fit for Spacewar!'s parallel-array entity table. The mapping is 1:1.
2. **State-machine dispatch** — Hyperspace states, entity type dispatch, and the restart logic are all clean guarded-Arc patterns.
3. **Custom types** — `spacewar:fixed18` demonstrates the type system's openness under real pressure.
4. **Game/runtime separation** — The forced separation of display from logic is not just formally correct but actively improves the code's clarity vs. the interleaved original.
5. **Composable variation** — Want to add a third ship? Add a third `spacewar:ship_config` Record and a third entry in the entity table. Want different gravity? Swap the `spacewar:gravity` Processor. Want different ship shapes? Swap the outline data. This is the composability RUNS promises, and Spacewar! demonstrates it concretely.

### What Stress-Tests the Spec

1. **Fixed-point arithmetic** — The expression language needs clean support for custom fixed-point types with explicit bit widths and binary point positions. `spacewar:fixed18` is the test case.
2. **Deterministic PRNG** — Bit-level operations (rotate, XOR, add) on ones-complement integers. The expression language must handle this exactly.
3. **Implicit hardware behavior made explicit** — Toroidal wrapping, ones-complement negative zero, display-coordinate overflow. Every hardware "freebie" becomes a Processor or type constraint.
4. **The expression language itself** — Writing the sin/cos approximation (Chebyshev polynomial, lines 200–254) in `.runs-prim` notation would be the most demanding test of the expression language's formal expressiveness. It involves nested multiplications, conditional sign correction, range reduction, and fixed-point scaling. If `.runs-prim` can express this subroutine, it can express anything Spacewar! needs.

### What It Proves Philosophically

Spacewar! is the oldest video game source code. It was written in 1962 for a machine that no longer exists, in an assembly language that no one programs in, on physical media (paper tape) that has degraded. The game survives because someone (Steve Russell) kept the tapes, someone (Al Kossow at bitsavers) scanned them, and someone (Norbert Landsteiner at masswerk.at) reconstructed the source and built an emulator.

That is the *durable substrate* problem. The game exists today because of heroic individual preservation efforts, not because its substrate was designed to endure.

A RUNS-compliant Spacewar! would exist as **plain-text Nostr events** — discoverable, forkable, compilable by any future runtime. The game logic (the part that makes Spacewar! *Spacewar!*) would be separate from the display (which changes with every platform). The entity table (24 objects, each a Record) would be inspectable by anyone. The gravity formula, the hyperspace uncertainty math, the PRNG — all readable, all replaceable, all attributable.

The teenager in 2125 who pulls `spacewar:gravity` from the commons and wires it into her own game doesn't need Steve Russell's paper tapes. She doesn't need bitsavers.org. She doesn't need a hero. The substrate endures because the protocol was designed for it.

---

## Part 6: Proposed Conversion Strategy

### Phase 1: Records & Types
Define `spacewar:fixed18`, `spacewar:object`, `spacewar:controls`, `spacewar:ship_config`, `spacewar:match_state`, `spacewar:star_entry`, `spacewar:star_catalog`, `spacewar:game_constants`.

### Phase 2: Math Primitives
Implement `spacewar:sin`, `spacewar:cos`, `spacewar:multiply`, `spacewar:divide`, `spacewar:sqrt`, `spacewar:random` as Processors. These must be **bit-identical** to the PDP-1 subroutines. Each is self-contained, ~20 lines of `.runs-prim` body.

### Phase 3: Game Logic Processors
Build from the bottom up:
1. `spacewar:rotation_update` — trivial
2. `spacewar:gravity` — the first real test
3. `spacewar:thrust` — needs fuel decrement
4. `spacewar:velocity_integrate` — uses the `diff` macro's damping behavior
5. `spacewar:wrap_position` — making implicit hardware behavior explicit
6. `spacewar:torpedo_update` — gravity warp + lifetime
7. `spacewar:explosion_tick` — countdown + deactivate
8. `spacewar:hyperspace_transit` — randomize position/velocity
9. `spacewar:hyperspace_breakout` — uncertainty accumulation + death check
10. `spacewar:torpedo_launch` — edge detection + spawn
11. `spacewar:collision_detect` — pairwise L1-norm check
12. `spacewar:ship_update` — the bundle Network wiring 1–6 and 10

### Phase 4: Top-Level Network
Wire `spacewar:game_tick` with guarded entity dispatch and restart logic.

### Phase 5: Static Data
Encode `ot1`, `ot2` (ship outlines) and the full star catalog as `spacewar:` data Records.

### Phase 6: Verification
The gold standard: a RUNS runtime running the Spacewar! network should produce **frame-identical output** to Norbert Landsteiner's PDP-1 emulator at masswerk.at, given identical input sequences. If the PRNG state, entity positions, and collision outcomes match tick-for-tick, the conversion is correct.

---

## Open Questions for Discussion

1. **How deep should bit-fidelity go?** The ones-complement negative-zero edge cases may affect initialization and sentinel detection (the `ddd` constant at L87 is explicitly -0, and `spq` treats -0 differently from +0). Document them fully in the `spacewar:fixed18` type specification. Whether to implement in ones-complement or emulate the relevant behaviors atop twos-complement is an implementation decision — the spec must capture the semantics either way.

2. **Should the sin/cos routine be a `spacewar:` Processor or a candidate for the RUNS standard library?** The Adams Associates sine-cosine subroutine is a general-purpose trig approximation. It could be useful outside Spacewar!. But the specific binary point conventions are Spacewar!-specific.

3. **The star catalog**: Peter Samson catalogued the visible northern sky by hand. This data has astronomical AND historical value. Should the `spacewar:star_catalog` Record include the original Bayer/Flamsteed designations as metadata (e.g., `87 Taur, Aldebaran`)? This would make the data useful beyond Spacewar! — a small act of cumulative craft.

4. **Expression language maturity**: The sin/cos Chebyshev polynomial and the PRNG bit-manipulation are the hardest tests of `.runs-prim` expressiveness. Should Spacewar! be a formal test case for the expression language design? ("If it can express Spacewar!, it can express anything in this complexity class.")

5. **Outline data as art asset vs. game logic**: The ship shapes are encoded as octal-digit drawing instructions (each digit = a direction + draw/move command). Is this a Record field that the runtime interprets? Or should the RUNS port include a `spacewar:outline_to_vertices` Processor that converts the compact encoding to vertex lists, making the rendering fully explicit?
