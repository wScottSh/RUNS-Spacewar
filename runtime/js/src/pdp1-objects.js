/**
 * Spacewar! Object Table
 * 
 * RIGOROUS translation from mtb (Lines 445-510)
 */

import {
    INITIAL_POS, INITIAL_ANGLE, INITIAL_TORPEDOES, MAA, TRF
} from './pdp1-math.js?v=2';

// nob = 30 (from source)
export const NOB = 30;

// Object types
export const OBJ_INACTIVE = 0;
export const OBJ_SHIP = 1;
export const OBJ_TORPEDO = 2;
export const OBJ_EXPLOSION = 3;

/**
 * Object table field offsets (from source Lines 450-480):
 * 
 *   0×30 =   0: Calc routine pointers (mtb)
 *   1×30 =  30: X positions (nx1)
 *   2×30 =  60: Y positions (ny1)
 *   3×30 =  90: Counter/lifetime (na1)
 *   4×30 = 120: Instruction count (nb1)
 *   5×30 = 150: Delta X velocity (ndx)
 *   6×30 = 180: Delta Y velocity (ndy)
 *   7×30 = 210: Angular velocity (nom)
 *   8×30 = 240: Angle theta (nth)
 *   9×30 = 270: Angular acceleration (nal)
 *  10×30 = 300: Acceleration scale (nas)
 *  11×30 = 330: Fuel (nfu)
 *  12×30 = 360: Torpedoes remaining (ntr)
 *  13×30 = 390: Outline pointer (not)
 *  14×30 = 420: Old control word (nco)
 *  15×30 = 450: Hyperspace 1 (nh1)
 *  16×30 = 480: Hyperspace 2 (nh2)
 *  17×30 = 510: Hyperspace 3 (nh3)
 */

/**
 * Create initial ship - EXACT values from source Lines 420-445:
 * 
 *         lac (200000             / 200000₈ = 65536₁₀
 *         dac nx1                 / ship 1 X
 *         dac ny1                 / ship 1 Y (SAME as X!)
 *         cma
 *         dac nx1 1               / ship 2 X = -65536
 *         dac ny1 1               / ship 2 Y = -65536
 *         lac (144420             / 144420₈ = 51472₁₀
 *         dac nth                 / ship 1 angle
 *         law 10
 *         dac nal                 / angular acceleration = 10
 *         dac nal 1
 *         law i 40                / torpedo count = -40 (counts up)
 *         dac ntr
 *         dac ntr 1
 * 
 * CRITICAL: Both ships start DIAGONALLY! X=Y=±65536
 * Ship 2 angle is NOT set, so it's 0 (default from clear)
 */
export function createShip(playerIndex) {
    // lac (200000 / cma for player 1 vs player 2
    const sign = playerIndex === 0 ? 1 : -1;
    const pos = sign * INITIAL_POS;  // ±65536

    return {
        type: OBJ_SHIP,
        mx: pos,                    // X position
        my: pos,                    // Y position (SAME AS X - diagonal!)
        mdx: 0,                     // X velocity
        mdy: 0,                     // Y velocity
        mom: 0,                     // Angular velocity (omega)
        mth: playerIndex === 0 ? INITIAL_ANGLE : 0,  // Only ship 1 gets 144420₈
        mal: MAA,                   // Angular acceleration = 10
        mas: 0,                     // Acceleration scale (not used directly)
        mfu: 0,                     // Fuel (not implemented in 2b version)
        mtr: INITIAL_TORPEDOES,     // Torpedoes = 40
        mco: 0,                     // Old control word
        ma: 0,                      // Counter
        mb: 0o2000,                 // Instruction count = 2000₈ = 1024
        mot: playerIndex + 1,       // Outline: 1=wedge, 2=needle
        // Internal state for rendering
        _sn: 0,
        _cs: 0,
        _stx: 0,                    // Torpedo spawn X
        _sty: 0                     // Torpedo spawn Y
    };
}

/**
 * Create torpedo - from sr2 (Lines 780-810)
 */
export function createTorpedo(x, y, vx, vy, owner) {
    return {
        type: OBJ_TORPEDO,
        mx: x,
        my: y,
        mdx: vx,
        mdy: vy,
        ma: TRF,        // 300 ticks lifetime
        mot: owner      // Which ship fired
    };
}

/**
 * Object table manager
 */
export class ObjectTable {
    constructor() {
        this.objects = new Array(NOB).fill(null);
    }

    /**
     * Initialize - EXACT from source Lines 420-445
     * 
     * a3,     clear mtb, nnn-1        / clear all tables
     *         law ss1
     *         dac mtb
     *         law ss2
     *         dac mtb 1
     *         ...
     */
    initialize() {
        // clear mtb, nnn-1
        this.objects.fill(null);

        // Ship 1 in slot 0
        this.objects[0] = createShip(0);

        // Ship 2 in slot 1
        this.objects[1] = createShip(1);
    }

    /**
     * Get ship by player
     */
    getShip(player) {
        return this.objects[player];
    }

    /**
     * Spawn object in first free slot
     * 
     * st1,    init sr1, mtb           / search for unused object
     * sr1,    lac .
     *         sza i                   / 0 if unused
     *         jmp sr2
     *         index sr1, (lac mtb nob, sr1
     *         hlt                     / no space for new objects
     */
    spawn(obj) {
        for (let i = 2; i < NOB; i++) {
            if (this.objects[i] === null) {
                this.objects[i] = obj;
                return i;
            }
        }
        return -1;  // hlt - no space
    }

    /**
     * Remove object
     */
    remove(index) {
        this.objects[index] = null;
    }

    /**
     * Iterate active objects
     */
    *active() {
        for (let i = 0; i < NOB; i++) {
            if (this.objects[i] !== null) {
                yield { index: i, obj: this.objects[i] };
            }
        }
    }

    /**
     * Iterate ships only
     */
    *ships() {
        for (let i = 0; i < 2; i++) {
            if (this.objects[i]?.type === OBJ_SHIP) {
                yield { index: i, obj: this.objects[i] };
            }
        }
    }

    /**
     * Iterate torpedoes only
     */
    *torpedoes() {
        for (let i = 2; i < NOB; i++) {
            if (this.objects[i]?.type === OBJ_TORPEDO) {
                yield { index: i, obj: this.objects[i] };
            }
        }
    }
}

export default ObjectTable;
