# spacewar:fuel

**Type**: Scalar  
**Namespace**: `spacewar:` (Game-specific)

## Description

Remaining fuel units for ship thrust. Depletes by 1 per tick when thrusting.

## Schema

```yaml
spacewar:fuel:
  type: i32
  initial_value: 20000
  min_value: 0
```

## Usage

```yaml
# Full tank
fuel: 20000

# Half depleted
fuel: 10000

# Empty
fuel: 0
```

## Notes

- Original Spacewar! constant: `foo = -20000` (stored as negative)
- Thrust disabled when fuel == 0
- No refueling in original game (finite resource)
- At 60 Hz with constant thrust: ~333 seconds of fuel
