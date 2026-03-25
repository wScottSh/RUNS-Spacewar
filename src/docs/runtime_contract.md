# Spacewar! 3.1 RUNS Runtime Contract

## What This Document Is

This is the complete specification for building a runtime that plays Spacewar! 3.1 from the RUNS source files in `runs-spacewar/src/`. If you follow this contract, you will have a working game.

The RUNS source files contain **all game logic** — physics, collision, scoring, state machines, everything. This document specifies **everything else**: when to call the game logic, what to feed it, and how to interpret its output.

---

## Part 1: Architecture

```
┌─────────────────────────────────────────────┐
│                  RUNTIME                     │
│                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐ │
│  │  Input    │  │  RUNS      │  │  Output  │ │
│  │  Mapper   │→ │  Engine    │→ │  Renderer│ │
│  │          │  │ (game_tick)│  │          │ │
│  └──────────┘  └────────────┘  └──────────┘ │
│                                              │
│  ┌──────────┐  ┌────────────┐               │
│  │ Lifecycle │  │  State     │               │
│  │ Manager  │  │  Storage   │               │
│  └──────────┘  └────────────┘               │
└─────────────────────────────────────────────┘
```

You build five components:

1. **RUNS Engine** — parses `.runs` source, compiles Processors, executes the Network
2. **Input Mapper** — reads keyboard/gamepad, produces inbound Records
3. **Output Renderer** — reads outbound Records, draws to screen
4. **Lifecycle Manager** — drives init → play → score → reinit → end flow
5. **State Storage** — allocates and manages the `state:` block between ticks

The RUNS Engine is universal (works for any RUNS game). The other four are Spacewar-specific.

---

## Part 2: Lifecycle

The runtime drives the match lifecycle. The game logic signals transitions; the runtime acts on them.

```
┌─────── LAUNCH ──────┐
│                      │
▼                      │
match_initialize() ────┤
│                      │
▼                      │
┌──── GAME LOOP ────┐  │
│  provide inbound   │  │
│  call game_tick()  │  │
│  consume outbound  │  │
│  render frame      │  │
└────────┬──────────┘  │
         │              │
         ├── trigger_reinit == true ──► match_initialize() ──┘
         │
         └── result.state == match_over ──► DISPLAY SCORES ──► END
```

### Startup Sequence

1. Parse all `.runs` files in `src/`
2. Compile Processors and Networks
3. Allocate `state:` block with zero values
4. Load `init_state.json` → populate `state.consts` (game constants)
5. Load `ship_outlines.json` → populate `state.configs[0]` (Needle) and `state.configs[1]` (Wedge)
6. Load `star_catalog.json` → make available for starfield rendering
7. Read `game_config` from user settings (or all-defaults: all switches off)
8. Call `match_initialize()` to place ships and set resources
9. Enter game loop

### Per-Frame Tick

```
1. Read input devices → fill inbound Records
2. Call game_tick(requires, state) → produces + updated state
3. Check produces.match.trigger_reinit:
   - If true: call match_initialize(state), clear trigger_reinit
4. Check produces.match.state:
   - If match_over: exit game loop, display final scores
5. Render frame from produces
6. Wait for next frame (target: 15 fps for authentic feel, any rate works)
```

### Frame Rate

The PDP-1 ran Spacewar! at approximately **15 fps** (the busy-wait loop at L940 consumed remaining frame budget). The RUNS source is frame-rate-independent in principle — `tick_input.delta_time` allows scaling. However, the original constants (gravity, thrust, torpedo speed) were tuned for 15 fps. Running at 60 fps without scaling will produce 4× faster gameplay. Options:

- Run at 15 fps (authentic)
- Run at any fps and scale `delta_time` accordingly
- Run at any fps and divide acceleration constants by `fps/15`

---

## Part 3: Inbound Records (What You Provide)

Each tick, the runtime fills these Records and passes them to `game_tick`:

### tick_input

| Field | Type | Description |
|-------|------|-------------|
| `frame_number` | int | Monotonically increasing frame counter |
| `delta_time` | int | Time since last frame (fixed18 format, or 1 for fixed-step) |

### player_controls (×2, one per player)

| Field | Type | Description |
|-------|------|-------------|
| `rotate_cw` | bool | Clockwise rotation button held |
| `rotate_ccw` | bool | Counter-clockwise rotation button held |
| `thrust` | bool | Thrust button held |
| `fire` | bool | Fire button held |
| `hyperspace` | bool | Hyperspace button held |

**Input mapping**: The original PDP-1 used toggle switches and the test-word register. A modern runtime maps keyboard or gamepad buttons. Suggested defaults:

| Action | Player 1 | Player 2 |
|--------|----------|----------|
| Rotate CW | D | → |
| Rotate CCW | A | ← |
| Thrust | W | ↑ |
| Fire | S | ↓ |
| Hyperspace | Q | / |

**Hyperspace note**: In the original, hyperspace was triggered by pressing both rotate buttons simultaneously. In RUNS, this is simplified to a dedicated `hyperspace` boolean. The runtime can implement either behavior — the game logic only reads the boolean.

### display_config

| Field | Type | Description |
|-------|------|-------------|
| `width` | int | Playfield width in game units (1024 for PDP-1 scale) |
| `height` | int | Playfield height in game units (1024 for PDP-1 scale) |

**Note**: The game logic uses 18-bit fixed-point coordinates internally. The display_config tells the runtime how to scale game coordinates to screen pixels. The PDP-1 CRT was 1024×1024 pixels with 10-bit addressing.

---

## Part 4: Outbound Records (What You Consume)

After each tick, the runtime reads these Records:

### render_object[] (the render list)

An array of objects to draw this frame. Each has:

| Field | Type | Description |
|-------|------|-------------|
| `object_type` | enum | `ship`, `torpedo`, `explosion`, `central_star` |
| `position_x` | int | X position (fixed18, game coordinates) |
| `position_y` | int | Y position (fixed18, game coordinates) |
| `angle` | int | Heading angle (fixed18, for ships only) |
| `outline_data` | data | Ship outline words (for ships only) |
| `brightness` | int | Intensity level (0 = normal, 2 = dim for hyperspace breakout) |
| `particle_seed` | int | PRNG seed for particle scatter (explosions only) |
| `particle_count` | int | Number of particles to generate (explosions only) |
| `flame_length` | int | Engine exhaust particle count (thrusting ships only) |

### match_result

| Field | Type | Description |
|-------|------|-------------|
| `score_1` | int | Player 1 score |
| `score_2` | int | Player 2 score |
| `state` | enum | `playing`, `match_over` |
| `trigger_reinit` | bool | If true, runtime must call `match_initialize` |
| `restart_timer` | int | Internal countdown (runtime does not use directly) |
| `rounds_remaining` | int | Rounds left in match (0 = infinite) |

### starfield_state

| Field | Type | Description |
|-------|------|-------------|
| `scroll_offset` | int | Current scroll position for star catalog |
| `scroll_counter` | int | Internal timer (runtime does not use directly) |

---

## Part 5: Rendering

### Coordinate System

The PDP-1 uses a 1024×1024 display with (0, 0) at center. Positive X is right,
**positive Y is up** (PDP-1 CRT convention). The game logic uses 18-bit
fixed-point coordinates where the display range is approximately ±131,072.
Map game coordinates to screen:

```
screen_x = (game_x / 131072) * (screen_width / 2) + (screen_width / 2)
screen_y = (screen_height / 2) - (game_y / 131072) * (screen_height / 2)
```

Note the Y-flip: PDP-1 Y-up → screen Y-down. Positive game_y maps to the
upper half of the screen (lower screen_y values).

The display wraps toroidally — positions outside the playfield wrap to the opposite edge.

### Rendering by Object Type

#### Ships (`object_type == ship`)

Draw the ship outline at `(position_x, position_y)` rotated by `angle`. The outline is an array of octal words interpreted as 3-bit direction codes.

See [outline_format.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/docs/outline_format.md) for the complete outline rendering algorithm, direction code table, rotation matrix, and checkpoint save/restore mechanism.

If `flame_length > 0`, draw exhaust particles behind the ship (opposite heading direction). Generate `flame_length` random dots using the PRNG, scattered behind the ship. The original used `sar 9s` and `sar 4s` to scale random values.

If `brightness == 2`, draw at reduced intensity (hyperspace breakout phase — ship is flickering back into existence).

#### Torpedoes (`object_type == torpedo`)

Draw a single bright dot at `(position_x, position_y)`. That's it. The original PDP-1 used `dpy` with intensity 1 (brightest single point).

#### Explosions (`object_type == explosion`)

Generate `particle_count` random (x, y) offsets from `particle_seed` using the PRNG. Draw each as a dot around `(position_x, position_y)`. The scatter uses two different scales — some particles close, some farther — to create the expanding debris visual.

Exact PRNG-driven placement is authentic but not mandatory. The visual should convey "thing exploded here" — scattered dots expanding outward over time.

#### Central Star (`object_type == central_star`)

Source: `blp` routine at L522-539, `bpt` subroutine at L541-561.

The central star is rendered as a **mirrored line of individual dots through
the origin at a random angle**, redrawn each frame. The algorithm:

1. Generate random displacement `(bx, by)` via PRNG (L525-536)
2. Draw a dot at center `(0, 0)` (L550-551)
3. Starting from center, draw up to 20 dots along direction `(bx, by)`,
   each offset by `(bx, by)` from the previous (the `starp` macro, L553)
4. Negate `(bx, by)` (L557-560), restart from center → draws the
   mirror-image line through origin
5. Result: a randomly-oriented line of point-plotted dots through center

This produces the iconic flickering, rotating line that changes angle
each frame. The `bx`/`by` offsets incorporate the gravity vector
(`\bx`, `\by`) when gravity is active, making the line wobble with
nearby ships. On a P7 phosphor display, frame persistence blurs this
into a pulsing starburst.

### Starfield (from star_catalog + starfield_state)

The starfield is NOT in `render_object[]`. It renders separately from `star_catalog.json` and `starfield_state.scroll_offset`.

Algorithm:
```
for each star in star_catalog:
  render_x = star.x - starfield_state.scroll_offset
  if render_x < 0:
    render_x = render_x + 8192        // Wrap at right margin

  render_y = star.y * 256              // Display scaling (L589: sar 9s → mul 256 equivalent)

  brightness = star.tier               // 1 = brightest, 4 = dimmest

  draw dot at (render_x, render_y) with brightness
```

The starfield scrolls slowly — approximately 1 position per 40 frames. The game logic handles the scroll counter; the runtime just reads `scroll_offset` and applies it.

Stars are rendered BEHIND all game objects (lowest draw priority).

### Score Display

Read `match_result.score_1` and `match_result.score_2`. Display them to the players. The original used the PDP-1 operator lights (L777-779: `lac \1sc; lio \2sc; hlt`). A modern runtime should display scores as text, a HUD overlay, or any clearly visible indicator.

When `match_result.state == match_over`, display final scores prominently and stop gameplay.

---

## Part 6: Sense Switch UI

The original PDP-1 had six sense switches (physical toggle switches). The runtime must provide a way to toggle these at runtime (keyboard shortcuts, menu, or similar):

| Switch | Key (suggested) | Effect |
|--------|----------------|--------|
| SW1 | 1 | Angular damping (rotation stops when button released) |
| SW2 | 2 | Heavy star (approximately double gravity) |
| SW3 | 3 | Rapid fire (no torpedo reload delay) |
| SW4 | 4 | Disable background stars + disable gravity |
| SW5 | 5 | Star capture teleports instead of explodes |
| SW6 | 6 | No gravity + no central star display |

Map these to `game_config` inbound Record fields. The game logic reads them each tick.

---

## Part 7: AEMS Integration (Optional)

At build time, the runtime may resolve AEMS Manifestation events from Nostr relays (or local cache) to populate ship outline data. This is optional — the outline data is already in `ship_outlines.json` and `manifestations.json`. A fully offline runtime can skip AEMS entirely.

If AEMS is integrated:
1. Query relays for kind 30051 events with `d`-tags `spacewar:needle` and `spacewar:wedge`
2. Extract `outline_data` property from each
3. Parse octal words into arrays
4. Populate `state.configs[0]` and `state.configs[1]`

---

## Part 8: Minimal Implementation Checklist

For the absolute minimum viable runtime:

- [ ] Parse and compile RUNS source files
- [ ] Allocate state block, load constants and outlines
- [ ] Call `match_initialize` on startup
- [ ] Main loop: read input → call `game_tick` → render
- [ ] Map keyboard to `player_controls` (5 buttons × 2 players)
- [ ] Render ships as outlines (or simplified shapes as placeholder)
- [ ] Render torpedoes as dots
- [ ] Render explosions as scattered dots
- [ ] Render central star as a visible point at center
- [ ] Render starfield from catalog + scroll_offset
- [ ] Display scores
- [ ] Handle `trigger_reinit` (call `match_initialize`)
- [ ] Handle `match_over` (stop game, show final scores)

Optional but recommended:
- [ ] Sense switch toggles
- [ ] Toroidal wrapping in rendering (objects near edge appear on both sides)
- [ ] Sound effects (not in original — creative freedom)
- [ ] CRT phosphor glow effect (for authentic aesthetics)
