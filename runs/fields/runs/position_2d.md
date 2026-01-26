# runs:position_2d

**Type**: Struct  
**Namespace**: `runs:` (Standard Library)  
**Status**: Proposed for 2D variant

## Description

2D position in fixed-point Q16.16 format. Proposed addition to RUNS Standard Library for 2D games.

## Schema

```yaml
runs:position_2d:
  type: struct
  fields:
    x:
      type: i32
      format: Q16.16 fixed-point
      description: Horizontal position (16.16 fixed-point)
    y:
      type: i32
      format: Q16.16 fixed-point
      description: Vertical position (16.16 fixed-point)
```

## Usage

```yaml
# Example: Ship at screen center
position: runs:position_2d
  x: 0          # 0.0 in fixed-point
  y: 0          # 0.0 in fixed-point

# Example: Ship offset right
position: runs:position_2d
  x: 13107200   # 200.0 in Q16.16 (200 << 16)
  y: 0
```

## Notes

- Q16.16 format: 16 bits integer, 16 bits fraction
- Range: -32768.0 to +32767.99998
- Precision: ~0.000015 (1/65536)
- Matches original Spacewar! 18-bit fixed-point philosophy
