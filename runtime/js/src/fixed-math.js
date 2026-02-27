/**
 * Fixed-Point Math Utilities
 * 
 * Q16.16 fixed-point arithmetic for RUNS Processors
 * Matches original Spacewar! 18-bit fixed-point philosophy
 */

// Q16.16 format: 16 bits integer, 16 bits fraction
export const FIXED_SHIFT = 16;
export const FIXED_ONE = 1 << FIXED_SHIFT;  // 65536 = 1.0
export const FIXED_HALF = 1 << (FIXED_SHIFT - 1);  // 32768 = 0.5

/**
 * Convert float to Q16.16 fixed-point
 */
export function toFixed(value) {
    return Math.round(value * FIXED_ONE);
}

/**
 * Convert Q16.16 fixed-point to float
 */
export function fromFixed(value) {
    return value / FIXED_ONE;
}

/**
 * Multiply two Q16.16 values
 */
export function fixedMul(a, b) {
    // Use BigInt for intermediate to avoid overflow
    return Number((BigInt(a) * BigInt(b)) >> BigInt(FIXED_SHIFT));
}

/**
 * Divide two Q16.16 values
 */
export function fixedDiv(a, b) {
    if (b === 0) return a > 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
    return Number((BigInt(a) << BigInt(FIXED_SHIFT)) / BigInt(b));
}

//=============================================================================
// Sine/Cosine Lookup Table (256 entries for one quadrant)
// Classic approach matching original Spacewar!
//=============================================================================

const SIN_TABLE_SIZE = 256;
const SIN_TABLE = new Int32Array(SIN_TABLE_SIZE);

// Pre-compute sine table
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
    const angle = (i / SIN_TABLE_SIZE) * (Math.PI / 2);  // 0 to π/2
    SIN_TABLE[i] = toFixed(Math.sin(angle));
}

/**
 * Get sine of angle (Q16.16 input/output)
 * Uses lookup table with quadrant mirroring
 */
export function fixedSin(angle) {
    // Normalize angle to 0..2π
    const twoPi = toFixed(2 * Math.PI);
    while (angle < 0) angle += twoPi;
    while (angle >= twoPi) angle -= twoPi;

    // Determine quadrant and index
    const quarterPi = twoPi >> 2;  // π/2
    const halfPi = twoPi >> 1;     // π
    const threeQuarterPi = quarterPi + halfPi;  // 3π/2

    let index, sign;

    if (angle < quarterPi) {
        // Q1: 0 to π/2
        index = Math.floor((angle / quarterPi) * (SIN_TABLE_SIZE - 1));
        sign = 1;
    } else if (angle < halfPi) {
        // Q2: π/2 to π (mirror Q1)
        index = SIN_TABLE_SIZE - 1 - Math.floor(((angle - quarterPi) / quarterPi) * (SIN_TABLE_SIZE - 1));
        sign = 1;
    } else if (angle < threeQuarterPi) {
        // Q3: π to 3π/2 (negate Q1)
        index = Math.floor(((angle - halfPi) / quarterPi) * (SIN_TABLE_SIZE - 1));
        sign = -1;
    } else {
        // Q4: 3π/2 to 2π (negate mirror Q1)
        index = SIN_TABLE_SIZE - 1 - Math.floor(((angle - threeQuarterPi) / quarterPi) * (SIN_TABLE_SIZE - 1));
        sign = -1;
    }

    index = Math.max(0, Math.min(SIN_TABLE_SIZE - 1, index));
    return SIN_TABLE[index] * sign;
}

/**
 * Get cosine of angle (Q16.16 input/output)
 * cos(x) = sin(x + π/2)
 */
export function fixedCos(angle) {
    const quarterPi = toFixed(Math.PI / 2);
    return fixedSin(angle + quarterPi);
}

//=============================================================================
// LFSR Random Number Generator
// AUTHENTIC PDP-1 algorithm from spacewar_2b_25mar62.txt
//=============================================================================

/**
 * Linear Feedback Shift Register - Authentic PDP-1 algorithm
 * 
 * Original PDP-1 assembly:
 *   lac N
 *   rar 1s          ; rotate right 1
 *   xor (335671     ; XOR with constant (octal)
 *   add (335671     ; ADD same constant
 *   dac N
 * 
 * Constant 335671 (octal) = 114617 (decimal) = 0x1BF39 (hex)
 * 
 * @param {number} seed - Current seed (32-bit)
 * @returns {Object} { value, nextSeed }
 */
export function lfsrRandom(seed) {
    // Constant from original PDP-1 source: 335671 (octal)
    const LFSR_CONSTANT = 0x1BF39;  // 114617 decimal

    // Ensure 32-bit unsigned
    seed = seed >>> 0;

    // Rotate right 1 bit (authentic rar 1s)
    const carry = seed & 1;
    const shifted = seed >>> 1;
    const rotated = (shifted | (carry << 31)) >>> 0;

    // XOR with constant, then ADD constant (authentic algorithm)
    const xored = (rotated ^ LFSR_CONSTANT) >>> 0;
    const nextSeed = (xored + LFSR_CONSTANT) >>> 0;

    return {
        value: seed,
        nextSeed
    };
}

/**
 * Get random value in range [min, max) using LFSR
 */
export function lfsrRandomRange(seed, min, max) {
    const { value, nextSeed } = lfsrRandom(seed);
    const range = max - min;
    const result = min + (value % range);
    return { value: result, nextSeed };
}

//=============================================================================
// Vector Math (Q16.16)
//=============================================================================

/**
 * Add two 2D vectors
 */
export function vec2Add(a, b) {
    return {
        x: a.x + b.x,
        y: a.y + b.y
    };
}

/**
 * Scale a 2D vector
 */
export function vec2Scale(v, scalar) {
    return {
        x: fixedMul(v.x, scalar),
        y: fixedMul(v.y, scalar)
    };
}

/**
 * Distance squared between two points
 */
export function vec2DistanceSquared(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    // Use BigInt to avoid overflow
    return Number((BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy)));
}

export default {
    FIXED_SHIFT,
    FIXED_ONE,
    FIXED_HALF,
    toFixed,
    fromFixed,
    fixedMul,
    fixedDiv,
    fixedSin,
    fixedCos,
    lfsrRandom,
    lfsrRandomRange,
    vec2Add,
    vec2Scale,
    vec2DistanceSquared
};
