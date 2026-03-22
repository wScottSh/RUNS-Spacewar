# Part 2: Record Definitions & Runtime Interface

## How to Read This Document

This file defines every Record type and custom type used in the Spacewar! RUNS conversion. Each definition includes:

- All Fields with types, defaults, and the source line(s) from `spacewar3.1_complete.txt` where the value originates
- Whether the Record is internal (game logic only), inbound boundary (runtime → game logic), or outbound boundary (game logic → runtime)
- Derivation notes explaining why each Field exists

Cross-reference: `01_source_concordance.md` maps source lines → Records. This file defines the Records themselves.

---

## Custom Type: `spacewar:fixed18`

The PDP-1 uses 18-bit ones-complement arithmetic. All position, velocity, angle, and scale values in Spacewar! use this representation. The `spacewar:fixed18` type defines the exact semantics.

### Representation

- **Width**: 18 bits
- **Encoding**: Ones-complement signed integer
- **Range**: −131,071 to +131,071 (−(2¹⁷−1) to +(2¹⁷−1))
- **Two zero representations**: +0 = `000000₈`, −0 = `777777₈`

### Binary Point Convention

The binary point position is **context-dependent** — there is no single fixed-point format. The PDP-1 has no floating-point unit; the programmers used shift instructions (`sar`, `sal`, `scr`, `scl`) to position the binary point as needed for each operation.

Key conventions in Spacewar!:

| Context | Binary Point Position | Source Reference |
|---------|----------------------|-----------------|
| Sin/cos argument | Right of bit 3 | L192 comment: "binary point to right of bit 3" |
| Sin/cos result | Right of bit 0 | L193 comment: "binary point to right of bit 0" |
| Position (X, Y) | Right of bit 17 (integer) | Coordinates are 10-bit integers in ±512 range |
| Velocity (dX, dY) | Right of bit 17 | Same integer scale as position (added directly) |
| Angle (θ) | Right of bit 3 | Same scale as sin/cos argument |
| Angular velocity | Right of bit 3 | Added directly to angle |
| Sqrt input | Right of bit 17 | L305: "binary point to right of bit 17" |
| Sqrt result | Between bits 8 and 9 | L306: "binary point between bits 8 and 9" |

### Negative Zero Rules

| Operation | −0 Behavior | Source Evidence |
|-----------|-------------|-----------------|
| `cma` (complement) | +0 → −0 | By definition: bitwise NOT of `000000₈` = `777777₈` |
| `sma` (skip if minus) | −0 skips (treated as negative) | Sign bit (bit 0) is set in −0 |
| `spa` (skip if positive) | −0 does NOT skip | Sign bit is set |
| `add` | Result normalized: −0 + X = X | PDP-1 hardware normalizes −0 on add |
| `sub` | NOT normalized: (−0) − (+0) = −0 | PDP-1 subtract does not normalize |
| `mpy` / `dvd` | Result normalized | PDP-1 hardware normalizes on multiply/divide |
| `sza` (skip if zero) | Skips for both +0 and −0 | Tests magnitude bits only |

The `ddd` constant (L87, value `-0`) is used as a sentinel at L808–809: `lio ddd; spi i` — tests if IO register is negative zero to control outline compiler branching.

### Implementation Guidance

A RUNS runtime may implement `spacewar:fixed18` using:
- **Native ones-complement** (if the target supports it)
- **Twos-complement emulation** — represent as 18-bit twos-complement internally, implement explicit −0 handling for `cma`, sign tests, and subtract

The spec must capture the **semantics** regardless of implementation strategy. Any implementation that produces identical results for all defined operations is compliant.

---

## Internal Records

### `spacewar:object`

The core entity Record. 24 slots (L663: `nob=30` octal = 24 decimal). Derived from the parallel-array entity table (see `01_source_concordance.md` § Entity Table Memory Layout).

```text
record spacewar:object
scope: internal (game logic only — never crosses boundary)
instances: 24 (fixed)

fields:
  state:                        spacewar:object_state
    # Enum: empty, ship, torpedo, exploding, hyperspace_in, hyperspace_out
    # Source: mtb[i] calc routine address (see State Machine table in 01_source_concordance.md)
    # Default: empty

  collidable:                   bool
    # Derived from state: true for ship and torpedo; false for exploding, hyperspace_in, empty
    # Source: sign bit (400000₈) on calc routine address = non-collidable
    # Default: false

  position_x:                   spacewar:fixed18
    # Source: nx1[i] (L668–669)
    # Default: 0
    # Initial value ship 1: 200000₈ (L798). Ship 2: complement (L800–801)

  position_y:                   spacewar:fixed18
    # Source: ny1[i] (L670–672)
    # Default: 0
    # Initial value ship 1: 200000₈ (L799). Ship 2: complement (L802)

  velocity_x:                   spacewar:fixed18
    # Source: ndx[i] (L680–681)
    # Default: 0

  velocity_y:                   spacewar:fixed18
    # Source: ndy[i] (L682–684)
    # Default: 0

  lifetime:                     int
    # Source: na1[i] (L674–675)
    # Torpedoes: initialized from tlf (L80, 96 frames). Explosions: computed from mb1.
    # Counts down via `count i ma1` macro.
    # Default: 0

  angular_velocity:             spacewar:fixed18
    # Source: nom[i] (L686–687)
    # Only meaningful for ships (slots 0–1). 2-wide array.
    # Default: 0

  angle:                        spacewar:fixed18
    # Source: nth[i] (L689–690)
    # Only meaningful for ships (slots 0–1). 2-wide array.
    # Initial: 144420₈ (L803–804) for ship 1. Ship 2 inherits same.
    # Binary point: right of bit 3 (same as sin/cos argument).
    # Default: 0

  fuel:                         int
    # Source: nfu[i] (L692–693)
    # Only meaningful for ships (slots 0–1). 2-wide array.
    # Initial: foo = -20000₈ (L81, L819–821). Counts UP toward 0 (ones-complement).
    # Default: 0

  torpedoes:                    int
    # Source: ntr[i] (L695–696)
    # Only meaningful for ships (slots 0–1). 2-wide array.
    # Initial: tno value = -41₈ (L77, L816–818). Counts UP toward 0.
    # Default: 0

  outline_ref:                  int
    # Source: not[i] (L698–699)
    # Pointer to compiled outline code. Only meaningful for ships.
    # In RUNS: reference to spacewar:ship_config Record.
    # Default: 0

  prev_controls:                int
    # Source: nco[i] (L701–702)
    # Previous frame's control word. Used for edge detection (torpedo fire, hyperspace chord).
    # Only meaningful for ships. 2-wide array.
    # Default: 0

  hyperspace_saved_state:       spacewar:object_state
    # Source: nh1[i] (L704–705)
    # The ship's calc routine saved before entering hyperspace. Restored on breakout.
    # Only meaningful for ships. 2-wide array.
    # Default: empty

  hyperspace_shots_remaining:   int
    # Source: nh2[i] (L706–708)
    # Initialized from mhs = 8 (L89, L825–827). Decremented on each hyperspace use.
    # Only meaningful for ships. 2-wide array.
    # Default: 0

  hyperspace_recharge_timer:    int
    # Source: nh3[i] (L710–711)
    # Frames until hyperspace can be used again. Set from hd3 = 128 (L92).
    # Only meaningful for ships. 2-wide array.
    # Default: 0

  hyperspace_uncertainty_acc:   int
    # Source: nh4[i] (L712–714)
    # Accumulates uncertainty (hur = 40000₈ per use). Higher = more likely explosion on exit.
    # Only meaningful for ships. 2-wide array.
    # Default: 0
```

### `spacewar:game_constants`

All gameplay-defining constants. Read-only during gameplay; set at initialization.

```text
record spacewar:game_constants
scope: internal (game logic only)
instances: 1

fields:
  max_torpedoes:                  int       # tno (L77): 33 (law i 41 = -(41₈) = -33, so max = 32 usable)
  torpedo_velocity_shift:         int       # tvl (L78): 4 (sar 4s = divide by 16)
  torpedo_reload_time:            int       # rlt (L79): 16 (law i 20 = -16, used as countdown)
  torpedo_lifetime:               int       # tlf (L80): 96 (law i 140 = -96)
  max_fuel:                       int       # foo (L81): -8192 (-20000₈, counts up to 0)
  angular_acceleration:           int       # maa (L82): 8 (10₈)
  thrust_scale_shift:             int       # sac (L83): 4 (sar 4s = divide by 16)
  star_capture_radius:            int       # str (L84): 1
  collision_radius:               int       # me1 (L85): 3072 (6000₈)
  collision_radius_half:          int       # me2 (L86): 1536 (3000₈)
  torpedo_gravity_warpage_shift:  int       # the (L88): 9 (sar 9s = divide by 512)
  hyperspace_max_shots:           int       # mhs (L89): 8 (law i 10 = -8)
  hyperspace_entry_delay:         int       # hd1 (L90): 32 (law i 40 = -32)
  hyperspace_breakout_duration:   int       # hd2 (L91): 64 (law i 100 = -64)
  hyperspace_recharge_time:       int       # hd3 (L92): 128 (law i 200 = -128)
  hyperspace_displacement_scale:  int       # hr1 (L93): 9 (scl 9s = multiply by 512)
  hyperspace_velocity_scale:      int       # hr2 (L94): 4 (scl 4s = multiply by 16)
  hyperspace_uncertainty:         int       # hur (L95): 16384 (40000₈)
```

### `spacewar:ship_config`

Identity data compiled from AEMS Manifestations at build time.

```text
record spacewar:ship_config
scope: internal (used by build_render_list Processor)
instances: 2

fields:
  outline_data:                 spacewar:outline_word[]
    # Ship 1 (Needle): ot1 (L1338–1345): 111131 111111 111111 111163 311111 146111 111114 700000
    # Ship 2 (Wedge):  ot2 (L1348–1355): 013113 113111 116313 131111 161151 111633 365114 700000
    # Each word is an octal-encoded drawing instruction sequence.
    # 700000 = terminator.

  player_id:                    int
    # 0 = ship 1 (Needle), 1 = ship 2 (Wedge)
```

### `spacewar:star_catalog` + `spacewar:star_entry`

Peter Samson's Expensive Planetarium — ~478 real stars.

```text
record spacewar:star_catalog
scope: internal (read by build_render_list to produce render_objects for stars)
instances: 1

fields:
  stars:                        spacewar:star_entry[]
    # Source: L1385–1866 (478 entries across 4 brightness tiers)


record spacewar:star_entry
fields:
  x:                            int
    # Horizontal position, 0–8191. From mark macro: 8192 - X_arg.
    # Source: first argument to `mark` macro (L1379–1383)

  y:                            int
    # Vertical position, ±512 range. From mark macro: Y_arg × 256.
    # Source: second argument to `mark` macro

  brightness:                   int
    # Tier 1–4. Derived from which section (1j–1q, 2j–2q, 3j–3q, 4j–4q) the star appears in.
    # Tier 1 = brightest (9 stars), Tier 4 = dimmest (377 stars)

  designation:                  string
    # Bayer/Flamsteed designation from source comments.
    # Example: "87 Taur, Aldebaran" (L1385)
```

---

## Inbound Boundary Records

These are written by the runtime **before** each game tick. Game logic reads them.

Cross-reference: RUNS Library `runs:delta_time` (inbound boundary Field), `runs:input_intent` (inbound boundary Field) — `runs-library/README.md` § Boundary Fields.

### `spacewar:tick_input`

```text
record spacewar:tick_input
scope: inbound boundary
instances: 1
library_analogue: extends runs:delta_time

fields:
  delta_time:                   spacewar:fixed18
    # Time elapsed since last tick, in game time units.
    # For faithful reproduction: fixed value equal to PDP-1 frame duration
    # (~66ms, ~15fps). See L665: \mtc = -4000 instructions × 5µs = 20ms... 
    # Actually: 4000₈ = 2048 decimal × 5µs = ~10.2ms base, but the actual
    # frame time depends on object count. The counting budget line L940
    # busy-waits to fill the remaining time.
    # Recommended: use a fixed timestep of 1 game-tick. The runtime
    # accumulates wall-clock time and fires ticks at the original cadence.
```

| Platform | How it provides `delta_time` |
|----------|------------------------------|
| PDP-1 | Implicit — one tick per main loop iteration (L665→L940→L941) |
| Web | `requestAnimationFrame` delta accumulated; fire tick at fixed intervals |
| N64 | V-blank interrupt; count V-blanks, fire tick at fixed intervals |

### `spacewar:player_controls`

```text
record spacewar:player_controls
scope: inbound boundary
instances: 2 (one per player)
library_analogue: extends runs:input_intent (spacewar-specific shape)

fields:
  rotate_ccw:                   bool      # Turning left
  rotate_cw:                    bool      # Turning right
  thrust:                       bool      # Engine firing
  fire:                         bool      # Torpedo launch
  hyperspace:                   bool      # Hyperspace entry
```

**Source derivation**: The original reads a 4-bit control word per player via `iot 11` (L834) or `lat` (L838). Bits: rotate-CCW, rotate-CW, thrust, fire (L100–102). Hyperspace = both rotate bits set simultaneously (chord detection at L1294–1298).

The `hyperspace` boolean replaces chord detection — the runtime maps "both rotate buttons" (or a dedicated button like N64 Z-trigger) to this boolean. Game logic reads intent, not buttons.

| Platform | Input mapping |
|----------|--------------|
| PDP-1 | `iot 11` 4-bit control word; hyperspace = bits 0+1 both set |
| Web | Keyboard: WASD + Space (P1), arrows + Enter (P2); or Gamepad API |
| N64 | D-pad/stick ± threshold for rotate; A = thrust; B = fire; Z = hyperspace |

### `spacewar:display_config`

```text
record spacewar:display_config
scope: inbound boundary
instances: 1

fields:
  width:                        int       # Playfield width in game units
  height:                       int       # Playfield height in game units
```

**Source derivation**: The PDP-1's Type 30 CRT uses 10-bit display registers (1024×1024 points). Toroidal wrapping is free — register overflow wraps automatically. In RUNS, the `wrap_position` Processor needs explicit boundaries.

For faithful reproduction, all runtimes provide `width: 1024, height: 1024`. The runtime maps game units to screen pixels.

| Platform | Game units | Physical resolution |
|----------|-----------|-------------------|
| PDP-1 | 1024×1024 (implicit) | 1024×1024 CRT points |
| Web | 1024×1024 (from config) | Canvas size (scaled) |
| N64 | 1024×1024 (from config) | 320×240 (scaled + centered) |

### `spacewar:game_config`

```text
record spacewar:game_config
scope: inbound boundary
instances: 1

fields:
  angular_damping:              bool      # SW1 (szs 10, L1101): zero angular velocity per frame
  heavy_star:                   bool      # SW2 (szs i 20, L1150): double gravity
  rapid_fire:                   bool      # SW3 (szs i 30, L1236): skip reload timer
  disable_background:           bool      # SW4 (szs 40, L630): no Expensive Planetarium
  star_teleport:                bool      # SW5 (szs 50, L1319): star capture → teleport
  disable_gravity:              bool      # SW6 (szs 60, L523/L1122): no gravity, no background
  game_count:                   int       # From operator panel (lat bits 6–11, L786–791)
```

**Source derivation**: Six PDP-1 sense switches, read per-frame via `szs` instructions. In practice, physical switches set before the game starts. The runtime maps physical toggles/menu settings to these booleans.

---

## Outbound Boundary Records

These are written by game logic **after** each tick. The runtime reads them.

Cross-reference: RUNS Library `runs:render_transform` (outbound boundary Field) — `runs-library/README.md` § Boundary Fields.

### `spacewar:render_object`

```text
record spacewar:render_object
scope: outbound boundary
instances: variable (up to 24 entities + 478 stars + 1 central star)
library_analogue: extends runs:render_transform (spacewar-specific projection)

fields:
  object_type:                  spacewar:render_type
    # Enum: ship, torpedo, explosion, star, central_star, exhaust
    # Determined by state enum + rendering context

  position_x:                   spacewar:fixed18
    # Game coordinates, origin center, Y-up, ±512 range
    # Source: nx1[i] for entities; mark X for stars

  position_y:                   spacewar:fixed18
    # Source: ny1[i] for entities; mark Y for stars

  angle:                        spacewar:fixed18
    # Ship heading. Only meaningful for ship and exhaust types.
    # Source: nth[i]

  outline_data:                 spacewar:outline_word[]
    # Ship shape data. Only meaningful for ship type.
    # Source: compiled outline from ot1/ot2 via ship_config

  brightness:                   int
    # 1–4 for stars (brightness tier), 0 for other types.
    # Source: which dislis tier (L636–639)

  particle_seed:                spacewar:fixed18
    # PRNG state at start of particle generation. For explosion type only.
    # The runtime reproduces particle positions by running the PRNG.

  particle_count:               int
    # Number of explosion particles. For explosion type only.
    # Source: computed from mb1 instruction budget in mex routine

  flame_length:                 int
    # Exhaust flame length (thruster visual). For ship type, 0 if not thrusting.
    # Source: \src random count (L1218) when thrust is active (L1221–1222)
```

**Why a projection, not raw entity state**: The runtime doesn't need fuel, torpedoes, hyperspace state, or collision data. The `build_render_list` Processor (last in the Network) reads internal state and produces this minimal projection. Rendering decisions never flow back into game state.

The runtime transforms game coordinates to screen coordinates (offset + scale + Y-flip for Y-down displays). This is trivial and belongs in the runtime, not game logic.

### `spacewar:match_result`

```text
record spacewar:match_result
scope: outbound boundary
instances: 1

fields:
  state:                        spacewar:match_lifecycle
    # Enum: playing, round_over, match_over, restart_countdown
    # Source: derived from game lifecycle state machine (L717–791)

  score_1:                      int
    # Player 1 score. Source: \1sc (L746, L768, L777, L784)

  score_2:                      int
    # Player 2 score. Source: \2sc (L752, L769, L778, L785)

  rounds_remaining:             int
    # Games left in match. Source: \gct (L764, L767, L772, L791)
    # Initialized from game_config.game_count

  restart_timer:                int
    # Frames until next round begins. 0 if not in countdown.
    # Source: \ntd (L735, L738). Set to 2× torpedo_lifetime on round end.
```

### `spacewar:starfield_state`

```text
record spacewar:starfield_state
scope: outbound boundary
instances: 1

fields:
  scroll_offset:                int
    # Current right-margin pointer. Source: fpr (L653, initial 10000₈ = 4096)
    # Advances by 1 every 20 frames, wraps at 20000₈ (L644–648)

  scroll_counter:               int
    # Countdown timer. Source: bkc (L652). Resets to -20 (law i 20, L642–643)
    # When reaches 0, scroll_offset advances
```

---

## Complete Runtime Interface Declaration

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

Cross-reference: RUNS spec § Runtime Interface (`runs-spec/README.md` item 6) — "A Network declares the Fields it requires from the runtime and the Fields it produces for the runtime."

### Boundary Summary

| Record | Direction | Fields Crossing | Count |
|--------|-----------|----------------|-------|
| `tick_input` | Runtime → Game | `delta_time` | 1 |
| `player_controls` (×2) | Runtime → Game | 5 booleans per player | 10 |
| `display_config` | Runtime → Game | `width`, `height` | 2 |
| `game_config` | Runtime → Game | 6 booleans + 1 int | 7 |
| `render_object[]` | Game → Runtime | 9 fields per object | variable |
| `match_result` | Game → Runtime | 5 fields | 5 |
| `starfield_state` | Game → Runtime | 2 fields | 2 |

**4 inbound Records. 3 outbound Records. 7 total. Everything else is invisible to the runtime.**
