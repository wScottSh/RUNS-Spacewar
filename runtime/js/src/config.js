/**
 * Spacewar! Game Configuration
 * 
 * All values use NORMALIZED COORDINATES (0.0 to 1.0 range).
 * - Position (0.5, 0.5) = center of screen
 * - Velocity in "screen-widths per tick"
 * - Works at ANY resolution - conversion to pixels happens only at render time
 * 
 * Physics tuned to match ORIGINAL PDP-1 game feel, not realistic physics.
 * Original ran at ~30 Hz; we run at 60 Hz so time-based values are halved.
 */

export const CONFIG = {
    // === Physics ===
    physics: {
        tickRate: 60,                    // Fixed 60 Hz simulation

        // Gravity (central star) - WEAKER than true inverse-square, like original
        gravityStrength: 0.000002,       // Reduced from 0.000008 for authentic feel
        gravityMinDistance: 0.05,        // Prevents infinite force at center
        gravityZone: 0.35,               // No gravity beyond this radius (original had cutoff)

        // Ship movement (halved for 60 Hz vs original 30 Hz)
        thrustAcceleration: 0.00005,     // Per-tick acceleration when thrusting
        maxVelocity: 0.012,              // Terminal velocity cap

        // Rotation - CRISP like original (no damping by default)
        // Original sense switch 10 toggled between crisp and momentum modes
        rotationMode: 'crisp',           // 'crisp' or 'momentum'
        angularSpeed: 0.06,              // Radians per tick when key held (crisp mode)
        // Momentum mode settings (optional, set rotationMode: 'momentum' to enable)
        angularAccelMomentum: 0.002,     // Radians per tick² (momentum mode only)
        angularDampingMomentum: 0.98,    // Multiplier per tick (momentum mode only)
    },

    // === Combat ===
    combat: {
        torpedoSpeed: 0.007,             // Muzzle velocity (halved for 60Hz)
        torpedoLifetime: 180,            // Ticks before despawn (~3 seconds at 60Hz)
        torpedoInheritVelocity: 0.3,     // Fraction of ship velocity inherited
        torpedoWarpage: 0.0000003,       // Negligible "space warpage" - cosmetic only

        // Hyperspace
        hyperspaceCooldown: 180,         // Ticks between uses (~3 seconds)
        hyperspaceScatter: 0.3,          // Max random offset from center
        hyperspaceMalfunctionChance: 0.15, // Chance of explosion on reentry
    },

    // === Collision Radii ===
    collision: {
        shipRadius: 0.022,               // Slightly smaller for tighter gameplay
        torpedoRadius: 0.007,            // Small hitbox
        starRadius: 0.035,               // Danger zone
    },

    // === Resources ===
    resources: {
        maxFuel: 2000,                   // More fuel for longer games
        fuelPerThrust: 1,                // Fuel consumed per thrust tick
        maxTorpedoes: 32,                // Limited ammo
        maxHyperspaceCharges: 3,         // Emergency escapes
    },

    // === Initial Spawn Positions ===
    spawn: {
        player1: { x: 0.25, y: 0.5 },    // Left side
        player2: { x: 0.75, y: 0.5 },    // Right side
        star: { x: 0.5, y: 0.5 },        // Center

        // Initial velocities (slight orbital motion)
        player1Velocity: { dx: 0, dy: -0.001 },
        player2Velocity: { dx: 0, dy: 0.001 },
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
