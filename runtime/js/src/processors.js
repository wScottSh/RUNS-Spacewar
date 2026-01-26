/**
 * Spacewar! Processor Implementations
 * 
 * JavaScript implementations of all RUNS Processors
 * Each function is pure and matches the .runs-prim specification
 */

import {
    FIXED_ONE,
    toFixed,
    fromFixed,
    fixedMul,
    fixedSin,
    fixedCos,
    lfsrRandom,
    lfsrRandomRange,
    vec2Add,
    vec2Scale,
    vec2DistanceSquared
} from './fixed-math.js';

//=============================================================================
// MATH PROCESSORS
//=============================================================================

/**
 * add_vec2 - Vector addition
 */
export function addVec2(a, b) {
    return {
        x: a.x + (b.dx || b.x),
        y: a.y + (b.dy || b.y)
    };
}

/**
 * scale_vec2 - Vector scaling with Q16.16
 */
export function scaleVec2(v, scalar) {
    return {
        dx: fixedMul(v.dx, scalar),
        dy: fixedMul(v.dy, scalar)
    };
}

/**
 * sin_cos - Trigonometric lookup
 */
export function sinCos(angle) {
    return {
        sin: fixedSin(angle),
        cos: fixedCos(angle)
    };
}

/**
 * distance_squared - Fast distance without sqrt
 */
export function distanceSquared(a, b) {
    return vec2DistanceSquared(a, b);
}

//=============================================================================
// PHYSICS PROCESSORS
//=============================================================================

/**
 * integrate_velocity - Euler integration
 */
export function integrateVelocity(position, velocity, deltaTime) {
    // deltaTime is in seconds, convert to fixed-point multiplier
    const dtFixed = toFixed(deltaTime);
    return {
        x: position.x + fixedMul(velocity.dx, dtFixed),
        y: position.y + fixedMul(velocity.dy, dtFixed)
    };
}

/**
 * apply_gravity - Inverse-square gravity
 */
export function applyGravity(position, velocity, attractorPos, gravityStrength) {
    const dx = attractorPos.x - position.x;
    const dy = attractorPos.y - position.y;

    // Distance squared (avoid sqrt)
    let distSq = vec2DistanceSquared(position, attractorPos);
    distSq = Math.max(distSq, 1);  // Prevent divide-by-zero

    // Inverse-square gravity with BigInt for precision
    const accelX = Number((BigInt(gravityStrength) * BigInt(dx)) / BigInt(distSq));
    const accelY = Number((BigInt(gravityStrength) * BigInt(dy)) / BigInt(distSq));

    return {
        dx: velocity.dx + accelX,
        dy: velocity.dy + accelY
    };
}

/**
 * wrap_position - Toroidal screen wrap
 */
export function wrapPosition(position, bounds) {
    let x = position.x % bounds.width;
    let y = position.y % bounds.height;

    if (x < 0) x += bounds.width;
    if (y < 0) y += bounds.height;

    return { x, y };
}

//=============================================================================
// CONTROL PROCESSORS
//=============================================================================

/**
 * apply_rotation - Angular velocity with control input
 */
export function applyRotation(angle, angularVelocity, control, angularAccel) {
    let newAngularVelocity = angularVelocity;

    if (control.rotateCcw) {
        newAngularVelocity -= angularAccel;
    }
    if (control.rotateCw) {
        newAngularVelocity += angularAccel;
    }

    let newAngle = angle + newAngularVelocity;

    // Wrap angle to [0, 2π)
    const twoPi = toFixed(2 * Math.PI);
    while (newAngle >= twoPi) newAngle -= twoPi;
    while (newAngle < 0) newAngle += twoPi;

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

        return {
            velocity: {
                dx: velocity.dx + fixedMul(thrustPower, cos),
                dy: velocity.dy + fixedMul(thrustPower, sin)
            },
            fuel: fuel - 1
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
export function fireTorpedo(control, shipPos, shipVel, shipAngle, torpedoCount, torpedoSpeed, playerId) {
    if (control.fire && torpedoCount > 0) {
        const { sin, cos } = sinCos(shipAngle);

        return {
            torpedoCount: torpedoCount - 1,
            spawnTorpedo: true,
            torpedoPos: { x: shipPos.x, y: shipPos.y },
            torpedoVel: {
                dx: shipVel.dx + fixedMul(torpedoSpeed, cos),
                dy: shipVel.dy + fixedMul(torpedoSpeed, sin)
            },
            torpedoOwner: playerId
        };
    }

    return {
        torpedoCount,
        spawnTorpedo: false,
        torpedoPos: null,
        torpedoVel: null,
        torpedoOwner: null
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
export function checkCollision(posA, posB, radiusSumSq) {
    const distSq = vec2DistanceSquared(posA, posB);
    return distSq < radiusSumSq;
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
export function hyperspaceJump(control, hyperspaceCharges, position, velocity, bounds, randomSeed) {
    if (control.hyperspace && hyperspaceCharges > 0) {
        // Random position
        let { value: randX, nextSeed: seed1 } = lfsrRandomRange(randomSeed, 0, bounds.width);
        let { value: randY, nextSeed: seed2 } = lfsrRandomRange(seed1, 0, bounds.height);

        // Random velocity impulse
        const uncertainty = toFixed(2.0);  // ±2.0 units/tick
        let { value: randVx, nextSeed: seed3 } = lfsrRandomRange(seed2, -uncertainty, uncertainty);
        let { value: randVy, nextSeed: seed4 } = lfsrRandomRange(seed3, -uncertainty, uncertainty);

        return {
            hyperspaceCharges: hyperspaceCharges - 1,
            position: { x: randX, y: randY },
            velocity: {
                dx: velocity.dx + randVx,
                dy: velocity.dy + randVy
            },
            randomSeed: seed4,
            jumping: true
        };
    }

    return {
        hyperspaceCharges,
        position,
        velocity,
        randomSeed,
        jumping: false
    };
}

export default {
    // Math
    addVec2,
    scaleVec2,
    sinCos,
    distanceSquared,
    // Physics
    integrateVelocity,
    applyGravity,
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
