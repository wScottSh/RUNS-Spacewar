# Postmortem: `hyperspace_transit.runs`

**Source**: L1007-1045 (hp1 routine)
**Masswerk**: Part 8 — Hyperspace! — "The Thrills of Hyperspace"

---

## Discrepancies Found

### 1. Scaling direction: right-shift → left-shift

**Old (wrong)**:
```
let disp_x = rng1.value >> consts.hyperspace_displacement_shift   # hr1: sar 9s (>>9)
let vel_x = rng2.value >> consts.hyperspace_velocity_shift        # hr2: sar 4s
```

**Correct**:
```
let disp_x = disp_high << consts.hyperspace_displacement_scale   # hr1: scl 9s (<<9)
let vel_x = vel_low << consts.hyperspace_velocity_scale          # hr2: scl 4s (<<4)
```

The PDP-1 constants `hr1` and `hr2` are `scl 9s` and `scl 4s` — combined **left** shifts, not right shifts. The existing processor inverted the scaling direction. The `game_constants.runs` correctly documents these as left-shift scale values.

### 2. Field name mismatch

The existing processor referenced `consts.hyperspace_displacement_shift` and `consts.hyperspace_velocity_shift`, which do not exist in `game_constants.runs`. The actual field names are `hyperspace_displacement_scale` and `hyperspace_velocity_scale`.

### 3. Constant 311040₈ misnamed as "pi"

**Old**: `let pi = 0o311040 as spacewar:fixed18`
**Correct**: `let two_pi = 0o311040`

311040₈ = 102944₁₀. In the sine-cosine format (binary point right of bit 3), this represents **2π**, not π. π would be 144420₈ = 51472₁₀. The DIGS spec skill explicitly warns: "311040₈ = 2π, NOT π."

### 4. Split-and-scale pattern was absent

The existing processor used `rng1.value >> shift` and `(rng1.value <<< 9) >> shift`, attempting to use the raw random value and a rotate. The actual PDP-1 algorithm uses a precise register-splitting technique:

1. `scr 9s` — combined shift right 9 (splits 18-bit word into AC and IO)
2. `sir 9s` — shift IO right 9 (right-aligns the bottom half)
3. `scl Ns` — combined shift left N (scales both halves to target range)

The DIGS equivalent extracts two 9-bit signed halves via arithmetic shifts:
```
let half_high = value >> 9              # top 9 bits, sign-extended
let half_low = (value << 9) >> 9        # bottom 9 bits, sign-extended
```

### 5. Velocity X/Y mapping was swapped

The PDP-1 code stores:
- `dac i \mdy` — AC value → velocity_y (high half of random)
- `dio i \mdx` — IO value → velocity_x (low half of random)

The existing processor had the axes correctly labeled in comments but the code structure was ambiguous.

### 6. Invalid DIGS constructs

The existing processor used `var` (mutable variables) and `repeat N:` (not a DIGS construct). The rewrite uses `let` shadowing and `for step in range(3) from angle = raw_angle:` (the DIGS `from` clause for bounded iteration with state accumulation).

### 7. Timer guard: `< 0` vs `<= 0`

The existing processor used `if life < 0:` for the transit countdown. Per `isp` semantics (skip if result > 0), the correct guard is `if life <= 0:`, matching the established pattern from `hyperspace_breakout.runs`.

---

## Surprising Findings

### 1. Angle reuses velocity random value

Masswerk: "We load the last random number (stored in location `ran`)" — the code at L1034 uses `lac ran`, which holds the output of the SECOND `random` macro call (the velocity call). The angle is NOT independently random; it correlates with the velocity vector. Masswerk notes this dependency is "obfuscated" by the angle normalization wrap-around.

### 2. The displacement/velocity split-and-scale is elegant

The `scr 9s` + `sir 9s` + `scl Ns` pattern extracts two independent 9-bit signed values from a single 18-bit random word and scales them to different ranges, all in 3 instructions. This avoids two separate `random` calls while producing two uncorrelated-enough values for X and Y.

### 3. Loop iteration count: 3 (not 2)

`setup \hpt,3` stores -3. In ones-complement, the `isp`/`count` sequence produces 3 iterations because -1+1 = -0 (777777₈), which has sign bit 1 and is NOT positive, so `isp` does not skip until -0+1 = +1. Masswerk's annotation says "2 iterations," which appears to be a casual annotation rather than empirical data. Functionally, the 3rd iteration is a harmless no-op since 131071/102944 ≈ 1.27 (one subtract always suffices).

---

## Concordance Corrections Needed

1. **`game_constants.runs`** — The field names `hyperspace_displacement_scale` and `hyperspace_velocity_scale` are correct, but the comments say "Shift count left" which is accurate. However, any documentation referencing "right shift" for these constants (if any exists) should be corrected.

2. **No other concordance corrections identified.** The `object.runs` field definitions are consistent with the processor's I/O.

---

## Sub-Processor Dependencies

| Processor | DIGS body written? | Status |
|-----------|-------------------|--------|
| `spacewar:random` | ✅ Yes | Verified in `random.runs` |

No blocking dependencies.

---

## Test Vectors

### Test 1: Transit still counting (timer not expired)

**Input**: `object.lifetime = -10`
**Expected**: `object.lifetime = -9`, all other fields unchanged, `prng` unchanged.
**Rationale**: isp increments -10 → -9, result ≤ 0, jump to return.

### Test 2: Transit expires with known random seed

**Input**:
- `object.lifetime = 0` (will become 1, which is > 0 → transit complete)
- `object.position_x = 0, position_y = 0`
- `prng.state = 0o355670` (second iteration of PRNG from zero seed)
- `consts.hyperspace_displacement_scale = 9, hyperspace_velocity_scale = 4, hyperspace_breakout_duration = 64`

**PRNG trace**:
- `random(0o355670)`:
  - rotate right 1: 0o155670 XOR sign → need exact calc
  - (Full trace requires exact ones-complement arithmetic)

**Expected behavior**: Position offset applied, velocity set (not added), angle set from second random value, breakout timer = -64.

### Test 3: Angle normalization with large positive value

**Input**: `raw_angle = 120000₁₀` (> 2π = 102944₁₀)
**Expected after normalization**:
- Pass 1: 120000 ≥ 0 → subtract 102944 → 17056. 17056 ≥ 0, no add-back. angle = 17056.
- Pass 2: 17056 ≥ 0 → subtract 102944 → -85888. -85888 < 0 → add 102944 → 17056. angle = 17056.
- Pass 3: Same as pass 2 → angle = 17056.
**Final angle**: 17056₁₀
