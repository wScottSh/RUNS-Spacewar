# runs:velocity_2d

**Type**: Struct  
**Namespace**: `runs:` (Standard Library)  
**Status**: Proposed for 2D variant

## Description

2D velocity in fixed-point Q16.16 format. Rate of change of position per tick.

## Schema

```yaml
runs:velocity_2d:
  type: struct
  fields:
    dx:
      type: i32
      format: Q16.16 fixed-point
      description: Horizontal velocity component
    dy:
      type: i32
      format: Q16.16 fixed-point
      description: Vertical velocity component
```

## Usage

```yaml
# Example: Stationary
velocity: runs:velocity_2d
  dx: 0
  dy: 0

# Example: Moving right at 5.0 units/tick
velocity: runs:velocity_2d
  dx: 327680    # 5.0 in Q16.16 (5 << 16)
  dy: 0
```

## Notes

- Units: position units per tick
- Integrates with `runs:position_2d` via `integrate_velocity` Processor
- Affected by gravity, thrust, and other forces
