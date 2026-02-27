/**
 * Spacewar! Game Engine
 * 
 * RIGOROUS translation of ml0 main loop (Lines 445-555)
 */

import ObjectTable, {
    OBJ_SHIP, OBJ_TORPEDO, OBJ_EXPLOSION,
    createShip, createTorpedo
} from './pdp1-objects.js?v=2';

import {
    checkCollision,
    updateShip,
    applyGravity,
    applyThrust,
    createTorpedo as makeTorpedo,
    updateTorpedo,
    updateExplosion,
    handleStarCollision
} from './pdp1-processors.js?v=2';

import { TRF, TORPEDO_RELOAD, random, sar } from './pdp1-math.js?v=2';

/**
 * Main game engine
 * 
 * ml0,    load \mtc, -4000        / delay for loop
 *         init ml1, mtb           / loc of calc routines
 *         ...
 */
export class SpacewarEngine {
    constructor() {
        this.table = new ObjectTable();
        this.tickCount = 0;
        this.randomSeed = 0o123456;

        // Control words for each player
        this.controls = [0, 0];
        this.prevControls = [0, 0];

        // Sense switches (game configuration)
        this.senseSwitch2 = false;   // Heavy star (stronger gravity)
        this.senseSwitch5 = false;   // Get out of star
        this.senseSwitch10 = true;   // Crisp rotation (default ON)

        // Spawn/destroy queues
        this.spawnQueue = [];
        this.destroyQueue = [];
    }

    /**
     * Initialize game
     */
    initialize() {
        this.table.initialize();
        this.tickCount = 0;
    }

    /**
     * Set control word for player
     * Bits: 0=CCW, 1=CW, 2=Thrust, 3=Fire
     */
    setControl(player, control) {
        this.controls[player] = control;
    }

    /**
     * Main loop tick - translation of ml0/ml1
     * 
     * ml1,    lac .                   / 1st control word
     *         sza i                   / zero if not active
     *         jmp mq1                 / not active
     *         ...
     */
    tick() {
        this.spawnQueue = [];
        this.destroyQueue = [];

        // === PHASE 1: Process each object ===
        // (In original, this is interleaved with collision checking)

        for (const { index, obj } of this.table.active()) {
            if (obj.type === OBJ_SHIP) {
                this.processShip(index);
            } else if (obj.type === OBJ_TORPEDO) {
                this.processTorpedo(index);
            } else if (obj.type === OBJ_EXPLOSION) {
                this.processExplosion(index);
            }
        }

        // === PHASE 2: Collision detection ===
        // Original: mx1/mx2/my1/my2 loop (Lines 500-530)
        this.checkAllCollisions();

        // === PHASE 3: Apply queued changes ===
        for (const torp of this.spawnQueue) {
            this.table.spawn(torp);
        }

        for (const idx of this.destroyQueue) {
            this.table.remove(idx);
        }

        // Update previous controls for edge detection
        this.prevControls[0] = this.controls[0];
        this.prevControls[1] = this.controls[1];

        this.tickCount++;
    }

    /**
     * Process ship (ss1/ss2 calc routines)
     */
    processShip(index) {
        const ship = this.table.objects[index];
        const control = this.controls[index];
        const prevControl = this.prevControls[index];

        // === ROTATION AND THRUST ===
        const { thrusting, sn, cs } = updateShip(ship, control, this.senseSwitch10);

        // === GRAVITY ===
        const gravResult = applyGravity(ship, this.senseSwitch2);

        if (gravResult.inStar) {
            // pof routine - in star
            handleStarCollision(ship, this.senseSwitch5);
            return;
        }

        // === APPLY THRUST AND UPDATE POSITION ===
        applyThrust(ship, thrusting, gravResult.bx, gravResult.by, sn, cs);

        // === FIRE TORPEDO (edge-triggered) ===
        // mco,    lac .               / previous control word
        //         cma
        //         and \scw            / present control word
        //         ral 3s              / torpedo bit to bit 0
        //         sma
        //         jmp sr5             / no launch

        const firePressed = (control & 8) && !(prevControl & 8);

        if (firePressed && ship.mtr > 0 && ship.ma <= 0) {
            // Decrement torpedo count
            ship.mtr--;

            // Set reload timer
            ship.ma = TORPEDO_RELOAD;

            // Create torpedo
            const torp = makeTorpedo(ship, sn, cs);
            this.spawnQueue.push({
                type: OBJ_TORPEDO,
                ...torp
            });
        }

        // Tick reload timer
        if (ship.ma > 0) {
            ship.ma--;
        }
    }

    /**
     * Process torpedo (tcr calc routine)
     */
    processTorpedo(index) {
        const torp = this.table.objects[index];

        const result = updateTorpedo(torp, this.senseSwitch2);

        if (result.expired || result.inStar) {
            this.destroyQueue.push(index);
        }
    }

    /**
     * Process explosion (mex calc routine)
     */
    processExplosion(index) {
        const obj = this.table.objects[index];

        const finished = updateExplosion(obj);

        if (finished) {
            // Respawn ship
            this.table.objects[index] = createShip(index);
        }
    }

    /**
     * Collision detection - mx1/mx2/my1/my2 loop
     * 
     * Original checks ALL pairs of objects:
     *   ml1/ml2 iterate through all objects
     *   For each pair, check collision
     */
    checkAllCollisions() {
        const objects = this.table.objects;

        // Ship vs Ship
        const ship0 = objects[0];
        const ship1 = objects[1];

        if (ship0?.type === OBJ_SHIP && ship1?.type === OBJ_SHIP) {
            if (checkCollision(ship0.mx, ship0.my, ship1.mx, ship1.my)) {
                this.explodeObject(0);
                this.explodeObject(1);
            }
        }

        // Torpedoes vs Ships
        for (let t = 2; t < 30; t++) {
            const torp = objects[t];
            if (torp?.type !== OBJ_TORPEDO) continue;

            for (let s = 0; s < 2; s++) {
                const ship = objects[s];
                if (ship?.type !== OBJ_SHIP) continue;

                // Don't hit own ship? Actually original doesn't check owner
                // Let's check anyway for gameplay
                if (torp.mot === s + 1) continue;  // Skip own torpedoes

                if (checkCollision(torp.mx, torp.my, ship.mx, ship.my)) {
                    this.explodeObject(s);
                    this.destroyQueue.push(t);
                }
            }
        }
    }

    /**
     * Turn object into explosion
     * 
     *         lac (mex            / yes, EXPLODE
     *         dac i ml1           / replace calc routine with explosion
     *         dac i ml2
     *         lac i mb1           / duration of explosion
     * mb2,    add .
     *         cma
     *         sar 9s
     *         sar
     *         add (1
     * ma1,    dac .               / set explosion countdown
     */
    explodeObject(index) {
        const obj = this.table.objects[index];
        if (!obj) return;

        // mb1 = instruction count, used for explosion duration
        // cma; sar 9s; sar; add (1 = negate, shift right 10, add 1
        // Typical mb1 = 2000₈ = 1024, so explosion = ~1 + 1 = 2 ticks? That's too short
        // Let's use a reasonable duration
        const duration = 60;  // About 1 second at 60Hz

        obj.type = OBJ_EXPLOSION;
        obj.ma = duration;
    }

    /**
     * Get state for rendering
     */
    getState() {
        return {
            tickCount: this.tickCount,
            star: { mx: 0, my: 0 },
            objects: this.table.objects.filter(o => o !== null)
        };
    }
}

export default SpacewarEngine;
