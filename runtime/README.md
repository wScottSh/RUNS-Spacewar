# Spacewar! Runtime

This directory will contain runtime implementations that execute RUNS Networks.

## Planned Runtimes

### JavaScript/TypeScript (Phase 1)
Browser-based interpreter for rapid prototyping and demonstration.

**Features:**
- Dynamic Network loading from Nostr events
- Canvas-based rendering (vector graphics)
- Keyboard input mapping
- 60 Hz tick rate

### Future Runtimes
- **Rust Native**: High-performance desktop runtime with graph fusion
- **WebAssembly**: Compiled RUNS for near-native browser performance
- **Embedded**: Minimal interpreter for resource-constrained devices

## Runtime Requirements

Per RUNS Protocol, all runtimes must:
1. Load Networks from plain-text Nostr events
2. Resolve `spacewar:` umbrella to manifest `note_id`
3. Fetch dependency tree (RUNS Standard Library)
4. Verify signatures and content integrity
5. Execute Processors in declared phase order
6. Support dynamic resolution (dev) and static flattening (production)

## Development Status

> **Phase 1 (Current)**: JavaScript interpreter in development

Check `js/` subdirectory for implementation progress.
