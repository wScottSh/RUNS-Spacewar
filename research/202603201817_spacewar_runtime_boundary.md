# Spacewar! Runtime Interface: The Boundary Records

## The Problem This Solves

The same RUNS source — the same Network, the same Processors, the same Records — must compile to both a **web browser** (Canvas/WebGL, keyboard/gamepad, requestAnimationFrame) and an **N64 ROM** (MIPS R4300i, RSP/RDP, libdragon, N64 controller). Later, possibly other targets. The game logic must be identical across all runtimes. The rendering, input, and timing must be completely different.

The question is: **what exact Records sit at the boundary?** These are the "edge Records" — the ones that both the game logic Network and the platform-specific runtime need to read or write. Every other Record is internal to the game logic and invisible to the runtime.

Getting this boundary wrong means either:
- The game logic leaks platform details (breaking portability)
- The runtime doesn't get enough information to render/play properly (breaking fidelity)

---

## Part 1: The Principle

The RUNS spec defines the Runtime Interface:

> *"A Network declares the Fields it requires from the runtime (input: timing, player commands) and the Fields it produces for the runtime (output: spatial state, visual state, audio triggers). Swapping one runtime for another leaves the game Network — and everything inside it — unchanged."*

And the critical test:

> *"Any simulation whose output feeds back into game state that other Processors read is game logic — it lives inside the Network as a Processor, not outside it as a runtime service."*

This gives us a clean decision procedure for every piece of data:

1. **Does the data originate from the platform?** (Hardware clock, controller state, display dimensions) → **Inbound boundary Record** — runtime writes, game logic reads.
2. **Does the data exist solely for platform presentation?** (Rendered vertices, audio triggers, screen coordinates) → **Outbound boundary Record** — game logic writes, runtime reads.
3. **Does the data feed back into game logic?** (Ship position after gravity, fuel after thrust, collision result) → **Internal Record** — game logic reads AND writes. The runtime never touches it.

---

## Part 2: Three Platforms, One Game

### What Each Platform Provides

| Capability | PDP-1 (1962) | Web Browser (2026) | N64 (1996) |
|-----------|-------------|-------------------|-----------|
| **CPU** | 18-bit, 100K ops/sec | 64-bit, ~GHz | 64-bit MIPS, 93.75MHz |
| **Display** | Type 30 CRT, 1024×1024 vector, 20K points/sec, no framebuffer | Canvas/WebGL, arbitrary resolution, framebuffer | RDP, 320×240 framebuffer, 16/32-bit color |
| **Input** | 4-bit control word per player (rotate-CW, rotate-CCW, thrust, fire) via IOT 11 (control boxes) or `lat` (test-word switches) | Keyboard events + Gamepad API (analog sticks, 16+ buttons) | N64 controller (analog stick ±85, 10 digital buttons, D-pad) |
| **Timing** | Fixed instruction budget per frame (~15K instructions ≈ ~66ms) | requestAnimationFrame (~16.67ms at 60fps) + fixed timestep accumulator | V-blank interrupt (~16.67ms NTSC, ~20ms PAL) |
| **Audio** | None (PDP-1 has no audio hardware) | Web Audio API | RSP audio synthesis, 16-bit PCM |

### What Spacewar!'s Game Logic Needs FROM a Runtime

The game logic needs exactly three things from the outside world:

1. **How much time has passed** — to advance the simulation by one tick
2. **What the players are doing** — the current state of each player's controls
3. **What the display dimensions are** — to know the wrapping boundaries

That's it. Everything else is internal.

### What Spacewar!'s Game Logic Gives TO a Runtime

The game logic produces exactly two things for the outside world:

1. **A list of things to draw** — position, shape, and visual type of every active object
2. **Match result** — when the game ends, who won

The original PDP-1 had no audio hardware. This base conversion is a faithful port — it produces the visual and logical output that the original produced, nothing more. Audio is a natural first extension: a future variant could fork the Network, add a `spacewar:audio_triggers` outbound Record that emits events for torpedo fire, explosions, thrust, and hyperspace transitions, and any runtime with audio hardware would consume them. That's the composability promise — the base game ships clean; variants extend it.

---

## Part 3: The Boundary Records — Exhaustive Definition

### Inbound Record 1: `spacewar:tick_input`

This is what the runtime writes before each game tick.

```text
record spacewar:tick_input
fields:
  delta_time: spacewar:fixed18    # time elapsed since last tick, in game time units
```

**Why `delta_time` and not a frame counter?**

The original PDP-1 code uses a fixed instruction budget (`\mtc`) — every frame takes exactly the same number of CPU cycles. This means the original has an implicit fixed timestep. A RUNS port should make this explicit: the runtime provides `delta_time`, and the game logic advances by that amount.

For faithful reproduction, the runtime should provide a fixed `delta_time` equal to the original PDP-1 frame duration (~66ms, or ~15 frames/sec). Both the web and N64 runtimes would accumulate real time and call the game tick with this fixed timestep, potentially multiple times per render frame. The game logic doesn't know or care about the rendering frame rate.

**Platform-specific behavior:**

| Platform | How it provides `delta_time` |
|----------|------------------------------|
| PDP-1 | Implicit — one tick per main loop iteration |
| Web | Fixed timestep accumulator: accumulate `requestAnimationFrame` delta, fire tick at fixed intervals |
| N64 | V-blank interrupt: count V-blanks, fire tick at fixed intervals |

### Inbound Record 2: `spacewar:player_controls`

This is the abstracted input for one player. Two instances exist (player 1, player 2).

```text
record spacewar:player_controls
fields:
  rotate_ccw:  bool    # turning left
  rotate_cw:   bool    # turning right
  thrust:      bool    # engine firing
  fire:        bool    # torpedo launch
  hyperspace:  bool    # hyperspace entry (both rotate buttons in original)
```

**Why booleans, not the raw control word?**

The original PDP-1 code reads a 4-bit control word per player via `iot 11` (bits: rotate-CCW, rotate-CW, thrust, fire). Hyperspace is detected as both rotate buttons pressed simultaneously. This bit-packing is a hardware artifact, not a design decision.

On the web, these booleans come from keyboard events (`KeyA`, `KeyD`, `KeyW`, `KeySpace`) or Gamepad API button states. On the N64, they come from the controller's digital buttons or D-pad. The game logic doesn't know whether the player pressed a key, tilted a stick, or flipped a toggle switch.

**The hyperspace edge case:**

In the original, hyperspace is triggered by pressing both rotate buttons simultaneously — a "chord" input. The game logic detects this by reading the control word and checking for the specific bit pattern. In the RUNS port, we have a choice:

- **Option A**: Keep `hyperspace` as an explicit boolean. The runtime maps "both rotate buttons" (or a dedicated button) to this boolean. The game logic just reads `hyperspace == true`.
- **Option B**: Remove `hyperspace` and let the game logic detect the chord from `rotate_ccw && rotate_cw`. 

**Option A is correct.** The runtime should handle input mapping. On a web keyboard, hyperspace might be a dedicated key. On the N64, it might be the Z-trigger. The game logic shouldn't care HOW the player requests hyperspace — only WHETHER they did. The runtime translates platform-specific input into intent.

This is the "verb layer" pattern from input abstraction research: game logic reads intents, not buttons.

**Platform-specific behavior:**

| Platform | How it provides `player_controls` |
|----------|-----------------------------------|
| PDP-1 | `iot 11` reads 4-bit control word; bit 0 = rotate-CCW, bit 1 = rotate-CW, bit 2 = thrust, bit 3 = fire; hyperspace = bits 0+1 both set |
| Web | Keyboard: WASD + Space (P1), arrows + Enter (P2). Gamepad API: D-pad/stick + buttons. Runtime maps to booleans. |
| N64 | D-pad left/right or analog stick threshold for rotate; A = thrust; B = fire; Z = hyperspace. Runtime maps to booleans. |

### Inbound Record 3: `spacewar:display_config`

This is the display dimensions — needed because Spacewar!'s toroidal wrapping must know the boundaries.

```text
record spacewar:display_config
fields:
  width:   int    # playfield width in game units
  height:  int    # playfield height in game units
```

**Why this is a boundary Record:**

On the PDP-1, toroidal wrapping was free — the Type 30 CRT's 10-bit display registers naturally overflow and wrap. The game code never checks boundaries; they wrap by hardware.

In a RUNS port, the `spacewar:wrap_position` Processor needs to know the wrapping boundaries. These come from the runtime because different displays have different aspect ratios and resolutions. The game logic wraps in **game units**; the runtime maps game units to screen pixels.

The original PDP-1 uses a 1024×1024 game-unit space (10-bit coordinates). For faithful reproduction, all runtimes should provide `width: 1024, height: 1024` and map that to whatever physical resolution they have. The game logic doesn't know about pixels.

**Platform-specific behavior:**

| Platform | Game units | Physical resolution |
|----------|-----------|-------------------|
| PDP-1 | 1024×1024 (implicit) | 1024×1024 CRT points |
| Web | 1024×1024 (from config) | Canvas width×height (scaled) |
| N64 | 1024×1024 (from config) | 320×240 framebuffer (scaled + centered) |

### Outbound Record: `spacewar:render_object`

This is what the game logic produces for each active object. The runtime reads these to draw the frame.

```text
record spacewar:render_object
fields:
  object_type:    spacewar:render_type   # enum: ship, torpedo, explosion, star, central_star, exhaust
  position_x:     spacewar:fixed18       # in game units (0–1023)
  position_y:     spacewar:fixed18       # in game units (0–1023)
  angle:          spacewar:fixed18       # heading (ships and exhaust only)
  outline_data:   spacewar:outline_data  # ship shape (ships only)
  brightness:     int                    # render intensity (stars: 1–4 tiers)
  particle_seed:  spacewar:fixed18       # PRNG state for explosion particle generation
  particle_count: int                    # number of explosion particles to render
  flame_length:   int                    # exhaust flame length (ships only, 0 if not thrusting)
```

**Why not just pass the internal entity state?**

The game logic's internal `spacewar:object` Record has fields that the runtime doesn't need (fuel, torpedoes remaining, hyperspace state, collision data). The render object is a **projection** — only the fields the runtime needs to draw. This keeps the boundary minimal and prevents the runtime from accidentally depending on game logic internals.

The projection is built by a dedicated Processor at the end of the game tick:

```text
processor spacewar:build_render_list
inputs:
  objects: spacewar:object[]       # full internal state
  ship_configs: spacewar:ship_config[]  # outline data
  star_catalog: spacewar:star_catalog
  central_star: spacewar:central_star_config
outputs:
  render_list: spacewar:render_object[]
```

This Processor is the **last game-logic Processor** in the Network. It reads internal state and produces the render list. The runtime reads the render list and draws. The render list is a one-way door — rendering decisions never flow back into game state.

**What each platform does with the render list:**

| Field | PDP-1 | Web | N64 |
|-------|-------|-----|-----|
| `position_x/y` | `dpy` instruction at (x, y) | Canvas `lineTo`/`arc` at scaled (x, y) | RDP triangle at scaled (x, y) |
| `outline_data` | JIT-compiled outline code draws rotated ship | JavaScript draws rotated polyline | RSP transforms vertex list |
| `brightness` | CRT intensity parameter | CSS/canvas alpha or stroke width | RDP color intensity |
| `particle_seed` + `particle_count` | Generate random particle positions and `dpy` each | Canvas draws random dots from seed | RDP plots random points from seed |
| `flame_length` | Draw exhaust trail behind ship | Canvas draws gradient trail | RDP draws colored trail |

**The explosion particle edge case:**

In the original, explosion particles are generated by the PRNG during the explosion calc routine and immediately displayed. The PRNG state after generating particles is the PRNG state for the next game logic operation. This means the PRNG's consumption by rendering IS game logic — it affects future gameplay (hyperspace destinations, etc.).

This is the spec's test in action: *"does the simulation output feed back into game state?"* The PRNG state feeds back. Therefore, the particle generation sequence is game logic. The render list provides the PRNG state and particle count so the runtime can reproduce the exact particle positions — but the PRNG stepping happens inside the game logic Network, not in the runtime.

### Future Variant: Audio Triggers

The original PDP-1 has no audio hardware. This base conversion faithfully reproduces what the original produced — visual output and game state. Audio is excluded from the base game's boundary.

However, a future variant could fork the Network and add a `spacewar:audio_triggers` outbound Record:

```text
record spacewar:audio_triggers
fields:
  events: spacewar:audio_event[]

record spacewar:audio_event
fields:
  event_type: spacewar:audio_type   # enum: torpedo_fire, explosion, thrust_loop, hyperspace_enter, hyperspace_exit
  player_id:  int                   # which player (for stereo panning)
  position_x: spacewar:fixed18     # for spatial audio
  position_y: spacewar:fixed18
```

The game logic already knows *when* gameplay events happen (torpedo launches, collisions, hyperspace transitions). A variant that emits these as audio triggers would let any audio-capable runtime play sound effects without diffing state. This is exactly the kind of evolution that RUNS variants enable — the base Network stays clean; the forked Network extends it.

### Outbound Record: `spacewar:match_result`

```text
record spacewar:match_result
fields:
  state:       spacewar:match_state  # enum: playing, player1_wins, player2_wins, draw, restart_pending
  score_1:     int
  score_2:     int
  games_left:  int
```

The runtime reads this to display scores and handle end-of-match UI (play again, quit, etc.). The game logic writes it when both ships are destroyed or score thresholds are reached.

---

## Part 4: The Complete Boundary Declaration

The top-level Network declares its Runtime Interface:

```yaml
network spacewar:game_tick
runtime_interface:
  requires:                              # runtime provides BEFORE tick
    tick_input:      spacewar:tick_input
    p1_controls:     spacewar:player_controls
    p2_controls:     spacewar:player_controls
    display_config:  spacewar:display_config

  produces:                              # game logic provides AFTER tick
    render_list:     spacewar:render_object[]
    match_result:    spacewar:match_result
```

**Everything inside `spacewar:game_tick` — every Processor, every internal Record, every internal Field — is invisible to the runtime.** The runtime cannot read ship fuel, torpedo count, hyperspace state, collision results, or any internal game logic data. It gets the render list and the match result. That's it.

This is the portability guarantee: if you can write a runtime that provides `tick_input`, `player_controls`, and `display_config`, and reads `render_list` and `match_result`, you can run Spacewar! on your platform. The game logic is a black box. The boundary Records are the contract.

---

## Part 5: What's Inside vs What's Outside

### Inside the Network (Invisible to Runtime)

| Record | Why Internal |
|--------|-------------|
| `spacewar:object[]` (full entity table) | Contains game logic state (fuel, torpedoes, hyperspace counters) that feeds back into Processors |
| `spacewar:game_constants` | Defines game behavior — swapping these changes the game, not the presentation |
| `spacewar:ship_config` | Identity data (outline) used to build render objects; not needed by runtime directly |
| `spacewar:star_catalog` | Static data used to build render objects for the starfield |
| PRNG state (`ran`) | Feeds back into game logic (hyperspace, explosion distribution) |
| Collision intermediate results | Only meaningful within the collision Processor |
| Sine/cosine lookup/computation | Pure math used by internal Processors |

### At the Boundary (Shared between Game Logic and Runtime)

| Record | Direction | What Crosses |
|--------|-----------|-------------|
| `spacewar:tick_input` | Runtime → Game | `delta_time` only |
| `spacewar:player_controls` (×2) | Runtime → Game | 5 booleans per player |
| `spacewar:display_config` | Runtime → Game | `width`, `height` |
| `spacewar:render_object[]` | Game → Runtime | Position, type, outline, brightness, particles |
| `spacewar:match_result` | Game → Runtime | State, scores, games remaining |

### Outside the Network (Runtime-Only)

| Concern | Why External |
|---------|-------------|
| Keyboard/gamepad/controller reading | Platform-specific hardware interaction |
| Screen rendering (Canvas vs RDP vs CRT) | Platform-specific display hardware |
| Audio synthesis | Platform-specific audio hardware |
| Frame pacing (vsync, rAF, instruction budget) | Platform-specific timing |
| Coordinate scaling (game units → pixels) | Platform-specific resolution |
| Score display UI | Platform-specific UI rendering |
| Pause menu, settings | Platform-specific UI |

---

## Part 6: The Hard Edge Cases

### Edge Case 1: The Exhaust Flame

In the original, the exhaust flame is drawn in the spaceship calc routine — interleaved with physics. The flame length depends on fuel remaining and PRNG state. But flame rendering doesn't feed back into game state.

**Resolution:** The game logic writes `flame_length` on the render object. The runtime draws the flame. If fuel is zero, `flame_length` is zero. The game logic computes the flame length (it knows the fuel state); the runtime draws the visual (it knows how to render a flame on its platform).

### Edge Case 2: Star Brightness Tiers

The Expensive Planetarium has four brightness tiers. On the PDP-1, tiers map to CRT intensity parameters. On a web browser, they might map to opacity or dot size. On the N64, they map to RDP color values.

**Resolution:** The render list includes `brightness: int` (1–4). The runtime chooses how to represent brightness. This is the right abstraction — the game logic says "how bright," the runtime says "what that looks like."

### Edge Case 3: Display Coordinate System

The PDP-1's CRT has origin at center, Y-up. A web Canvas has origin at top-left, Y-down. The N64's framebuffer has origin at top-left, Y-down.

**Resolution:** All game logic uses the PDP-1's coordinate system (origin center, Y-up, range ±512). The render list uses these game coordinates. The runtime transforms game coordinates to screen coordinates. This transformation is trivial (offset + scale + Y-flip) and belongs in the runtime, not the game logic.

### Edge Case 4: The "Expensive" Display Trick

On the PDP-1, brighter stars are rendered by plotting multiple points at the same location (redundant display commands increase phosphor brightness). This is a hardware-specific rendering technique.

**Resolution:** The render list says `brightness: 3`. The PDP-1 runtime plots 3 points. The web runtime draws a larger dot. The N64 runtime uses a brighter color. The original implementation was runtime logic encoded into the render logic — there were no other computers, so no separation was needed. This is an interpretation conversion so that the same data can drive different rendering techniques on different hardware. The hardware trick is encapsulated in the runtime.

### Edge Case 5: Randomized Explosion Particles

Explosion particles are generated by the PRNG. The game logic steps the PRNG N times (where N = particle count) during the explosion Processor. The render list needs to reproduce the exact positions of those particles.

**Resolution:** The render list provides `particle_seed` (PRNG state at the start of particle generation) and `particle_count`. The runtime runs the same PRNG algorithm N times to compute particle positions for display. This means the runtime must implement the Spacewar! PRNG — but only for rendering, not for game logic. The PRNG specification (rotate-right-1, XOR 355670₈, add 355670₈) is part of the `spacewar:` specification that all runtimes must implement.

Alternatively, the `spacewar:build_render_list` Processor could pre-compute all particle positions and include them as an array. This eliminates the PRNG implementation from runtimes at the cost of larger render lists. Both approaches are valid; the pre-computed approach is simpler for runtime authors.

### Edge Case 6: Frame-Rate Independence vs. Frame-Rate Fidelity

A web browser runs at ~60fps. The N64 runs at ~30fps (or 60fps with simple scenes). The PDP-1 runs at ~15fps. If the game logic ticks at a fixed timestep, the visual result should be identical regardless of render framerate.

**Resolution:** The runtime implements the fixed timestep pattern:
1. Accumulate real wall-clock time
2. When accumulated time ≥ fixed tick duration, call `spacewar:game_tick` with `delta_time = fixed_tick`
3. Render the current state from the render list
4. For smooth rendering, optionally interpolate between previous and current render lists (cosmetic only — the interpolated positions are never fed back to game logic)

The fixed tick should match the original PDP-1's frame duration for behavioral fidelity. Both the web and N64 runtimes call the game tick at the same frequency; they just render at different visual framerates between ticks.

---

## Part 7: The Portability Proof

If the boundary is correct, the following statements must all be true:

| Statement | Verified? |
|-----------|-----------|
| Changing the rendering technology (Canvas → WebGL → RDP) requires zero changes to the game Network | ✅ — Runtime reads `render_list`, draws however it wants |
| Changing the input device (keyboard → N64 controller → PDP-1 switches) requires zero changes to the game Network | ✅ — Runtime writes `player_controls` booleans, maps however it wants |
| The same input sequence produces the same game state on every platform | ✅ — Game logic is deterministic (fixed-point, fixed timestep, deterministic PRNG) |
| Adding audio requires only a Network fork (variant), not changes to the base game | ✅ — Fork the Network, add `audio_triggers` outbound Record, wire in event emitters |
| A headless runtime (no display, no input — for testing/replay) can run the game Network | ✅ — Provide fixed `player_controls`, ignore `render_list`, verify game state |
| The game Network can be unit-tested without any runtime at all | ✅ — Feed `tick_input` + `player_controls`, read `render_list` + `match_result` |

The headless runtime test is the most useful: you can record an input sequence on the web version, replay it on the N64 version, and verify that the `match_result` and `render_list` are identical frame-for-frame. If they are, the port is correct. If they aren't, something inside the Network is platform-dependent and must be fixed.

---

## Summary: Five Records, One Sharp Line

```
  ┌─────────────────────────────────────────────┐
  │              RUNTIME (platform-specific)      │
  │  ┌─────────────┐  ┌──────────────────────┐  │
  │  │ Input Reader │  │ Renderer             │  │
  │  │ (keyboard,   │  │ (Canvas, RDP, CRT)   │  │
  │  │  controller, │  │                      │  │
  │  │  switches)   │  │                      │  │
  │  └──────┬───────┘  └──────────▲───────────┘  │
  │         │                     │               │
  └─────────┼─────────────────────┼───────────────┘
            │                     │
    ────────▼─────────────────────┼──────────── BOUNDARY
            │                     │
  ┌─────────┼─────────────────────┼───────────────┐
  │         │  GAME LOGIC (RUNS Network)          │
  │         ▼                     │               │
  │  tick_input ──────►┌──────────┴───┐           │
  │  player_controls──►│ spacewar:    │           │
  │  display_config───►│ game_tick    ├──► render_list
  │                    │ (Network)    ├──► match_result
  │                    └──────────────┘           │
  │                                               │
  │  Internal Records (invisible to runtime):     │
  │  • spacewar:object[] (entity table)           │
  │  • spacewar:game_constants                    │
  │  • spacewar:star_catalog                      │
  │  • PRNG state                                 │
  │  • sin/cos computation                        │
  │  • collision intermediates                    │
  └───────────────────────────────────────────────┘
```

Three Records in. Two Records out. Everything inside is game logic. Everything outside is platform. The line is sharp, and it holds.
