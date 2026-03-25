# `update_scores` Postmortem

**Processor**: `spacewar:update_scores`
**Source Lines**: L738-754 (mdn routine)
**Date**: 2026-03-25

## Discrepancies Found

### 1. Invalid `var` keyword usage
The existing processor used `var timer`, `var s1`, `var s2` with mutable reassignment. DIGS has no `var` keyword — all bindings are immutable `let` with shadowing. Replaced with `let` bindings and inline conditional expressions.

**Old (invalid)**:
```
var s1 = result.score_1
if ship1_alive:
  s1 = s1 + 1
```

**New (valid DIGS)**:
```
let s1 = if ship1_alive then result.score_1 + 1 else result.score_1
```

### 2. Missing `#! runs-prim 1.0` version declaration
The existing processor had no version declaration. Added as required by the DIGS spec.

### 3. Timer increment performed before branch
The old code performed `timer + 1` inside the `else` branch. The PDP-1's `isp` at L738 always increments `\ntd` before deciding whether to skip. Moved the `let timer = result.restart_timer + 1` before the branch to match PDP-1 semantics. The value is only used in branches where `restart_timer != 0`.

### 4. Missing `output` keyword
All output assignments lacked the `output` keyword required by DIGS syntax.

## Surprising Findings

### Flags 1 and 2 are vestigial
The PDP-1 code at L739-740 sets program flags 1 and 2, then clears them conditionally (L744, L750) if the corresponding ship is dead. Flag 2 is unconditionally cleared again at L753. These flags are never checked anywhere else in Spacewar! 3.1. As Masswerk notes, these are likely "leftovers from a patch" or "set up to communicate with another patch we don't know about." DIGS ignores them entirely since they have no functional effect.

### `law ss1; xor mtb` is an identity comparison
The PDP-1 determines ship liveness by comparing the current handler address to the expected one via XOR. If equal, XOR = 0 (alive). In RUNS, this maps cleanly to `state == spacewar:ship` since the handler address IS the state encoding in the PDP-1 architecture.

### Timer semantics are inverted from typical countdowns
The restart timer counts UP from a negative value (e.g., -192) toward positive. The PDP-1 `isp` (increment, skip if positive) is the natural countdown primitive. When `\ntd` crosses from negative to non-negative, the timer has expired. This is the opposite of the typical "count down to zero" pattern.

## Concordance Corrections Needed

None identified. The match_result Record definition (L735, L738 references) correctly documents the `restart_timer` field and its source lines.

## Sub-Processor Dependencies

None. This processor performs no sub-processor calls, only integer comparison and arithmetic.

## Test Vectors

### Test 1: Timer still counting down
- **Input**: `restart_timer = -50`, ship1 alive, ship2 alive
- **Expected**: `restart_timer = -49`, `trigger_reinit = false`, scores unchanged
- **Rationale**: `isp` increments -50 → -49, still negative → jmp ml1

### Test 2: Timer expires, both ships alive (tie)
- **Input**: `restart_timer = -1`, `score_1 = 3`, `score_2 = 5`, ship1 state=ship, ship2 state=ship
- **Expected**: `restart_timer = 0`, `score_1 = 4`, `score_2 = 6`, `trigger_reinit = true`
- **Rationale**: `isp` increments -1 → 0. In ones-complement, 0 is positive → skip → score both + trigger reinit

### Test 3: Timer expires, ship1 exploding
- **Input**: `restart_timer = -1`, `score_1 = 2`, `score_2 = 7`, ship1 state=exploding, ship2 state=ship
- **Expected**: `restart_timer = 0`, `score_1 = 2`, `score_2 = 8`, `trigger_reinit = true`
- **Rationale**: Ship1 dead (handler != ss1) → no score. Ship2 alive → score +1.

### Test 4: No restart pending
- **Input**: `restart_timer = 0`
- **Expected**: `restart_timer = 0`, `trigger_reinit = false`, scores unchanged
- **Rationale**: Timer inactive. Normal gameplay continues.

### Test 5: Both ships dead
- **Input**: `restart_timer = -1`, `score_1 = 1`, `score_2 = 1`, ship1 state=exploding, ship2 state=exploding  
- **Expected**: `restart_timer = 0`, `score_1 = 1`, `score_2 = 1`, `trigger_reinit = true`
- **Rationale**: Neither ship survives → no points awarded. Timer fires, reinit triggered.
