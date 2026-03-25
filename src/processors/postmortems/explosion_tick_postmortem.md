# Postmortem: explosion_tick

## Discrepancies Found

### 1. Lifetime Check Off-by-One (CRITICAL)

The existing processor used `life >= 0` to determine when to clear the entity:

```
# OLD (WRONG):
if life >= 0:
    output object = object with { state = spacewar:empty, ... }
```

The PDP-1 uses `isp` (increment and skip if positive) which checks `> 0` (strictly positive). In ones-complement, zero is NOT positive.

```
# L978: count i ma1, mxr
#   isp ma1[i]   — increment, skip if result > 0
#   jmp mxr      — if result <= 0, return (continue explosion)
```

| Lifetime before `isp` | After `isp` | Skip? | Behavior |
|------------------------|-------------|-------|----------|
| -7 | -6 | No | Continue |
| -1 | 0 | No | Continue (0 is NOT positive) |
| 0 | 1 | Yes | Fall through → clear entity |

**Impact**: The old code cleared entities one frame early (7 frames instead of 8 for ship-ship collisions). This affected explosion visual duration and PRNG synchronization.

**Fix**: Changed to `life > 0`.

### 2. Budget Derivation Bug (CRITICAL)

The existing processor derived budget from `outline_ref`:

```
# OLD (WRONG):
let budget = if object.outline_ref >= 0 then ship_budget else torpedo_budget
```

Torpedoes have `outline_ref` defaulting to 0 (the object record default). Since `0 >= 0` is true, ALL entities incorrectly received `ship_budget = 1024`, giving torpedoes 128 particles instead of 2.

**Fix**: Added `entity_index: int` to inputs. Ships occupy slots 0-1; torpedoes occupy slots 2-23. Budget is now determined by `entity_index < 2`.

### 3. Invalid DIGS Constructs

| Invalid | Replacement |
|---------|-------------|
| Bare `velocity_integrate()` return assigned to `ix`/`iy` without `.field` | Sub-processor calls (valid DIGS; outputs accessed as `ix.position`, `ix.velocity`) |
| Missing `preconditions:` | Added `object.state == spacewar:exploding` |
| Missing `collidable = false` on clear | Added to match PDP-1 (dzm clears all state) |
| Loop variable `i` shadowed outer scope | Renamed to `step` |

### 4. diff Macro Clarification

The existing processor's comments were correct but the implementation used `spacewar:velocity_integrate` as a sub-processor call. This is the right abstraction: the `diff` macro with AC=0 does velocity += 0 (unchanged), then position += velocity >> 3. The `velocity_integrate` sub-processor implements this general pattern.

## Surprising Findings

1. **Ship explosions last 8 frames, not 7**: The `isp` check means lifetime goes -7 → -6 → ... → -1 → 0 → 1 (clear). The entity is rendered on the frame when lifetime = 0 (8 frames total of visible explosion).

2. **Torpedo explosions are barely visible**: Budget 16 >> 3 = 2 particles per frame. With lifetime starting at about -1 (from collision_detect: -(16+16) >> 8 + 1 = 0 + 1 = 1... actually this computes to 1, but stored negative as count-up). This creates a 1-2 frame flash with 2 particles.

3. **Scale table is renderer-only**: L961-963 (ms1/sma/idx msh) selects between `scr 1s` and `scr 3s` scatter scales. For all practical budgets, the scale stays at `scr 1s` (tight cluster). This is entirely a display concern — the RUNS processor only needs to capture the PRNG seed and count.

4. **Self-modifying display code**: L966-972 constructs a shift instruction at runtime by ORing a random 9-bit value with the `scl` opcode, then executes it via `xct`. The RUNS architecture eliminates this entirely by deferring particle rendering to the runtime.

## Concordance Corrections Applied

1. **collision_detect.runs L119**: Fixed operator precedence — `-(budget_i + budget_j) >> 8 + 1` was ambiguous; parenthesized to `(-(budget_i + budget_j) >> 8) + 1` to match the PDP-1 instruction sequence (cma, sar 8s, add 1). Also collapsed multi-line `with` blocks to single lines per DIGS grammar.

2. **velocity_integrate.runs**: Rewrote body with valid DIGS — added `#! runs-prim 1.0` header, replaced bare assignments with `let` shadowing and `output` statements.

## Sub-Processor Dependencies

| Processor | Status | Used For |
|-----------|--------|----------|
| `spacewar:velocity_integrate` | ✅ Valid DIGS | Position drift (2 calls) |
| `spacewar:random` | ⚠️ Body not valid DIGS | PRNG advancement (2 × pcount calls) |

## Test Vectors

### Vector 1: Ship explosion, first frame (lifetime = -7)

```
Input:
  entity_index = 0
  object = { state: exploding, lifetime: -7, outline_ref: 0,
             position_x: 1000, position_y: 2000,
             velocity_x: 100, velocity_y: -50 }
  prng = { state: 12345 }

Expected:
  budget = 1024 (entity_index < 2 → ship)
  particle_count = 1024 >> 3 = 128
  particle_seed = 12345 (captured before PRNG advance)
  prng advanced by 256 steps (128 × 2)
  life = -7 + 1 = -6, NOT > 0 → explosion continues
  object.lifetime = -6
  object.position_x = 1000 + (100 >> 3) = 1000 + 12 = 1012
  object.position_y = 2000 + (-50 >> 3) = 2000 + (-7) = 1993
  object.velocity_x = 100 (unchanged, acceleration = 0)
  object.velocity_y = -50 (unchanged)
```

### Vector 2: Torpedo explosion, entity cleared (lifetime = 0)

```
Input:
  entity_index = 5
  object = { state: exploding, lifetime: 0,
             position_x: 500, position_y: 500,
             velocity_x: 0, velocity_y: 0 }
  prng = { state: 99999 }

Expected:
  budget = 16 (entity_index >= 2 → torpedo)
  particle_count = 16 >> 3 = 2
  particle_seed = 99999
  prng advanced by 4 steps (2 × 2)
  life = 0 + 1 = 1, 1 > 0 → entity cleared
  object.state = empty
  object.collidable = false
  object.lifetime = 0
  object.position_x = 500 (velocity = 0)
  object.position_y = 500
```

### Vector 3: Ship explosion, lifetime = 0 (NOT cleared yet)

This vector validates the `isp` semantics correction (> 0, not >= 0).

```
Input:
  entity_index = 1
  object = { state: exploding, lifetime: -1,
             position_x: -30000, position_y: 40000,
             velocity_x: 200, velocity_y: 300 }
  prng = { state: 55555 }

Expected:
  budget = 1024 (entity_index < 2 → ship)
  particle_count = 128
  life = -1 + 1 = 0, 0 is NOT > 0 → explosion CONTINUES
  object.state remains exploding (NOT cleared!)
  object.lifetime = 0
  object.position_x = -30000 + (200 >> 3) = -30000 + 25 = -29975
  object.position_y = 40000 + (300 >> 3) = 40000 + 37 = 40037
```

This is the critical test: the old code would have cleared the entity here (>= 0), but the corrected code correctly keeps it alive for one more frame.
