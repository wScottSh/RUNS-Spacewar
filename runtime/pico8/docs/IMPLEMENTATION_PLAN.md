# PICO-8 Spacewar! — Implementation Plan

## For the Implementing Agent

You are building a single PICO-8 cartridge (`spacewar.p8`) that hand-transpiles the RUNS source into idiomatic PICO-8 Lua. **Do not invent game logic.** Every algorithm, constant, and data structure is specified in the `.runs` source files listed below. Your job is translation, not design.

> [!IMPORTANT]
> This is NOT a generic RUNS interpreter. It is a hand-compiled translation. The `.runs` files are your specification. Read them before writing any Lua.

### Workspace Layout

All source files live under `d:\repos\decentralized-games-standard\runs-spacewar\src\`:

**Architecture** (read first):
- [game_tick.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/networks/game_tick.runs) — top-level 6-phase Network
- [ship_update.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/networks/ship_update.runs) — ship sub-pipeline
- [runtime_contract.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/docs/runtime_contract.md) — what a runtime must do
- [outline_format.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/docs/outline_format.md) — ship outline rendering algorithm

**Records** (data schemas):
- [object.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/object.runs) — 17 entity fields, 24 slots
- [game_constants.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/game_constants.runs) — all 18 constants with exact values
- [game_config.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/game_config.runs) — 6 sense switches
- [player_controls.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/player_controls.runs) — 5 input booleans per player

**Data**:
- [init_state.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/init_state.json) — exact initialization values
- [ship_outlines.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/ship_outlines.json) — Needle + Wedge octal outline words
- [star_catalog.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/star_catalog.json) — 469 stars with x, y, brightness

**Entity Processors** (one Lua function each):
| Lua function | Source file | Source lines |
|-------------|------------|-------------|
| `rotation_update(i)` | [rotation_update.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/rotation_update.runs) | L1079-1119 |
| `gravity(i)` | [gravity.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/gravity.runs) | L1120-1166, L1312-1333 |
| `thrust(i)` | [thrust.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/thrust.runs) | L1167-1186 |
| `velocity_integrate(i)` | [velocity_integrate.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/velocity_integrate.runs) | L160-167 |
| `wrap_position(i)` | [wrap_position.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/wrap_position.runs) | hardware (explicit) |
| `torpedo_launch(i)` | [torpedo_launch.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/torpedo_launch.runs) | L1232-1288 |
| `hyperspace_check(i)` | [hyperspace_check.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_check.runs) | L1289-1309 |
| `torp_update(i)` | [torpedo_update.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/torpedo_update.runs) | L985-1005 |
| `expl_tick(i)` | [explosion_tick.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/explosion_tick.runs) | L946-983 |
| `hyp_transit(i)` | [hyperspace_transit.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_transit.runs) | L1007-1045 |
| `hyp_break(i)` | [hyperspace_breakout.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_breakout.runs) | L1047-1077 |

**System Processors** (one Lua function each):
| Lua function | Source file | Source lines |
|-------------|------------|-------------|
| `process_spawns()` | [process_spawns.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/process_spawns.runs) | L1245-1288 |
| `collision_detect()` | [collision_detect.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/collision_detect.runs) | L868-904 |
| `check_restart()` | [check_restart.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/check_restart.runs) | L717-736 |
| `update_scores()` | [update_scores.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/update_scores.runs) | L738-754 |
| `match_init()` | [match_initialize.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/match_initialize.runs) | L764-828 |
| `advance_scroll()` | [advance_starfield_scroll.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/advance_starfield_scroll.runs) | L623-653 |

**Verification**:
- [verification_report.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/tests/verification_report.md) — test vectors

---

## Known Deviations

| # | What | RUNS Canonical | PICO-8 | Impact |
|---|------|---------------|--------|--------|
| D1 | PRNG | rotate-right-1, XOR 355670₈, add 355670₈ | `rnd()` | Non-reproducible across platforms |
| D2 | Coordinates | 18-bit ±131,071 | 16:16 ±32,767 (÷4) | Rounding differences at edges |
| D3 | Trig | Adams polynomial sine (L190-254) | PICO-8 `sin()`/`cos()` | Fractionally different |
| D4 | Render boundary | `build_render_list` → `render_object[]` | `_draw()` reads entities directly | Same output, no boundary |
| D5 | Explosion duration | instruction-budget based | Fixed -12 | Per RUNS source simplification |
| D6 | Entity fields | 17 fields | ~13 (derive `collidable` from state) | Token savings |
| D7 | Star catalog | 469 stars from sprite memory | All 469, stored in `__gfx__` | Full fidelity |

**No sound.** The original PDP-1 had no speaker. This cart is silent.

---

## Constant Mapping

From [game_constants.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/game_constants.runs):

**Rule**: Only constants representing **positions or distances** are ÷4. Counters, frame counts, and probability values are 1:1.

```lua
-- Torpedoes
tno = 33      -- max_torpedoes (counter, 1:1)
tvl = 4       -- torpedo_velocity_shift (shift, 1:1)
rlt = 16      -- torpedo_reload_time (frames, 1:1)
tlf = 96      -- torpedo_lifetime (frames, 1:1)
the = 9       -- torpedo_gravity_warpage_shift (shift, 1:1)

-- Ship movement
foo = -8192   -- max_fuel (counter, 1:1)
maa = 8       -- angular_acceleration (angular, 1:1)
sac = 4       -- thrust_scale_shift (shift, 1:1)

-- Central star
str = 1       -- star_capture_radius (post-scaling comparison, 1:1)

-- Collision (÷4 because these are coordinate-space distances)
me1 = 768     -- collision_radius (3072 ÷ 4)
me2 = 384     -- collision_radius_half (1536 ÷ 4)

-- Hyperspace
mhs = 8       -- max shots (counter, 1:1)
hd1 = 32      -- entry delay (frames, 1:1)
hd2 = 64      -- breakout duration (frames, 1:1)
hd3 = 128     -- recharge time (frames, 1:1)
hr1 = 7       -- displacement scale (shift, ÷4 → minus 2)
hr2 = 2       -- velocity scale (shift, ÷4 → minus 2)
hur = 16384   -- uncertainty increment (probability, 1:1)
```

## Angle System

RUNS uses integer angle units where ±102,944 = ±π. PICO-8 `sin()`/`cos()` use turns: 0–1 = full circle.

```lua
-- Convert RUNS angle to PICO-8 turns
function a2t(a) return a / (102944*2) end

-- Angular acceleration: RUNS adds ±8 per frame.
-- In PICO-8 turns: 8 / 205888 ≈ 0.0000388 turns/frame.
-- Use the raw integer and convert only when calling sin/cos.
```

**Store angles as RUNS integers** (not turns). Only convert at draw time. This preserves the accumulation behavior exactly.

---

## Entity Table

```lua
-- 24 slots. Slots 1-2 = ships. 3-24 = torpedoes/explosions.
-- States: 0=empty, 1=ship, 2=torpedo, 3=exploding, 4=hyp_in, 5=hyp_out
e = {}

function make_ent()
  return {st=0, x=0, y=0, vx=0, vy=0, lt=0,
          av=0, ang=0, fuel=0, torp=0, oref=0,
          pctl=0, hss=0, hrt=0, hua=0}
end
```

**Init values** from [init_state.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/init_state.json) (positions ÷4):

| Field | Ship 1 (Needle) | Ship 2 (Wedge) |
|-------|-----------------|----------------|
| `st` | 1 | 1 |
| `x` | 16384 | -16384 |
| `y` | 16384 | -16384 |
| `ang` | 51472 | 51472 |
| `fuel` | -8192 | -8192 |
| `torp` | -33 | -33 |
| `hss` | -8 | -8 |
| `oref` | 0 (Needle) | 1 (Wedge) |

---

## Outline Data

From [ship_outlines.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/ship_outlines.json). Render algorithm in [outline_format.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/docs/outline_format.md).

```lua
outlines = {
  -- Needle (ot1): octal 111131 111111 111111 111163 311111 146111 111114 700000
  {0x9259,0x9249,0x9249,0x9273,0xC849,0xCC89,0x924C,0x38000},
  -- Wedge (ot2): octal 013113 113111 116313 131111 161151 111633 365114 700000
  {0x164B,0x9289,0x9B4B,0xA849,0xD069,0x939B,0x3D4C,0x38000},
}
```

Each word contains six 3-bit direction codes. Extract from LSB to MSB: `band(shr(word, bit), 7)`. Codes 0–5 = move pen in direction, 6 = save checkpoint, 7 = restore checkpoint. Apply rotation matrix using ship heading. See `outline_format.md` for the direction vector table and full algorithm.

---

## `_update()` Phase Structure

From [game_tick.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/networks/game_tick.runs), lines 50-131:

```lua
function _update()
  -- Read input
  local p1 = read_input(0)
  local p2 = read_input(1)

  -- Phase 1: Entity dispatch (SLOT ORDER: 1 before 2)
  spawns = {}  -- torpedo spawn queue
  for i=1,24 do
    local s=e[i]
    if     s.st==1 then ship_update(i, i==1 and p1 or p2)
    elseif s.st==2 then torp_update(i)
    elseif s.st==3 then expl_tick(i)
    elseif s.st==4 then hyp_transit(i)
    elseif s.st==5 then hyp_break(i)
    end
  end

  -- Phase 2: Process spawns
  process_spawns()

  -- Phase 3: Collision detection
  collision_detect()

  -- Phase 4: Match logic
  check_restart()
  update_scores()

  -- Phase 5: World state
  advance_scroll()
end
```

---

## Critical Algorithms

### Gravity (read [gravity.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/gravity.runs))

The most numerically complex Processor. At ÷4 scale:

```
Original:  xn = position_x >> 11    (because positions are 18-bit scale)
At ÷4:     xn = position_x >> 9     (positions already ÷4, so shift 2 less)

Original:  r_scaled = sqrt(r_sq) >> 9
At ÷4:     r_scaled = sqrt(r_sq) >> 7   (same reasoning)

Original:  divisor = (r_scaled * r_sq) >> 2
At ÷4:     divisor = (r_scaled * r_sq) >> 2   (unchanged — products scale naturally)
```

> [!CAUTION]
> Watch for PICO-8 overflow. `xn * xn` can overflow if `xn > 181`. Positions at ÷4 scale give `xn = 32767 >> 9 = 63`. So `xn * xn = 3969`. Safe.

### Collision (read [collision_detect.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/collision_detect.runs))

Diamond hitbox, pairwise check. At ÷4 scale: `me1 = 768`, `me2 = 384`:

```lua
for i=1,23 do
  if is_collidable(e[i]) then
    for j=i+1,24 do
      if is_collidable(e[j]) then
        local dx = abs(e[i].x - e[j].x)
        if dx < me1 then
          local dy = abs(e[i].y - e[j].y)
          if dy < me1 then
            if dx + dy < me1 + me2 then
              -- COLLISION
              e[i].st, e[j].st = 3, 3
              e[i].lt, e[j].lt = -12, -12
            end
          end
        end
      end
    end
  end
end

function is_collidable(s)
  return s.st==1 or s.st==2 or s.st==5
end
```

### Hyperspace Death Check (read [hyperspace_transit.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_transit.runs))

```lua
-- Death probability increases each use by hur (16384)
-- rnd(65536) replaces (random | 400000₈)
-- If rnd result + hua >= 32768 → die
if rnd(65536) + s.hua >= 32768 then
  s.st = 3  -- exploding
  s.lt = -12
else
  s.st = 5  -- hyperspace_out
  s.lt = -hd2
end
s.hua += hur
```

---

## Star Catalog

469 stars from [star_catalog.json](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/data/star_catalog.json). Pack into PICO-8 `__gfx__` section as 3 bytes per star (1407 bytes total, fits in sprite memory).

```lua
-- In _init(): decode from sprite memory
stars = {}
for i=0,468 do
  local a = i*3
  local xh,xl,yt = peek(a), peek(a+1), peek(a+2)
  add(stars, {x=xh*256+xl, y=band(yt,0xfc), tier=band(yt,3)+1})
end
```

Write a helper script to pack `star_catalog.json` into the hex format for `__gfx__`.

---

## Rendering

```lua
function gx(x) return 64+x/512 end   -- ±32767 → 0-127
function gy(y) return 64-y/512 end   -- flip Y

function _draw()
  cls(0)
  if not sw4 then draw_starfield() end
  if not sw6 then draw_star() end    -- central star (hide with SW6)

  for i=1,24 do
    local s=e[i]
    if s.st==1 then
      draw_outline(gx(s.x),gy(s.y),a2t(s.ang),outlines[s.oref+1], i==1 and 7 or 12)
      if s.thrusting then draw_flame(s) end
    elseif s.st==2 then
      pset(gx(s.x),gy(s.y),10)  -- torpedo: yellow dot
    elseif s.st==3 then
      draw_explosion(s)
    elseif s.st==5 then
      -- hyperspace breakout: draw outline at reduced brightness
      draw_outline(gx(s.x),gy(s.y),a2t(s.ang),outlines[s.oref+1], 5)
    end
  end

  print(sc1.." - "..sc2, 48, 2, 7)  -- scores
end
```

Ship 1: white (color 7). Ship 2: light blue (color 12). Hyperspace breakout: dark gray (color 5).

---

## Sense Switches

From [game_config.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/game_config.runs):

| Var | Switch | Effect | How to Toggle |
|-----|--------|--------|---------------|
| `sw1` | SW1 | Angular damping | Pause menu or `btn(4,1)` long-press |
| `sw2` | SW2 | Heavy star (2× gravity) | — |
| `sw3` | SW3 | Rapid fire (no reload) | — |
| `sw4` | SW4 | No background + no gravity | — |
| `sw5` | SW5 | Star teleport instead of explode | — |
| `sw6` | SW6 | Disable gravity + no star display | — |

Implementation choice: a simple pause-menu toggle screen, or keyboard shortcuts when PICO-8 is run in desktop mode. The sense switches are read from globals each frame; they can be toggled at any time.

---

## Implementation Phases

### Phase 1: Skeleton + Init
- [ ] Entity table structure (24 slots using `make_ent()`)
- [ ] All constants as globals (`tno`, `tvl`, `rlt`, etc.)
- [ ] `match_init()` — see [match_initialize.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/match_initialize.runs)
- [ ] `_init()` → constants + `match_init()`
- [ ] `_update()` with empty phase structure
- [ ] `_draw()` with `cls(0)`, central star `circfill`, score HUD
- [ ] **Test**: Black screen, pulsing center dot, "0 - 0" score

### Phase 2: Ship Movement
- [ ] `read_input(p)` via `btn()` — see [player_controls.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/records/player_controls.runs)
- [ ] `rotation_update(i,ctl)` — see [rotation_update.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/rotation_update.runs)
- [ ] Angle conversion function `a2t()`
- [ ] `gravity(i)` — see [gravity.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/gravity.runs) — with ÷4 shift adjustments
- [ ] `thrust(i,ctl)` — see [thrust.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/thrust.runs)
- [ ] Velocity integration + toroidal wrap
- [ ] `draw_outline()` — see [outline_format.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/docs/outline_format.md)
- [ ] Engine flame particles (when thrusting)
- [ ] **Test**: Two ships fly, gravity pulls toward center, outlines render

### Phase 3: Weapons + Collision
- [ ] `torpedo_launch(i,ctl)` — see [torpedo_launch.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/torpedo_launch.runs)
- [ ] `process_spawns()` — see [process_spawns.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/process_spawns.runs)
- [ ] `torp_update(i)` — see [torpedo_update.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/torpedo_update.runs)
- [ ] `collision_detect()` — see [collision_detect.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/collision_detect.runs)
- [ ] State transition to exploding on hit
- [ ] **Test**: Fire torpedo, 96-frame lifetime, diamond collision, state transitions

### Phase 4: State Machine + Match
- [ ] `expl_tick(i)` — see [explosion_tick.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/explosion_tick.runs)
- [ ] Explosion rendering (scattered random dots)
- [ ] `hyperspace_check(i,ctl)` — see [hyperspace_check.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_check.runs)
- [ ] `hyp_transit(i)` — see [hyperspace_transit.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_transit.runs)
- [ ] `hyp_break(i)` — see [hyperspace_breakout.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/hyperspace_breakout.runs)
- [ ] Uncertainty escalation (death after 4 uses)
- [ ] `check_restart()` — see [check_restart.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/check_restart.runs)
- [ ] `update_scores()` — see [update_scores.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/update_scores.runs)
- [ ] **Test**: Full game loop — fight, die, score, restart

### Phase 5: Starfield + Polish
- [ ] Pack 469 stars into `__gfx__` section
- [ ] Decode stars in `_init()`
- [ ] Starfield rendering with scroll offset
- [ ] `advance_scroll()` — see [advance_starfield_scroll.runs](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/processors/advance_starfield_scroll.runs)
- [ ] Sense switch toggles (pause menu or key combos)
- [ ] Token audit (target: under 7000/8192)
- [ ] **Test**: All verification vectors from [verification_report.md](file:///d:/repos/decentralized-games-standard/runs-spacewar/src/tests/verification_report.md)

---

## Verification Tests

Run after Phase 5 completion. From `verification_report.md`:

| Test | Expected Result |
|------|----------------|
| No input, both ships | Both spiral to center, star capture, explode |
| Torpedo fire | Spawns on heading, 96-frame lifetime, then explodes |
| Collision at (768, 0) | Hit (dx=768 < me1=768 → borderline, check exact) |
| Collision at (769, 0) | Miss |
| Hyperspace ×4 | Certain death on 4th use |
| Scoring: 1 alive | Survivor +1 |
| Scoring: both alive | Both +1 (tie) |
| SW1 on | Rotation stops when button released |
| SW2 on | Ships fall faster |
| SW6 on | No gravity, ships drift |

## Deliverable

One file: **`d:\repos\decentralized-games-standard\runs-spacewar\spacewar.p8`**
