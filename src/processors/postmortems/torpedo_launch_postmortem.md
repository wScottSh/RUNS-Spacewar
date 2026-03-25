# torpedo_launch Postmortem

## Discrepancies Found

### 1. Invalid `var` Syntax
The original processor used `var reload = ...` and `var torps = ...` with mutable reassignment. DIGS has no `var` keyword and no mutation. **Fixed**: replaced with `let` bindings and shadowing.

### 2. Missing `output` Keywords
The original sprinkled bare `spawn_torpedo = false` at the top level, and mixed `spawn_x`, `spawn_dy`, etc. without `output` prefixes. DIGS requires explicit `output` statements. **Fixed**: every output is assigned with `output` on all execution paths.

### 3. Missing `preconditions` Block
The original had no preconditions. Added `object.state == spacewar:ship` since torpedo launch only applies to ships (the entire L1079-1309 block is ship-only calculation code).

### 4. Removed `reload_time` Output
The original processor had a standalone `reload_time: int` output. In the PDP-1, the reload time is stored back into the ship's `ma1` property (the lifetime/reload timer field) at L1283-1284: `xct rlt; dac i ma1`. Since this is the same field as `object.lifetime`, the DIGS version stores it directly via `object with { lifetime = 0 - consts.torpedo_reload_time }`, eliminating the need for a separate output.

### 5. Rapid Fire Logic Clarification
The original comment said "SW3 inverts the reload check" which is imprecise. What SW3 actually does (L1236-1237): when set, `clc` replaces the complemented previous controls with all-1s, which makes `and \scw` return the raw current controls. This bypasses edge detection, not the reload check. The reload timer still counts, but because `clc` sets AC to all-1s before the AND, every frame the button is held registers as a "press".

In RUNS, `controls.fire` is edge-detected by the runtime. With `rapid_fire`, the runtime provides `fire = true` on every held frame. This is semantically equivalent.

### 6. Source Line Range Correction
The original listed "Source: L1232-1244 (sq9 through st1)". The label `st1` is at L1245, not L1244. The correct range for the intent-checking code is L1232-1244 (sq9 through the `jmp sr5` at L1244). The spawn setup begins at `st1` (L1245) and is handled by `process_spawns`.

## Surprising Findings

### Edge Detection via Complement-AND Pattern
The PDP-1 performs edge detection in just 4 instructions: `lac mco; cma; and \scw; ral 3s; sma`. The complement-AND pattern `(~prev) & current` yields 1-bits only where buttons transitioned from 0→1. The `ral 3s` rotates the torpedo bit (4th from top) to the sign position where `sma` can test it. Remarkably compact.

### Rapid Fire as Mask Bypass
SW3's effect is not a separate code path — it merely replaces the edge-detection mask with all-1s (`clc = cma+cla-opr`). This single-instruction change converts edge detection into level detection. The reload timer still functions normally; only the edge-detection gate is bypassed.

### Lifetime Field Dual-Use
The `ma1` pointer (mapped to `object.lifetime`) serves double duty: it's the torpedo's countdown-to-detonation timer AND the ship's torpedo reload cool-down timer. The `count i ma1` macro at L1232 increments this same field each frame. When a torpedo fires, it's reset to `-reload_time` at L1283-1284.

## Concordance Corrections Needed

None identified. The existing `process_spawns.runs` correctly states that reload timer handling is done by `torpedo_launch` (line 17-18 of process_spawns.runs).

## Sub-Processor Dependencies

None. This processor performs no sub-processor calls. The sin/cos values are received as pre-computed inputs (`sin_heading`, `cos_heading`).

## Test Vectors

### Test 1: Basic Fire — Full Ammo, Reloaded
**Input**: `object.lifetime = 0` (reloaded), `object.torpedoes = -33` (full ammo), `controls.fire = true`, `config.rapid_fire = false`, `sin_heading = 32768` (arbitrary), `cos_heading = 16384`, `object.position_x = 1000`, `object.position_y = 2000`, `object.velocity_x = 100`, `object.velocity_y = 50`
**Expected**:
- `reload = 0 + 1 = 1 >= 0` → `reload = 0` → reloaded = true
- `torps = -33 + 1 = -32` (still negative → ammo available)
- `spawn_torpedo = true`
- `sin_offset = 32768 >> 5 = 1024`, `spawn_x = 1000 - 1024 - 1024 = -1048`
- `cos_offset = 16384 >> 5 = 512`, `spawn_y = 2000 + 512 + 512 = 3024`
- `torp_speed_x = -(32768 >> 4) = -2048`, `spawn_dx = -2048 + 100 = -1948`
- `torp_speed_y = 16384 >> 4 = 1024`, `spawn_dy = 1024 + 50 = 1074`
- `object.lifetime = 0 - 16 = -16` (reload timer)
- `object.torpedoes = -32`

### Test 2: Still Reloading — No Fire
**Input**: `object.lifetime = -5` (reloading), `controls.fire = true`, `config.rapid_fire = false`
**Expected**:
- `reload = -5 + 1 = -4` (still negative)
- `reloaded = false`
- `spawn_torpedo = false`
- `object.lifetime = -4` (decremented toward 0)

### Test 3: Rapid Fire Bypasses Reload Timer
**Input**: `object.lifetime = -5` (still reloading), `object.torpedoes = -10`, `controls.fire = true`, `config.rapid_fire = true`, `sin_heading = 0`, `cos_heading = 65536`, `object.position_x = 0`, `object.position_y = 0`, `object.velocity_x = 0`, `object.velocity_y = 0`
**Expected**:
- `reload = -5 + 1 = -4` (still negative, but...)
- `reloaded = (-4 >= 0) or true = true` (rapid_fire overrides)
- `torps = -10 + 1 = -9` (ammo available)
- `spawn_torpedo = true`
- `cos_offset = 65536 >> 5 = 2048`, `spawn_y = 0 + 2048 + 2048 = 4096`
- `torp_speed_y = 65536 >> 4 = 4096`, `spawn_dy = 4096`
- `object.lifetime = 0 - 16 = -16` (reload timer reset)
- `object.torpedoes = -9`
