# `hyperspace_check` Processor Postmortem

## Source Lines

**L1289-1309** of `spacewar3.1_complete.txt` — the `sr5` hyperspace trigger through `st3`/`srt` return labels.

## Discrepancies Found

### 1. Missing `consts` input

The existing processor hardcoded the lifetime value as `-32` in the `with` expression. The PDP-1 source uses `xct hd1` at L1304, which executes the instruction stored at the `hd1` constant location (`law i 40` = load -32₁₀). This is a configurable constant. The DIGS version adds a `consts: spacewar:game_constants` input and uses `0 - consts.hyperspace_entry_delay` to parameterize this value.

### 2. Recharge timer logic was correct but used `var` mutation

The existing pseudo-code used `var recharge = ...` with reassignment, which is not valid DIGS. The DIGS version uses nested `if`/`else` blocks with `let` shadowing instead, matching the immutable binding semantics of the language.

### 3. Missing precondition

The existing processor had no `preconditions` block. This processor is only called for active ships. Added `object.state == spacewar:ship`.

### 4. `collidable` field was correctly identified

The existing processor correctly identified that `400000₈` in `lac (hp1 400000` at L1302 is the non-collidable flag (sign bit set). The DIGS version maps this to `collidable = false`.

### 5. Dead code correctly identified but not documented

The `ior i mco` at L1296 is dead code per Masswerk: `\mco is never set in Spacewar! 3.1`. The existing processor mentioned this in a comment but still included the OR logic conceptually. The DIGS version omits it entirely and documents the reasoning.

### 6. `mb1` instruction budget omitted

The PDP-1 stores `law 3` to `mb1` at L1306-1307. This is a frame-timing mechanism (how many idle cycles to skip in the main loop) — not game logic. Correctly omitted from DIGS.

## Surprising Findings

### 1. The entire control word chord detection is dead code

Masswerk's analysis reveals that the `cma; ior i mco; and (600000; sza` sequence at L1294-1298 was designed to prevent accidental hyperspace when overlapping rotation commands occurred during maneuvering with the test word controls. However, `\mco` (old control word) is never written in Spacewar! 3.1, so the OR with it contributes nothing. The AND mask `600000₈` isolates bits 0-1 (CCW and CW rotation). With `cma` complementing the control word, both bits being SET in the input results in both being CLEARED after complement, so `and (600000` yields zero, and `sza` succeeds — hyperspace triggers.

In RUNS, this entire Rube Goldberg detection is replaced by the `controls.hyperspace` boolean, which the runtime maps from chord detection or a dedicated button.

### 2. The `count` macro has a semantic subtlety

The `count i \mh3, st3` at L1289 expands to `isp mh3; jmp st3`. The `isp` instruction INCREMENTS and THEN tests: if the result is positive (>= 0 in ones-complement), it skips the next instruction. So:
- If timer was -128 → becomes -127 → still negative → DON'T skip → take `jmp st3` → exit (still recharging)
- If timer was -1 → becomes 0 → non-negative → skip `jmp st3` → fall through → ready, then `dzm i \mh3` zeros it

The DIGS `if recharge < 0` captures this exactly.

### 3. `hyperspace_saved_state` stores the routine address, not an enum

In PDP-1, `lac i ml1; dac i \mh1` at L1300-1301 saves the ROUTINE ADDRESS of the current ship handler (e.g., the label `ss1` or `ss2`). In RUNS, this is abstracted to saving the `object.state` enum value, which is later restored on breakout (at L1052 in `hp3`). The breakout processor (`hyperspace_breakout`) will need to restore this.

## Concordance Corrections Needed

None. The record schemas (`object.runs`, `game_constants.runs`, `player_controls.runs`) accurately describe all fields involved.

## Sub-Processor Dependencies

**None.** `spacewar:hyperspace_check` calls no other processors. It is a leaf node in the processor call graph.

## Test Vectors

### Vector 1: Recharging — no entry possible

```
Input:
  object.hyperspace_recharge_timer = -50
  object.hyperspace_shots_remaining = 5
  controls.hyperspace = true
  consts.hyperspace_entry_delay = 32

Expected:
  object.hyperspace_recharge_timer = -49  (incremented by 1)
  object.state = unchanged (ship)
  No hyperspace transition
```

### Vector 2: Ready, but no shots remaining

```
Input:
  object.hyperspace_recharge_timer = -1  (about to expire)
  object.hyperspace_shots_remaining = 0
  controls.hyperspace = true
  consts.hyperspace_entry_delay = 32

Expected:
  object.hyperspace_recharge_timer = 0  (zeroed, count-around prevented)
  object.state = unchanged (ship)
  No hyperspace transition
```

### Vector 3: Successful hyperspace entry

```
Input:
  object.state = ship
  object.hyperspace_recharge_timer = -1
  object.hyperspace_shots_remaining = 3
  controls.hyperspace = true
  consts.hyperspace_entry_delay = 32

Expected:
  object.hyperspace_recharge_timer = 0
  object.hyperspace_saved_state = ship
  object.state = hyperspace_in
  object.collidable = false
  object.lifetime = -32  (0 - consts.hyperspace_entry_delay)
```
