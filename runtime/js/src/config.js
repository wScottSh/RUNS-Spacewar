/**
 * Spacewar! Game Configuration
 * 
 * All values use NORMALIZED COORDINATES (0.0 to 1.0 range).
 * - Position (0.5, 0.5) = center of screen
 * - Velocity in "screen-widths per tick"
 * - Works at ANY resolution - conversion to pixels happens only at render time
 * 
 * Original PDP-1 ran at ~60 Hz with fixed timestep, we match that model.
 */

export const CONFIG = {
    // === Physics ===
    physics: {
        tickRate: 60,                    // Fixed 60 Hz simulation

        // Gravity (central star)
        gravityStrength: 0.000008,       // G*M constant in normalized space
        gravityMinDistance: 0.05,        // Prevents infinite force at center

        // Ship movement
        thrustAcceleration: 0.00008,     // Per-tick acceleration when thrusting
        maxVelocity: 0.015,              // Terminal velocity cap

        // Rotation
        angularAcceleration: 0.004,      // Radians per tick² when rotating
        angularDamping: 0.96,            // Multiplier per tick (1.0 = no damping)
        maxAngularVelocity: 0.15,        // Radians per tick cap
    },

    // === Combat ===
    combat: {
        torpedoSpeed: 0.012,             // Muzzle velocity (screen-widths/tick)
        torpedoLifetime: 120,            // Ticks before despawn (~2 seconds)
        torpedoInheritVelocity: 0.5,     // Fraction of ship velocity inherited

        // Hyperspace
        hyperspaceCooldown: 180,         // Ticks between uses (~3 seconds)
        hyperspaceScatter: 0.3,          // Max random offset from center
        hyperspaceMalfunctionChance: 0.15, // Chance of explosion on reentry
    },

    // === Collision Radii ===
    collision: {
        shipRadius: 0.025,               // 2.5% of screen width
        torpedoRadius: 0.008,            // Small hitbox
        starRadius: 0.04,                // 4% of screen width (danger zone)
    },

    // === Resources ===
    resources: {
        maxFuel: 1000,                   // Fuel units per ship
        fuelPerThrust: 1,                // Fuel consumed per thrust tick
        maxTorpedoes: 32,                // Limited ammo
        maxHyperspaceCharges: 3,         // Emergency escapes
    },

    // === Initial Spawn Positions ===
    spawn: {
        player1: { x: 0.25, y: 0.5 },    // Left side
        player2: { x: 0.75, y: 0.5 },    // Right side
        star: { x: 0.5, y: 0.5 },        // Center

        // Initial velocities (orbital hint)
        player1Velocity: { dx: 0, dy: -0.002 },
        player2Velocity: { dx: 0, dy: 0.002 },
    },

    // === Screen Wrapping ===
    wrap: {
        enabled: true,
        minX: 0,
        maxX: 1,
        minY: 0,
        maxY: 1,
    },
};

export default CONFIG;
