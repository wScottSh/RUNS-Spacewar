# Spacewar! Outline Format — Runtime Implementer Guide

## Overview

Ship outlines are stored as arrays of 18-bit octal words. Each word contains
six 3-bit direction codes, read **left-to-right** (most significant bits first).
The PDP-1's `rcl 3s` instruction (L437) rotates the combined AC:IO register
LEFT, extracting the top 3 bits of IO into AC on each iteration.
The code `7` in the most significant position (`700000₈`) terminates the outline.

Source: Outline compiler at L398–507, outline data at L1338–1355.

## Direction Codes

Each 3-bit code specifies a drawing direction relative to the ship's heading.
The renderer advances one pixel in the given direction and draws a dot.

PDP-1 display convention: AC = X (horizontal right), IO = Y (vertical up).
"Down" means toward −Y (forward from the ship's nose at θ=0).

| Code | MIT Name | PDP-1 ΔX | PDP-1 ΔY | Source Handler |
|------|----------|----------|----------|----------------|
| 0    | (same as 1) | +ssn | −scn | opr fallthrough → oc1 (L441→L479) |
| 1    | down (forward) | +ssn | −scn | oc1 (L479) |
| 2    | right | +scm | +ssm | oc2 (L494) |
| 3    | down and right | +ssc | −csm | oc3 (L495) |
| 4    | left | −scm | −ssm | oc4 (L496) |
| 5    | down and left | +csn | −ssd | oc5 (L497) |
| 6    | checkpoint save/restore | — | — | oc6 (L498–507) |
| 7    | mirror-flip / terminator | — | — | L450–474 |

**Verification at θ=0** (sin=0, cos=1, so ssn=0, scn=1):

- Code 1: ΔX=0, ΔY=−1 → down ✓
- Code 2: ΔX=+1, ΔY=0 → right ✓
- Code 3: ΔX=+1, ΔY=−1 → down-right ✓
- Code 4: ΔX=−1, ΔY=0 → left ✓
- Code 5: ΔX=−1, ΔY=−1 → down-left ✓

**Note on codes 6/7**: Code 6 toggles PDP-1 flag 6. First occurrence
(`szf 6` skips, `stf 6` sets) saves the current drawing position into
`\ssa`/`\ssi` and draws a dot. Second occurrence (`szf 6` doesn't skip,
`clf 6` clears) restores from checkpoint and draws a dot.

The `700000₈` terminator is code 7 in the MSB position — the outline compiler
stops when it encounters a full word with code 7 in position 0. Do NOT draw
the terminator.

## Rotation Matrix

At draw time, the codes reference rotation matrix components derived from
the ship's current heading angle θ (L1200–1213):

```
ssn = sin(θ) >> 9       scn = cos(θ) >> 9
ssm = sin(θ) >> 9       scm = cos(θ) >> 9
ssc = ssn + scn         csn = ssn - scn
ssd = ssn + scn         csm = -(ssn - scn) = scn - ssn
```

Source: L1200–1213 (scale and matrix setup, using >> 9 for outline step size).
Note: L1187–1188 first compute >> 5 for nose position offset, then L1200–1201
overwrite with >> 9 for the outline drawing steps.

## Outline Scale

The PDP-1 sin/cos output has binary point right of bit 0 (max ≈ 131071 = 1.0).
After `>> 9`, each step is `≈ 131071 / 512 ≈ 256` internal units. On the
PDP-1's 1024×1024 display (10-bit addressing, range ±512), each step ≈ **0.5
display pixels**. The Needle's ~20 forward steps span ≈ 10 pixels — ships
are intentionally small (~2% of screen width).

For a runtime with canvas width W, the outline scale factor should be:
```
scale = W / 1024
```
On a 512px canvas: `scale = 0.5`. This produces authentically-sized ships.
Runtimes may multiply by a visibility factor (1.5–2.0×) if ships are too
hard to see at native resolution.

## Mirror-Flip (Code 7, L450–473)

The compiled code uses PDP-1 flag 5 to distinguish first vs second encounter:

**First code 7** (flag 5 is set):
1. Save current X,Y position
2. Jump to post-outline code (flame routine at `sq6`)
3. Clear flag 5
4. Apply mirror transformation:
   - `ssm = -ssm`
   - `scm = -scm`
   - swap `csm ↔ ssd`
   - swap `ssc ↔ csn`
5. Jump back to START of compiled outline

**Second code 7** (flag 5 is clear):
1. `szf 5` skips → exit to post-outline code

This produces bilateral symmetry: the entire outline is drawn twice, once
with the original matrix and once with the flipped matrix.

## Outline Data

### The Needle (`ot1`, L1338–1345, Ship 1)

```
111131  111111  111111  111163  311111  146111  111114  700000
```

MSB-first decoded:
```
[1,1,1,1,3,1, 1,1,1,1,1,1, 1,1,1,1,1,1, 1,1,1,1,6,3,
 3,1,1,1,1,1, 1,4,6,1,1,1, 1,1,1,1,1,4]
```

### The Wedge (`ot2`, L1348–1355, Ship 2)

```
013113  113111  116313  131111  161151  111633  365114  700000
```

MSB-first decoded:
```
[0,1,3,1,1,3, 1,1,3,1,1,1, 1,1,6,3,1,3,
 1,3,1,1,1,1, 1,6,1,1,5,1, 1,1,1,6,3,3,
 3,6,5,1,1,4]
```

## Rendering Algorithm

```
1. Compute rotation matrix from ship heading θ (>> 9 scale)
2. Set draw position to ship center (sx1, sy1 from L1191-1197)
3. For each outline word (until 700000):
   a. Extract 6 codes, LEFT-TO-RIGHT (MSB first, via rcl 3s)
   b. For each code:
      - If 0-5: advance position by direction vector, draw dot
      - If 6 (first): save position to checkpoint
      - If 6 (second): restore from checkpoint
      - If 7: mirror-flip matrix, restart from beginning (first pass)
               or exit (second pass)
4. Output: list of (x, y) dot positions for the runtime to render
```

## Central Star Rendering

Source: L510–561 (blp/bpt routines). The central star is rendered as a random
burst of dots around (0, 0) using the PRNG. This is purely aesthetic — the
runtime should reproduce a similar visual effect but is not required to match
the exact PRNG-driven placement. The central star's gameplay effect (gravity,
capture) is handled entirely by `spacewar:gravity` Processor logic.

## Explosion Particle Rendering

Source: L946–977 (mex routine). Each explosion frame produces a seed and count
from the `explosion_tick` Processor. The runtime generates `particle_count`
random (x, y) offsets from the seed using `spacewar:random`, draws them as dots
around the explosion center. The particles follow the `mst` scale table (L982–983):
`scr 1s` then `scr 3s` — the table selects between shifting by 1 or 3 bits,
producing two different scatter radii per particle pair.
