# Postmortem: `torpedo_update.runs`

**Source**: L985–1005 (tcr routine)
**Masswerk**: Part 7, "Shootout at El Cassiopeia"

## Discrepancies Found

### 1. Sequential Dependency in Warpage Calculation (BUG FIX)

The old processor used `object.position_y` (the **original**, pre-update value) for the second warpage term:

```
# OLD (wrong):
let accel_x = (object.position_y >> 9) >> grav_shift
```

The PDP-1 code uses the **updated** `position_y` — the value that just came out of the first `diff` macro. The `diff` macro's last instruction is `dac i S`, which stores the updated position into both memory AND the accumulator. That AC value then flows into `sar 9s; xct the` for the second warpage:

```
# L1000: diff \mdy, my1, (sar 3s  — AC now = updated position_y
# L1001: sar 9s                    — AC = updated_position_y >> 9
# L1002: xct the                  — AC = (updated_position_y >> 9) >> the
# L1003: diff \mdx, mx1, (sar 3s
```

```
# NEW (correct):
let accel_x = (new_py >> 9) >> grav_shift
```

**Impact**: With the default `the = sar 9s`, both values are zeroed (total shift = 18 bits on an 18-bit word), so no gameplay difference. But with reduced warpage shifts (the "Winds of Space" mode), the trajectories would diverge from PDP-1 behavior. The old code would produce symmetric warpage; the correct code produces the asymmetric sequential coupling the PDP-1 actually computed.

### 2. Removed Sub-Processor Call

The old processor called `spacewar:velocity_integrate()` as a sub-processor. While factoring out `diff` is architecturally clean, it obscured the sequential data dependency between the two integration passes. The new DIGS body inlines the two diff expansions to make the dependency explicit.

### 3. Invalid DIGS Syntax

The old processor used `var` (mutable assignment) instead of `let` bindings. DIGS has no mutation — only immutable `let` bindings with shadowing.

## Surprising Findings

### The "Winds of Space" are invisible by default

With `the = sar 9s` (default), the total warpage shift is `>> 9 >> 9 = >> 18`. On an 18-bit word, this zeros the accumulator entirely. Torpedoes fly in perfect straight lines. The warpage effect only appears when someone "hacks up a warping factor" by reducing `the` — exactly as Masswerk describes and Levy recounts. This makes the warpage code a dormant feature activated by live-patching the constants table via the PDP-1's console switches.

### Minsky circle algorithm heritage

Masswerk identifies the warpage as a variation on Marvin Minsky's circle-drawing algorithm (HAKMEM Item 149). The cross-coupling (x drives y, y drives x) with an omitted complementation step produces an approximate gravitational attraction toward the origin, not a true circle. The omission of `cma` (complement) means this is a one-directional deviation, not a closed orbit.

## Concordance Corrections Needed

None identified. The record schemas, game_constants, and runtime_contract all align with the source.

## Sub-Processor Dependencies

None. The inlined diff expansion uses only basic arithmetic and shifts. No calls to `spacewar:sin`, `spacewar:sqrt`, `spacewar:multiply`, or `spacewar:velocity_integrate`.

## Test Vectors

### Test 1: Default warpage (straight-line flight)

With `the = 9` (default), warpage is zero:

- **Input**: position_x = 65536, position_y = 0, velocity_x = 1024, velocity_y = 0, lifetime = -50
- **Expected**:
  - accel_y = (65536 >> 9) >> 9 = 128 >> 9 = 0
  - velocity_y = 0 + 0 = 0; position_y = 0 + 0 = 0
  - accel_x = (0 >> 9) >> 9 = 0
  - velocity_x = 1024 + 0 = 1024; position_x = 65536 + (1024 >> 3) = 65536 + 128 = 65664
  - lifetime = -49

### Test 2: Torpedo expiration

- **Input**: lifetime = -1
- **Expected**: After incrementing: life = 0, which is >= 0 → explode
  - state = exploding, collidable = false, lifetime = -2

### Test 3: Warpage with reduced shift (Winds of Space)

With `the = 2` (strong warpage):

- **Input**: position_x = 32768, position_y = 0, velocity_x = 0, velocity_y = 512, lifetime = -80
- **Expected**:
  - accel_y = (32768 >> 9) >> 2 = 64 >> 2 = 16
  - new_vy = 512 + 16 = 528; new_py = 0 + (528 >> 3) = 66
  - accel_x = (66 >> 9) >> 2 = 0 >> 2 = 0
  - new_vx = 0 + 0 = 0; new_px = 32768 + 0 = 32768
  - lifetime = -79
