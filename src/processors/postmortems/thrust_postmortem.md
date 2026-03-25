# Thrust Processor Postmortem

**Processor**: `spacewar:thrust`
**Source Lines**: L1167-1186 (bsg through second diff call)
**Date**: 2026-03-25

## Discrepancies Found

### 1. Fuel Decrement — Removed (Wrong Processor)

The old processor included fuel decrement logic:

```
# Old (WRONG — not part of L1167-1186):
var fuel = object.fuel + 1
if fuel >= 0:
  fuel = 0
object = object with { fuel = fuel }
```

The PDP-1 fuel decrement (`count i \mfu, st2; dzm i \mfu`) occurs at **L1222-1224**, inside the exhaust flame rendering loop at label `sq7`. This is part of the display code, not the thrust computation. The thrust processor's scope (L1167-1186) never touches fuel — it only reads flag 6 (which was set based on fuel availability during control word parsing at L1105-1110) and checks it again via `sad i \mfu` at L1168 as a redundant safety measure.

Masswerk confirms this separation: the flame drawing loop at `sq7` "checks and increments" fuel, and each dot drawn burns one unit of fuel.

### 2. `flame_length` Output — Removed (Wrong Processor)

The old processor produced a `flame_length` output:

```
# Old (WRONG — not part of L1167-1186):
flame_length = 4  # Semantic: "thrusting"
```

The exhaust flame rendering (L1215-1227: `ranct`/`sq7`/`st2` loop) is a separate display concern. The `ranct` macro at L1215 generates a random flame length; the loop draws dots and burns fuel per dot. None of this logic exists in L1167-1186.

### 3. Invalid DIGS Syntax

The old processor used `var` and mutable assignment:

```
# Old (INVALID DIGS):
var accel_y = gravity_y
var accel_x = gravity_x
```

DIGS has no `var` keyword and no mutable variables. The new processor uses `let` bindings with conditional expressions:

```runs-prim
let accel_y = if thrust_enabled then cos_thrust + gravity_y else gravity_y
```

### 4. Source Line Reference for Fuel

The old processor cited "Source: L1225-1226" for the fuel decrement. The actual instructions at L1225-1226 in the PDP-1 source are within the spaceship display/outline rendering section:

- L1222: `count i \mfu, st2` — increment fuel, jump to st2 if still negative
- L1223: `dzm i \mfu` — if positive (exhausted), zero it
- L1224: `jmp sq9` — exit flame loop

These are 36-58 lines away from the thrust processor's scope and belong to the exhaust display routine.

## Surprising Findings

### Redundant Fuel Check at bsg

L1167-1169 (`cla; sad i \mfu; clf 6`) performs a redundant fuel check at the entry to thrust computation. Flag 6 was already set/cleared based on fuel during control word parsing (L1105-L1110: `lio i \mfu; spi i; clf 6`). Masswerk explains: *"the code is making pretty sure that the flag would not be set when the ship would be run out of fuel."*

This matters for DIGS modeling: the `thrust_enabled` input already encodes both "thrust button pressed" AND "fuel available", so the redundant check is implicit. The DIGS processor doesn't need to re-check fuel.

### Negation of Sine for X-Axis

L1182 (`cma`) negates the sine component before adding it to gravity_x. This is because in the PDP-1 coordinate system, the ship's forward direction (nose-first thrust) results in a *decrease* in X for positive sin(angle). The cosine component for Y is NOT negated.

### Scale Factor Chain

The thrust component undergoes two shifts: `sar 9s` (normalize sine/cosine to single-display-location scale) followed by `xct sac` (execute the instruction stored at `sac`, which is `sar 4s`). Total: `>> 13`. With sac's default value of 4, the maximum thrust acceleration is `1/8192` of a full-scale value per frame. This builds up through velocity integration.

## Concordance Corrections Needed

None identified. The DIGS spec, game_constants.runs, and object.runs are all consistent with the PDP-1 source.

## Sub-Processor Dependencies

| Sub-Processor | DIGS Body Written? | Status |
|---|---|---|
| `spacewar:velocity_integrate` | ✅ Yes | Complete (L160-167 diff macro) |

## Test Vectors

### Test 1: No Thrust, No Gravity

- **Input**: thrust_enabled=false, gravity_x=0, gravity_y=0, vel_x=100, vel_y=200, pos_x=1000, pos_y=2000
- **Expected**: accel_x=0, accel_y=0 → vel_x=100, vel_y=200, pos_x=1000+(100>>3)=1012, pos_y=2000+(200>>3)=2025

### Test 2: Thrust Only, No Gravity

- **Input**: thrust_enabled=true, cos_heading=131071, sin_heading=0, gravity_x=0, gravity_y=0, vel=0, pos=0
- **Expected**: cos_thrust = 131071 >> 13 = 15, accel_y=15, accel_x=0 → vel_y=15, pos_y=15>>3=1

### Test 3: Thrust + Gravity

- **Input**: thrust_enabled=true, cos_heading=65536, sin_heading=65536, gravity_x=-10, gravity_y=5, vel_x=0, vel_y=0, pos=0
- **Expected**: cos_thrust = 65536>>13 = 8, sin_thrust = -(65536>>13) = -8
- accel_y = 8 + 5 = 13, accel_x = -8 + (-10) = -18
- vel_y=13, pos_y=13>>3=1; vel_x=-18, pos_x=-18>>3=-3
