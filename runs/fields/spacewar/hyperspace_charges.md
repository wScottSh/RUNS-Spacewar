# spacewar:hyperspace_charges

**Type**: Scalar  
**Namespace**: `spacewar:` (Game-specific)

## Description

Remaining hyperspace jumps available. Emergency teleport with random uncertainty.

## Schema

```yaml
spacewar:hyperspace_charges:
  type: u8
  initial_value: 3
  min_value: 0
```

## Usage

```yaml
# Full charges
hyperspace_charges: 3

# One remaining
hyperspace_charges: 1

# Depleted
hyperspace_charges: 0
```

## Notes

- Original Spacewar! constant: `mhs = 10`
- This implementation uses 3 for balance
- Hyperspace is risky: random position + velocity impulse
- Last-resort escape mechanism
