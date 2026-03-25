# Postmortem: `wrap_position.runs`

## Discrepancies Found

### 1. Wrong Wrapping Boundary (Critical)

The existing processor wrapped at **±512** (½ of 1024), claiming this matched the PDP-1's "10-bit display register equivalent":

```
# OLD (WRONG):
let half_range = 0o1000 as spacewar:fixed18      # 512
let full_range = 0o2000 as spacewar:fixed18       # 1024
if x > half_range:
  x = x - full_range
```

This is incorrect. The PDP-1 wraps at the **full 18-bit word boundary** (±131071), not at the 10-bit display register range. The display uses only the top 10 of 18 bits for pixel position; the remaining 8 bits provide sub-pixel precision. The toroidal wrapping comes from the word-size overflow, not the display resolution.

**Masswerk Part 3** (Objects, L388):
> "positions are mapped to screen coordinates in the range `-377777..+377777` along the two axes. Thanks to the 18 bit one's complement number representation of the PDP-1, toroidal space — popping up at the other side when crossing the borders of the screen — will come for free: By adding 1 to `377777`, we'll end up at `400000`, or `-377777`."

**Masswerk Part 5** (Ships):
> "any update resulting in a potential off-screen position will just cause an overflow (which isn't cared for in any way) and the ship will pop up right on the other side."

The web runtime implementation confirms wrapping at ±131071, not ±512:
```javascript
function wrapPos(s) {
  if (s.x > 131071) s.x = i18(s.x - 262144);
  // ...
}
```

### 2. `var` Keyword (Invalid DIGS)

The existing processor used `var x = position_x` and mutation (`x = x - full_range`). DIGS has **no mutable variables** — only `let` bindings with shadowing and `output` statements.

### 3. `as` Type Casting (Invalid DIGS)

The expression `0o1000 as spacewar:fixed18` uses a type-casting syntax that does not exist in the DIGS grammar. Integer literals used in `spacewar:fixed18` context are typed by the context of their usage.

### 4. Missing `#! runs-prim 1.0` Header

The existing processor lacked the mandatory version declaration.

### 5. Missing `output` Statements

The existing processor used direct assignment (`position_x = x`) rather than the required `output` statement syntax.

## Surprising Findings

### The Processor Is Architecturally a No-Op

The wrapping the PDP-1 does is inherent in the 18-bit word size. Since `spacewar:fixed18` (width: 18, complement: ones, range: ±131071) defines the arithmetic rules for all position values, every upstream processor (`velocity_integrate`, `thrust`, `gravity`) already produces values wrapped within this range. The `wrap_position` processor exists purely for architectural documentation — it makes the implicit PDP-1 hardware behavior visible in the RUNS Petri net graph.

This is a legitimate design choice: it ensures that any reader of the network topology immediately sees that positions are toroidally wrapped after velocity integration, without needing to understand the type system's overflow rules.

### The 10 Bits Are Display, Not Game Logic

The PDP-1's Type 30 CRT uses 10-bit display registers (1024×1024 addressable points). But the game logic operates on the full 18-bit word. The display instruction `dpy` extracts the top 10 bits from each of the AC (Y) and IO (X) registers, discarding the low 8 bits. This means:
- Game positions have 8 bits of sub-pixel precision (256 sub-pixel steps per display pixel)
- Toroidal wrapping occurs at the word boundary (18 bits = ±131071), not the display boundary (10 bits = ±512)

## Concordance Corrections Needed

### `display_config.runs`

The record's comments describe the display as "1024×1024" and say the runtime should map game units to pixels. This is fine, but should not be confused with wrapping boundaries. The `display_config` record is **not** needed by this processor since wrapping is type-intrinsic.

### `04_conversion_phases.md` (Phase 4, Work Item 5)

States:
> "Input: `position_x/y`, `display_config.width/height`."

The processor should **NOT** take `display_config` as input. Wrapping does not depend on display dimensions — it depends on the `spacewar:fixed18` type's range, which is fixed at ±131071.

The document also says:
> "a position at 512 wraps to -511 automatically"

This should read: "a position at 131071 wraps to -131071 automatically" (18-bit word overflow, not 10-bit display overflow).

## Sub-Processor Dependencies

None. This processor calls no sub-processors.

## Test Vectors

Since the processor is a type-enforcing pass-through (identity function), all test vectors should produce output identical to input:

| Input X | Input Y | Output X | Output Y | Notes |
|---------|---------|----------|----------|-------|
| 0 | 0 | 0 | 0 | Origin: unchanged |
| 65536 | 65536 | 65536 | 65536 | Ship 1 init position (200000₈): unchanged |
| -65536 | -65536 | -65536 | -65536 | Ship 2 init position: unchanged |
| 131071 | -131071 | 131071 | -131071 | Maximum range boundary: unchanged |
| 100 | -100 | 100 | -100 | Small values: unchanged |

The wrapping is tested at the *arithmetic* level — when `velocity_integrate` adds a velocity to a position near the boundary, the `spacewar:fixed18` type's overflow behavior produces the wrapped result. The `wrap_position` processor simply passes the already-wrapped value through.

For an integration-level test that demonstrates the toroidal wrapping:
- Ship at position_x = 131000, velocity_x = 256, `scale_shift` = 0
- After `velocity_integrate`: new_x = `i18(131000 + 256)` = `i18(131256)` → wraps to a negative value in 18-bit ones-complement
- The `wrap_position` pass-through preserves this wrapped value
