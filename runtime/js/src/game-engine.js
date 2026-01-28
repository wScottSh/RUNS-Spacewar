/**
 * Spacewar! Game Engine
 * 
 * Core game loop implementing the RUNS Network execution
 * Processes all phases in order each tick
 * 
 * COORDINATE SYSTEM: Normalized (0.0 to 1.0)
 * All positions and velocities are resolution-independent.
 * Conversion to pixels happens only at render time.
 */

import RecordStorage from './record-storage.js';
import * as Processors from './processors.js';
import { CONFIG } from './config.js';

// Entity type constants
const ENTITY_SHIP = 'ship';
const ENTITY_TORPEDO = 'torpedo';
const ENTITY_STAR = 'star';

// Game modes
const MODE_INSTANT_RESPAWN = 'instant_respawn';
const MODE_GAME_OVER = 'game_over';

export class GameEngine {
    constructor(options = {}) {
        this.storage = new RecordStorage();
        this.tickCount = 0;
        this.randomSeed = options.randomSeed || 0xDEADBEEF;
        this.gameMode = options.gameMode || MODE_INSTANT_RESPAWN;

        // Spawn queue for deferred entity creation
        this.spawnQueue = [];
        this.destroyQueue = [];

        // Player control states
        this.playerControls = [
            { rotateCcw: false, rotateCw: false, thrust: false, fire: false, hyperspace: false },
            { rotateCcw: false, rotateCw: false, thrust: false, fire: false, hyperspace: false }
        ];

        // Fire cooldown to prevent machine-gun firing
        this.fireCooldown = [0, 0];
    }

    /**
     * Initialize game with starting state
     */
    initialize() {
        // Create central star
        this.storage.create({
            'spacewar:entity_type': ENTITY_STAR,
            'runs:position_2d': { ...CONFIG.spawn.star }
        });

        // Create Player 1 ship (wedge)
        this.storage.create({
            'spacewar:entity_type': ENTITY_SHIP,
            'spacewar:player_id': 0,
            'runs:position_2d': { ...CONFIG.spawn.player1 },
            'runs:velocity_2d': { ...CONFIG.spawn.player1Velocity },
            'runs:angle': 0,  // Facing right
            'runs:angular_velocity': 0,
            'spacewar:fuel': CONFIG.resources.maxFuel,
            'spacewar:torpedo_count': CONFIG.resources.maxTorpedoes,
            'spacewar:hyperspace_charges': CONFIG.resources.maxHyperspaceCharges,
            'spacewar:is_alive': true
        });

        // Create Player 2 ship (needle)
        this.storage.create({
            'spacewar:entity_type': ENTITY_SHIP,
            'spacewar:player_id': 1,
            'runs:position_2d': { ...CONFIG.spawn.player2 },
            'runs:velocity_2d': { ...CONFIG.spawn.player2Velocity },
            'runs:angle': Math.PI,  // Facing left
            'runs:angular_velocity': 0,
            'spacewar:fuel': CONFIG.resources.maxFuel,
            'spacewar:torpedo_count': CONFIG.resources.maxTorpedoes,
            'spacewar:hyperspace_charges': CONFIG.resources.maxHyperspaceCharges,
            'spacewar:is_alive': true
        });
    }

    /**
     * Set player control state
     */
    setPlayerControl(playerId, control) {
        this.playerControls[playerId] = { ...control };
    }

    /**
     * Execute one game tick
     */
    tick() {
        this.spawnQueue = [];
        this.destroyQueue = [];

        // Decrement fire cooldowns
        this.fireCooldown[0] = Math.max(0, this.fireCooldown[0] - 1);
        this.fireCooldown[1] = Math.max(0, this.fireCooldown[1] - 1);

        // Phase 2: Physics
        this.phasePhysics();

        // Phase 3: Combat
        this.phaseCombat();

        // Phase 4: Collision
        this.phaseCollision();

        // Phase 5: Respawn (if enabled)
        if (this.gameMode === MODE_INSTANT_RESPAWN) {
            this.phaseRespawn();
        }

        // Process spawn queue
        this.processSpawnQueue();

        // Process destroy queue
        this.processDestroyQueue();

        this.tickCount++;
    }

    /**
     * Phase 2: Physics - rotation, thrust, gravity, integration, wrap
     */
    phasePhysics() {
        const ships = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_SHIP });
        const starPos = CONFIG.spawn.star;

        for (const ship of ships) {
            if (!ship.fields['spacewar:is_alive']) continue;

            const playerId = ship.fields['spacewar:player_id'];
            const control = this.playerControls[playerId];

            // Apply rotation (with damping)
            const rotResult = Processors.applyRotation(
                ship.fields['runs:angle'],
                ship.fields['runs:angular_velocity'],
                control,
                CONFIG.physics.angularAcceleration,
                CONFIG.physics.angularDamping
            );
            ship.fields['runs:angle'] = rotResult.angle;
            ship.fields['runs:angular_velocity'] = rotResult.angularVelocity;

            // Apply thrust
            const thrustResult = Processors.applyThrust(
                ship.fields['runs:velocity_2d'],
                ship.fields['runs:angle'],
                control,
                CONFIG.physics.thrustAcceleration,
                ship.fields['spacewar:fuel']
            );
            ship.fields['runs:velocity_2d'] = thrustResult.velocity;
            ship.fields['spacewar:fuel'] = thrustResult.fuel;

            // Apply gravity
            ship.fields['runs:velocity_2d'] = Processors.applyGravity(
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                starPos,
                CONFIG.physics.gravityStrength
            );

            // Integrate velocity (simple per-tick addition)
            ship.fields['runs:position_2d'] = Processors.integrateVelocity(
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d']
            );

            // Wrap position
            if (CONFIG.wrap.enabled) {
                ship.fields['runs:position_2d'] = Processors.wrapPosition(
                    ship.fields['runs:position_2d']
                );
            }
        }

        // Also process torpedoes (gravity + integration + wrap)
        const torpedoes = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_TORPEDO });
        for (const torpedo of torpedoes) {
            // Apply gravity
            torpedo.fields['runs:velocity_2d'] = Processors.applyGravity(
                torpedo.fields['runs:position_2d'],
                torpedo.fields['runs:velocity_2d'],
                starPos,
                CONFIG.physics.gravityStrength
            );

            // Integrate
            torpedo.fields['runs:position_2d'] = Processors.integrateVelocity(
                torpedo.fields['runs:position_2d'],
                torpedo.fields['runs:velocity_2d']
            );

            // Wrap
            if (CONFIG.wrap.enabled) {
                torpedo.fields['runs:position_2d'] = Processors.wrapPosition(
                    torpedo.fields['runs:position_2d']
                );
            }
        }
    }

    /**
     * Phase 3: Combat - fire torpedoes, hyperspace, tick lifetime
     */
    phaseCombat() {
        const ships = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_SHIP });

        for (const ship of ships) {
            if (!ship.fields['spacewar:is_alive']) continue;

            const playerId = ship.fields['spacewar:player_id'];
            const control = this.playerControls[playerId];

            // Fire torpedo (with cooldown)
            const fireResult = Processors.fireTorpedo(
                control,
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                ship.fields['runs:angle'],
                ship.fields['spacewar:torpedo_count'],
                CONFIG.combat.torpedoSpeed,
                playerId,
                this.fireCooldown[playerId]
            );
            ship.fields['spacewar:torpedo_count'] = fireResult.torpedoCount;

            if (fireResult.spawnTorpedo) {
                this.spawnQueue.push({
                    type: ENTITY_TORPEDO,
                    fields: {
                        'spacewar:entity_type': ENTITY_TORPEDO,
                        'spacewar:player_id': fireResult.torpedoOwner,
                        'runs:position_2d': fireResult.torpedoPos,
                        'runs:velocity_2d': fireResult.torpedoVel,
                        'spacewar:lifetime': CONFIG.combat.torpedoLifetime,
                        'spacewar:is_alive': true
                    }
                });
                // Set cooldown (10 ticks = ~0.17 seconds between shots)
                this.fireCooldown[playerId] = 10;
            }

            // Hyperspace jump
            const hyperResult = Processors.hyperspaceJump(
                control,
                ship.fields['spacewar:hyperspace_charges'],
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                this.randomSeed
            );
            ship.fields['spacewar:hyperspace_charges'] = hyperResult.hyperspaceCharges;
            ship.fields['runs:position_2d'] = hyperResult.position;
            ship.fields['runs:velocity_2d'] = hyperResult.velocity;
            this.randomSeed = hyperResult.randomSeed;

            // Clear single-shot controls
            this.playerControls[playerId].fire = false;
            this.playerControls[playerId].hyperspace = false;
        }

        // Tick torpedo lifetimes
        const torpedoes = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_TORPEDO });
        for (const torpedo of torpedoes) {
            const lifeResult = Processors.tickLifetime(torpedo.fields['spacewar:lifetime']);
            torpedo.fields['spacewar:lifetime'] = lifeResult.lifetime;

            if (lifeResult.expired) {
                this.destroyQueue.push(torpedo.id);
            }
        }
    }

    /**
     * Phase 4: Collision detection and response
     */
    phaseCollision() {
        const ships = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_SHIP });
        const torpedoes = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_TORPEDO });
        const stars = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_STAR });
        const star = stars[0];

        const shipRadius = CONFIG.collision.shipRadius;
        const starRadius = CONFIG.collision.starRadius;
        const torpedoRadius = CONFIG.collision.torpedoRadius;

        // Ship-Star collision
        for (const ship of ships) {
            if (!ship.fields['spacewar:is_alive']) continue;

            if (Processors.checkCollision(
                ship.fields['runs:position_2d'],
                star.fields['runs:position_2d'],
                shipRadius,
                starRadius
            )) {
                ship.fields['spacewar:is_alive'] = false;
            }
        }

        // Ship-Ship collision
        const ship0 = ships.find(s => s.fields['spacewar:player_id'] === 0);
        const ship1 = ships.find(s => s.fields['spacewar:player_id'] === 1);

        if (ship0 && ship1 &&
            ship0.fields['spacewar:is_alive'] &&
            ship1.fields['spacewar:is_alive']) {
            if (Processors.checkCollision(
                ship0.fields['runs:position_2d'],
                ship1.fields['runs:position_2d'],
                shipRadius,
                shipRadius
            )) {
                ship0.fields['spacewar:is_alive'] = false;
                ship1.fields['spacewar:is_alive'] = false;
            }
        }

        // Torpedo-Ship collision (friendly fire disabled)
        for (const torpedo of torpedoes) {
            const torpedoOwner = torpedo.fields['spacewar:player_id'];

            for (const ship of ships) {
                if (!ship.fields['spacewar:is_alive']) continue;
                if (ship.fields['spacewar:player_id'] === torpedoOwner) continue;  // No friendly fire

                if (Processors.checkCollision(
                    torpedo.fields['runs:position_2d'],
                    ship.fields['runs:position_2d'],
                    torpedoRadius,
                    shipRadius
                )) {
                    ship.fields['spacewar:is_alive'] = false;
                    this.destroyQueue.push(torpedo.id);
                }
            }

            // Torpedo-Star collision
            if (Processors.checkCollision(
                torpedo.fields['runs:position_2d'],
                star.fields['runs:position_2d'],
                torpedoRadius,
                starRadius
            )) {
                this.destroyQueue.push(torpedo.id);
            }
        }
    }

    /**
     * Phase 5: Respawn dead ships (instant respawn mode)
     */
    phaseRespawn() {
        const ships = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_SHIP });

        for (const ship of ships) {
            if (ship.fields['spacewar:is_alive']) continue;

            const playerId = ship.fields['spacewar:player_id'];

            // Reset to starting state
            ship.fields['spacewar:is_alive'] = true;
            ship.fields['spacewar:fuel'] = CONFIG.resources.maxFuel;
            ship.fields['spacewar:torpedo_count'] = CONFIG.resources.maxTorpedoes;
            ship.fields['spacewar:hyperspace_charges'] = CONFIG.resources.maxHyperspaceCharges;
            ship.fields['runs:angular_velocity'] = 0;

            // Position and velocity based on player
            if (playerId === 0) {
                ship.fields['runs:position_2d'] = { ...CONFIG.spawn.player1 };
                ship.fields['runs:velocity_2d'] = { ...CONFIG.spawn.player1Velocity };
                ship.fields['runs:angle'] = 0;  // Facing right
            } else {
                ship.fields['runs:position_2d'] = { ...CONFIG.spawn.player2 };
                ship.fields['runs:velocity_2d'] = { ...CONFIG.spawn.player2Velocity };
                ship.fields['runs:angle'] = Math.PI;  // Facing left
            }
        }
    }

    /**
     * Process spawn queue after tick
     */
    processSpawnQueue() {
        for (const spawn of this.spawnQueue) {
            this.storage.create(spawn.fields);
        }
    }

    /**
     * Process destroy queue after tick
     */
    processDestroyQueue() {
        // Dedupe
        const uniqueIds = [...new Set(this.destroyQueue)];
        for (const id of uniqueIds) {
            this.storage.delete(id);
        }
    }

    /**
     * Get game state for rendering
     * Returns normalized coordinates (0-1 range)
     */
    getState() {
        return {
            tickCount: this.tickCount,
            records: this.storage.all()
        };
    }
}

export default GameEngine;
