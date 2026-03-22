# Spacewar! Outline Format — Runtime Implementer Guide

## Overview

Ship outlines are stored as arrays of 18-bit octal words. Each word contains
six 3-bit direction codes, read **right-to-left** (least significant bits first).
The code `7` in the most significant position (`700000₈`) terminates the outline.

Source: Outline compiler at L398–507, outline data at L1338–1355.

## Direction Codes

Each 3-bit code specifies a drawing direction relative to the ship's heading.
The renderer advances one pixel in the given direction and draws a dot.

| Code | Direction | dX | dY | Source Label |
|------|-----------|----|----|-------------|
| 0    | draw + add both     | +ssn | -scn | oc1 (L479) |
| 1    | draw + add cos, add sin | +scm | +ssm | oc2 (L494) |
| 2    | draw + add sum, sub cross | +ssc | -csm | oc3 (L495) |
| 3    | draw + sub both     | -scm | -ssm | oc4 (L496) |
| 4    | draw + add cross, sub sum | +csn | -ssd | oc5 (L497) |
| 5    | draw + sub sin, sub cos | (see code 6/7) | | oc6 (L498) |
| 6    | checkpoint: save position | — | — | oc6→oc9 (L498-503) |
| 7    | restore: return to checkpoint, flip orientation | — | — | oc6→oc9 (L504-507) / terminator |

**Note on codes 6/7**: Code 6 (`stf 6`) saves the current drawing position
into `\ssa`/`\ssi`. Code 7 restores from checkpoint and flips certain rotation
matrix signs (swaps `ssc↔csn` and `csm↔ssd`), enabling mirror-image branches
(like the Wedge's side fins).

The `700000₈` terminator is code 7 in the MSB position — the outline compiler
stops when it encounters a full word with code 7 in position 5. Do NOT draw
the terminator.

## Rotation Matrix

At draw time, the codes reference rotation matrix components derived from
the ship's current heading angle θ:

```
ssn = sin(θ) >> 5       scn = cos(θ) >> 5
ssm = sin(θ) >> 5       scm = cos(θ) >> 5
ssc = ssn + scn         csn = ssn - scn
ssd = ssn + scn         csm = -csn
```

Source: L1187–1213 (scale and matrix setup).

Each direction code adds/subtracts these components to the current position,
producing heading-relative drawing.

## Outline Data

### The Needle (`ot1`, L1338–1345, Ship 1)

```
111131  111111  111111  111163  311111  146111  111114  700000
```

### The Wedge (`ot2`, L1348–1355, Ship 2)

```
013113  113111  116313  131111  161151  111633  365114  700000
```

## Rendering Algorithm

```
1. Compute rotation matrix from ship heading θ
2. Set draw position to ship center (position_x, position_y)
3. For each outline word (until 700000):
   a. Extract 6 codes, right-to-left (bits 0-2, 3-5, ..., 15-17)
   b. For each code:
      - If 0-5: advance position by direction vector, draw dot
      - If 6: save position to checkpoint
      - If 7 (mid-word): restore from checkpoint, flip orientation
      - If 7 (word == 700000): stop
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
