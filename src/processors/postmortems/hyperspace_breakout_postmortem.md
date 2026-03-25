# Hyperspace Breakout Processor Postmortem

## 1. Discrepancies Found

### `isp` Skip Logic — Off-by-One (CRITICAL)

The existing pseudo-code had:
```
var life = object.lifetime + 1
if life < 0:
    # Still in breakout
```

**This is wrong.** PDP-1's `isp` (increment and skip if positive) skips ONLY when the result is strictly positive (> 0). When the result is 0, `isp` does NOT skip — it executes the next instruction (`jmp hp6`, continuing the breakout). The correct condition for "still in breakout" is `life <= 0`, not `life < 0`.

Corrected DIGS:
```
let life = object.lifetime + 1
if life <= 0:
    # Still in breakout
```

This is a 1-frame timing discrepancy: the existing code would start the re-entry sequence one frame too early (when lifetime reaches 0 instead of 1).

Masswerk confirms: "As long as the contents of the counter is still negative... we jump to the return at label hp2. — That's all folks! Eventually the counter will overflow to zero and we'll continue."

Note: Masswerk says "overflow to zero" about hp1's timer, but the same `count` macro pattern applies at hp3 L1049. The `count` macro is `isp A / jmp B` — so when `isp` skips (positive), the `jmp` is skipped and we fall through. When result is 0 or negative, `jmp B` executes.

### `var` Mutation → `let` Shadowing

The existing pseudo-code used mutable `var` declarations (`var life`, `var obj`, `var shots`) with reassignment. DIGS has no mutation — replaced with immutable `let` bindings using shadowing for sequential refinement.

### Missing Version Header and Preconditions

Added `#! runs-prim 1.0` header and `preconditions: object.state == spacewar:hyperspace_out` (the processor should only run during breakout phase).

### Missing `collidable = true` on Survival Path

The existing pseudo-code set `collidable = true` only in the survival `else` branch (L79), but did not set it when restoring the ship state at L31. In the PDP-1 source, the hp3 routine address was loaded via `law hp3; dac i ml1` at L1017 (hp1's transition to hp3) — **without** the 400000₈ sign bit, meaning the ship IS collidable throughout the entire breakout phase. The restored ship state (from `\mh1`) is the original spaceship routine address (also without 400000₈), so `collidable = true` is correct.

The corrected DIGS sets `collidable = true` in the state restoration (`let obj = object with { state = ..., collidable = true, ... }`) so it applies to both death and survival paths consistently.

### Instruction Budget Not Modeled

The existing pseudo-code did not model `law 2000; dac i mb1` (instruction budget for frame timing). This is correct — the instruction budget is a frame-rate stabilization mechanism, not game logic. DIGS bodies model game state transitions, not PDP-1 cycle counts.

### `prng` Output Handling

The existing pseudo-code had `prng = rng with { state = rng.state }` at the end, which only executed when breakout completed but not when still counting. The corrected DIGS outputs `prng = prng` (unchanged) when still counting, and `prng with { state = rng.state }` (updated) only when the random macro fires.

## 2. Surprising Findings

- **Convergent branches at hp7**: The `count i \mh2, hp7` at L1056 and the fall-through both converge at the same label `hp7` (L1059). Whether shots remain or the counter hit zero, execution continues identically — the recharge timer, uncertainty accumulation, and death check happen regardless. The `dzm` at L1057 (count-around prevention) runs only on the fall-through (zero/positive), but then immediately hits hp7. This is documented in Masswerk: "both branches, the jump to label hp7, if still counting, and the fall through, in case we would have reached zero, are meeting at the next instruction labeled hp7."

- **Certainty of death at 8th use**: After 8 uses, uncertainty = 8 × 16384 = 131072 = 400000₈ (the maximum negative 18-bit number). When this is added to any negative random number, the ones-complement addition overflows to positive, guaranteeing death. Masswerk: "the value in \mh4 will be 400000 after the increment, the equivalent of a set sign-bit and the maximum negative number... the addition will overflow to a positive number, regardless of the state of the other bits."

- **The shots counter is redundant**: As Masswerk notes, "this renders the limit on the 'number of hyperspace shots' rather useless, since \mh2 will never block the hyperspace trigger by reaching zero after the 8th jump, since the ship will break with certainty on this last shot and we will never return to see that check again." The uncertainty-based death check makes the shot counter belt-and-suspenders.

- **Recharge timer sign**: `xct hd3` executes `law i 200`, which loads -128₁₀ (ones-complement negative of octal 200 = decimal 128). In DIGS this is expressed as `0 - consts.hyperspace_recharge_time` since the constant stores the magnitude (128).

## 3. Concordance Corrections Needed

| Document | Issue |
|----------|-------|
| `object.runs` L126-131 | `hyperspace_saved_state` description says "Restored on breakout (L1052: `lac i \mh1; dac i ml1`)" — this is correct but should clarify that restoration always sets `collidable = true` because the original spaceship routine address never has the 400000₈ sign bit |
| `random.runs` L68 | Body says "deferred to Phase 4 (expression language design)" — Phase 4 is now (DIGS). The random processor body should be written in DIGS |

## 4. Sub-Processor Dependencies

| Processor | DIGS Body Written? | Notes |
|-----------|-------------------|-------|
| `spacewar:random` | ❌ No (header + comments only) | Body says "deferred to Phase 4." Called by hyperspace_breakout for death check. The algorithm IS documented in the processor comments (rotate-XOR-add). |

## 5. Test Vectors

Derived from Masswerk's analysis and hand computation. All values in ones-complement 18-bit.

### Test 1: First use — likely survival
- **Input**: lifetime = 0, hyperspace_uncertainty_acc = 0, hyperspace_shots_remaining = -8, prng.state = 100000₈ (arbitrary)
- **Computation**: 
  - life = 0 + 1 = 1 > 0 → breakout complete
  - shots = -8 + 1 = -7 (still negative → no zeroing)
  - uncertainty = 0 + 16384 = 16384
  - random(100000₈): rotate right 1 → 040000₈, XOR 355670₈ → 315670₈, ADD 355670₈ → result
  - death_roll = (result | 400000₈) + 16384
  - With uncertainty only 16384, the random bias (400000₈ = -131072₁₀) overwhelms → likely negative → survive
- **Expected**: state = ship, collidable = true, hyperspace_uncertainty_acc = 16384, shots = -7

### Test 2: Still counting — breakout dot displayed
- **Input**: lifetime = -10, all other values arbitrary
- **Computation**: life = -10 + 1 = -9 ≤ 0 → still in breakout
- **Expected**: object.lifetime = -9, all other fields unchanged, prng unchanged

### Test 3: Eighth use — certain death
- **Input**: lifetime = 0, hyperspace_uncertainty_acc = 114688 (= 7 × 16384), hyperspace_shots_remaining = -1, prng.state = any
- **Computation**:
  - life = 1 > 0 → breakout complete
  - shots = -1 + 1 = 0 → zeroed (count-around prevention)
  - uncertainty = 114688 + 16384 = 131072 = 400000₈
  - random produces any value v; death_roll = (v | 400000₈) + 131072
  - 400000₈ + 400000₈ overflows in ones-complement → always positive
- **Expected**: state = exploding, collidable = false, lifetime = -8, hyperspace_uncertainty_acc = 131072
