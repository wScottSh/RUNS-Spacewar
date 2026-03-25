# Postmortem: build_render_list

## Architectural Note

This processor has **no single PDP-1 counterpart**. In the original Spacewar! 3.1, rendering is tightly interleaved with entity computation — each entity's handling routine (ss1/ss2, tcr, mex, hp1, hp3) both computes AND displays in one pass via `dpy`/`dispt` instructions. The RUNS architecture separates these concerns: `build_render_list` collects the scattered rendering decisions into a single output list that the runtime draws.

## Discrepancies Found

### 1. Torpedo Brightness (MINOR)

The existing processor set `brightness = 0` for torpedoes:

```
# OLD (WRONG):
brightness = 0,
```

The PDP-1 source at L1004 uses `dispt i, i my1, 1` — the trailing `1` is the brightness/intensity parameter passed to the display instruction. The correct value is:

```digs
brightness = 1,  # L1004: dispt i, i my1, 1
```

### 2. Invalid Constructs (STRUCTURAL)

The existing processor used many constructs not in the DIGS spec:

| Invalid | Replacement |
|---------|-------------|
| `var list: ... = []` | Self-referential `output render_list = ...` |
| `match obj.state:` / `case:` | `if`/`elif`/`else` chain |
| `continue` | `output render_list = render_list` (no-op passthrough) |
| `for i from 0 to 23:` | `for obj in objects:` |
| `list + [{...}]` | `output render_list = render_list ++ [{...}]` |
| `render_list = list` (bare) | `output render_list = ...` (per-branch) |

### 3. Missing `#! runs-prim 1.0` Declaration

The existing processor had no version declaration. Added per DIGS spec section "Processor Structure".

### 4. Missing Else Branch

The existing processor had no fallback for unknown states. Added `else: output render_list = render_list` to satisfy the DIGS requirement that "every declared output field must be assigned exactly once along every execution path."

## Surprising Findings

1. **Hyperspace breakout renders as a ship outline, not just a point**: The existing processor correctly renders `hyperspace_out` as a `ship` type with the outline data included, even though L1075-1076 only shows `dispt i, i my1, 2` (a single point at intensity 2). However, the PDP-1 routine at hp3 (L1050) eventually transitions back to the normal ship routine (ss1/ss2) before the breakout phase completes, and during that transition the outline IS displayed. The existing processor's approach of rendering breakout-phase ships with their outline is a valid simplification.

2. **The central star is always displayed**: L938-939 shows `background; jsp blp` called unconditionally after the entity loop completes, regardless of any entity's state. The central star and the Expensive Planetarium background are both always present (unless SW4 disables the background, but the central star via `blp` is independent of SW4).

3. **Explosion particle_seed and particle_count are set to 0**: These fields are placeholders — the actual particle parameters are computed by the `explosion_tick` processor and must be plumbed through the rendering pipeline separately. This is a known limitation of the current architecture.

## Sub-Processor Dependencies

None. `build_render_list` is a pure projection with no sub-processor calls.

## Test Vectors

### Vector 1: Empty world — only central star

```
Input:
  objects = [24 × { state: empty, ... }]
  configs = [2 × { ... }]

Expected:
  render_list = [{
    object_type: central_star, position_x: 0, position_y: 0,
    angle: 0, brightness: 0, ...
  }]
  Length: 1
```

### Vector 2: Two ships — central star + 2 ship entries

```
Input:
  objects[0] = { state: ship, position_x: 65536, position_y: 65536,
                 angle: 51472, outline_ref: 0, ... }
  objects[1] = { state: ship, position_x: -65536, position_y: -65536,
                 angle: 0, outline_ref: 1, ... }
  objects[2..23] = { state: empty, ... }

Expected:
  render_list length: 3 (1 central star + 2 ships)
  render_list[0] = { object_type: central_star, ... }
  render_list[1] = { object_type: ship, position_x: 65536, angle: 51472,
                     outline_data: configs[0].outline_data, brightness: 0 }
  render_list[2] = { object_type: ship, position_x: -65536, angle: 0,
                     outline_data: configs[1].outline_data, brightness: 0 }
```

### Vector 3: Ship + torpedo + explosion + hyperspace

```
Input:
  objects[0] = { state: ship, position_x: 100, ... }
  objects[1] = { state: exploding, position_x: 200, ... }
  objects[2] = { state: torpedo, position_x: 300, ... }
  objects[3] = { state: hyperspace_in, position_x: 400, ... }
  objects[4] = { state: hyperspace_out, position_x: 500, angle: 1000,
                 outline_ref: 0, ... }
  objects[5..23] = { state: empty, ... }

Expected:
  render_list length: 5 (1 central + ship + explosion + torpedo + breakout ship)
  render_list[0] = { object_type: central_star, ... }
  render_list[1] = { object_type: ship, brightness: 0, ... }
  render_list[2] = { object_type: explosion, ... }
  render_list[3] = { object_type: torpedo, brightness: 1, ... }
  # hyperspace_in: NOT rendered (skipped)
  render_list[4] = { object_type: ship, brightness: 2, ... }
```

### Vector 4: Torpedo brightness correctness

```
Input:
  objects[2] = { state: torpedo, position_x: 1024, position_y: -2048, ... }

Expected:
  render_list entry for this torpedo:
    object_type: torpedo
    position_x: 1024
    position_y: -2048
    brightness: 1       # L1004: dispt i, i my1, 1
```
