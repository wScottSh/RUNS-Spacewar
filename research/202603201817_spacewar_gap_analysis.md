# Spacewar! RUNS Conversion: Comprehensive Gap Analysis

## Method

Compared every line of `spacewar3.1_complete.txt` (1,870 lines) against four research artifacts:
1. Source research (provenance)
2. RUNS conversion analysis (system decomposition)
3. AEMS integration (entity/manifestation mapping)
4. Runtime boundary (interface Records)

What follows is everything we missed, underspecified, or got wrong.

---

## Gap 1: The Sense Switch Configuration System

### What the source does

Six PDP-1 sense switches control game options. The code tests them with `szs` (skip-on-sense-switch):

| Switch | Code | Effect |
|--------|------|--------|
| `szs 10` (SW1) | L1101 | If set, zero angular momentum each frame → ships don't drift when rotating |
| `szs 20` (SW2) | L1150 | If set, doubles gravity effect (heavier star) |
| `szs 30` (SW3) | L1236 | If set, allows re-firing torpedoes before reload timer expires |
| `szs 40` (SW4) | L630 | If set, disables background starfield (Expensive Planetarium) entirely |
| `szs 50` (SW5) | L1319 | If set, ships dragged into star are teleported to far corner instead of exploding |
| `szs 60` (SW6) | L523, L1122 | If set, disables both background AND central star gravity entirely |

### What our analysis missed

The previous documents treat game constants as fixed values. They aren't. The sense switches create **six binary configuration flags** that alter game behavior at runtime. This is a configuration layer we never analyzed.

### RUNS mapping

These switches are neither runtime concerns nor AEMS concerns. They are **game configuration** — they change the rules, not the presentation or the identity of entities.

```text
record spacewar:game_config
fields:
  angular_damping:    bool    # SW1: zero angular momentum per frame
  heavy_star:         bool    # SW2: double gravity
  rapid_fire:         bool    # SW3: skip reload timer
  disable_background: bool    # SW4: no Expensive Planetarium
  star_teleport:      bool    # SW5: star captures → teleport, not explode
  disable_gravity:    bool    # SW6: no gravity, no background
```

This is an **inbound boundary Record** — the runtime reads physical switch/toggle/menu state and writes these booleans before the game starts. The game logic reads them. They don't change during gameplay (the original reads them per-frame, but they're physical switches that the player sets before starting).

**This means the runtime interface has FOUR inbound Records, not three**: `tick_input`, `player_controls` (×2), `display_config`, and `game_config`.

### Impact

The runtime boundary document needs updating. `spacewar:game_config` is a boundary Record.

---

## Gap 2: Game Lifecycle — Scoring, Restart, and Match Pacing

### What the source does

Lines 717–828 implement a game lifecycle state machine:

1. **Win detection** (L717–736): Checks if both ships' calc routines are `ss1`/`ss2` (alive). If both are alive and both are out of torpedoes, starts a restart countdown equal to 2× torpedo lifetime.
2. **Score tracking** (L738–753): When the restart fires, flags 1 and 2 are set. If a ship's calc routine ISN'T `ss1`/`ss2` (it died), its opponent's score (`\1sc` or `\2sc`) is incremented. Then jumps to `a` (restart).
3. **Game count** (L764–791): `gct` is a countdown read from the operator panel (`lat` instruction, bits 6–11). When it reaches zero, the game halts and displays scores. If the scores are tied, it keeps going.
4. **Score display** (L777–779): `lac \1sc` / `lio \2sc` / `hlt` — loads both scores and halts the machine, displaying them in the AC and IO registers on the console lights.

### What our analysis missed

The `match_result` outbound Record in the boundary analysis assumed a simple state machine (`playing`, `player1_wins`, etc.). But the actual lifecycle is richer:

- **Game count**: The number of matches to play is set by the operator before the game starts (via `lat` — the test word switches). This is a configuration value.
- **Restart delay**: When both ships are dead or out of ammo, there's a timed countdown before the next round begins. The game doesn't just end — it waits, then resets.
- **Score persistence**: Scores persist across rounds within a session. They're only displayed (and cleared) when the game count reaches zero.
- **Tie detection**: The game count doesn't decrement if scores are tied — it forces another round.

### RUNS mapping

- `game_count` belongs in `spacewar:game_config` (set before play starts)
- Restart delay is internal game logic (a Processor counts down the `ntd` timer)
- Scores are internal game state, projected to `match_result` at the boundary
- Tie detection is a game logic guard (MAPS arc condition)

The `match_result` Record should include:

```text
record spacewar:match_result
fields:
  state:           enum[playing, round_over, match_over, restart_countdown]
  score_1:         int
  score_2:         int
  rounds_remaining: int
  restart_timer:   int    # frames until next round begins (0 if not in countdown)
```

---

## Gap 3: Ones-Complement Negative Zero

### What the source does

The PDP-1 uses 18-bit ones-complement arithmetic. This has a critical edge case: **negative zero** (`777777₈` = all bits set). The PDP-1 hardware automatically converts -0 to +0 on add, multiply, and divide results. But NOT on subtract.

The Spacewar! code exploits this in several places:
- `cma` (complement accumulator) is used to negate values. Complementing +0 gives -0 (`777777₈`). The code then uses `sma` (skip-if-minus) or `spa` (skip-if-positive) to test signs.
- The `ddd` constant at L87 is explicitly `-0` — a sentinel value.
- Signed comparisons using `spq` (sign of positive quantity, which is `szm i` — skip if zero or minus, inverted) treat -0 differently from +0.

### What our analysis missed

The RUNS conversion analysis identified the need for a `spacewar:fixed18` type but didn't specify negative-zero behavior. If the RUNS expression language doesn't support ones-complement arithmetic with negative zero, the game behavior will differ in subtle ways.

### RUNS mapping

The `spacewar:fixed18` type specification must explicitly handle:
1. Two representations of zero (positive and negative)
2. `cma` producing -0 from +0
3. Sign tests treating -0 as negative
4. Addition, multiplication, and division normalizing -0 to +0
5. Subtraction NOT normalizing ((-0) - (+0) = -0)

This is a type system concern, not a boundary or AEMS concern. It belongs in the `spacewar:fixed18` Processor specs.

---

## Gap 4: Self-Modifying Code as Entity State Machine

### What the source does

The entity table doesn't have a "type" field. Instead, each entity slot contains the **address of its calc routine** in `mtb[i]`. The calc routine IS the type:
- `ss1` → spaceship 1 (alive)
- `ss2` → spaceship 2 (alive)
- `tcr` → torpedo (active)
- `mex 400000` → explosion (sign bit set = non-collidable)
- `hp1 400000` → hyperspace entry
- `hp3` → hyperspace breakout
- `0` → empty slot

State transitions are implemented by **replacing the calc routine address**:
- Ship collision: `lac (mex 400000)` / `dac i ml1` → writes the explosion routine address into the ship's slot
- Torpedo timeout: same pattern → explosion
- Hyperspace entry: `lac (hp1 400000)` / `dac i ml1` → writes hp1 into the ship's slot
- Ship dies to star: same → explosion or teleport (depends on SW5)

The sign bit (bit 0, octal `400000`) is overloaded as a "non-collidable" flag — entities with the sign bit set in their calc routine address are skipped by the collision loop.

### What our analysis missed

The conversion analysis mentioned self-modifying code but didn't fully decompose the **state machine**. In RUNS terms, this is:

```
entity_type = calc_routine_address → maps to an enum:
  SHIP_ACTIVE     = ss1/ss2
  TORPEDO_ACTIVE  = tcr
  EXPLODING       = mex
  HYPERSPACE_IN   = hp1
  HYPERSPACE_OUT  = hp3
  EMPTY           = 0

collidable = !(calc_routine_address & 400000)
```

The RUNS `spacewar:object` Record needs:

```text
record spacewar:object
fields:
  state:      enum[empty, ship, torpedo, exploding, hyperspace_in, hyperspace_out]
  collidable: bool    # derived from state (ship and torpedo are collidable; others are not)
  ...
```

This is cleaner than the original's overloaded address/sign-bit hack, but must produce identical behavior. The conversion must map each `dac i ml1` write to a state transition on the Record.

---

## Gap 5: The Instruction Budget Timing Mechanism

### What the source does

`\mtc` is initialized to `-4000` (L665) each frame. Each calc routine adds its instruction count (`mb1[i]`) to `\mtc`. After all objects are processed, L940 does `count \mtc, .` — spinning in a busy loop until `\mtc` reaches zero. This guarantees every frame takes exactly 4000 instruction periods (~66ms at 5µs/instruction).

If the total computation exceeds 4000 instructions, the game runs slow — but the physics still advance by one frame, just late.

### What our analysis missed

The fixed timestep analysis in the boundary doc assumes `delta_time` is always the same. This is correct for the RUNS port. But the ORIGINAL game doesn't have a fixed timestep — it has a fixed instruction budget. If fewer objects are active, the frame renders faster and then busy-waits. If more objects are active (many torpedoes + explosions), the frame might overrun.

For a faithful RUNS port, this distinction doesn't matter: the game logic always advances by one fixed tick. But for **emulation fidelity testing** against the masswerk.at emulator, we need to account for the fact that the original's timing is instruction-count-based, not wall-clock-based.

### RUNS mapping

No change needed. The instruction budget is implementation detail of the original PDP-1 runtime, not game logic. The RUNS port uses a fixed timestep, which is the equivalent mechanism for modern hardware.

---

## Gap 6: The Star Display Scrolling Mechanism

### What the source does

The background routine (`bck`, L629–649) implements a **scrolling starfield**. It doesn't just display the stars — it scrolls them:

- `fpr` (L653) is a "right margin" pointer that advances by 1 unit every 20 frames (`bkc` counter)
- Stars are displayed relative to `fpr` — as `fpr` advances, the starfield scrolls left
- When `fpr` reaches the end of the catalog, it wraps to the beginning
- Four brightness tiers are displayed with separate `dislis` macro invocations (L636–639), each with a different `dpy` intensity parameter

### What our analysis missed

The star catalog wasn't described as scrolling in any previous artifact. We treated it as a static backdrop. It isn't static — **the stars slowly scroll across the screen**, creating a sense of motion against the fixed playing field.

### RUNS mapping

This is a boundary question. Does the scroll offset affect gameplay? 

**No.** The starfield is purely cosmetic. The scroll offset (`fpr`) doesn't feed back into any game logic — no Processor reads it. Ships don't interact with background stars.

But the scroll IS driven by a counter (`bkc`), which counts down from -20 and wraps. This counter is deterministic and frame-synchronized. If we want visual fidelity, the scroll must match the original.

Two approaches:
1. **Game logic drives the scroll counter**: Include `fpr` as an internal Record field. A `spacewar:scroll_stars` Processor advances it each frame. The render list includes the scroll offset.
2. **Runtime drives the scroll**: The runtime independently counts frames and scrolls. Simpler but decoupled from game tick pacing.

Approach 1 is correct because the scroll is frame-synchronized with the game tick. If the game logic runs at 15fps, the scroll should advance at 15fps, not at the runtime's render framerate.

Add to `spacewar:render_object[]` or a separate `spacewar:starfield_state`:

```text
record spacewar:starfield_state
fields:
  scroll_offset: int    # current fpr value (0–8191 in original, wrapping)
  scroll_counter: int   # bkc countdown, fires scroll advance
```

This is an outbound boundary Record — game logic writes it, runtime reads it to render the starfield at the correct scroll position.

---

## Gap 7: The Patch Space Convention

### What the source does

L1362: `p, . 200/ / space for patches` — reserves 128 words of memory for runtime patches.

### What our analysis missed

This is a modding/debugging convention, not game logic. PDP-1 programmers would patch live game behavior by writing new code into this space during a session.

### RUNS mapping

This has no direct RUNS equivalent — and that's correct. The RUNS fork/variant model replaces runtime patching. Someone who wants to modify the game forks the RUNS source and publishes a variant, rather than hot-patching memory.

No change needed. But it's worth noting: the patch space is the 1962 ancestor of the RUNS variant model.

---

## Summary: What Changes

| Gap | Severity | Action Required |
|-----|----------|----------------|
| **Sense switches** | **High** — missing boundary Record | Add `spacewar:game_config` as 4th inbound boundary Record |
| **Game lifecycle** | **Medium** — `match_result` underspecified | Expand `match_result` with `restart_timer`, `round_over` state, `rounds_remaining` |
| **Negative zero** | **Medium** — type spec incomplete | Document negative-zero behavior in `spacewar:fixed18` type specification |
| **State machine** | **Medium** — entity state not decomposed | Define explicit `state` enum on `spacewar:object` Record replacing calc-routine-as-type |
| **Instruction budget** | **None** — correctly abstracted | Fixed timestep in RUNS is the right equivalent; no change |
| **Star scrolling** | **Low** — cosmetic fidelity | Add `spacewar:starfield_state` outbound Record for scroll offset |
| **Patch space** | **None** — historical note only | No RUNS equivalent needed; fork/variant model replaces it |

### Updated Runtime Interface

```yaml
network spacewar:game_tick
runtime_interface:
  requires:
    tick_input:      spacewar:tick_input
    p1_controls:     spacewar:player_controls
    p2_controls:     spacewar:player_controls
    display_config:  spacewar:display_config
    game_config:     spacewar:game_config        # NEW — sense switch flags

  produces:
    render_list:     spacewar:render_object[]
    match_result:    spacewar:match_result        # EXPANDED — lifecycle states
    starfield_state: spacewar:starfield_state     # NEW — scroll offset
```

Four in. Three out. Seven boundary Records total.
