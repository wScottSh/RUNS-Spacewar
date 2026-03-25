# Postmortem: check_restart

## Discrepancies Found

### 1. Fictitious Active-Torpedo Check (CRITICAL)

The existing processor added a loop to check for active torpedo entities in the world:

```
# OLD (WRONG — not in PDP-1 source):
var any_active_torps = false
for k from 2 to 23:
  if objects[k].state == torpedo:
    any_active_torps = true
    break
```

The PDP-1 source (L725-732) checks ONLY the two ships' torpedo counters:

```
L725: law 1       # AC = 1
L726: add ntr     # AC = 1 + ship1_torpedoes
L727: spa         # skip if >= 0 (ship 1 out of torpedoes)
L728: jmp md1     # still has torpedoes → normal play
```

There is no entity-table scan for active torpedoes. When both ships' counters read ≥ -1, the game immediately enters the scoring countdown, even if torpedoes are still in flight.

### 2. Missing md1 Path — Timer Reset (STRUCTURAL)

The existing processor omitted the md1 path entirely:

```
# L733: xct tlf    — execute "law i 140" → AC = -96₁₀ (140₈ = 96₁₀)
# L734: sal 1s     — shift left 1 → AC = -192
# L735: dac \ntd   — restart_timer = -192
```

The PDP-1 resets the restart_timer to -192 EVERY frame during normal play. This is critical — it means the scoring countdown only begins when the condition (death or stalemate) persists. Without this reset, the timer would never be properly initialized.

### 3. Missing Scoring Logic (STRUCTURAL)

The existing processor did not model L738-754 (the scoring countdown and score update). The PDP-1 code:
- Counts `\ntd` toward 0 while the game continues (allowing explosions to play out)
- When `\ntd` reaches 0: checks which ships survived, increments their scores

### 4. Torpedo Counter Semantics — Correct but Under-documented

The existing processor used `objects[0].torpedoes < 0` as "has torpedoes", which is correct but doesn't explain WHY. The PDP-1 uses `law 1; add ntr; spa` — this tests if `ntr + 1 >= 0`, i.e., `ntr >= -1`. Since torpedoes count UP from -33 toward 0:
- `ntr < -1` → ship still has torpedoes  
- `ntr >= -1` → ship is out (fired all, or counter was dzm'd)

The DIGS version uses `objects[0].torpedoes + 1 >= 0` to match the PDP-1 instruction sequence exactly.

### 5. Invalid Constructs

| Invalid | Replacement |
|---------|-------------|
| `var any_active_torps = false` | Removed (fictitious check) |
| `for k from 2 to 23:` | Removed |
| `break` | Removed |
| Bare `result = result with {...}` | `output result = result with {...}` |

## Surprising Findings

1. **The restart timer is reset EVERY frame during normal play**: This is not a one-time initialization — it's a continuous reset. The md1 path (L733-736) runs on every frame where conditions are normal. This means the timer only starts counting down when play transitions from normal to scoring, because the reset stops.

2. **The stalemate path goes directly to mdn**: When both ships are out of torpedoes (L731 `spa i` fails, L732 `jmp mdn`), the game enters the same scoring countdown as when a ship dies. There is no separate stalemate handling.

3. **`xct tlf` is indirect execution**: The PDP-1 doesn't use a constant for torpedo_lifetime — it executes the INSTRUCTION stored at address `tlf` (which is `law i 140`). This means the torpedo lifetime parameter was runtime-configurable by patching memory location 11₈.

4. **`sal 1s` is a shift-AC-left**: This doubles the value. `-96 << 1 = -192`. So `restart_timer = -192 = -(2 × 96)`. The constant 96₁₀ = 140₈ is the torpedo lifetime.

5. **Scoring always happens in stalemate**: When both ships are alive and out of torpedoes, both reach the mdn scoring path. The scoring code (L741-752) checks each ship independently — if alive, increment score. In a stalemate, BOTH scores increment (both survived).

## Sub-Processor Dependencies

None.

## Test Vectors

### Vector 1: Normal play — both alive, ship 1 has torpedoes

```
Input:
  objects[0] = { state: ship, torpedoes: -20, ... }
  objects[1] = { state: ship, torpedoes: -5, ... }
  result = { restart_timer: -100, score_1: 0, score_2: 0, state: playing, ... }
  consts = { torpedo_lifetime: 96, ... }

Expected:
  result = { restart_timer: -192, score_1: 0, score_2: 0, state: playing }
```

Reasoning: Both alive, ship 1 has torpedoes (-20 + 1 = -19 < 0, so `spa` at L727 does NOT skip → `jmp md1`). Timer reset to -192.

### Vector 2: Stalemate — both out, timer counting

```
Input:
  objects[0] = { state: ship, torpedoes: 0, ... }
  objects[1] = { state: ship, torpedoes: 0, ... }
  result = { restart_timer: -50, score_1: 2, score_2: 1, state: playing }

Expected:
  result = { restart_timer: -49, score_1: 2, score_2: 1, state: playing }
```

Reasoning: Both out (0+1=1 >= 0). Timer -50+1=-49 < 0 → still counting.

### Vector 3: Stalemate timer expires — both score

```
Input:
  objects[0] = { state: ship, torpedoes: 0, ... }
  objects[1] = { state: ship, torpedoes: 0, ... }
  result = { restart_timer: -1, score_1: 2, score_2: 1, state: playing }

Expected:
  result = { restart_timer: 0, score_1: 3, score_2: 2, state: round_over }
```

Reasoning: Both out. Timer -1+1=0 >= 0. Both alive → both scores increment.

### Vector 4: Ship 1 dead, timer counting

```
Input:
  objects[0] = { state: exploding, ... }
  objects[1] = { state: ship, ... }
  result = { restart_timer: -10, score_1: 0, score_2: 3, state: playing }

Expected:
  result = { restart_timer: -9, score_1: 0, score_2: 3, state: playing }
```

### Vector 5: Ship 1 dead, timer expires — ship 2 scores

```
Input:
  objects[0] = { state: exploding, ... }
  objects[1] = { state: ship, ... }
  result = { restart_timer: -1, score_1: 0, score_2: 3, state: playing }

Expected:
  result = { restart_timer: 0, score_1: 0, score_2: 4, state: round_over }
```

Reasoning: ship1 not alive → no score_1 increment. ship2 alive → score_2 + 1 = 4.
