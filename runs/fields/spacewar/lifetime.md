# spacewar:lifetime

**Type**: Scalar  
**Namespace**: `spacewar:` (Game-specific)

## Description

Ticks remaining until object despawns. Used for torpedoes and temporary effects.

## Schema

```yaml
spacewar:lifetime:
  type: u16
  initial_value: 140  # For torpedoes
  min_value: 0
```

## Usage

```yaml
# Newly spawned torpedo
lifetime: 140

# Half-expired
lifetime: 70

# About to despawn
lifetime: 1
```

## Notes

- Original Spacewar! constant: `tlf = 140` (torpedo lifetime)
- At 60 Hz: 140 ticks = ~2.33 seconds
- Decrements by 1 each tick via `tick_lifetime` Processor
- Object destroyed when lifetime == 0
