# RUNS Spacewar! - First RUNS Prototype Implementation

**Status**: In Development  
**Version**: 0.1.0  
**Started**: 2026-01-25

## Overview

This is the **first prototype implementation** of the RUNS (Record Update Network System) architecture, porting the classic Spacewar! (1962) game to demonstrate:

- **Minimal Primitives**: ~15 granular Processors (add_vec2, apply_gravity, etc.)
- **Plain-Text Distribution**: All components as Nostr events with provenance chains
- **AEMS Integration**: Game objects as universal Entities with multiple Manifestations
- **Multi-Runtime**: Same Networks run on different interpreters

## Project Structure

```
runs-spacewar/
├── docs/
│   ├── original-source-reference.md    # PDP-1 assembly source archive
│   └── implementation-plan.md          # Detailed design document
├── aems/
│   ├── entities/                       # Kind 30001 events (std:spacewar-*)
│   ├── manifestations/                 # Kind 30002 events (classic-1962:*, ascii:*)
│   └── README.md
├── runs/
│   ├── fields/                         # Field schemas (runs:*, spacewar:*)
│   ├── processors/                     # Processor definitions (.runs-prim)
│   ├── networks/                       # Network wiring (.runs-net)
│   └── README.md
├── runtime/
│   ├── js/                            # JavaScript/TypeScript interpreter
│   └── README.md
└── README.md
```

## Quick Start

> **Note**: Implementation in progress. Check back for runtime instructions.

## Design Decisions

Based on user feedback:

1. **RNG**: Classic LFSR (Linear Feedback Shift Register) as in original, defined as `runs:` primitive
2. **Entity Spawning**: Processors emit spawn events, runtime processes queue after tick
3. **Death/Respawn**: Both modes supported (instant respawn vs. game over)
4. **Input Mapping**: Per-runtime (keyboard/gamepad → `spacewar:control_state`)

## References

- **RUNS Protocol**: https://github.com/decentralized-game-standard/runs-standard
- **RUNS Standard Library**: https://github.com/decentralized-game-standard/runs-standard-library
- **AEMS Standard**: https://github.com/decentralized-game-standard/aems-standard
- **Original Spacewar!**: https://gist.github.com/JonnieCache/4258114

## License

MIT License - Open for implementation, extension, critique.
