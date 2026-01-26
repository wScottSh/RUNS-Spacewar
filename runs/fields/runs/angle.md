# runs:angle

**Type**: Scalar  
**Namespace**: `runs:` (Standard Library)  
**Status**: Proposed

## Description

Angle in radians, Q16.16 fixed-point format. Single-axis rotation for 2D games.

## Schema

```yaml
runs:angle:
  type: i32
  format: Q16.16 fixed-point
  unit: radians
  range: 0 to 2π (0 to 411775 in Q16.16)
```

## Usage

```yaml
# Example: Facing right (0 radians)
angle: 0

# Example: Facing up (π/2 radians)
angle: 102944    # ~1.5708 in Q16.16

# Example: Facing left (π radians)
angle: 205887    # ~3.14159 in Q16.16
```

## Notes

- 0 radians = facing right (+X axis)
- π/2 radians = facing up (+Y axis)
- Wraps at 2π (full rotation)
- Used with `sin_cos` Processor for thrust/torpedo direction
