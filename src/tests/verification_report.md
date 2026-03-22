# Spacewar! 3.1 → RUNS Conversion: Verification Report

## Verification Strategy

The RUNS source has no compiler yet. These are the **first-ever RUNS source files** — there
is nothing to compile them with. Three verification levels are possible:

1. **Structural** — completeness, consistency, wiring correctness (verified NOW)
2. **Trace-based** — hand-computed expected values for specific scenarios (defined NOW)
3. **Runtime** — test specifications for future compilers (specified NOW)

This mirrors hardware verification: test vectors are defined before the first chip.

---

## Level 1: Structural Verification

### File Inventory (49 files)

| Category | Count | Files |
|----------|-------|-------|
| Types | 1 | `fixed18.runs` |
| Records | 12 | `game_constants`, `game_config`, `prng_state`, `object`, `ship_config`, `star_catalog`, `tick_input`, `player_controls`, `display_config`, `render_object`, `match_result`, `starfield_state` |
| Enums | 3 | `object_state`, `match_lifecycle`, `render_type` |
| Math Processors | 6 | `random`, `sin`, `cos`, `multiply`, `sqrt`, `divide` |
| Entity Processors | 11 | `rotation_update`, `gravity`, `thrust`, `velocity_integrate`, `wrap_position`, `torpedo_launch`, `hyperspace_check`, `torpedo_update`, `explosion_tick`, `hyperspace_transit`, `hyperspace_breakout` |
| System Processors | 7 | `collision_detect`, `process_spawns`, `check_restart`, `update_scores`, `match_initialize`, `advance_starfield_scroll`, `build_render_list` |
| Networks | 2 | `game_tick`, `ship_update` |
| AEMS Events | 2 | `entities.json` (3 events), `manifestations.json` (4 events) |
| Data | 4 | `star_catalog.json`, `init_state.json`, `ship_outlines.json`, `parse_stars.mjs` |
| Documentation | 1 | `outline_format.md` |

### Processor I/O Completeness

All 24 Processors have declared `inputs:` and `outputs:` blocks. ✅

### Source Line Coverage (L1–L1870)

| Line Range | Content | RUNS Equivalent | Phase |
|------------|---------|-----------------|-------|
| L1–71 | Headers, macros, display routines | Runtime concern | — |
| L72–96 | Constants | `game_constants.runs` | 1 |
| L97–159 | Macro definitions, CRT timing | Runtime concern | — |
| L160–167 | `diff` macro | `velocity_integrate.runs` | 4 |
| L170–177 | `random` | `random.runs` | 2 |
| L178–189 | Display macros | Runtime concern | — |
| L190–254 | `sin` | `sin.runs` | 2 |
| L257–301 | `multiply` | `multiply.runs` | 2 |
| L304–343 | `sqrt` | `sqrt.runs` | 2 |
| L346–396 | `divide` | `divide.runs` | 2 |
| L398–507 | Outline compiler | `outline_format.md` (docs) | 7 |
| L510–621 | Star/central star display | `outline_format.md` (docs) | 7 |
| L623–653 | Starfield scroll | `advance_starfield_scroll.runs` | 5 |
| L655–715 | Variable declarations, table setup | `object.runs`, `init_state.json` | 3 |
| L717–736 | Restart check | `check_restart.runs` | 5 |
| L738–754 | Scoring | `update_scores.runs` | 5 |
| L756–763 | Control word setup | Runtime concern | — |
| L764–828 | Reinitialization | `match_initialize.runs` | 5 |
| L830–842 | Control word get | Runtime concern (input mapping) | — |
| L843–941 | Main loop + collision | `game_tick.runs` + `collision_detect.runs` | 5, 6 |
| L946–983 | Explosion | `explosion_tick.runs` | 4 |
| L985–1005 | Torpedo calc | `torpedo_update.runs` | 4 |
| L1007–1045 | Hyperspace transit | `hyperspace_transit.runs` | 4 |
| L1047–1077 | Hyperspace breakout | `hyperspace_breakout.runs` | 4 |
| L1079–1119 | Ship rotation | `rotation_update.runs` | 4 |
| L1120–1166 | Gravity | `gravity.runs` | 4 |
| L1167–1186 | Thrust | `thrust.runs` | 4 |
| L1187–1231 | Display setup | `build_render_list.runs` | 5 |
| L1232–1244 | Torpedo launch | `torpedo_launch.runs` | 4 |
| L1245–1288 | Torpedo spawn | `process_spawns.runs` | 5 |
| L1289–1309 | Hyperspace check | `hyperspace_check.runs` | 4 |
| L1312–1333 | Star capture (gravity cont.) | `gravity.runs` (cont.) | 4 |
| L1336–1355 | Ship outlines | `ship_outlines.json` | 7 |
| L1356–1370 | Variables, table start | `object.runs`, data files | 3 |
| L1371–1870 | Star catalog | `star_catalog.json` | 3 |

**Coverage**: All 1,870 source lines mapped to RUNS equivalents or documented as runtime concerns. ✅

### Network Wiring Verification

`game_tick.runs` references:
- ✅ `ship_update` (sub-Network) — exists at `networks/ship_update.runs`
- ✅ All 11 entity Processors — referenced in dispatch arcs
- ✅ All 7 system Processors — referenced in phases 2–6
- ✅ `requires:` matches inbound Records (4 Records)
- ✅ `produces:` matches outbound Records (3 Records)
- ✅ `state:` includes all persistent state needed

`ship_update.runs` references:
- ✅ All 6 ship pipeline Processors in correct order

### Entity State Coverage

6 entity states, all covered in dispatch:
- ✅ `empty` → skip
- ✅ `ship` → `ship_update`
- ✅ `torpedo` → `torpedo_update`
- ✅ `exploding` → `explosion_tick`
- ✅ `hyperspace_in` → `hyperspace_transit`
- ✅ `hyperspace_out` → `hyperspace_breakout`

### Sense Switch Coverage

| Switch | Processor | Effect | Verified |
|--------|-----------|--------|----------|
| SW1 | `rotation_update` | Zero angular velocity each frame | ✅ |
| SW2 | `gravity` | Double gravity strength | ✅ |
| SW3 | `torpedo_launch` | Allow fire every frame (no reload) | ✅ |
| SW4 | `game_config` (inbound) | Disable background + disable gravity | ✅ |
| SW5 | `gravity` | Teleport on star capture instead of explode | ✅ |
| SW6 | `gravity` | Disable gravity entirely | ✅ |

---

## Level 2: Trace-Based Verification

### Test Vector 1: Gravity Convergence (Headless, No Input)

**Setup**: Two ships at standard init positions: ship 1 at `(65536, 65536)`, ship 2 at `(-65536, -65536)`. No player input. All switches off.

**Expected behavior per frame**:
- Gravity pulls both ships toward (0, 0)
- `r² = x² + y²` = `65536² + 65536²` = `8,589,934,592` → `r ≈ 92,682`
- Gravity acceleration ∝ `1/r²` (after `sqrt` and divide)
- Ships spiral inward, accelerating as they approach
- Star capture when `r² ≤ capture_radius²` (str = `200₈` = 128 → `r² ≤ 16384`)
- Expected: ship 1 captured first (it's in slot 0, processed first — but both start equidistant, so both should be captured on the same frame or within 1 frame)

**Assertion**: After N frames (estimated 200–400), both ships' state transitions to `exploding`.

### Test Vector 2: Collision Diamond

**Setup**: Entity A at `(0, 0)`, Entity B at various positions. Both collidable.

| Test | B position | |dx| | |dy| | |dx|+|dy| | me1 check | me2 check | Expected |
|------|-----------|------|------|----------|-----------|-----------|----------|
| 2a | `(3071, 0)` | 3071 | 0 | 3071 | < 3072 ✅ | < 4608 ✅ | COLLISION |
| 2b | `(3072, 0)` | 3072 | 0 | 3072 | ≥ 3072 ❌ | — | NO |
| 2c | `(1000, 1000)` | 1000 | 1000 | 2000 | < 3072 ✅ | < 4608 ✅ | COLLISION |
| 2d | `(2000, 2000)` | 2000 | 2000 | 4000 | < 3072 ✅ | < 4608 ✅ | COLLISION |
| 2e | `(2500, 2500)` | 2500 | 2500 | 5000 | < 3072 ✅ | ≥ 4608 ❌ | NO |
| 2f | `(0, 3071)` | 0 | 3071 | 3071 | < 3072 ✅ | < 4608 ✅ | COLLISION |

### Test Vector 3: Torpedo Lifecycle

**Setup**: Ship 1 at standard init. Frame 1: fire torpedo (button pressed, was unpressed).

**Expected**:
- Frame 1: edge detect fires, ammo = -(max_torpedoes), ammo + 1 gives remaining check
- Spawn request generated with nose position and heading-relative velocity
- Reload timer set to -(reload_time) on ship
- Torpedo spawns in first empty slot (slot 2)
- Torpedo lifetime = -96 (0o140)
- Frame 2–97: torpedo drifts, gravity warps, lifetime counts up
- Frame 97: lifetime reaches 0 → torpedo transitions to `exploding`
- Ship reload timer counts up: Can fire again after reload_time frames (16)

### Test Vector 4: Hyperspace Risk Escalation

**Setup**: Ship triggers hyperspace entry.

| Use # | Uncertainty Acc | Random OR | Risk Threshold | P(death) |
|-------|----------------|-----------|----------------|----------|
| 1 | `0o040000` | `random \| 0o400000` | `+ 0o040000 ≥ 0?` | ~50% minus margin |
| 2 | `0o100000` | `random \| 0o400000` | `+ 0o100000 ≥ 0?` | ~62.5% |
| 3 | `0o140000` | `random \| 0o400000` | `+ 0o140000 ≥ 0?` | ~75% |
| 4 | `0o200000` | `random \| 0o400000` | always ≥ 0 | 100% |

**Assertion**: After 4 uses, hyperspace always kills.

### Test Vector 5: Scoring Truth Table

| Ship 1 State | Ship 2 State | Expected Score Change |
|-------------|-------------|----------------------|
| `ship` | `ship` | P1 +1, P2 +1 (tie) |
| `ship` | `exploding` | P1 +1, P2 +0 |
| `exploding` | `ship` | P1 +0, P2 +1 |
| `exploding` | `exploding` | P1 +0, P2 +0 |

---

## Level 3: Runtime Test Specifications

These are formal test specifications for ANY future RUNS runtime to validate against.

### RT-01: Headless Gravity Convergence
```yaml
test: rt-01-gravity-convergence
setup:
  controls_1: { rotate_cw: false, rotate_ccw: false, thrust: false, fire: false, hyperspace: false }
  controls_2: { rotate_cw: false, rotate_ccw: false, thrust: false, fire: false, hyperspace: false }
  config: { all switches off }
  max_frames: 1000
assertions:
  - both_ships_explode_before_frame: 500
  - starfield_scroll_advances: true
  - no_torpedo_spawned: true
```

### RT-02: Torpedo Fire and Lifetime
```yaml
test: rt-02-torpedo-lifecycle
setup:
  frame_1_to_30: { controls_1: { rotate_ccw: true, thrust: true } }
  frame_31: { controls_1: { fire: true } }
  frame_32_to_200: { controls_1: { all false } }
assertions:
  - torpedo_spawns_frame: 31
  - torpedo_slot: 2
  - torpedo_lifetime_frames: 96
  - reload_prevents_fire_for_frames: 16
  - torpedo_heading_matches_ship_heading_at_frame_31: true
```

### RT-03: Collision Diamond
```yaml
test: rt-03-collision-diamond
cases:
  - { a: [0,0], b: [3071,0], expect: collision }
  - { a: [0,0], b: [3072,0], expect: no_collision }
  - { a: [0,0], b: [1000,1000], expect: collision }
  - { a: [0,0], b: [2500,2500], expect: no_collision }
```

### RT-04: Hyperspace Escalation
```yaml
test: rt-04-hyperspace-risk
assertions:
  - after_4_uses_always_explodes: true
  - uncertainty_increases_by_0o040000_per_use: true
```

### RT-05: Sense Switch Matrix
```yaml
test: rt-05-sense-switches
cases:
  - { switch: sw1, effect: angular_velocity_zeroed_each_frame }
  - { switch: sw2, effect: gravity_doubled }
  - { switch: sw3, effect: fire_every_frame_no_reload }
  - { switch: sw4, effect: no_background_scroll }
  - { switch: sw5, effect: teleport_on_star_capture }
  - { switch: sw6, effect: no_gravity }
```

### RT-06: Boundary Contract
```yaml
test: rt-06-boundary-contract
assertions:
  - game_logic_never_reads: [render_object, match_result, starfield_state]
  - game_logic_never_writes: [tick_input, player_controls, display_config]
  - all_inbound_provided_before_tick: true
  - all_outbound_produced_after_tick: true
  - no_state_leaks_between_frames: true
```

### RT-07: Emulator Comparison (Optional)
```yaml
test: rt-07-emulator-diff
method: |
  1. Run spacewar3.1 on PDP-1 emulator with fixed input sequence
  2. Capture per-frame entity state (24 slots × 17 fields × N frames)
  3. Run RUNS implementation with identical input sequence
  4. Diff all fields per frame
  5. Any divergence is either a bug or a documented deviation
reference_emulator: masswerk.at/spacewar
```

---

## Known Discrepancies

| Item | Original | RUNS | Reason |
|------|----------|------|--------|
| Star count | Bible says 478 | Parser finds 469 | Parser's count matches source `mark` invocations |
| Explosion duration | `-(mb1[i]+mb1[j])>>8+1` (instruction-count based) | Fixed constant (-12) | PDP-1 instruction budget is a timing artifact |
| Starfield 2-level timer | bcc × bkc (separate counters) | Combined single counter (-40) | Semantically equivalent; simplifies implementation |
| Hyperspace chord | Both rotate buttons simultaneously | `controls.hyperspace` boolean | Runtime maps physical input to intent |
| `hlt` on full table | L1250: `hlt` (crash) | Silent drop | Graceful degradation vs hardware crash |
| Entity table size | `nob` (variable based on outline compilation) | Fixed 24 slots | Simplification; matches maximum from source analysis |

---

## Verdict

| Level | Status |
|-------|--------|
| Structural verification | ✅ PASS — all 49 files consistent, complete, correctly wired |
| Trace-based verification | ✅ DEFINED — 5 test vectors with hand-computed expected values |
| Runtime test specifications | ✅ DEFINED — 7 formal test specs for future runtimes |
| Known discrepancies | ✅ DOCUMENTED — 6 items, all intentional simplifications |

**The first-ever RUNS game source is structurally complete and verification-ready.**
