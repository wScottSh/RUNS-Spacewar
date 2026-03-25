# Postmortem: `rotation_update.runs`

## Source Lines

L1091–1119 of `spacewar3.1_complete.txt` (labels `sr0`/`sc1` through `jda sin; dac \sn`).

## Discrepancies Found

### 1. Angular Damping Mode Missing ×128 Multiplier (CRITICAL)

The old pseudo-code had:

```
if config.angular_damping:
  omega = 0
```

This is catastrophically wrong. In the PDP-1 source, when SW1 is set (damping active):
- L1103: `dzm i mom` — zeroes the stored angular velocity (correct)
- L1104: `ral 7s` — rotates AC left 7, multiplying by 128

The AC at this point contains the frame's accumulated angular velocity (= old_angular_velocity + frame_delta). In steady state, old_angular_velocity is always 0 (zeroed last frame), so AC = frame_delta = ±8 or 0. After `ral 7s`, AC = ±1024 or 0.

This is the "Bergenholm rotation" vs "rocket thrusters" distinction Masswerk describes: gyros give instant, responsive rotation without momentum accumulation by applying a 128× multiplier to the current-frame input.

The old code effectively disabled ALL rotation when damping was active — setting omega to 0 and never applying any rotation to the angle.

**Fix**: `rotation_amount = new_angular_velocity << 7` in damping mode.

### 2. Angle Normalization Constant: 2π, Not π (CRITICAL)

The old pseudo-code had:

```
let pi = 0o311040 as spacewar:fixed18   # π in angle units
```

`311040₈ = 102944₁₀`. This is **2π** (a full circle), NOT π. The PDP-1 source confirms:
- Ship 2 is initialized at `144420₈ = 51472₁₀` which is π (half rotation, facing opposite direction)
- The sin subroutine normalizes arguments against `311040₈`, called 2π in the header comment (L192-193)
- `311040₈ = 2 × 144420₈`

**Fix**: Renamed to `two_pi`.

### 3. Angle Normalization Logic Incorrect

The old pseudo-code had range clamping:

```
if angle > pi: angle = angle - pi
if angle < -pi: angle = angle + pi
```

The PDP-1 code (L1113-1116) implements a different pattern:

```asm
sma         ; skip if AC < 0
sub (311040 ; AC >= 0 → subtract 2π
spa         ; skip if AC >= 0
add (311040 ; AC < 0 → add 2π
```

This is a single-pass wrap: if the angle is positive, try subtracting 2π; if the result goes negative, add 2π back. This normalizes the angle to approximately [0, 2π) in steady state, not [-π, +π).

**Fix**: Replicated the exact sma/sub/spa/add cascade as a two-step conditional.

### 4. Input Logic for Both Buttons Pressed

The old pseudo-code had:

```
if controls.rotate_ccw and not controls.rotate_cw:
  omega = omega + consts.angular_acceleration
else if controls.rotate_cw and not controls.rotate_ccw:
  omega = omega - consts.angular_acceleration
```

The PDP-1 scans bits sequentially: first testing CCW (spi at L1094), then rotating and testing CW (spi at L1097). If both are pressed, both additions trigger: `AC = +maa - maa = 0`. The old code's `and not` guards produce the same net result (0 delta), so this is functionally correct but structurally diverges from the PDP-1 flow. The new DIGS version handles this explicitly.

### 5. `var` Keyword Invalid in DIGS

The old pseudo-code used `var` statements. DIGS has no `var` — only `let` for immutable bindings with shadowing.

## Surprising Findings

1. **The Bergenholm/Gyro ×128 multiplier**: The damping mode doesn't just "stop" rotation — it provides a fundamentally different rotation mechanic. By zeroing stored angular velocity but multiplying the frame's input by 128, the ship rotates immediately and stops immediately. Masswerk calls this distinction "(Bergenholm rotation / gyros)" vs "(rocket thrusters)" with accumulated momentum.

2. **Angle lives in [0, 2π), not [-π, π)**: The normalization cascade doesn't center the angle around zero. Ship 1 starts at `200000₈` for position, and the angle wraps around `311040₈ = 2π`. This is consistent with the sin subroutine expecting input "between +2π" (L192).

3. **Flag 6 as thrust state**: The PDP-1 uses program flag 6 to carry thrust state forward to the velocity integration code. This is mapped to the `thrust_enabled` output boolean in DIGS.

## Concordance Corrections Needed

The `object.runs` comment on `angle` (line 84) says:
> "±π range via normalization (±311040₈ = ±102944₁₀)"

This is wrong. The normalization wraps to [0, 2π), not ±π. `311040₈` IS 2π, not π. The field comment should read:
> "[0, 2π) range via normalization (311040₈ = 102944₁₀ = 2π)"

## Sub-Processor Dependencies

| Processor | DIGS Body Written? | Notes |
|-----------|-------------------|-------|
| `spacewar:sin` | ✅ Yes | Returns `sin` and `cos` outputs |

## Test Vectors

### Test 1: CCW rotation, no damping
- **Input**: `angular_velocity = 0`, `angle = 0`, `rotate_ccw = true`, `rotate_cw = false`, `angular_damping = false`
- **Expected**: `angular_velocity = 8`, `angle = 8` (0 + 8 = 8, normalization: 8 >= 0 → 8 - 102944 = -102936 < 0 → -102936 + 102944 = 8)

### Test 2: CCW rotation WITH damping (the ×128 fix)
- **Input**: `angular_velocity = 0`, `angle = 0`, `rotate_ccw = true`, `rotate_cw = false`, `angular_damping = true`
- **Expected**: `angular_velocity = 0` (zeroed by damping), `angle = 1024` (8 << 7 = 1024; normalization: 1024 >= 0 → 1024 - 102944 = -101920 < 0 → -101920 + 102944 = 1024)

### Test 3: No rotation, angle near 2π wrap boundary
- **Input**: `angular_velocity = 100`, `angle = 102900`, `rotate_ccw = false`, `rotate_cw = false`, `angular_damping = false`
- **Expected**: `angular_velocity = 100`, raw_angle = 103000, normalization: 103000 >= 0 → 103000 - 102944 = 56 >= 0 → `angle = 56` (wrapped past 2π)

### Test 4: Thrust with fuel remaining
- **Input**: `thrust = true`, `fuel = -5000`
- **Expected**: `thrust_enabled = true` (fuel < 0 means fuel remaining)

### Test 5: Thrust with fuel exhausted
- **Input**: `thrust = true`, `fuel = 0`
- **Expected**: `thrust_enabled = false` (fuel >= 0 means exhausted)
