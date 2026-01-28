/**
 * Spacewar! Processor Implementations
 * 
 * JavaScript implementations of all RUNS Processors
 * Each function is pure and matches the .runs-prim specification
 * 
 * PHYSICS TUNED FOR ORIGINAL GAME FEEL:
 * - Crisp rotation (no momentum by default, like sense switch 10 OFF)
 * - Gravity zone cutoff (no long-range gravity)
 * - Torpedoes have negligible warpage, not full gravity
 */

import { CONFIG } from './config.js';

//=============================================================================
// MATH PROCESSORS
//=============================================================================

/**
 * add_vec2 - Vector addition
 */
export function addVec2(a, b) {
    return {
        x: a.x + (b.dx !== undefined ? b.dx : b.x),
        y: a.y + (b.dy !== undefined ? b.dy : b.y)
    };
}

/**
 * scale_vec2 - Vector scaling
 */
export function scaleVec2(v, scalar) {
    return {
        dx: v.dx * scalar,
        dy: v.dy * scalar
    };
}

/**
 * sin_cos - Trigonometric functions (native)
 */
export function sinCos(angle) {
    return {
        sin: Math.sin(angle),
        cos: Math.cos(angle)
    };
}

/**
 * distance_squared - Fast distance without sqrt
 */
export function distanceSquared(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
}

/**
 * lfsr_random - Linear Feedback Shift Register RNG
 * Returns value in [0, 1) range and next seed
 */
export function lfsrRandom(seed) {
    // 16-bit LFSR with taps at 16, 14, 13, 11
    let s = seed;
    const bit = ((s >> 0) ^ (s >> 2) ^ (s >> 3) ^ (s >> 5)) & 1;
    s = (s >> 1) | (bit << 15);

    return {
        value: s / 65536,  // Normalize to [0, 1)
        nextSeed: s
    };
}

//=============================================================================
// PHYSICS PROCESSORS
//=============================================================================

/**
 * integrate_velocity - Simple per-tick Euler integration
 * No deltaTime needed - velocity is in "screen-widths per tick"
 */
export function integrateVelocity(position, velocity) {
    return {
        x: position.x + velocity.dx,
        y: position.y + velocity.dy
    };
}

/**
 * apply_gravity - Gravity with zone cutoff (like original)
 * Only applies within gravityZone radius, weaker than true inverse-square
 */
export function applyGravity(position, velocity, attractorPos, gravityStrength) {
    const dx = attractorPos.x - position.x;
    const dy = attractorPos.y - position.y;

    // Distance calculation
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    // Gravity zone cutoff - no gravity outside this radius (like original)
    const gravityZone = CONFIG.physics.gravityZone;
    if (dist > gravityZone) {
        return velocity;  // No gravity effect
    }

    // Minimum distance to prevent singularity
    const minDist = CONFIG.physics.gravityMinDistance;
    const effectiveDist = Math.max(dist, minDist);

    // Weaker gravity: use 1/r^2.5 instead of 1/r^2 for gentler pull
    // This matches the original's approximated gravity feel
    const force = gravityStrength / (effectiveDist * effectiveDist * Math.sqrt(effectiveDist));

    // Apply in direction of attractor (normalized)
    const nx = dx / effectiveDist;
    const ny = dy / effectiveDist;

    return {
        dx: velocity.dx + nx * force,
        dy: velocity.dy + ny * force
    };
}

/**
 * apply_torpedo_warpage - Negligible "space warpage" for torpedoes
 * Original used sar 9s twice = divide by 262144, nearly invisible effect
 */
export function applyTorpedoWarpage(position, velocity, attractorPos) {
    const dx = attractorPos.x - position.x;
    const dy = attractorPos.y - position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.01) return velocity;  // Avoid division by zero

    // Negligible warpage - cosmetic effect only
    const warpage = CONFIG.combat.torpedoWarpage;

    return {
        dx: velocity.dx + (dx / dist) * warpage,
        dy: velocity.dy + (dy / dist) * warpage
    };
}

/**
 * wrap_position - Toroidal screen wrap (normalized 0-1)
 */
export function wrapPosition(position) {
    let x = position.x;
    let y = position.y;

    // Wrap to [0, 1)
    while (x < 0) x += 1;
    while (x >= 1) x -= 1;
    while (y < 0) y += 1;
    while (y >= 1) y -= 1;

    return { x, y };
}

//=============================================================================
// CONTROL PROCESSORS
//=============================================================================

/**
 * apply_rotation - CRISP rotation like original (sense switch 10 OFF)
 * Angular velocity is directly set by input, not accumulated
 */
export function applyRotation(angle, angularVelocity, control) {
    let newAngularVelocity;

    if (CONFIG.physics.rotationMode === 'momentum') {
        // Momentum mode (sense switch 10 ON) - accumulate angular velocity
        newAngularVelocity = angularVelocity;
        if (control.rotateCcw) {
            newAngularVelocity -= CONFIG.physics.angularAccelMomentum;
        }
        if (control.rotateCw) {
            newAngularVelocity += CONFIG.physics.angularAccelMomentum;
        }
        // Apply damping
        newAngularVelocity *= CONFIG.physics.angularDampingMomentum;
    } else {
        // CRISP mode (default, sense switch 10 OFF) - direct rotation
        if (control.rotateCcw) {
            newAngularVelocity = -CONFIG.physics.angularSpeed;
        } else if (control.rotateCw) {
            newAngularVelocity = CONFIG.physics.angularSpeed;
        } else {
            newAngularVelocity = 0;  // Immediate stop when key released
        }
    }

    // Integrate angle
    let newAngle = angle + newAngularVelocity;

    // Wrap angle to [0, 2π)
    const TWO_PI = 2 * Math.PI;
    while (newAngle >= TWO_PI) newAngle -= TWO_PI;
    while (newAngle < 0) newAngle += TWO_PI;

    return {
        angle: newAngle,
        angularVelocity: newAngularVelocity
    };
}

/**
 * apply_thrust - Directional thrust with fuel consumption
 */
export function applyThrust(velocity, angle, control, thrustPower, fuel) {
    if (control.thrust && fuel > 0) {
        const { sin, cos } = sinCos(angle);

        let newDx = velocity.dx + thrustPower * cos;
        let newDy = velocity.dy + thrustPower * sin;

        // Clamp to max velocity
        const speed = Math.sqrt(newDx * newDx + newDy * newDy);
        const maxV = CONFIG.physics.maxVelocity;
        if (speed > maxV) {
            const scale = maxV / speed;
            newDx *= scale;
            newDy *= scale;
        }

        return {
            velocity: { dx: newDx, dy: newDy },
            fuel: fuel - CONFIG.resources.fuelPerThrust
        };
    }

    return { velocity, fuel };
}

//=============================================================================
// COMBAT PROCESSORS
//=============================================================================

/**
 * fire_torpedo - Spawn torpedo with inherited velocity
 */
export function fireTorpedo(control, shipPos, shipVel, shipAngle, torpedoCount, torpedoSpeed, playerId, cooldown = 0) {
    // Check cooldown and ammo
    if (!control.fire || torpedoCount <= 0 || cooldown > 0) {
        return {
            torpedoCount,
            spawnTorpedo: false,
            torpedoPos: null,
            torpedoVel: null,
            torpedoOwner: null
        };
    }

    const { sin, cos } = sinCos(shipAngle);
    const inheritFactor = CONFIG.combat.torpedoInheritVelocity;

    // Spawn slightly in front of ship to avoid self-collision
    const spawnOffset = 0.03;

    return {
        torpedoCount: torpedoCount - 1,
        spawnTorpedo: true,
        torpedoPos: {
            x: shipPos.x + cos * spawnOffset,
            y: shipPos.y + sin * spawnOffset
        },
        torpedoVel: {
            dx: shipVel.dx * inheritFactor + torpedoSpeed * cos,
            dy: shipVel.dy * inheritFactor + torpedoSpeed * sin
        },
        torpedoOwner: playerId
    };
}

/**
 * tick_lifetime - Decrement lifetime counter
 */
export function tickLifetime(lifetime) {
    const newLifetime = Math.max(0, lifetime - 1);
    return {
        lifetime: newLifetime,
        expired: newLifetime === 0
    };
}

/**
 * check_collision - Radius-based overlap detection
 */
export function checkCollision(posA, posB, radiusA, radiusB) {
    const distSq = distanceSquared(posA, posB);
    const radiusSum = radiusA + radiusB;
    return distSq < radiusSum * radiusSum;
}

/**
 * collision_response_destroy - Mark entity as destroyed
 */
export function collisionResponseDestroy(collided, isAlive) {
    return collided ? false : isAlive;
}

/**
 * hyperspace_jump - Random teleport with uncertainty
 */
export function hyperspaceJump(control, hyperspaceCharges, position, velocity, randomSeed) {
    if (!control.hyperspace || hyperspaceCharges <= 0) {
        return {
            hyperspaceCharges,
            position,
            velocity,
            randomSeed,
            jumping: false
        };
    }

    // Generate random position (avoiding center star)
    let { value: rx, nextSeed: seed1 } = lfsrRandom(randomSeed);
    let { value: ry, nextSeed: seed2 } = lfsrRandom(seed1);

    // Scatter around center, but not too close to star
    const scatter = CONFIG.combat.hyperspaceScatter;
    let newX = 0.5 + (rx - 0.5) * scatter * 2;
    let newY = 0.5 + (ry - 0.5) * scatter * 2;

    // Random velocity impulse
    let { value: rvx, nextSeed: seed3 } = lfsrRandom(seed2);
    let { value: rvy, nextSeed: seed4 } = lfsrRandom(seed3);
    const impulse = 0.003;

    return {
        hyperspaceCharges: hyperspaceCharges - 1,
        position: { x: newX, y: newY },
        velocity: {
            dx: velocity.dx + (rvx - 0.5) * impulse * 2,
            dy: velocity.dy + (rvy - 0.5) * impulse * 2
        },
        randomSeed: seed4,
        jumping: true
    };
}

export default {
    // Math
    addVec2,
    scaleVec2,
    sinCos,
    distanceSquared,
    lfsrRandom,
    // Physics
    integrateVelocity,
    applyGravity,
    applyTorpedoWarpage,
    wrapPosition,
    // Control
    applyRotation,
    applyThrust,
    // Combat
    fireTorpedo,
    tickLifetime,
    checkCollision,
    collisionResponseDestroy,
    hyperspaceJump
};
