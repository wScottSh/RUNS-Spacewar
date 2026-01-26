# runs:delta_time

**Type**: Scalar  
**Namespace**: `runs:` (Standard Library)  
**Status**: Standard Library field

## Description

Frame timestep provided by runtime. Used for frame-rate independent physics integration.

## Schema

```yaml
runs:delta_time:
  type: float
  unit: seconds
  typical_value: 0.016667  # 60 Hz
```

## Usage

```yaml
# Provided by runtime each tick
delta_time: 0.016667  # 1/60 second at 60 Hz
```

## Notes

- Runtime-provided, not stored in Records
- For Spacewar! prototype: fixed at 1/60 second (60 Hz tick rate)
- Used by `integrate_velocity` and other physics Processors
- Enables frame-rate independence if runtime varies tick rate
