# runs:angular_velocity

**Type**: Scalar  
**Namespace**: `runs:` (Standard Library)  
**Status**: Proposed for 2D variant

## Description

Angular velocity in radians per tick, Q16.16 fixed-point. Rate of rotation for 2D objects.

## Schema

```yaml
runs:angular_velocity:
  type: i32
  format: Q16.16 fixed-point
  unit: radians/tick
```

## Usage

```yaml
# Example: Not rotating
angular_velocity: 0

# Example: Rotating clockwise slowly
angular_velocity: 655    # ~0.01 rad/tick in Q16.16

# Example: Rotating counter-clockwise
angular_velocity: -655   # ~-0.01 rad/tick
```

## Notes

- Positive = clockwise rotation
- Negative = counter-clockwise rotation
- Integrates with `runs:angle` via `apply_rotation` Processor
- Original Spacewar! used angular acceleration of 10 units
