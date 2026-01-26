# spacewar:torpedo_count

**Type**: Scalar  
**Namespace**: `spacewar:` (Game-specific)

## Description

Remaining torpedoes available to fire. Decrements on each launch.

## Schema

```yaml
spacewar:torpedo_count:
  type: u8
  initial_value: 32
  min_value: 0
  max_value: 32
```

## Usage

```yaml
# Full complement
torpedo_count: 32

# Half depleted
torpedo_count: 16

# Empty
torpedo_count: 0
```

## Notes

- Original Spacewar! constant: `tno = 41` (torpedoes + 1)
- Fire disabled when torpedo_count == 0
- No reloading in original game
- Reload time between shots: 20 ticks (~0.33 seconds)
