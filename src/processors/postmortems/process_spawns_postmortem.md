# Postmortem: `process_spawns.runs`

**Source**: L1245-1288 (st1 through sr7)
**Masswerk**: Part 7 — Shootout at El Cassiopeia — "Setup"

---

## Discrepancies Found

### 1. Invalid DIGS constructs throughout

**Old (invalid)**:
```
var objs = objects
for each req in spawn_requests:
  continue
  var found_slot = -1
  for k from 2 to 23:
    if ...:
      break
  objs[found_slot] = objs[found_slot] with { ... }
```

**Correct**:
```runs-prim
output objects = objects
for req in spawn_requests:
  for slot_idx in range(22) from found = false:
    ...
    output objects[idx] = objects[idx] with { ... }
    let found = true
```

The existing processor used `var` (mutable variables), `for each` (not a DIGS keyword), `break`, `continue`, and `for k from 2 to 23` (invalid range syntax). The DIGS rewrite uses:
- `output objects = objects` then `output objects[idx]` (overwrite pattern from `collision_detect.runs`)
- `for ... from found = false:` to simulate break-on-first-match
- `for slot_idx in range(22)` with `let idx = slot_idx + 2` for slot offset

### 2. Source line references mostly accurate

The existing processor cited L1245-1288 and individual line references were checked against the PDP-1 source. They are correct. Minor note: the comment cited "L1277-1278: add i \\mdx; dac ." but the actual instructions are at L1277-1278 (with `sr3, dac .` being the self-modifying target). This is functionally accurate.

### 3. Torpedo lifetime sign convention

**Old**: `lifetime = -consts.torpedo_lifetime`
**Correct**: `lifetime = 0 - consts.torpedo_lifetime`

DIGS unary negation on a `let` binding is valid, but `0 - value` is the established convention in this codebase for ones-complement negation (matching the PDP-1's `law i 140` which loads the ones-complement negative of 96₁₀). The `game_constants.runs` stores torpedo_lifetime as the MAGNITUDE (96), so the DIGS code negates it.

Constant verification: `law i 140₈`. Octal 140 = 1×64 + 4×8 + 0 = 96₁₀. `game_constants.runs` default = 96. ✅

### 4. `collidable` correctly derived from PDP-1 sign bit

The existing processor correctly set `collidable = true`. The PDP-1 stores `lac (tcr` at L1255 — the address `tcr` without the `400000₈` sign bit means the object IS collidable. This is the opposite of explosions which use `lac (mex 400000` to set non-collidable.

### 5. Instruction budget correctly omitted

L1287-1288 (`law 20; dap .`) stores the torpedo instruction budget (20₈ = 16₁₀) for frame-timing stabilization. This is a PDP-1 timing artifact, not game logic. Correctly omitted per established precedent (see `hyperspace_check_postmortem.md` §6).

### 6. Reload timer correctly delegated

L1283-1284 (`xct rlt; dac i ma1`) sets the reload timer on the PARENT SHIP, not on the torpedo. The existing processor correctly noted this is handled by `torpedo_launch`, which outputs `reload_time = -consts.torpedo_reload_time`. This delegation is correct.

---

## Surprising Findings

### 1. The slot search scans ALL objects, not just torpedoes

L1245-1249 uses `init sr1, mtb` and searches from mtb[0] through mtb[nob-1]. Ship slots (0-1) will never be empty during gameplay because they always have non-zero calc routine addresses (ss1 or ss2), but the PDP-1 code does not skip them — the search naturally passes over them. The DIGS version optimizes by starting at index 2, which is equivalent.

### 2. The `hlt` on no empty slot is a hard crash

L1250 (`hlt`) is a PDP-1 halt instruction followed by `jmp .-1` (infinite loop). This means if all 22 torpedo slots are full and a fire request is processed, the game FREEZES. In practice, with 32 torpedoes per ship (total 64 possible) but only 22 slots, this is reachable under heavy fire. The RUNS version silently drops the spawn request instead.

### 3. Self-modifying code elegance

The sr2-sr7 sequence is a masterclass in PDP-1 self-modifying code. A single accumulator chains through table offsets:
- Start with base address in sr1
- `law nob; add sr1` → position_x address
- `add (nob)` → position_y address
- Repeat for each property (lifetime, budget, velocity_x, velocity_y)

Each `dap` deposits the computed address into the address field of a later instruction (`ss3`, `ss4`, `sr6`, `sr7`, `sr3`, `sr4`), which then executes as `dio .` or `dac .` to write the property value. This avoids needing separate memory variables for each pointer.

---

## Concordance Corrections Needed

1. **No corrections needed.** The `object.runs` and `game_constants.runs` field definitions are consistent with the processor's I/O. The `torpedo_launch.runs` spawn interface correctly pre-computes all values that `process_spawns` stores.

---

## Sub-Processor Dependencies

| Processor | DIGS body written? | Status |
|-----------|-------------------|--------|
| (none) | N/A | `process_spawns` is a leaf processor — no sub-calls |

No blocking dependencies.

---

## Test Vectors

### Vector 1: Single active spawn request, slot 2 is empty

```
Input:
  objects[0].state = ship, objects[1].state = ship
  objects[2].state = empty (all others empty too)
  spawn_requests = [{ active=true, spawn_x=1000, spawn_y=2000,
                       spawn_dx=500, spawn_dy=600 }]
  consts.torpedo_lifetime = 96

Expected:
  objects[2].state = torpedo
  objects[2].collidable = true
  objects[2].position_x = 1000
  objects[2].position_y = 2000
  objects[2].velocity_x = 500
  objects[2].velocity_y = 600
  objects[2].lifetime = -96
  All other slots unchanged.
```

### Vector 2: Inactive spawn request — no changes

```
Input:
  objects = [all empty except ships at 0,1]
  spawn_requests = [{ active=false, spawn_x=0, spawn_y=0,
                       spawn_dx=0, spawn_dy=0 }]

Expected:
  objects = unchanged (no torpedo created)
```

### Vector 3: No empty slots — spawn request silently dropped

```
Input:
  objects[0..1].state = ship
  objects[2..23].state = torpedo (all slots full)
  spawn_requests = [{ active=true, spawn_x=5000, spawn_y=6000,
                       spawn_dx=100, spawn_dy=200 }]

Expected:
  objects = unchanged (no slot available, torpedo NOT created)
  No halt, no error — silent drop.
```
