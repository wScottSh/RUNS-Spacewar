# Postmortem: advance_starfield_scroll

## Discrepancies Found

### 1. Octal vs. Decimal: `law i 20` (CRITICAL)

The existing processor treated `law i 20` at L642 as decimal 20:

```
# OLD (WRONG):
# law i 20; dac bkc → reset to -20 (fires every 20 level-1 ticks)
scroll_ctr = -40  # Combined: -20 × 2 frames
```

The PDP-1 source is in **octal** by default. `20₈ = 16₁₀`. The correct reset value is -16:

```digs
# CORRECT:
let bkc_reset = -16  # L642: law i 20 → 20₈ = 16₁₀
```

The combined scroll period is **32 frames** (16 bkc ticks × 2 bcc frames), not 40.

### 2. Merged Counters (STRUCTURAL)

The existing processor collapsed the two independent PDP-1 counters (`bcc` and `bkc`) into a single `scroll_counter` field counting from -40 to 0. This is incorrect for two reasons:

- The combined value was wrong (should be 32, not 40; see above).
- The PDP-1 uses genuinely independent counters with separate `isp` semantics. When `bcc` doesn't fire, `bkc` is *not incremented at all* — the entire `bck` routine returns early. Merging them changes the timer semantics.

The fix adds a `frame_counter` field to `spacewar:starfield_state` and models both counters independently.

### 3. Scroll Direction Confusion (MINOR)

The existing processor was inconsistent about scroll direction:

```
# Existing comment: "fpr counts DOWN"
var offset = starfield.scroll_offset - 1  # L644: law i 1; add fpr
```

The comment is correct (fpr counts down), and the code uses `- 1`, which is also correct. But the PDP-1 mechanism is worth clarifying: `law i 1` loads `-1` into AC (the `i` suffix negates), then `add fpr` adds fpr to -1. So the operation is `fpr + (-1) = fpr - 1`. The DIGS version uses `offset + -1` to match the PDP-1 instruction sequence exactly.

### 4. Wrap Condition Polarity (MINOR)

The existing processor used:

```
if offset < 0:
  offset = offset + 8192
```

The PDP-1 uses `spa` (skip if AC >= 0) — if fpr-1 is *non-negative*, skip the add. If *negative*, add 8192. The existing code's `< 0` condition was correct, but the DIGS version uses the inline conditional form `if offset >= 0 then offset else offset + 8192` to match the `spa` skip-on-non-negative pattern more directly.

### 5. `isp` Semantics: Skip on >= 0, not > 0 (IMPORTANT)

The existing processor used `< 0` as the "not fired" condition, which is correct. The PDP-1 `isp` instruction skips when the result is non-negative (sign bit clear in ones-complement). Zero is non-negative, so `isp` skips on zero. This means:

- `bcc`: set to -2 → isp makes it -1 (negative, no skip), isp makes it 0 (non-negative, skip). Fires every **2** frames. ✓
- `bkc`: set to -16 → takes 16 isp calls to reach 0. Fires every **16** bcc-ticks. ✓

## Surprising Findings

1. **The "Expensive Planetarium" name is ironic**: Peter Samson's starfield was genuinely expensive — the `dislis` macro is expanded 4 times in memory, consuming ~135 words. Samson chose this over a subroutine call specifically for real-time performance (avoiding copy/restore overhead for J, Q, and brightness parameters).

2. **The brightness modulation changed between versions**: Spacewar! 2b used *refresh frequency* to differentiate star magnitudes (1st magnitude refreshed twice per cycle, 4th magnitude only once every 4 cycles). Version 3.1 switched to the CRT's built-in 8-level intensity parameter via the `dpy` instruction's brightness bits — a much simpler approach.

3. **The scroll offset `fpr` starts at 10000₈ = 4096₁₀ (center of star map)**: This means the game starts with the star map centered, and scrolls leftward. When fpr reaches 0, it wraps to 8191 and continues. The star data's x-domain spans 0 to 20000₈ (0 to 8192₁₀).

4. **No `bcc` reset on first frame**: `bcc` starts at 0 (L651). Because `isp` increments to 1 (which is >= 0), the first frame fires immediately and resets `bcc` to -2. This is intentional — the stars are displayed on the very first frame of the game.

## Concordance Corrections Needed

1. **`starfield_state.runs`**: Updated as part of this change. Added `frame_counter` field for `bcc`, corrected `scroll_counter` documentation from "-20₁₀" to "-16₁₀ (20₈ = 16₁₀)", corrected scroll period from "~40 frames" to "32 frames".

2. **No other documentation changes needed**: The `CONVERSION_BIBLE.md` and cross-reference documents reference the Expensive Planetarium at a high level and do not contain specific timer values.

## Sub-Processor Dependencies

None. `advance_starfield_scroll` calls no sub-processors. It is a leaf node in the call graph.

## Test Vectors

### Vector 1: Initial state — first frame fires immediately

```
Input:
  starfield = { scroll_offset: 4096, frame_counter: 0, scroll_counter: 0 }
  config = { disable_background: false, ... }

Expected:
  starfield = { scroll_offset: 4095, frame_counter: -2, scroll_counter: -16, ... }
```

Reasoning: bcc=0 → isp → 1 (>=0, fires). Reset bcc=-2. bkc=0 → isp → 1 (>=0, fires). Reset bkc=-16. fpr=4096+(-1)=4095 (>=0, no wrap).

### Vector 2: bcc not yet fired — early return

```
Input:
  starfield = { scroll_offset: 4095, frame_counter: -2, scroll_counter: -16 }
  config = { disable_background: false, ... }

Expected:
  starfield = { scroll_offset: 4095, frame_counter: -1, scroll_counter: -16 }
```

Reasoning: bcc=-2 → isp → -1 (negative, no fire). Only frame_counter updated.

### Vector 3: bcc fires but bkc doesn't — partial tick

```
Input:
  starfield = { scroll_offset: 4095, frame_counter: -1, scroll_counter: -15 }
  config = { disable_background: false, ... }

Expected:
  starfield = { scroll_offset: 4095, frame_counter: -2, scroll_counter: -14 }
```

Reasoning: bcc=-1 → isp → 0 (>=0, fires). Reset bcc=-2. bkc=-15 → isp → -14 (negative, no fire). scroll_offset unchanged.

### Vector 4: Scroll offset wraps at zero

```
Input:
  starfield = { scroll_offset: 0, frame_counter: -1, scroll_counter: -1 }
  config = { disable_background: false, ... }

Expected:
  starfield = { scroll_offset: 8191, frame_counter: -2, scroll_counter: -16 }
```

Reasoning: bcc fires, bkc fires. fpr=0+(-1)=-1 (negative) → -1+8192=8191.

### Vector 5: Background disabled — passthrough

```
Input:
  starfield = { scroll_offset: 4096, frame_counter: 0, scroll_counter: 0 }
  config = { disable_background: true, ... }

Expected:
  starfield = { scroll_offset: 4096, frame_counter: 0, scroll_counter: 0 }
```

Reasoning: SW4 set → entire routine skipped. State unchanged.
