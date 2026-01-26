/**
 * Spacewar! Game Engine
 * 
 * Core game loop implementing the RUNS Network execution
 * Processes all phases in order each tick
 */

import RecordStorage from './record-storage.js';
import * as Processors from './processors.js';
import { toFixed, fromFixed, FIXED_ONE } from './fixed-math.js';

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
        this.deltaTime = 1 / 60;  // 60 Hz
        this.randomSeed = options.randomSeed || 0xDEADBEEF;
        this.gameMode = options.gameMode || MODE_INSTANT_RESPAWN;

        // Spawn queue for deferred entity creation
        this.spawnQueue = [];
        this.destroyQueue = [];

        // Game constants (matching Network definition)
        this.constants = {
            screenWidth: toFixed(1024),
            screenHeight: toFixed(768),
            starPosition: { x: toFixed(512), y: toFixed(384) },
            gravityStrength: toFixed(1000),
            thrustPower: toFixed(0.0625),  // ~4096 in original scale
            angularAccel: toFixed(0.01),
            torpedoSpeed: toFixed(0.5),
            torpedoLifetime: 140,
            collisionRadiusStarSq: toFixed(100) * toFixed(100),
            collisionRadiusShipSq: toFixed(80) * toFixed(80),
            collisionRadiusTorpedoSq: toFixed(50) * toFixed(50)
        };

        // Player control states
        this.playerControls = [
            { rotateCcw: false, rotateCw: false, thrust: false, fire: false, hyperspace: false },
            { rotateCcw: false, rotateCw: false, thrust: false, fire: false, hyperspace: false }
        ];
    }

    /**
     * Initialize game with starting state
     */
    initialize() {
        // Create central star
        this.storage.create({
            'spacewar:entity_type': ENTITY_STAR,
            'runs:position_2d': { ...this.constants.starPosition }
        });

        // Create Player 1 ship (wedge)
        this.storage.create({
            'spacewar:entity_type': ENTITY_SHIP,
            'spacewar:player_id': 0,
            'runs:position_2d': { x: toFixed(200), y: toFixed(384) },
            'runs:velocity_2d': { dx: 0, dy: 0 },
            'runs:angle': 0,
            'runs:angular_velocity': 0,
            'spacewar:fuel': 20000,
            'spacewar:torpedo_count': 32,
            'spacewar:hyperspace_charges': 3,
            'spacewar:is_alive': true
        });

        // Create Player 2 ship (needle)
        this.storage.create({
            'spacewar:entity_type': ENTITY_SHIP,
            'spacewar:player_id': 1,
            'runs:position_2d': { x: toFixed(824), y: toFixed(384) },
            'runs:velocity_2d': { dx: 0, dy: 0 },
            'runs:angle': toFixed(Math.PI),  // Facing left
            'runs:angular_velocity': 0,
            'spacewar:fuel': 20000,
            'spacewar:torpedo_count': 32,
            'spacewar:hyperspace_charges': 3,
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
        const bounds = { width: this.constants.screenWidth, height: this.constants.screenHeight };

        for (const ship of ships) {
            if (!ship.fields['spacewar:is_alive']) continue;

            const playerId = ship.fields['spacewar:player_id'];
            const control = this.playerControls[playerId];

            // Apply rotation
            const rotResult = Processors.applyRotation(
                ship.fields['runs:angle'],
                ship.fields['runs:angular_velocity'],
                control,
                this.constants.angularAccel
            );
            ship.fields['runs:angle'] = rotResult.angle;
            ship.fields['runs:angular_velocity'] = rotResult.angularVelocity;

            // Apply thrust
            const thrustResult = Processors.applyThrust(
                ship.fields['runs:velocity_2d'],
                ship.fields['runs:angle'],
                control,
                this.constants.thrustPower,
                ship.fields['spacewar:fuel']
            );
            ship.fields['runs:velocity_2d'] = thrustResult.velocity;
            ship.fields['spacewar:fuel'] = thrustResult.fuel;

            // Apply gravity
            ship.fields['runs:velocity_2d'] = Processors.applyGravity(
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                this.constants.starPosition,
                this.constants.gravityStrength
            );

            // Integrate velocity
            ship.fields['runs:position_2d'] = Processors.integrateVelocity(
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                this.deltaTime
            );

            // Wrap position
            ship.fields['runs:position_2d'] = Processors.wrapPosition(
                ship.fields['runs:position_2d'],
                bounds
            );
        }

        // Also process torpedoes (gravity + integration + wrap)
        const torpedoes = this.storage.queryByFields({ 'spacewar:entity_type': ENTITY_TORPEDO });
        for (const torpedo of torpedoes) {
            // Apply gravity
            torpedo.fields['runs:velocity_2d'] = Processors.applyGravity(
                torpedo.fields['runs:position_2d'],
                torpedo.fields['runs:velocity_2d'],
                this.constants.starPosition,
                this.constants.gravityStrength
            );

            // Integrate
            torpedo.fields['runs:position_2d'] = Processors.integrateVelocity(
                torpedo.fields['runs:position_2d'],
                torpedo.fields['runs:velocity_2d'],
                this.deltaTime
            );

            // Wrap
            torpedo.fields['runs:position_2d'] = Processors.wrapPosition(
                torpedo.fields['runs:position_2d'],
                bounds
            );
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

            // Fire torpedo
            const fireResult = Processors.fireTorpedo(
                control,
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                ship.fields['runs:angle'],
                ship.fields['spacewar:torpedo_count'],
                this.constants.torpedoSpeed,
                playerId
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
                        'spacewar:lifetime': this.constants.torpedoLifetime,
                        'spacewar:is_alive': true
                    }
                });
            }

            // Hyperspace jump
            const hyperResult = Processors.hyperspaceJump(
                control,
                ship.fields['spacewar:hyperspace_charges'],
                ship.fields['runs:position_2d'],
                ship.fields['runs:velocity_2d'],
                { width: this.constants.screenWidth, height: this.constants.screenHeight },
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

        // Ship-Star collision
        for (const ship of ships) {
            if (!ship.fields['spacewar:is_alive']) continue;

            if (Processors.checkCollision(
                ship.fields['runs:position_2d'],
                star.fields['runs:position_2d'],
                this.constants.collisionRadiusStarSq
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
                this.constants.collisionRadiusShipSq
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
                    this.constants.collisionRadiusTorpedoSq
                )) {
                    ship.fields['spacewar:is_alive'] = false;
                    this.destroyQueue.push(torpedo.id);
                }
            }

            // Torpedo-Star collision
            if (Processors.checkCollision(
                torpedo.fields['runs:position_2d'],
                star.fields['runs:position_2d'],
                this.constants.collisionRadiusStarSq
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

            // Reset to starting position
            ship.fields['spacewar:is_alive'] = true;
            ship.fields['spacewar:fuel'] = 20000;
            ship.fields['spacewar:torpedo_count'] = 32;
            ship.fields['spacewar:hyperspace_charges'] = 3;
            ship.fields['runs:velocity_2d'] = { dx: 0, dy: 0 };
            ship.fields['runs:angular_velocity'] = 0;

            // Position based on player
            if (playerId === 0) {
                ship.fields['runs:position_2d'] = { x: toFixed(200), y: toFixed(384) };
                ship.fields['runs:angle'] = 0;  // Facing right
            } else {
                ship.fields['runs:position_2d'] = { x: toFixed(824), y: toFixed(384) };
                ship.fields['runs:angle'] = toFixed(Math.PI);  // Facing left
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
     */
    getState() {
        return {
            tickCount: this.tickCount,
            records: this.storage.all(),
            screenWidth: this.constants.screenWidth,
            screenHeight: this.constants.screenHeight
        };
    }
}

export default GameEngine;
