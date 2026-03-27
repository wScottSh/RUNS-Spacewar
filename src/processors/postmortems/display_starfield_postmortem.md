# Postmortem: display_starfield

## Discrepancies Found

### 1. Star Count Error in Record Definition (CRITICAL)

The `star_catalog.runs` record header claimed **478 stars** with tier counts **(9+10+82+377)**. Manual parsing of every `mark` macro invocation in the PDP-1 source (L1385-1866) confirms the correct count is **469 stars: (9+9+81+370)**.

```
# OLD (WRONG):
# 478 entries across 4 brightness tiers (9+10+82+377).

# CORRECT:
# 469 entries across 4 brightness tiers (9+9+81+370).
```

The existing `star_catalog.json` was already correct (469 entries, field-by-field verification against PDP-1 source yielded zero mismatches).

### 2. No Display Processor Existed (STRUCTURAL)

The Expensive Planetarium's rendering logic — Peter Samson's `dislis` macro — had no DIGS representation. The `advance_starfield_scroll.runs` processor correctly models the scroll timer cascade (bcc/bkc/fpr), but the actual star-to-screen projection was absent from the codebase. The new `display_starfield.runs` fills this gap.

### 3. PDP-1 Performance Optimizations vs. Logical Behavior

The `dislis` macro uses several PDP-1 performance optimizations that have no effect on the logical output:

1. **`flo` pointer advancement** (L603-606): When a star is off-screen left and no star has been displayed yet (flag 5 clear), `flo` is advanced past it so the next frame starts scanning later. This is a scan-start optimization irrelevant in DIGS.

2. **Self-modifying address pointers** (`dap fin`, `dap fyn`): The macro patches its own `lac` and `lio` instructions' address fields to walk the star table. In DIGS, this is a simple `for` loop.

3. **Flag 5 early exit**: Once stars have been displayed and a star falls off-screen left, the macro exits. This is an early-termination optimization that doesn't change which stars are visible.

4. **Four separate macro expansions**: The PDP-1 instantiates `dislis` four times in memory (one per brightness tier) because the macro uses local labels and stores per-tier state. In DIGS, a single pass with per-star brightness is equivalent.

## Surprising Findings

1. **The `spq` instruction is a micro-coded composite**: `spq` (skip if positive and not zero) is not a standard PDP-1 instruction. It equals `sza i sma-szf` (instruction word `650500₈`). The PDP-1 manual encouraged combining skip micro-ops. In the EP, it specifically tests `screen_x > 0` for the left boundary — zero is excluded because a star at exactly x=0 would be on the boundary and should not be displayed.

2. **The fgr wraparound adds +2000 with the −20000**: The instruction at L596 is `add (-20000+2000)`. This is NOT two separate operations — it's a single constant `−20000+2000 = −16000₈ = −7168₁₀`. The +2000 accounts for the fact that `fgr` jumps to `frr`, which is AFTER the `add (2000` at L582. So the combined operation is: `dx = dx − 8192 + 1024 = dx − 7168`. In DIGS, we decompose this into the two logical steps (subtract 8192 for wrap, then add 1024 for display width) for clarity.

3. **The re-centering subtraction**: L584's `sub (1000` is `sub 512₁₀`. This converts the range `1..1024` (after the +1024 addition) to `−511..+512`, centering on the display origin. This is the second-to-last step before the `sal 8s` shift into the CRT register format.

4. **16 stars have no designation**: Of the 469 stars, 16 have empty comments in the PDP-1 source (just a bare `/` with no text). These are genuine unnamed catalog entries. The existing JSON correctly preserves them as empty strings.

5. **The brightness mapping is inverted**: The `dislis` parameter B is `3,2,1,0` for tiers 1-4 respectively. So `intensity = 4 − tier`. Tier 1 (brightest 9 stars: Aldebaran, Rigel, etc.) gets CRT intensity 3 (maximum). Tier 4 (370 dim stars) gets intensity 0 (default/minimum).

## Concordance Corrections Needed

1. **`star_catalog.runs`**: Fixed as part of this change. Corrected tier counts from "478 (9+10+82+377)" to "469 (9+9+81+370)".

2. No other documentation changes needed.

## Sub-Processor Dependencies

None. `display_starfield` calls no sub-processors. It is a leaf node in the call graph.

## Test Vectors

### Vector 1: Star at scroll center — Aldebaran visible

```
Input:
  catalog = { stars: [{ x: 6655, y: 371, brightness: 1, designation: "87 Taur, Aldebaran" }, ...] }
  starfield = { scroll_offset: 6655, frame_counter: -2, scroll_counter: -16 }
  config = { disable_background: false, ... }

Expected visible star entry for Aldebaran:
  dx = 6655 - 6655 = 0 → dx >= 0 → wrap: 0 - 8192 = -8192
  screen_x = -8192 + 1024 = -7168 → ≤ 0 → NOT VISIBLE
```

Reasoning: When `scroll_offset == star.x`, the star is at the exact right margin and should be off-screen. The PDP-1 confirms: `sub fpr` yields 0, `sma` does NOT skip (0 is non-negative), so we go to `fgr`. After `add (-20000+2000)` = 0 − 7168 = −7168, `spq` does NOT skip (negative), so the star is skipped.

### Vector 2: Star just inside right edge

```
Input:
  catalog = { stars: [{ x: 6655, y: 371, brightness: 1, designation: "87 Taur, Aldebaran" }] }
  starfield = { scroll_offset: 6656, ... }

Expected:
  dx = 6655 - 6656 = -1 → dx < 0 → no wrap
  screen_x = -1 + 1024 = 1023 → > 0 → visible
  screen_x = 1023 - 512 = 511
  intensity = 4 - 1 = 3
  Result: { x: 511, y: 371, brightness: 3 }
```

Reasoning: Star is 1 unit inside the right margin. Screen position 511 is near the right edge of the display (max is 512).

### Vector 3: Star wraps around from left to right edge

```
Input:
  catalog = { stars: [{ x: 100, y: 200, brightness: 4, designation: "" }] }
  starfield = { scroll_offset: 8100, ... }

Expected:
  dx = 100 - 8100 = -8000 → dx < 0 → no wrap
  screen_x = -8000 + 1024 = -6976 → ≤ 0 → NOT VISIBLE
```

But with a smaller offset:
```
  starfield = { scroll_offset: 200, ... }

  dx = 100 - 200 = -100 → dx < 0 → no wrap
  screen_x = -100 + 1024 = 924 → > 0 → visible
  screen_x = 924 - 512 = 412
  intensity = 4 - 4 = 0
  Result: { x: 412, y: 200, brightness: 0 }
```

### Vector 4: Background disabled — empty list

```
Input:
  catalog = { stars: [...469 stars...] }
  starfield = { scroll_offset: 4096, ... }
  config = { disable_background: true, ... }

Expected:
  visible = { stars: [] }
```

Reasoning: SW4 set → entire routine skipped. No stars emitted.

### Vector 5: Wraparound at domain boundary

```
Input:
  catalog = { stars: [{ x: 8191, y: -143, brightness: 4, designation: "33 Pisc" }] }
  starfield = { scroll_offset: 50, ... }

Expected:
  dx = 8191 - 50 = 8141 → dx >= 0 → wrap: 8141 - 8192 = -51
  screen_x = -51 + 1024 = 973 → > 0 → visible
  screen_x = 973 - 512 = 461
  intensity = 4 - 4 = 0
  Result: { x: 461, y: -143, brightness: 0 }
```

Reasoning: Star near the right edge of the map, scroll near the left edge. The circular wraparound makes the star visible near the right side of the display.
