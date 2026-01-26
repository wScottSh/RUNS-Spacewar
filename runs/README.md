# RUNS Components for Spacewar!

This directory contains the RUNS (Record Update Network System) layer: Fields, Processors, and Networks that define game logic.

## Structure

```
runs/
├── fields/             # Field schemas (data shapes)
│   ├── runs/          # Standard Library fields
│   │   ├── position_2d.yaml
│   │   ├── velocity_2d.yaml
│   │   ├── angle.yaml
│   │   └── delta_time.yaml
│   └── spacewar/      # Game-specific fields
│       ├── entity_type.yaml
│       ├── fuel.yaml
│       ├── control_state.yaml
│       └── ...
├── processors/         # Processor definitions (.runs-prim)
│   ├── math/
│   │   ├── add_vec2.runs-prim
│   │   ├── scale_vec2.runs-prim
│   │   └── distance_squared.runs-prim
│   ├── physics/
│   │   ├── integrate_velocity.runs-prim
│   │   ├── apply_gravity.runs-prim
│   │   └── wrap_position.runs-prim
│   ├── control/
│   │   ├── apply_rotation.runs-prim
│   │   └── apply_thrust.runs-prim
│   └── combat/
│       ├── fire_torpedo.runs-prim
│       ├── check_collision.runs-prim
│       └── tick_lifetime.runs-prim
├── networks/           # Network wiring (.runs-net)
│   └── spacewar_main.runs-net
└── README.md
```

## Field Namespaces

- **`runs:`** - Reserved for Standard Library (exact schemas required)
- **`spacewar:`** - Game-specific umbrella prefix
- **`aems:`** - AEMS integration fields (entity/manifestation refs)

## Processor Format

Processors use plain-text `.runs-prim` format:

```text
processor add_vec2
inputs:
  a: runs:position_2d
  b: runs:velocity_2d
outputs:
  result: runs:position_2d

result.x = a.x + b.x
result.y = a.y + b.y
```

## Network Format

Networks use YAML `.runs-net` format defining tick phases and processor wiring.

## Publishing to Nostr

Each Processor and Network is published as a separate Nostr event (kind 30078) with:
- `note_id` for content-addressed provenance
- `umbrella` tag linking to `spacewar:` manifest
- `depends` tags for dependency chains

## References

- **RUNS Protocol**: https://github.com/decentralized-game-standard/runs-standard
- **RUNS Standard Library**: https://github.com/decentralized-game-standard/runs-standard-library
