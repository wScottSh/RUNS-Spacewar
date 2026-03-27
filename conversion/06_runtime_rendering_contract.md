# Runtime Rendering Contract

**Conversion Document 06** — Spacewar! 3.1

This document specifies how a runtime implementation should render each
`spacewar:render_object` produced by `build_render_list`. It bridges
the gap between game logic (Records and Processors) and visual
presentation (the runtime's display system).

**Authority**: PDP-1 Source (L-numbers reference `spacewar3.1_complete.txt`).
**Cross-references**: `01_source_concordance.md` for line ownership,
`02_record_definitions.md` for Record schemas.

---

## 1. PDP-1 Display Model

The PDP-1 Type 30 CRT is a **point-plot display**. There is no
framebuffer, no pixel grid. Each `dpy` instruction illuminates a
single phosphor dot at coordinates (AC, IO). The game draws the entire
frame by issuing hundreds of individual `dpy` instructions per tick.

### Coordinate System

- **Origin**: Center of display.
- **Axes**: AC = X (positive right), IO = Y (positive up).
- **Range**: 10-bit signed, ±512 in each axis.
- **Toroidal wrap**: Coordinates wrap at the edges (position modulo
  1024). The game explicitly wraps via the `wrap_position` Processor.

### Intensity Encoding

The `dpy` instruction encodes intensity in bits 7–6 of the instruction
word. The `dispt` macro (L146–151) computes this:

```
dispt A, Y, B:
  B = B << 6             # repeat 6, B=B+B
  lio Y                  # load Y coordinate
  dpy -(A) + B           # display point
```

Intensity values and their visual meaning:

| `dispt` B value | Bit pattern | Visual |
|---|---|---|
| 0 | `00` | Brightest (longest deflection) |
| 1 | `01` | Standard |
| 2 | `10` | Reduced (hyperspace breakout) |
| 3 | `11` | Dimmest (explosion particles) |

### Phosphor Persistence

Each plotted dot fades over approximately 50ms. At the game's ~15–20
FPS refresh rate, some dots visibly decay between frames. This creates
the characteristic twinkling and afterglow aesthetic. Brighter dots
(lower intensity value) persist longer than dimmer ones.

### Rendering: Dots, Not Lines

The PDP-1 has no line-drawing instruction. All "lines" in Spacewar!
are sequences of individual dots plotted one step apart. The ship
outlines, exhaust flames, and star patterns are all dot sequences.

---

## 2. Ship Outline Rendering

**When**: `render_object.object_type == ship`
**Source**: L398–507 (outline compiler), L1187–1216 (rotation matrix)
**Fields used**: `position_x`, `position_y`, `angle`, `sin_heading`,
`cos_heading`, `outline_data`

Ship rendering has two phases: constructing a rotation matrix from the
ship's heading, then interpreting the outline data to step a cursor
through rotated directions.

### 2a. Rotation Matrix Construction

Source: L1187–1216. Given `sin_heading` and `cos_heading` from the
object Record (written by `rotation_update`):

```
# Scale for outline position offsets (L1187–1188)
ssn_pos = sin_heading >> 5
scn_pos = cos_heading >> 5

# Ship tip = position offset by (ssn_pos, scn_pos)
# Ship nose = position offset by 2×(ssn_pos, scn_pos)
tip_x = position_x - ssn_pos           # L1191–1192
nose_x = tip_x - ssn_pos               # L1193–1194
tip_y = position_y + scn_pos           # L1195–1197
nose_y = tip_y + scn_pos               # L1198–1199

# Re-scale for outline stepping (L1200–1201)
ssn = sin_heading >> 9
scn = cos_heading >> 9

# 6 rotation matrix components (L1202–1213)
ssm = ssn
ssc = ssn + scn
ssd = ssn + scn                         # same value as ssc
csn = ssn - scn
csm = -(ssn - scn)                      # = scn - ssn
scm = scn
```

The drawing cursor starts at `(tip_x, tip_y)`. The initial display
point is plotted at `(0, 0)` relative offset via `cla cli-opr;
dpy-4000` (L1214–1215) before the outline code executes.

### 2b. Outline Data Format

Each word in `outline_data` is an 18-bit value containing six 3-bit
direction codes. Codes are read **right-to-left** (least significant
3 bits first). The terminator is `700000₈`.

<!-- TODO: Convert this extraction algorithm to DIGS expression language -->

```
for each word in outline_data:
  if word == 0o700000: stop
  remaining_codes = 6
  while remaining_codes > 0:
    code = word & 0o7
    word = word >> 3
    remaining_codes -= 1
    execute(code)
```

### 2c. Direction Code Table

The outline compiler's dispatch table (L440–447) maps codes 0–6 to
stepping operations. Each stepping code (0–5) advances the cursor
position and plots a dot. Codes 6 and 7 are control codes.

The dispatch at L440 uses `dispatch` macro: `add (. 3; dap . 1; jmp .`
— a computed jump. Code 0 falls through to `opr` (no-op, then L479 =
`oc1`), code 1 → `oc2` (L494), code 2 → `oc3` (L495), code 3 →
`oc4` (L496), code 4 → `oc5` (L497), code 5 → `oc6` (L498).

The `xincr` and `yincr` macros (L118–136) step the cursor:

- `xincr X, Y, INS`: `Y += INS(ssn); X += INS(scn)` — step along
  the sin/cos axis.
- `yincr X, Y, INS`: `Y += INS(scn); X += (-INS+add+sub)(ssn)` —
  step perpendicular.

The `comtab` macro (L409–415) generates pairs of stepping instructions
for the combined rotation matrix components.

| Code | Handler | Operations | Stepping Direction |
|---|---|---|---|
| 0 | `oc1` (L479–481) | `add ssn; sub scn` (xincr add) | Forward along heading |
| 1 | `oc2` via `comtab` (L494) | `add scm; add ssm` | 45° clockwise |
| 2 | `oc3` via `comtab` (L495) | `add ssc; sub csm` | 90° clockwise |
| 3 | `oc4` via `comtab` (L496) | `sub scm; sub ssm` | 135° clockwise (backward-ish) |
| 4 | `oc5` via `comtab` (L497) | `add csn; sub ssd` | Perpendicular |
| 5 | `oc6` (L498–507) | Checkpoint toggle (see below) | (not a direction) |
| 6 | (from `ocj` loop) | Store `(sx1, sy1)` as checkpoint | Control |
| 7 | Code 7 block (L450–473) | Return to checkpoint + mirror | Control |

> **Note**: The exact mapping of codes 0–5 to the `comtab` entries
> requires careful verification against the dispatch table. The table
> above represents the best current trace from L440–447 → L479–507.
> The `oc6` handler at L498 toggles checkpoint state using flag 6:
> first encounter stores position (`dac \ssa; dio \ssi`), second
> encounter restores it.

After each stepping code (0–4), the runtime plots a dot via `ioh;
dpy-4000` (L485–486). Full brightness, at the current cursor position.

### 2d. Code 7: Checkpoint Return and Mirror

Code 7 (L450–473) performs three operations:

1. **Test flag 5**: `szf 5` — if flag 5 is set, jump to the exhaust
   flame routine (`sq6`). Flag 5 is set by the first pass through the
   outline, enabling the flame after the outline completes.
2. **Restore checkpoint**: Load saved `(sx1, sy1)` from `(\ssa, \ssi)`.
3. **Mirror the rotation matrix**: Negate `ssm` and `scm`, swap
   `(ssc ↔ csn)` and `(ssd ↔ csm)`. This mirrors all subsequent
   drawing around the ship's nose axis, creating the bilateral
   symmetry of the ship outline.

After mirroring, control returns to the start of the outline data
(via `ocm` jump) to re-draw the outline with the flipped matrix.
The ship shape is defined as one half; code 7 draws the other half
automatically.

### 2e. Aesthetic Guidance

The ship outline is a sequence of closely-spaced dots forming angular
line segments. The 8 directions produce a distinctly stepped, low-
resolution vector appearance. Diagonal lines show visible stairstepping.

Runtime implementations may render:
- **Individual dots** (most faithful to PDP-1)
- **Connected line segments** (SVG/modern vector)
- **Pixel-art** (retro aesthetic)

The prescriptive requirement is that the stepping directions and
checkpoint/mirror mechanism produce the correct ship shape.

---

## 3. Exhaust Flame Rendering

**When**: `render_object.object_type == ship` AND `flame_length > 0`
**Source**: L1217–1231 (sq6–sq9)
**Fields used**: `position_x`, `position_y`, `sin_heading`,
`cos_heading`, `flame_length`

The exhaust flame is drawn as a series of dots trailing behind the
ship (opposite the heading direction).

### Algorithm

The game logic (`exhaust_burn` Processor) computes `flame_length`
(0–15 dots) and burns fuel accordingly. The runtime draws the dots:

```
# Direction: reverse heading, at finer scale than outline
# L1223: scale \sn, 8s, \ssn → sin >> 8
# L1224: scale \cs, 8s, \scn → cos >> 8
sin_step = sin_heading >> 8
cos_step = cos_heading >> 8

# Starting position: ship tail (same as outline cursor at code 7)
cursor_x = tip_x       # \sx1 from outline rendering
cursor_y = tip_y       # \sy1

# Draw flame_length dots, stepping in reverse heading
# L1229: yincr \sx1, \sy1, sub — step backward
# L1230: dispt i, \sy1 — display at current position
for dot in range(flame_length):
  # yincr with sub: step in reverse direction
  cursor_y -= cos_step            # sub \scn
  cursor_x += sin_step            # (-sub+add+sub) \ssn = add \ssn
  plot(cursor_x, cursor_y)       # dpy-4000 (full brightness)
```

Each flame dot is one `yincr` step apart, using the `sub` variant of
the step macro. The flame extends from the ship's tail position along
the reverse heading. All dots are at full intensity.

---

## 4. Torpedo Rendering

**When**: `render_object.object_type == torpedo`
**Source**: L1004
**Fields used**: `position_x`, `position_y`, `brightness` (= 1)

A single dot at (`position_x`, `position_y`) with intensity 1
(standard brightness). No shape, no animation.

```
# L1004: dispt i, i my1, 1
plot(position_x, position_y, intensity=1)
```

---

## 5. Explosion Particle Rendering

**When**: `render_object.object_type == explosion`
**Source**: L946–977
**Fields used**: `position_x`, `position_y`, `particle_seed`,
`particle_count`

The runtime reproduces the exact particle positions deterministically
by replaying the PRNG from `particle_seed`. Each particle uses two
PRNG calls for its scatter offset.

### Scale Selection

Source: L955–963, L982–983.

The `mst` scale table has two entries:

| Entry | Instruction | Shift | When Used |
|---|---|---|---|
| `mst` | `scr 1s` | ÷2 | Default (particle_count ≤ 96) |
| `mst+1` | `scr 3s` | ÷8 | When `(-particle_count) - 96 ≥ 0` |

The selection logic at L961–963:

```
# L957–960: mxc = -(budget >> 3) — negative particle count
# L961: sub (140 — subtract 96₁₀ from AC (AC still holds mxc)
# L962: sma — skip if AC < 0
# L963: idx msh — AC ≥ 0 → advance scale pointer to scr 3s
```

For standard Spacewar! 3.1 values, both ship explosions (budget 1024
→ 128 particles) and torpedo explosions (budget 16 → 2 particles)
produce negative results after the subtraction, so the default
`scr 1s` is always used. The `scr 3s` entry is vestigial — it would
only trigger for entities with instruction budgets < 768.

### Particle Loop

Source: L964–977. For each particle:

```
prng_state = particle_seed
scale = scr_1s              # always scr 1s for standard values

for i in range(particle_count):
  # First random call: X scatter (L964)
  prng_state = random(prng_state)
  scatter_x = prng_state & 0o777     # L965: 9-bit mask → [0, 511]

  # Second random call: Y scatter (L968)
  prng_state = random(prng_state)
  # L969–970: scr 9s; sir 9s — rotate AC:IO right 9, then IO right 9
  # This shuffles bits between AC and IO for more randomness
  scatter_y = rotate_combined(prng_state, 9)

  # L971: xct msh — execute scale instruction (scr 1s)
  # Shifts the combined (scatter_x, scatter_y) right by 1
  (scatter_x, scatter_y) = shift_combined_right(scatter_x, scatter_y, 1)

  # L973: add i my1 — scatter_y += position_y
  # L975: add i mx1 — scatter_x += position_x
  display_x = scatter_x + position_x
  display_y = scatter_y + position_y

  # L976: dpy-i 300 — display at intensity 3 (dimmest)
  plot(display_x, display_y, intensity=3)
```

> **Note**: The L966 `ior (scl` and L972 `mi1 = hlt` pattern is
> PDP-1 self-modifying code. `scl` encodes a display subroutine
> address; the `ior` merges the scatter value with this address to
> create a computed instruction at L972. The net effect on scatter
> positioning is captured above. The runtime does not need to replicate
> the self-modification — only the scatter arithmetic.

Particle reproduction is **deterministic**: given the same
`particle_seed` and `particle_count`, every runtime must produce
identical particle positions.

---

## 6. Hyperspace Breakout Rendering

**When**: `render_object.object_type == hyperspace_dot`
**Source**: L1075–1076
**Fields used**: `position_x`, `position_y`, `brightness` (= 2)

During hyperspace breakout, the PDP-1 renders a **single dot** at
reduced intensity. The full ship outline is NOT drawn.

```
# L1075: lac i mx1 — load X position
# L1076: dispt i, i my1, 2 — plot single point at intensity 2
plot(position_x, position_y, intensity=2)
```

`build_render_list` emits `object_type = hyperspace_dot` for entities
in the `hyperspace_out` state. No outline data is included.

---

## 7. Central Star Rendering

**When**: `render_object.object_type == central_star`
**Source**: L522–561 (blp + bpt routines)
**Fields used**: `position_x` (= 0), `position_y` (= 0), `star_seed`

The central star is rendered via two routines that use the game PRNG
to generate a burst pattern. Reproduction is deterministic — given
the same PRNG state, every runtime must produce identical star
placement.

### blp Routine (L522–539)

Only renders when gravity is enabled (SW6 off, `config.disable_gravity
== false`). If gravity is disabled, the star is not drawn.

```
# L525: random — generate PRNG value
# L526: rar 9s — rotate right 9
# L527: and (add 340 — mask with 340₈ = 224₁₀ = 11100000₂
# L528: spa — skip if AC ≥ 0
# L529: xor (377777 — ones-complement negate if negative
# L530: dac \bx — store as X offset
bx = abs(random() >> 9) & 0o340

# L531: lac ran — load previous random value (from PRNG state)
# L532: ral 4s — rotate left 4
# L533: and (add 340 — same mask
# L534: spa — skip if ≥ 0
# L535: xor (377777 — negate if negative
# L536: dac \by — store as Y offset
by = abs(prev_random << 4) & 0o340

# L537: jsp bpt — call burst pattern routine
# L538: ioh — sync display
```

### bpt Routine (L541–561)

Generates the characteristic flickering cluster around the origin:

```
# L542: random — generate PRNG value
# L543–544: sar 9s; sar 5s — shift right 14 total
# L545–546: spa; cma — absolute value
# L547: sal 3s — shift left 3 → magnitude [0, 24]
# L548: add (bds — add address of starp table
# L549: dap bjm — store as computed jump target
count = abs(random() >> 14) << 3
# count determines how many starp macros execute (0 to ~20)

# L550: cla cli clf 6 — clear AC, IO, flag 6
# L551: dpy-4000 — plot center dot at origin

# L552: bjm, jmp . — jump into starp table
# bds (L553): repeat 20, starp — 20 consecutive starp macros
#
# starp macro (L512–520):
#   add \bx; swap; add \by; swap; ioh; dpy-4000
#   Each starp adds (bx, by) offset and plots a dot.
#   After N starp calls, cursor has moved N×(bx, by) from origin.

# After the starp chain:
# L554: szf 6 — check flag 6
# L555: jmp . (return) — if flag 6 set, done
# L556: stf 6 — set flag 6 (marks first pass complete)
# L557–560: cma; swap; cma; swap — negate both bx and by offsets
# L561: jmp bjm — repeat with negated offsets (mirror pass)
```

The net result: a center dot, then N dots at multiples of `(bx, by)`,
then N dots at multiples of `(-bx, -by)`. This produces a roughly
bilaterally symmetric cluster. The values of N, bx, and by change
every frame via the PRNG, creating the twinkling aesthetic.

Total dots per frame: 1 (center) + N + N, where N ∈ [0, 20].

---

## 8. Background Stars (Expensive Planetarium)

**Source**: L565–653 (dislis macro + bck routine)
**Data**: Star catalogs at `1j`–`4j` (L655+)

The Expensive Planetarium renders 478 real stars in 4 brightness tiers.
This is a separate rendering layer — not driven by entity
`render_object` instances.

### Star Catalog

The star positions are compiled from a real star catalog at assembly
time. Each tier has its own pair of parallel arrays (X coordinates in
`Nj`, Y coordinates in `Nq`):

| Tier | Count | `dispt` Intensity | Star Source |
|---|---|---|---|
| 1 | 9 | 3 (`dpy-i 300₈`) | Brightest real stars |
| 2 | 10 | 2 (`dpy-i 200₈`) | |
| 3 | 82 | 1 (`dpy-i 100₈`) | |
| 4 | 377 | 0 (`dpy-i 0`) | Dimmest |

Star coordinates are stored as raw PDP-1 values. The X coordinate
displayed is `8192 - stored_x`, scaled by `sal 8s` (×256) before
display. The Y coordinate is loaded directly and displayed.

### Scroll and Wrap

The background slowly scrolls: every 20 frames (`bkc` counter at
L640–642), the right margin (`fpr`, initialized to `10000₈ = 4096₁₀`)
increments by 1 (L644–645). Stars whose X position exceeds `fpr` are
clipped from the right side and wrap to the left (toroidal).

The scroll speed: 1 unit per 20 frames. At ~15 FPS, that is ~0.75
units/second. A full wrap cycle takes 4096 × 20 ÷ 15 ≈ 5461 seconds
(~91 minutes). The stars complete one full rotation in about an hour
and a half.

### Conditional Rendering

- `szs 40` (L630): Skip rendering if SW4 (enable_planetarium) is OFF.
  Sense switch 4 gates the Expensive Planetarium.
- `bcc` counter (L632–635): The planetarium only renders every 3rd
  frame (`law i 2; dac bcc` sets a 3-frame cycle). This reduces
  computational cost — star rendering is expensive on the PDP-1.

### Data Flow

The star catalog is **static data** — it does not change during
gameplay. It is not part of the entity system and does not flow
through `render_object`. The rendering contract specifies the
algorithm and the data format. The runtime is responsible for:

1. Loading the star catalog (478 entries with X, Y, brightness tier)
2. Applying the scroll offset each frame
3. Performing right-margin clipping and wrap
4. Rendering each visible star at its brightness tier

The catalog data should be extracted from the PDP-1 source (L655+)
as part of Phase 7 work item 4 ("Extract and encode star catalog").
The format of that extracted data is outside this document's scope.

---

## Field Coverage Matrix

Every `render_object` field is documented above:

| Field | Used By | Section |
|---|---|---|
| `object_type` | All rendering decisions | Switch key |
| `position_x` | Ship, torpedo, explosion, hyper, star | §2–7 |
| `position_y` | Ship, torpedo, explosion, hyper, star | §2–7 |
| `angle` | Ship (rotation matrix) | §2a |
| `sin_heading` | Ship (rotation matrix), exhaust flame | §2a, §3 |
| `cos_heading` | Ship (rotation matrix), exhaust flame | §2a, §3 |
| `outline_data` | Ship (direction codes) | §2b–2d |
| `brightness` | Torpedo (1), hyperspace_dot (2), stars (1–4) | §4, §6, §8 |
| `particle_seed` | Explosion (PRNG replay) | §5 |
| `particle_count` | Explosion (loop count) | §5 |
| `star_seed` | Central star (PRNG replay) | §7 |
| `flame_length` | Ship exhaust (dot count) | §3 |

---

## Concordance Cross-Reference

| Source Lines | Concordance Label | Contract Section |
|---|---|---|
| L118–136 | `xincr`/`yincr` macros | §2c, §3 |
| L146–151 | `dispt` macro | §1 |
| L398–507 | Outline compiler | §2b–2d |
| L510–520 | `starp` macro | §7 |
| L522–561 | `blp`/`bpt` central star | §7 |
| L565–653 | `dislis` background stars | §8 |
| L1187–1216 | Ship display setup | §2a |
| L1217–1231 | Exhaust flame | §3 |
