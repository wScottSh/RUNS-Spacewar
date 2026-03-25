# Postmortem: collision_detect

## Discrepancies Found

### 1. Wrong Explosion Duration (CRITICAL)

The existing processor used a fixed `explosion_life = -12`:

```
# OLD (WRONG):
let explosion_life = -12   # ~12 frames, reasonable default
```

The PDP-1 computes explosion duration from the instruction budgets of the two colliding entities (L892-898):

```
L892: lac i mb1      # load budget of entity i
L893: add . (mb2)    # add budget of entity j
L894: cma            # negate
L895: sar 8s         # divide by 256
L896: add (1         # add 1
```

Instruction budgets:
- Ships: 2000₈ = 1024₁₀ (L822-824: `law 2000; dac nb1`)
- Torpedoes: 20₈ = 16₁₀ (set in tcr at L991-992)

| Collision | Budget Sum | Result |
|-----------|-----------|--------|
| Ship vs Ship | -(1024+1024) >> 8 + 1 | **-7** |
| Ship vs Torpedo | -(1024+16) >> 8 + 1 | **-3** |
| Torpedo vs Torpedo | -(16+16) >> 8 + 1 | **1** |

A ship-ship collision produces a 7-frame explosion; a ship-torpedo collision produces a 3-frame explosion; two torpedoes produce a 1-frame flash. The fixed -12 was wrong for ALL cases.

### 2. `abs()` Not in DIGS (STRUCTURAL)

The existing processor used `abs(dx)` which is not a DIGS built-in. Replaced with the inline conditional pattern per DIGS spec:

```digs
let adx = if dx >= 0 then dx else -dx
```

### 3. Invalid Loop Constructs (STRUCTURAL)

| Invalid | Replacement |
|---------|-------------|
| `var objs = objects` | `output objects = objects` (initialization) |
| `for i from 0 to 23:` | `for i in range(23):` |
| `for j from i + 1 to 23:` | `for j in range(24):` with `if j > i:` |
| `objs[i] = objs[i] with {...}` | `output objects[i] = objects[i] with {...}` |
| Bare `objects = objs` | Removed (output accumulation handles this) |

### 4. Outer Loop Bound (MINOR)

The existing processor used `for i from 0 to 23` (24 iterations). The PDP-1 outer loop iterates i from 0 to `nob-2` (22), because the last entity (23) has no higher-indexed entity to compare against. The DIGS version uses `range(23)` (0..22) matching the PDP-1.

## Surprising Findings

1. **Torpedo-torpedo collision produces a 1-frame explosion**: The formula gives -(16+16) >> 8 + 1 = 0 + 1 = 1. With the count macro (isp), lifetime starts at 1, isp makes it 2 (> 0 → skip), so the explosion handler runs exactly once. This is consistent with Masswerk: "the explosion resulting from a collision of two torpedoes will be over after the first frame."

2. **The diamond hitbox is actually octagonal**: The three checks (|dx| < me1, |dy| < me1, |dx|+|dy| < me1+me2) create an octagon, not a diamond or circle. With me2 = me1/2, the octagon is inscribed in the square, clipping its corners at 45°.

3. **Collision order is deterministic**: The PDP-1's nested loop processes pairs in a specific order (0,1), (0,2), ..., (0,23), (1,2), ..., (22,23). When a collision occurs, both entities are immediately set to exploding/non-collidable, affecting all subsequent pair checks. The DIGS output-accumulation pattern preserves this order.

## Sub-Processor Dependencies

None. All arithmetic is inline.

## Test Vectors

### Vector 1: Ships barely within diamond hitbox

```
Input:
  objects[0] = { state: ship, collidable: true, position_x: 0, position_y: 0 }
  objects[1] = { state: ship, collidable: true, position_x: 2000, position_y: 2000 }
  consts = { collision_radius: 3072, collision_radius_half: 1536 }

  |dx| = 2000 < 3072 ✓
  |dy| = 2000 < 3072 ✓
  |dx| + |dy| = 4000 < 4608 ✓ → COLLISION

Expected:
  objects[0] = { state: exploding, collidable: false, lifetime: -7 }
  objects[1] = { state: exploding, collidable: false, lifetime: -7 }
```

### Vector 2: Outside diamond but inside square

```
Input:
  objects[0] = { state: ship, position_x: 0, position_y: 0, collidable: true }
  objects[1] = { state: torpedo, position_x: 2500, position_y: 2500, collidable: true }

  |dx| = 2500 < 3072 ✓
  |dy| = 2500 < 3072 ✓
  |dx| + |dy| = 5000 < 4608? NO → no collision
```

### Vector 3: Non-collidable entity skipped

```
Input:
  objects[0] = { state: ship, collidable: true, position_x: 0, position_y: 0 }
  objects[1] = { state: exploding, collidable: false, position_x: 100, position_y: 100 }

  objects[1].collidable == false → skip comparison.
  No collision.
```

### Vector 4: Ship-torpedo explosion duration

```
Input:
  objects[0] = { state: ship, collidable: true, position_x: 500, position_y: 500 }
  objects[2] = { state: torpedo, collidable: true, position_x: 500, position_y: 500 }

  Collision: same position. ship_budget=1024, torpedo_budget=16.
  lifetime = -(1024+16) >> 8 + 1 = -1040 >> 8 + 1 = -4 + 1 = -3

Expected:
  Both get lifetime = -3
```
