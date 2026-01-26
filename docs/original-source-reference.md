# Spacewar! Original PDP-1 Source Code (1962)

This document preserves the original PDP-1 assembly source code for Spacewar! from 1962, retrieved from the JonnieCache gist.

**Source**: https://gist.github.com/JonnieCache/4258114

## Historical Context

Spacewar! was one of the first digital computer games, developed in 1962 by Steve Russell, Martin Graetz, and Wayne Wiitanen at MIT on the PDP-1 computer. The game features two spaceships ("wedge" and "needle") battling in a gravity well around a central star.

## Key Game Constants (from source)

```assembly
tno = 41        ; Number of torpedoes + 1
tvl = sar 4s    ; Torpedo velocity (shift right 4)
rlt = 20        ; Torpedo reload time
tlf = 140       ; Torpedo lifetime
foo = -20000    ; Fuel supply
maa = 10        ; Angular acceleration
sac = sar 4s    ; Ship acceleration
str = 1         ; Star capture radius
me1 = 6000      ; Collision radius
mhs = 10        ; Hyperspace shots available
```

## Game Mechanics

### Physics
- **Gravity**: Inverse-square law toward central star
- **Thrust**: Impulse in facing direction, consumes fuel
- **Rotation**: Angular velocity with acceleration
- **Torpedoes**: Inherit ship velocity + muzzle velocity, affected by gravity
- **Screen Wrap**: Toroidal topology (edges wrap)

### Controls (Original)
- **Rotate CCW/CW**: Change ship orientation
- **Thrust**: Apply acceleration in facing direction
- **Fire Torpedo**: Launch projectile
- **Hyperspace**: Emergency teleport (risky, limited uses)

### Entities
- **2 Spaceships**: Player-controlled, wedge and needle shapes
- **Up to 64 Torpedoes**: 32 per ship maximum
- **1 Central Star**: Gravitational attractor, collision = death
- **~400 Background Stars**: Decorative, based on real star catalog

## Technical Details

- **Platform**: PDP-1 (18-bit word, 4K words of memory)
- **Display**: Vector graphics on oscilloscope
- **Arithmetic**: 18-bit fixed-point
- **Frame Rate**: ~60 Hz (tied to display refresh)

## Original Source Code

> **Note**: The complete assembly listing is extremely long (~6000+ lines). Key sections are excerpted below. Full source available at the gist link above.

### Sine/Cosine Subroutine (Lines 66-155)

```assembly
cos,
0
dap csx
lac (62210
add cos
dac sin
jmp .+4
sin,
0
dap csx
lac sin
spa
si1,
add (311040
sub (62210
sma
jmp si2
add (62210
si3,
ral 2s
; [multiply operations]
; [Taylor series approximation]
```

### Main Control Loop (Lines 1444-1555)

```assembly
ml0,
load ~mtc, -4000    ; delay for loop
init ml1, mtb       ; loc of calc routines
; [ship initialization]
; [torpedo management]
; [collision detection]
```

### Gravity Calculation

The original used inverse-square gravity with fixed-point arithmetic:

```assembly
; Calculate direction to star
dx = star.x - ship.x
dy = star.y - ship.y

; Distance squared (no sqrt)
dist_sq = dx * dx + dy * dy

; Acceleration = G / dist^2
accel_x = (G * dx) / dist_sq
accel_y = (G * dy) / dist_sq

; Apply to velocity
velocity.dx += accel_x
velocity.dy += accel_y
```

### Collision Detection

Simple radius-based overlap:

```assembly
; Ship-Star collision
dist_sq = distance_squared(ship.pos, star.pos)
if dist_sq < capture_radius_sq:
  ship.alive = false

; Ship-Ship collision  
dist_sq = distance_squared(ship1.pos, ship2.pos)
if dist_sq < collision_radius_sq:
  ship1.alive = false
  ship2.alive = false
```

### Hyperspace Jump

Randomized teleport with uncertainty:

```assembly
if hyperspace_button and hyperspace_charges > 0:
  hyperspace_charges -= 1
  
  ; Random new position
  ship.x = random(0, screen_width)
  ship.y = random(0, screen_height)
  
  ; Random velocity impulse (danger!)
  ship.vx += random(-uncertainty, uncertainty)
  ship.vy += random(-uncertainty, uncertainty)
```

## References

- **Original Gist**: https://gist.github.com/JonnieCache/4258114
- **Spacewar! Wikipedia**: https://en.wikipedia.org/wiki/Spacewar!
- **Computer History Museum**: https://www.computerhistory.org/revolution/computer-games/16/182

## RUNS Port Notes

This source serves as the reference for the RUNS implementation. Key adaptations:

1. **Fixed-Point → Flexible**: RUNS allows runtime to choose representation
2. **Monolithic → Modular**: Each mechanic becomes a separate Processor
3. **Binary → Plain-Text**: Networks and Processors as Nostr events
4. **Single Runtime → Multi-Runtime**: Same logic runs on web, desktop, embedded

The goal is to preserve the **gameplay feel** while demonstrating RUNS's architectural benefits.
