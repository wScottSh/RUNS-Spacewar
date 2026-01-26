# spacewar:control_state

**Type**: Bitfield  
**Namespace**: `spacewar:` (Game-specific)

## Description

Player input state packed as bitfield. Runtime maps physical input (keyboard/gamepad) to this Field.

## Schema

```yaml
spacewar:control_state:
  type: bitfield
  bits:
    rotate_ccw: 1    # Bit 0: Rotate counter-clockwise
    rotate_cw: 1     # Bit 1: Rotate clockwise
    thrust: 1        # Bit 2: Apply thrust
    fire: 1          # Bit 3: Fire torpedo
    hyperspace: 1    # Bit 4: Hyperspace jump
```

## Usage

```yaml
# No input
control_state: 0b00000

# Thrusting only
control_state: 0b00100

# Rotating CW + thrusting
control_state: 0b00110

# All inputs (unlikely but valid)
control_state: 0b11111
```

## Notes

- Runtime-specific mapping (keyboard/gamepad → bitfield)
- Original Spacewar! used test switches on PDP-1 console
- Processors read individual bits: `if control.thrust and fuel > 0`
- Per RUNS Protocol: input mapping is per-runtime, not standardized
