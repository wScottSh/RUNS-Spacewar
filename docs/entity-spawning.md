# Entity Spawning Mechanism

This document describes how RUNS Networks handle dynamic entity creation (e.g., firing torpedoes).

## Overview

RUNS Processors are pure and stateless—they cannot directly create new Records. Instead, Processors **emit spawn events** that the runtime processes after the tick completes.

## Spawn Flow

```
1. Processor executes
   └── fire_torpedo outputs: spawn_torpedo = true, torpedo_pos, torpedo_vel, torpedo_owner

2. Runtime collects spawn events
   └── Spawn queue: [{ type: torpedo, pos: {...}, vel: {...}, owner: 0 }]

3. Tick completes

4. Runtime processes spawn queue
   └── Creates new Record with:
       - id: <generated>
       - spacewar:entity_type: torpedo
       - runs:position_2d: torpedo_pos
       - runs:velocity_2d: torpedo_vel
       - spacewar:player_id: torpedo_owner
       - spacewar:lifetime: 140
       - spacewar:is_alive: true

5. New Record participates in next tick
```

## Network Syntax

In the Network definition, spawning is declared in the processor block:

```yaml
- fire_torpedo:
    query: entity_type == ship and is_alive
    inputs: [control_state, position_2d, velocity_2d, angle, torpedo_count, player_id]
    params:
      torpedo_speed: 32768
    outputs: [torpedo_count]
    spawns:
      type: torpedo
      fields:
        spacewar:entity_type: torpedo
        spacewar:lifetime: 140
        spacewar:is_alive: true
        runs:position_2d: ${output.torpedo_pos}
        runs:velocity_2d: ${output.torpedo_vel}
        spacewar:player_id: ${output.torpedo_owner}
```

## Runtime Responsibilities

1. **Detect spawn signals**: Check Processor outputs for spawn flags
2. **Queue spawns**: Collect all spawn events during tick
3. **Defer creation**: Only create Records after tick completes (maintains determinism)
4. **Generate IDs**: Assign unique Record IDs to new entities
5. **Initialize Fields**: Set all required Fields from spawn declaration

## Destruction Flow

Similar mechanism for destroying entities:

```yaml
- despawn_expired:
    query: entity_type == torpedo and lifetime == 0
    action: destroy
```

Runtime removes matched Records from storage after tick completes.

## Why This Design?

1. **Purity**: Processors remain stateless and testable
2. **Determinism**: Spawn order is well-defined (Processor execution order)
3. **Composability**: Any Processor can emit spawn events
4. **Clarity**: Network declares what gets created, not how

## Example: Torpedo Lifecycle

```
Tick N:   fire_torpedo emits spawn event
Tick N+1: Torpedo Record exists, apply_gravity/integrate_velocity run
Tick N+2: tick_lifetime decrements (140 → 139)
...
Tick N+140: lifetime == 1 → 0
Tick N+141: despawn_expired destroys torpedo Record
```
