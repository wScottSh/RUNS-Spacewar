# Part 4: Conversion Phases

## How to Read This Document

This file defines 8 sequential phases for converting Spacewar! 3.1 into a fully RUNS-compliant game. Each phase specifies:

- **Dependencies**: what must exist before this phase starts
- **Source lines consumed**: which lines from `01_source_concordance.md` this phase implements
- **Outputs**: what this phase produces (file artifacts, Record schemas, Processor definitions)
- **Step-by-step work items**: numbered, specific, executable by any agent
- **Edge cases**: non-obvious behaviors that must NOT be skipped
- **Acceptance criteria**: how to verify the phase is correct

Phases are strictly ordered — each phase's inputs are produced by prior phases. An agent can pick up at any phase boundary.

---

## Phase 1: Type System & Constants

### Dependencies
- Access to `source/spacewar3.1_complete.txt`
- Access to `conversion/01_source_concordance.md` (Game Constants Table, Sense Switch Concordance)
- Access to `conversion/02_record_definitions.md` (§ Custom Type: `spacewar:fixed18`)

### Source Lines Consumed
- L72–96 (game constants `tno` through `ran`)
- Sense switch references: L523, L630, L1101, L1122, L1150, L1236, L1319

### Outputs
- `spacewar:fixed18` type specification document
- `spacewar:game_constants` Record schema (populated with values)
- `spacewar:game_config` Record schema (6 booleans + game_count)
- `spacewar:prng_state` definition (initial value: 0, from `ran` at L96)

### Work Items

1. **Define `spacewar:fixed18`** per `02_record_definitions.md` § Custom Type. Create either a formal spec document or inline type definition. Must include:
   - 18-bit ones-complement representation
   - The negative-zero rules table (7 operations: `cma`, `sma`, `spa`, `add`, `sub`, `mpy`/`dvd`, `sza`)
   - The binary point convention table (8 contexts: sin arg, sin result, position, velocity, angle, angular velocity, sqrt input, sqrt output)
   - The `ddd` sentinel note (L87: `-0` used at L808–809)

2. **Populate `spacewar:game_constants`** with all 17 values from the Game Constants Table in `01_source_concordance.md`. For each:
   - Extract the source value (octal/instruction)
   - Compute the decimal equivalent
   - Assign the RUNS Field name
   - Document the encoding: `law i N` means the runtime value is `-N` (ones-complement negative used as countdown initial). The game logic counts UP toward 0 via `isp`/`count`.

3. **Populate `spacewar:game_config`** with all 6 sense switch booleans + `game_count`:
   - Map each `szs` instruction to its boolean (note: `szs 10` = skip if switch 1 is set; `szs i 20` = skip if switch 2 is NOT set — inverted sense!)
   - Document `game_count` derivation: `lat` instruction (L786–787), bits 6–11 extracted by `rar 6s; and (37` (L787–788), complemented if non-zero (L790)

4. **Define PRNG state**: initial value `0` (L96: `ran, 31, 0`). The PRNG algorithm is Phase 2, but the state definition belongs here.

### Edge Cases

- **`law i N` encoding**: The PDP-1 `law i` instruction loads the ones-complement negative of N. `law i 41` = `-33₁₀` in ones-complement. The game uses these as countdown timers via `isp` (increment and skip if positive). The initial fuel `-20000₈` = `-8192₁₀` is NOT a `law i` — it's a direct constant.
- **Shift-encoded constants**: `tvl = sar 4s`, `sac = sar 4s`, `the = sar 9s`, `hr1 = scl 9s`, `hr2 = scl 4s`. These are stored as executable instructions that are `xct`-ed (executed) inline. In RUNS, store the *shift count* as an integer Field and apply the shift in Processor logic.
- **Switch inversion**: `szs A` = "skip if switch set." `szs i A` = "skip if switch NOT set." When `SW6` (`szs 60`) is set at L523, the jump to `blx` IS taken (skipping the star), meaning gravity IS disabled. The boolean sense must match: `disable_gravity: true` ↔ SW6 set.

### Acceptance Criteria

- [ ] All 17 constants from L72–96 are present in `spacewar:game_constants` with correct decimal values
- [ ] All 6 sense switches are mapped with correct boolean polarity
- [ ] Negative-zero rules match the table in `02_record_definitions.md`
- [ ] `game_count` derivation is documented with bit extraction logic
- [ ] No constant is stored as a PDP-1 instruction — all are converted to numeric values or shift counts

---

## Phase 2: Math Primitives

### Dependencies
- Phase 1 outputs (type system, constants)

### Source Lines Consumed
- L170–177 (`random` PRNG)
- L190–254 (`sin`, `cos` — Adams Associates subroutine)
- L257–301 (`mpy`, `imp` — BBN multiply)
- L304–343 (`sqt` — integer square root)
- L346–396 (`dvd`, `idv` — BBN divide)

### Outputs
- `spacewar:random` Processor definition
- `spacewar:sin` Processor definition
- `spacewar:cos` Processor definition
- `spacewar:multiply` Processor definition
- `spacewar:sqrt` Processor definition
- `spacewar:divide` Processor definition

### Work Items

1. **Implement `spacewar:random` (L170–177)**: Transform PRNG state → next state.
   - Algorithm: `ran = (ran >>> 1) XOR 355670₈ + 355670₈`
   - Where `>>>` is rotate-right-1 (`rar 1s`), not arithmetic shift
   - Input: current `ran` value. Output: updated `ran` value.
   - The `ranct` macro (L179–187) wraps this with scaling and absolute-value — inline into calling Processors, not a separate Processor.

2. **Implement `spacewar:sin` and `spacewar:cos` (L190–254)**: Polynomial sine approximation.
   - Cos entry (L200): adds `62210₈` (π/2) to argument, falls through to sin.
   - Argument normalization (L210–254): reduces to first quadrant via ±π adjustments.
   - Core polynomial (L217–230): 4th-degree Chebyshev approximation with coefficients `242763₈`, `756103₈`, `121312₈`, `532511₈`, `144417₈`.
   - Sign correction (L231–238): if result should be negative, negate. Clamp magnitude to `377777₈` (max positive).
   - Return both sin and cos (stored in `sin` and `cos` memory locations).
   - **Critical**: argument binary point is right of bit 3. Result binary point is right of bit 0. These differ.

3. **Implement `spacewar:multiply` (L257–301)**: 18×18 → 34-bit ones-complement multiply.
   - Handles sign separately: if either operand negative, complement it; track sign.
   - Core: `repeat 21, mus mp2` — 21 multiply-step instructions.
   - Returns high word in AC, low word in IO (34-bit product with 2 sign bits).
   - The `imp` (L260–269) variant returns only the low 17 bits + sign.

4. **Implement `spacewar:sqrt` (L304–343)**: Integer square root.
   - Iterative algorithm (23 steps per L311: `law i 23`).
   - Input: binary point right of bit 17. Output: binary point between bits 8 and 9.
   - Must handle input = 0 correctly (output = 0).

5. **Implement `spacewar:divide` (L346–396)**: Integer divide with remainder.
   - `dvd`: full divide with AC=high-dividend, IO=low-dividend.
   - `idv`: integer divide shortcut (L351–357) — extends AC into AC+IO.
   - Handles sign: complement operands if negative, correct result sign at end.
   - Returns quotient in AC, remainder in IO.

### Edge Cases

- **Multiply sign handling**: The BBN multiply routine treats ones-complement negatives via explicit `cma` before and after. The RUNS Processor must replicate this exactly — twos-complement multiplication is NOT equivalent for edge values near −0.
- **Sin/cos max clamp**: L234 clamps the result to `377777₈` (max positive 18-bit value). This prevents overflow when the polynomial produces values slightly above 1.0 due to approximation error.
- **Divide by zero**: The PDP-1 `dis` instruction produces undefined results for zero divisor. The source never divides by zero (gravity computation skips when distance ≤ capture radius at L1141–1142). The Processor should either match PDP-1 behavior or document the precondition.
- **Square root of zero**: The iterative loop handles this (output = 0), but verify the 23-step unrolling terminates correctly.

### Acceptance Criteria

- [ ] `random` produces identical sequence starting from `ran=0`: step 1 should produce `355670₈ + (0 XOR 355670₈)` — verify against known PDP-1 PRNG outputs
- [ ] `sin(0)` = 0, `sin(62210₈)` = `377777₈` (≈1.0), `cos(0)` = `377777₈`
- [ ] `multiply(2, 3)` = 6 with correct sign handling
- [ ] `sqrt(177777₈)` produces expected result per bit-position convention
- [ ] All operations handle −0 inputs per `spacewar:fixed18` spec

---

## Phase 3: Core Records

### Dependencies
- Phase 1 outputs (type system)
- `02_record_definitions.md` (all Record definitions)

### Source Lines Consumed
- L665–715 (entity table parallel arrays → `spacewar:object` Record)
- L1371–1870 (star catalog → `spacewar:star_catalog`)
- L651–653 (background state → `spacewar:starfield_state`)
- L1336–1355 (outlines → `spacewar:ship_config`)

### Outputs
- All 8 Record schemas as formal RUNS Record definitions:
  - Internal: `spacewar:object`, `spacewar:game_constants`, `spacewar:ship_config`, `spacewar:star_catalog` + `spacewar:star_entry`
  - Inbound: `spacewar:tick_input`, `spacewar:player_controls`, `spacewar:display_config`, `spacewar:game_config`
  - Outbound: `spacewar:render_object`, `spacewar:match_result`, `spacewar:starfield_state`
- Controls type: `spacewar:player_controls` (5 booleans)
- State enums: `spacewar:object_state`, `spacewar:match_lifecycle`, `spacewar:render_type`

### Work Items

1. **Define `spacewar:object` Record** per `02_record_definitions.md`. Verify all 17 Fields are present, types are correct, and source line derivations are documented.

2. **Define all enums**:
   - `spacewar:object_state`: `empty`, `ship`, `torpedo`, `exploding`, `hyperspace_in`, `hyperspace_out`
   - `spacewar:match_lifecycle`: `playing`, `round_over`, `match_over`, `restart_countdown`
   - `spacewar:render_type`: `ship`, `torpedo`, `explosion`, `star`, `central_star`

3. **Parse and encode star catalog** (L1385–1866): Extract all 478 stars from the `mark X, Y` macro invocations.
   - For each star: compute `x = 8192 - X_arg`, `y = Y_arg` (before ×256 scaling — the ×256 is display format)
   - Extract brightness tier from section: `1j`=1, `2j`=2, `3j`=3, `4j`=4
   - Extract designation from inline comment (e.g., `/87 Taur, Aldebaran`)
   - Output as structured `spacewar:star_entry[]`

4. **Define boundary Records**: Create all 4 inbound + 3 outbound per `02_record_definitions.md`.

5. **Define initialization state**: For each Record, document the initial values set during the reinitialization sequence (L792–828):
   - Ship 1: position `(200000₈, 200000₈)`, angle `144420₈`, `state = ship`, fuel `= foo`, torpedoes `= tno`, hyperspace shots `= mhs`
   - Ship 2: position `(complement(200000₈), complement(200000₈))`, same other values
   - All other slots: `state = empty`
   - Starfield: `scroll_offset = 10000₈`, `scroll_counter = 0`
   - Match: `score_1 = 0`, `score_2 = 0`, `rounds_remaining` from `game_config.game_count`

### Edge Cases

- **Parallel array width**: Arrays `mtb` through `ndy` (L666–684) are `nob`-wide (24 slots). Arrays `nom` through `nh4` (L686–714) are 2-wide (ship 1 and 2 only). Torpedoes and explosions do NOT have angle, fuel, torpedoes, outline, controls, or hyperspace fields — these are undefined memory in the original. The RUNS Record has all fields for all 24 slots, but only ship slots (0–1) use the 2-wide fields meaningfully.
- **Instruction budget field (`nb1`)**: NOT converted. This is a PDP-1 timing mechanism (`nb1[i]` = number of instructions the calc routine takes, added to `\mtc` frame budget). RUNS uses fixed timestep instead. However, the value IS read at L892–893 during collision to compute explosion duration (`mb1 + mb2`). Preserve it as an internal-only field or compute explosion duration differently.
- **Fuel counting direction**: `foo = -20000₈`. The game uses `count i \mfu, label` which executes `isp \mfu[i]` (increment and skip if positive). Fuel starts negative and counts UP toward 0. When it reaches 0, fuel is exhausted. The RUNS implementation can either preserve ones-complement counting or use a positive counter that decrements — but the behavior must be identical.
- **Torpedo count direction**: Same pattern. `tno = law i 41` = `-33₁₀`. Torpedoes count up toward 0. `count i \mtr, st1` (L1242) increments and skips if positive — meaning "still have torpedoes." When `\mtr` reaches 0 (or +), torpedoes are exhausted.
- **`dzm i \mtr` / `dzm i ma1` count-around prevention**: After a `count` macro fires (path taken = counter just became positive), the code immediately zeroes the counter to prevent it from continuing to count into positive territory. This appears at L1233, L1243, L1290, L1057. The RUNS implementation must replicate this clamping.

### Acceptance Criteria

- [ ] All 17 Fields of `spacewar:object` match `02_record_definitions.md` exactly
- [ ] Star catalog contains exactly 478 entries across 4 tiers (9+10+82+377)
- [ ] Initialization values for both ships match L792–828 exactly
- [ ] All boundary Records match `02_record_definitions.md` runtime interface declaration
- [ ] Enums match state machine table in `01_source_concordance.md`

---

## Phase 4: Entity Processors

### Dependencies
- Phase 1 (types + constants), Phase 2 (math primitives), Phase 3 (Records)

### Source Lines Consumed
- L946–983 (`mex` — explosion tick)
- L985–1005 (`tcr` — torpedo update)
- L1007–1045 (`hp1` — hyperspace transit)
- L1047–1077 (`hp3` — hyperspace breakout)
- L1079–1090 (`ss1`/`ss2` — ship entry)
- L1091–1117 (rotation update)
- L1112–1119 (angle normalization + sin/cos)
- L1120–1166 (gravity computation)
- L1167–1186 (thrust)
- L1187–1216 (display preparation — partial, for flame_length)
- L1217–1231 (exhaust rendering — flame_length extraction only)
- L1232–1244 (torpedo launch check)
- L1289–1309 (hyperspace entry check)
- L1312–1333 (star capture handling)

### Outputs
- `spacewar:rotation_update` Processor
- `spacewar:gravity` Processor (includes star capture)
- `spacewar:thrust` Processor
- `spacewar:velocity_integrate` Processor
- `spacewar:wrap_position` Processor
- `spacewar:torpedo_launch` Processor (intent only — actual spawn is Phase 5)
- `spacewar:hyperspace_check` Processor
- `spacewar:torpedo_update` Processor
- `spacewar:explosion_tick` Processor
- `spacewar:hyperspace_transit` Processor
- `spacewar:hyperspace_breakout` Processor

### Work Items

1. **`spacewar:rotation_update`** (L1091–1117):
   - Input: `player_controls`, `object.angular_velocity`, `object.angle`, `object.fuel`, `game_config.angular_damping`, `game_constants.angular_acceleration`
   - Logic: if `rotate_ccw` → add `maa` to angular velocity. If `rotate_cw` → subtract `maa`. If BOTH → hyperspace intent (handled by `hyperspace_check`, not here).
   - SW1 check: if `angular_damping` → zero angular velocity after updating.
   - Fuel check: if `fuel >= 0` (exhausted) → clear thrust flag (prevents thrust, not rotation).
   - Add angular velocity to angle. Normalize angle: if > `311040₈` (π), subtract `311040₈`. If < -`311040₈` (-π), add `311040₈`.
   - Compute sin and cos of new angle (calls `spacewar:sin`).
   - Output: updated `angular_velocity`, `angle`, `sin_cache`, `cos_cache`, `thrust_enabled` flag.

2. **`spacewar:gravity`** (L1120–1166 + L1312–1333):
   - Input: `object.position_x/y`, `game_config.disable_gravity`, `game_config.heavy_star`, `game_config.star_teleport`, `game_constants.star_capture_radius`
   - Logic: if `disable_gravity` → zero gravity accumulators, skip.
   - Compute r²: `(x >> 11)² + (y >> 11)²`. Subtract `star_capture_radius`.
   - If r² ≤ 0: **star capture**.
     - If `star_teleport`: zero velocity, teleport to `(377777₈, 377777₈)`, return.
     - Else: zero velocity, set `state = exploding`, set explosion duration, return.
   - Compute gravity magnitude: `1 / (sqrt(r²) × r² / 4)`.
   - If `heavy_star`: apply extra `>> 2` to divisor (doubles gravity).
   - Compute gravity vector: `gravity_x = -x / divisor`, `gravity_y = -y / divisor`.
   - Output: `gravity_x`, `gravity_y`, or state transition to `exploding`/teleport.

3. **`spacewar:thrust`** (L1167–1186):
   - Input: `thrust_enabled`, `sin_cache`, `cos_cache`, `object.velocity_x/y`, `gravity_x/y`, `game_constants.thrust_scale_shift`
   - Logic: if NOT thrust_enabled → apply only gravity to velocity.
   - Else: thrust component = `cos × thrust_scale` added to `gravity_y`, `−sin × thrust_scale` added to `gravity_x`.
   - Apply combined gravity+thrust to velocity via integration: `velocity_x += gravity_x >> 3`, `velocity_y += gravity_y >> 3`. (The `sar 3s` in the `diff` macro at L1178/L1186 is the velocity damping factor.)
   - Decrement fuel (via `count i \mfu` at L1225 — actually this is in the exhaust section).
   - Output: updated `velocity_x`, `velocity_y`, `fuel`.

4. **`spacewar:velocity_integrate`** (from `diff` macro, L160–167, used at L1178/L1186):
   - This is the core integration step hidden in the `diff` macro.
   - `diff V,S,SF` means: `V += AC; AC = xct SF; S += AC`. In context: add scaled acceleration to velocity, then add scaled velocity to position.
   - In RUNS: `position += velocity; velocity += acceleration * damping`.
   - **The `sar 3s` is NOT general damping** — it's specific to each `diff` call. Gravity uses `sar 3s` (L1178, L1186), torpedo gravity uses `sar 3s` as well (L1000, L1003). These are integration scale factors.

5. **`spacewar:wrap_position`** (implicit in PDP-1):
   - The PDP-1's 18-bit ones-complement word size provides toroidal wrapping for free — a position at 131071 (`377777₈`) overflows to -131071 (`400000₈`) automatically. The 10-bit display registers use only the top 10 bits of this 18-bit position; the lower 8 bits are sub-pixel precision. In RUNS, this wrapping is implicit in the `spacewar:fixed18` type; the explicit Processor documents the toroidal topology in the network graph.
   - Input: `position_x/y`.
   - Logic: identity pass-through. The `spacewar:fixed18` type (18-bit, ones-complement, range ±131071) enforces wrapping through its arithmetic rules. All upstream operations produce already-wrapped results.
   - Output: `position_x`, `position_y` (unchanged).

6. **`spacewar:torpedo_launch`** (L1232–1244):
   - Input: `player_controls.fire`, `object.prev_controls`, `object.lifetime` (reload timer), `object.torpedoes`, `game_config.rapid_fire`
   - Logic: check reload timer (`lifetime` field re-used). If timer > 0, skip (unless `rapid_fire`).
   - Edge detect: XOR current with prev controls, test fire bit (L1238–1240: `ral 3s; sma`). Fire only on PRESS, not hold.
   - SW3 rapid fire: if `rapid_fire`, complement the AND mask (L1236: `szs i 30; clc`) — effectively skipping the "not reloaded" check by inverting it.
   - Check torpedo count: if exhausted (`\mtr >= 0`), skip.
   - Output: `spawn_request` (torpedo spawn parameters: position from ship nose, velocity from heading × `tvl` + ship velocity) — actual spawn handled by Phase 5's `process_spawns`.
   - Set reload timer from `rlt`.
   - **Edge case**: `dzm i \mtr` at L1243 prevents count-around. After torpedoes hit 0, zero the counter to prevent further incrementing.

7. **`spacewar:hyperspace_check`** (L1289–1309):
   - Input: `player_controls`, `object.prev_controls`, `object.hyperspace_recharge_timer`, `object.hyperspace_shots_remaining`
   - Logic: if recharge timer > 0 → skip (cooling down). Check `count i \mh3` at L1289.
   - If shots remaining = 0 → skip.
   - Detect chord: `(current XOR prev) AND 600000₈` — both rotate bits changed simultaneously (L1294–1298).
   - On entry: save current state in `hyperspace_saved_state`, set `state = hyperspace_in`, `collidable = false`, set timer from `hd1`, set instruction budget to 3 (timing artifact — not converted, but note it).
   - **Edge case**: `dzm i \mh3` at L1290 — count-around prevention on recharge timer.

8. **`spacewar:torpedo_update`** (L985–1005):
   - Input: `object.lifetime`, `object.position_x/y`, `object.velocity_x/y`, `game_constants.torpedo_gravity_warpage_shift`
   - Logic: count down lifetime. On timeout: set `state = exploding`, `collidable = false`, set explosion duration to 2 (L991–992: `law i 2`).
   - During life: apply gravity warpage to velocity — `velocity_y += (position_x >> 9 >> torpedo_gravity_warpage_shift) >> 3`, similarlly for x. (Uses same `diff` macro + `the` constant.)
   - **Note**: torpedo gravity warpage uses position-dependent acceleration, NOT central-star-distance gravity. The formula at L997–1003 is: `dx += (x >> 9) × the >> 3`, `dy += (y >> 9) × the >> 3`. This is a first-order approximation of gravity — simpler than the ship's full `sqrt`-based gravity.
   - Output: updated position/velocity, or state transition.

9. **`spacewar:explosion_tick`** (L946–983):
   - Input: `object.lifetime`, `object.position_x/y`, `object.velocity_x/y`
   - Logic: decelerate: `velocity_x -= velocity_x >> 3`, `velocity_y -= velocity_y >> 3` (damping via `diff`).
   - Generate particle scatter: for each frame, use PRNG to generate random particle offsets (L964–976). The number of particles is determined by the scaling loop at L961 (`sub (140)`). Particles are NOT game entities — they're visual effect data.
   - Count down lifetime. When exhausted: zero the entity slot (`state = empty`).
   - Output: updated state (explosion progressing or clearing), plus render data (`particle_seed` and `particle_count` for `render_object`).

10. **`spacewar:hyperspace_transit`** (L1007–1045):
    - Input: `object.lifetime`, `object.position_x/y`, `object.velocity_x/y`, `object.angle`, PRNG state, `game_constants.hyperspace_displacement_scale`, `game_constants.hyperspace_velocity_scale`, `game_constants.hyperspace_breakout_duration`
    - Logic: count down timer (from `hd1` = 32). On timeout:
      - Set `state = hyperspace_out` (calc `= hp3`).
      - Apply random displacement: two PRNG calls, scale by `hr1` (×512), add to position.
      - Apply random velocity: two PRNG calls, scale by `hr2` (×16), set as new velocity.
      - Normalize angle to ±π (L1036–1041): add `311040₈` if negative, subtract if > `311040₈`, repeat 3 times (L1033: `setup \hpt,3`).
      - Randomize angle: set angle to current PRNG value (L1034–1035).
      - Set breakout timer from `hd2` (64 frames).
    - During transit: ship is invisible and non-collidable. No rendering.
    - Output: updated position, velocity, angle, state transition.

11. **`spacewar:hyperspace_breakout`** (L1047–1077):
    - Input: `object.lifetime`, `object.hyperspace_saved_state`, `object.hyperspace_shots_remaining`, `object.hyperspace_recharge_timer`, `object.hyperspace_uncertainty_acc`, PRNG state, `game_constants.hyperspace_recharge_time`, `game_constants.hyperspace_uncertainty`
    - Logic: count down breakout timer (from `hd2` = 64). On timeout:
      - Restore state from `hyperspace_saved_state` (`\mh1` → `ml1`).
      - Set instruction budget to 2000 (timing artifact — not converted).
    - Hyperspace shots decrement: `count i \mh2, hp7` (L1056). If `\mh2` reaches 0, zero it (`dzm i \mh2` L1057).
    - Start recharge: `hd3 → \mh3` (L1059–1060).
    - Accumulate uncertainty: `\mh4 += hur` (L1061–1063). Each use makes the next more dangerous.
    - **Random death check** (L1064–1068): `random | 400000₈ + \mh4`. If result ≥ 0 (`spa`), the ship EXPLODES instead of returning. The `| 400000₈` sets the sign bit of the random number, biasing toward negative — combined with the accumulated uncertainty, this creates escalating risk.
    - On random death: set `state = exploding`, `collidable = false`, short explosion (L1071–1072: `law i 10` = 8 frames, budget 2000).
    - During breakout: ship IS rendered (L1075–1076: `dispt` at intensity 2). It's collidable (no `400000₈` on `hp3`).
    - Output: updated state, hyperspace counters, or explosion transition.

### Edge Cases (Cross-Cutting)

- **Hyperspace collidability**: `hp1 400000` = non-collidable (transit). `hp3` (no `400000`) = collidable (breakout). A ship in breakout CAN be hit by torpedoes.
- **Torpedo launch position**: from ship NOSE (`\stx`, `\sty` at L1260/1264), NOT ship center. Ship nose is computed from position + 2× sin/cos offset (L1193–1199).
- **Torpedo velocity**: heading × `tvl` PLUS inherited ship velocity (L1277: `add i \mdx`, L1281: `add i \mdy`). Torpedoes inherit momentum.
- **Instruction budget**: The original tracks instruction count per entity (nb1) for frame-timing purposes. This is a PDP-1 artifact. Do NOT convert it. The explosion duration calculation at L892–893 (`mb1 + mb2`) uses nb1 as a proxy for "how big this explosion should be." In RUNS, use a dedicated explosion_scale field or a constant.
- **Explosion particle rendering**: The `mex` routine generates particles pseudo-randomly for display. The game logic captures the PRNG state and particle count (from the scale loop at L961). These belong on `render_object.particle_seed` and `render_object.particle_count` — the runtime reproduces the exact particle pattern.
- **Star capture timing**: In the original, `pof` (L1312–1333) fires mid-ship-update when gravity detects r² ≤ capture_radius. The state transition to `exploding` or teleport happens immediately, skipping the rest of the ship calc.

### Acceptance Criteria

- [ ] All 11 Processors defined with explicit inputs and outputs
- [ ] Each Processor references specific source lines for its logic
- [ ] All 6 sense switch effects are implemented in the correct Processors
- [ ] Hyperspace chord detection matches L1294–1298 exactly
- [ ] Torpedo inherits ship velocity (L1277, L1281)
- [ ] Explosion duration from `nb1` is handled (either as dedicated field or constant)
- [ ] Count-around prevention (`dzm` after `count`) at L1233, L1243, L1290, L1057

---

## Phase 5: System Processors

### Dependencies
- Phase 3 (Records), Phase 4 (entity Processors)

### Source Lines Consumed
- L717–736 (restart check)
- L738–754 (score update)
- L764–791 (match lifecycle)
- L792–828 (reinitialization)
- L843–868 (main loop dispatch — becomes Network wiring)
- L868–904 (collision detection)
- L1245–1288 (torpedo spawn — Phase 4 creates the request, Phase 5 inserts)
- L623–649 (starfield scroll)
- L1187–1216, L1217–1231 (render list construction — runtime-facing parts)

### Outputs
- `spacewar:collision_detect` Processor
- `spacewar:process_spawns` Processor
- `spacewar:check_restart` Processor
- `spacewar:update_scores` Processor
- `spacewar:match_initialize` Processor
- `spacewar:advance_starfield_scroll` Processor
- `spacewar:build_render_list` Processor

### Work Items

1. **`spacewar:collision_detect`** (L868–904):
   - Input: all `spacewar:object[]` with `collidable = true`
   - Logic: pairwise comparison of all collidable entities.
     - `|dx| = |position_x[i] - position_x[j]|` — take absolute value (`spa; cma`).
     - If `|dx| >= collision_radius` (me1 = 3072): no collision, skip.
     - `|dy| = |position_y[i] - position_y[j]|` — take absolute value.
     - If `|dy| >= collision_radius`: no collision, skip.
     - If `|dx| + |dy| >= collision_radius_half` (me2 = 1536): no collision, skip.
     - **On collision**: set BOTH entities to `state = exploding`, `collidable = false`. Set explosion duration from sum of instruction budgets: `lifetime = -(mb1[i] + mb1[j]) >> 8 + 1` (L892–898).
   - **Critical note**: the collision check is `me1` (primary) and `me2` (secondary, half). The two-check system forms a diamond-shaped hitbox, NOT a circular one. This is intentional and must be preserved.
   - Output: state transitions on colliding entities.

2. **`spacewar:process_spawns`** (L1245–1288):
   - Input: spawn requests from `torpedo_launch` Processors
   - Logic: for each spawn request, search the entity table for an `empty` slot.
     - If no empty slot: error (original does `hlt` at L1250). In RUNS: either drop the torpedo silently or log a warning.
     - Set slot: `state = torpedo`, `collidable = true`, position from spawn request (ship nose: `\stx`, `\sty`), velocity from spawn request (heading × `tvl` + ship velocity), set reload timer on the PARENT ship (`rlt → ma1[ship]`), set torpedo lifetime (`tlf → na1[torp]` at L1285–1286).
   - Output: populated torpedo entity slots.

3. **`spacewar:check_restart`** (L717–736):
   - Input: entity table (ships and all objects), `game_constants.torpedo_lifetime`
   - Logic: test if both ships are still in `ship` state (L717–724: compare `mtb[0]` against `ss1`, `mtb[1]` against `ss2`).
   - If both alive: check if both out of torpedoes (`torpedoes[0] >= 0 AND torpedoes[1] >= 0`).
   - If both dead (or one dead and all torpedoes gone/exploded): set restart timer = 2 × `torpedo_lifetime` (L733–735).
   - **Subtle**: the condition at L717–724 checks if ships are alive by comparing calc routine to `ss1`/`ss2`. If EITHER ship is NOT alive, skip to `mdn` (scoring). If BOTH alive but both out of torpedoes, trigger restart. This handles the stalemate case.
   - Output: update `match_result.restart_timer`.

4. **`spacewar:update_scores`** (L738–754):
   - Input: `match_result.restart_timer`, entity table (ship states)
   - Logic: count down `restart_timer` (L738: `count \ntd, ml1`). When fires:
     - L739–740: `stf 1; stf 2` — set flags 1 and 2 (not used for scoring; used for display).
     - **Ship 1 test** (L741–746): `law ss1; xor mtb; sza; clf 1; sza i; idx \1sc`.
       - `xor mtb`: AC = ss1 XOR ship1_calc. If ship 1 alive → XOR = 0.
       - `sza`: if zero (alive), skip `clf 1` → flag 1 stays set.
       - `sza i`: skip if NOT zero. AC still holds XOR. If alive (AC=0), `sza i` does NOT skip → `idx \1sc` **executes**.
       - **Result: surviving ship gets a point.** Ship 1 alive → `\1sc` incremented.
     - **Ship 2 test** (L747–752): identical logic. `law ss2; xor mtb 1; sza; clf 2; sza i; idx \2sc`.
       - Ship 2 alive → `\2sc` incremented.
     - L753: `clf 2` — unconditional flag cleanup (not part of scoring).
     - L754: `jmp a` → reinitialization.
     - **Scoring truth table** (verified by instruction trace):

       | Ship 1 | Ship 2 | `\1sc` | `\2sc` |
       |--------|--------|--------|--------|
       | Alive  | Alive  | +1     | +1     |
       | Alive  | Dead   | +1     | +0     |
       | Dead   | Alive  | +0     | +1     |
       | Dead   | Dead   | +0     | +0     |

     - Both alive = tie round (both get a point). Both dead = no points.
   - After scoring: jump to `a` (L754: `jmp a`) for reinitialization.
   - Output: updated scores, trigger reinitialization.

5. **`spacewar:match_initialize`** (L764–828):
   - Input: `match_result`, `game_config`, `game_constants`
   - Logic: the full reinitialization sequence. Handles:
     - Game count check (L764–772): if `\gct > 0`, decrement and continue. If `\gct = 0` after decrement, check if scores are tied (L769: `sas \2sc`). If tied, force one more round (L771–772: `law i 1; dac \gct`).
     - Operator panel check (L773–783): `lat` test word bit check for pause/continue.
     - Score display + halt at match end (L777–779).
     - Game count extraction from operator panel (L786–791): `lat; rar 6s; and (37; sza; cma; dac \gct`.
     - Full table clear (L792: `clear mtb, nnn-1`).
     - Ship placement: ship 1 at `(200000₈, 200000₈)`, ship 2 at complement (L797–804).
     - Angle: `144420₈` for ship 1 (L803–804). Ship 2 same.
     - Outline compilation: calls outline compiler (`jda oc` at L811, L814).
     - Resource initialization: torpedoes from `tno` (L816–818), fuel from `foo` (L819–821), instruction budget `2000` for ships (L822–824), hyperspace shots from `mhs` (L825–827).
   - Output: fully initialized entity table, reset match state.

6. **`spacewar:advance_starfield_scroll`** (L623–649):
   - Input: `starfield_state.scroll_counter`, `starfield_state.scroll_offset`, `game_config.disable_background`, `game_config.disable_gravity`
   - Logic: if `disable_background` OR `disable_gravity` → skip entirely (SW4 at L630, SW6 checked indirectly).
   - Decrement scroll_counter (L632: `isp bcc`). If not yet zero: skip advance.
   - When counter fires: reset counter to -2 (L634: `law i 2; dac bcc`). Display 4 brightness tiers (L636–639 — runtime concern, not converted).
   - Advance scroll: decrement `bkc` countdown (L640: `isp bkc`). If not yet zero: skip. When fires: reset countdown to -20 (L642–643), advance `fpr` by 1 (L644–645). Wrap: if `fpr < 0` (`spa`), add `20000₈` (L647).
   - **Two-level timer**: `bcc` fires every frame on alternate frames (every 2 frames), `bkc` fires every 20 of those → scroll advances every ~40 frames. The tier display between scroll advances is a runtime concern.
   - Output: updated `starfield_state`.

7. **`spacewar:build_render_list`** (L1187–1231, plus aggregation logic):
   - Input: all `spacewar:object[]`, `spacewar:star_catalog`, `spacewar:starfield_state`, `spacewar:ship_config[]`
   - Logic: for each active entity:
     - If `ship`: emit `render_object` with position, angle, outline_data, flame_length.
     - If `torpedo`: emit `render_object` with position only.
     - If `exploding`: emit `render_object` with position, particle_seed, particle_count.
     - If `hyperspace_out`: emit `render_object` at reduced intensity (breakout phase).
     - If `hyperspace_in`: do NOT emit (invisible).
   - For central star: emit one `render_object` at position `(0, 0)` with `type = central_star`.
   - For starfield: stars are rendered by runtime from `star_catalog` + `starfield_state.scroll_offset`. The build_render_list does NOT emit individual star render_objects — it lets the runtime handle catalog iteration. The `starfield_state` outbound Record IS the star rendering instruction.
   - Flame length: computed from `\src` (L1218: `ranct sar 9s, sar 4s, \src`) — a random number of exhaust particles when thrusting. The game logic produces this count; the runtime renders it.
   - Output: `render_object[]` array.

### Edge Cases

- **Collision diamond vs circle**: The two-check system (`me1` for each axis independently, then `me2` for sum) produces a diamond-shaped hitbox in Manhattan distance, not Euclidean. Do NOT replace with circular collision — this is original behavior.
- **Scoring logic**: The PDP-1 flag-and-skip mechanism at L738–754 is the single hardest piece to translate. Trace every instruction. Get it wrong and scores are inverted.
- **Reinitialization outline compilation**: The original calls `jda oc` (outline compiler) at L811/814 to compile `ot1`/`ot2` into executable display code. In RUNS, this step becomes "populate `ship_config[0].outline_data` from AEMS Manifestation `spacewar:needle` and `ship_config[1].outline_data` from `spacewar:wedge`."
- **Scrolling two-level timer**: `bcc` and `bkc` are both countdown timers at different frequencies. The scroll rate is approximately 1 pixel per 40 frames (~2.7 seconds per pixel at 15fps). Verify timing matches.
- **Star catalog rendering**: The `dislis` routine (L565–621) handles right-margin wrapping (`sub fpr; sma; add 20000₈`), brightness-based `dpy` intensity, and four-tier iteration. All of this is runtime rendering — game logic only advances `fpr`.

### Acceptance Criteria

- [ ] Collision detection uses Manhattan diamond, NOT Euclidean circle
- [ ] Scoring logic matches verified truth table: surviving ship gets +1 to its own score. Both alive = both +1 (tie). Both dead = neither +1. See Phase 5 `update_scores` instruction trace.
- [ ] Reinitialization sets all fields to exact values from L792–828
- [ ] Starfield scroll rate matches: advance by 1 every ~40 frames
- [ ] build_render_list emits correct render_object for each state
- [ ] Torpedo spawn inherits ship velocity and spawns at ship nose

---

## Phase 6: Network Topology

### Dependencies
- Phase 4 (entity Processors), Phase 5 (system Processors)

### Source Lines Consumed
- L843–941 (main loop structure — becomes Network wiring)

### Outputs
- `spacewar:game_tick` Network definition (top-level)
- `spacewar:ship_update` Network definition (sub-Network bundle)
- Runtime interface declaration
- Execution order specification

### Work Items

1. **Define `spacewar:ship_update` bundle**: A sub-Network containing the ship-specific Processors in order:
   - `spacewar:rotation_update` → `spacewar:gravity` → `spacewar:thrust` → `spacewar:velocity_integrate` → `spacewar:wrap_position` → `spacewar:torpedo_launch` → `spacewar:hyperspace_check`
   - This is a sequential pipeline — each Processor's output feeds the next.

2. **Define `spacewar:game_tick` Network**: The top-level game tick with guarded dispatch:
   ```
   for each object in spacewar:object[]:
     guard: state == ship         → spacewar:ship_update
     guard: state == torpedo      → spacewar:torpedo_update
     guard: state == exploding    → spacewar:explosion_tick
     guard: state == hyperspace_in  → spacewar:hyperspace_transit
     guard: state == hyperspace_out → spacewar:hyperspace_breakout
     guard: state == empty        → (skip)
   then:
     spacewar:process_spawns
     spacewar:collision_detect
     spacewar:check_restart
     spacewar:update_scores
     spacewar:advance_starfield_scroll
     spacewar:build_render_list
   ```

3. **Specify execution order**: The original processes entities in slot order (L843: `ml1` iterates `mtb` from start to end). This means ship 1 (slot 0) always updates before ship 2 (slot 1). Torpedoes in lower slots update before those in higher slots. This IS observable — a torpedo spawned and immediately collided in the same frame is possible if the firing ship's slot is processed first. Preserve slot-order iteration.

4. **Wire runtime interface**: Declare `requires` and `produces` per `02_record_definitions.md` § Complete Runtime Interface Declaration.

5. **Document the match lifecycle wrapper**: The game has an outer lifecycle that wraps `game_tick`:
   - On match start: `match_initialize` fires once.
   - Each frame: `game_tick` fires.
   - On round end: `update_scores` triggers `match_initialize` (L754: `jmp a`).
   - On match end: `match_result.state = match_over`, scores displayed.
   - This is NOT a Network — it's a lifecycle controller that the runtime drives.

### Edge Cases

- **Entity iteration includes the last entity separately**: The original loop at L929 processes slots 0 through `nob-2` in the inner loop, then processes slot `nob-1` (the last entity) separately at L930–937 — because the last entity has no pair for collision comparison. In RUNS, the collision Processor handles pairwise separately from the dispatch loop.
- **Two-pass entity processing**: The original makes two passes: first pass (L843–868) tries collision against later entities; second pass (L906–941) dispatches the calc routine. Both happen in the same loop iteration. In RUNS, separate `collision_detect` from per-entity dispatch.
- **Background and star display are inside the entity loop**: L938–940 calls `background` and `blp` (star display) AFTER all entities, but BEFORE the busy-wait. In RUNS, `advance_starfield_scroll` and `build_render_list` are the last Processors in `game_tick`.

### Acceptance Criteria

- [ ] Guarded dispatch covers all 6 states (empty through hyperspace_out)
- [ ] Entity-level Processors fire in slot order (0, 1, 2, ..., 23)
- [ ] System Processors fire after all entity Processors
- [ ] Runtime interface declaration matches `02_record_definitions.md` exactly
- [ ] Match lifecycle (init → play → score → reinit) is documented

---

## Phase 7: Static Data & AEMS Events

### Dependencies
- Phase 3 (Records), `03_aems_layer.md` (Entity/Manifestation definitions)

### Source Lines Consumed
- L1336–1345 (`ot1` — Needle outline)
- L1348–1355 (`ot2` — Wedge outline)
- L1371–1870 (star catalog)
- L398–507 (outline compiler — as documentation for runtime outline rendering)
- L510–561 (central star display — as documentation for runtime star rendering)

### Outputs
- Encoded star catalog data file (478 entries)
- Ship outline data files (2 outlines, 8 words each)
- 3 AEMS Entity events (JSON, ready for Nostr publication)
- 4 AEMS Manifestation events (JSON, ready for Nostr publication)
- Runtime rendering documentation (outline format, star display, central star)

### Work Items

1. **Encode star catalog**: Parse all `mark X, Y` entries from L1385–1866. For each:
   - Compute `x = 8192 - X_argument`
   - Store `y = Y_argument` (raw, before ×256 display scaling)
   - Assign brightness tier from section (1j=1, 2j=2, 3j=3, 4j=4)
   - Extract designation from inline comment
   - Output as structured data (JSON, YAML, or RUNS Record format)
   - Validate: exactly 478 entries. Tier counts: 9, 10, 82, 377.

2. **Encode ship outlines**: Extract `ot1` (L1338–1345) and `ot2` (L1348–1355) as arrays of 8 octal words each, with terminator `700000`.

3. **Publish AEMS Entity events**: Create 3 JSON events per `03_aems_layer.md` § Entities. These are kind 30050 events with `d`-tags: `spacecraft`, `projectile`, `gravity-source`.

4. **Publish AEMS Manifestation events**: Create 4 JSON events per `03_aems_layer.md` § Manifestations. Kind 30051 events with `d`-tags: `spacewar:needle` (with outline_data), `spacewar:wedge` (with outline_data), `spacewar:torpedo` (no properties), `spacewar:central-star` (no properties).

5. **Document outline format for runtime implementers**: The PDP-1 outline compiler (`oc`, L398–507) interprets each outline word as a sequence of 3-bit direction codes:
   - 0 = draw NE, 1 = draw NW, 2 = draw N, 3 = draw SE, 4 = draw SW, 5 = draw S, 6 = store checkpoint, 7 = return to checkpoint
   - Each word contains six 3-bit codes read right-to-left
   - `700000₈` terminates
   - The runtime must implement an outline renderer that interprets these codes relative to the ship's current heading (using the rotation matrix components).

6. **Document central star rendering for runtime implementers**: The `blp` routine (L522–539) renders the central star as a random burst of dots when SW6 is not set. Random position via PRNG, scaled random brightness. The `bpt` routine (L541–561) renders additional scattered dots around the central star (flicker effect). This is a runtime visual — reproduce the aesthetic, exact PRNG-driven placement is optional.

### Edge Cases

- **Star catalog number base**: L1377 switches to `decimal` — all `mark` arguments are decimal, not octal. The rest of the source is octal.
- **Star coordinate system**: `8192 - X` produces a right-margin-relative coordinate. The display routine at L577–578 subtracts `fpr` (scroll offset) to get the rendered position. The `spacewar:star_entry.x` should store the absolute position (pre-scroll), and the runtime applies `scroll_offset`.
- **Outline `700000₈` terminator**: Must NOT be included as a drawable instruction — it signals the end of the outline table.
- **Outline checkpoint mechanism**: Code 6 saves current position; code 7 returns to it. This enables "branches" in the outline — e.g., the Wedge's side fins.

### Acceptance Criteria

- [ ] Star catalog has exactly 478 entries with correct tier distribution
- [ ] All star coordinates match source `mark` arguments with correct decimal parse
- [ ] Ship outlines are byte-identical to source `ot1`/`ot2`
- [ ] AEMS events match JSON format in `03_aems_layer.md`
- [ ] Outline format documentation is sufficient for a runtime implementer

---

## Phase 8: Verification

### Dependencies
- All prior phases complete (Phases 1–7)

### Source Lines Consumed
- None — verification tests against the completed implementation

### Outputs
- Test suite definition
- Verification results report
- Known discrepancy documentation (if any)

### Work Items

1. **Headless game logic test**: Build a minimal headless runtime that:
   - Provides fixed `tick_input`, `player_controls` (no input), `display_config` (1024×1024), `game_config` (all defaults: all switches off)
   - Runs the `game_tick` Network for N frames
   - Validates: ships don't move (no input), gravity pulls both toward center, star scrolls
   - Validates: after enough frames, both ships hit the star and explode

2. **Input replay test**: Define a "choreographed" input sequence:
   - Frame 1–30: Player 1 rotates CCW, thrust
   - Frame 31: Player 1 fires torpedo
   - Frame 32–60: Both idle
   - Validate: torpedo travels on expected heading, torpedo lifetime expires after 96 frames, reload timer prevents re-fire for 16 frames

3. **Collision geometry test**: Place two entities at positions where:
   - `|dx| = 3071` (just inside `me1 = 3072`) and `|dy| = 0` → collision expected
   - `|dx| = 3072` (exactly at `me1`) → NO collision (test uses `sma` = strictly less than)
   - `|dx| = 1000`, `|dy| = 1000`, sum = 2000 > `me2 = 1536` → NO collision (second check)
   - `|dx| = 500`, `|dy| = 500`, sum = 1000 < `me2` → collision
   - Verify diamond-shaped hitbox behavior

4. **Hyperspace risk escalation test**: Fire hyperspace N times, verify:
   - First use: uncertainty = `40000₈`. Risk = `(random | 400000₈) + 40000₈ >= 0`.
   - Second use: uncertainty = `100000₈` (2 × `40000₈`). Higher risk.
   - Eventually: certain death (uncertainty exceeds max positive → always explodes).

5. **Sense switch configuration test**: For each switch:
   - SW1: verify angular velocity zeros each frame
   - SW2: verify gravity is approximately doubled
   - SW3: verify torpedo can fire every frame
   - SW4: verify background scroll doesn't advance
   - SW5: verify ship hitting star teleports to `(377777₈, 377777₈)`
   - SW6: verify no gravity + no star display

6. **Emulator comparison (optional but recommended)**: Run the original source on a PDP-1 emulator (e.g., masswerk.at/spacewar) with a known input sequence. Capture frame-by-frame entity state. Run the RUNS implementation with the identical input sequence. Diff all entity fields per frame. Any divergence is either a bug or a documented intentional deviation.

7. **Boundary contract test**: Verify:
   - Game logic never reads outbound Records
   - Runtime never reads internal Records
   - All 4 inbound Records are provided before each tick
   - All 3 outbound Records are produced after each tick
   - No leaked state between frames

### Acceptance Criteria

- [ ] Headless test: ships converge toward center and explode on star capture
- [ ] Input replay: torpedo heading, lifetime, and reload timer match expected values
- [ ] Collision: all 4 geometry test cases produce correct results
- [ ] Hyperspace: risk escalates with each use, eventual certain death confirmed
- [ ] All 6 sense switch tests pass
- [ ] Boundary contract: no leaked internal state
- [ ] (Optional) Emulator comparison: zero divergence on 1000-frame sequence

---

## Phase Dependency Graph

```
Phase 1: Type System & Constants
    ↓
Phase 2: Math Primitives
    ↓
Phase 3: Core Records
    ↓
Phase 4: Entity Processors ───┐
    ↓                          │
Phase 5: System Processors ────┤
    ↓                          │
Phase 6: Network Topology ─────┘
    ↓
Phase 7: Static Data & AEMS Events
    ↓
Phase 8: Verification
```

Phases 4 and 5 can be done in parallel after Phase 3. Phase 6 requires both. Phase 7 can be started after Phase 3 (independent of 4–6). Phase 8 requires all phases.
