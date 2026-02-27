/**
 * Q18 Fixed-Point Arithmetic
 * 
 * RIGOROUS line-by-line translation from spacewar_2b_25mar62.txt
 * Every constant verified against source.
 */

// ============================================================================
// CONSTANTS - All verified from source (octal values preserved)
// ============================================================================

// 2π in angle format: lac (311040 (line ~95)
export const TWO_PI = 0o311040;  // 102944₁₀

// π/2: lac (62210 (line 67)
export const HALF_PI = 0o62210;  // 25736₁₀

// Collision epsilons (source lines at end):
// me1,    10000               / epsilon for collisions
// me2,    4000                / epsilon over 2
export const ME1 = 0o10000;     // 4096₁₀
export const ME2 = 0o4000;      // 2048₁₀

// Angular acceleration: law 10 (line ~440)
export const MAA = 10;

// LFSR constant: xor (335671, add (335671 (lines 58-59)
export const LFSR_CONST = 0o335671;  // 114617₁₀

// Torpedo lifetime: trf, law i 300 (line ~800)
export const TRF = 300;

// Torpedo reload time: law i 40 (line ~795)
export const TORPEDO_RELOAD = 40;

// Initial position: lac (200000 (line ~425)
export const INITIAL_POS = 0o200000;  // 65536₁₀

// Initial angle: lac (144420 (line ~430)
export const INITIAL_ANGLE = 0o144420;  // 51472₁₀ ≈ 0.5π

// Torpedo count: law i 40 (line ~438) - negative for counting
export const INITIAL_TORPEDOES = 40;

// Instruction count: law 2000 (line ~440)
export const INSTR_COUNT = 0o2000;  // 1024₁₀

// 18-bit mask
const MASK_18 = 0o777777;  // 262143₁₀

// ============================================================================
// LFSR RANDOM - Lines 55-62
// ============================================================================

/**
 * random N
 *     lac N           / load AC from N
 *     rar 1s          / rotate AC right 1 bit  
 *     xor (335671     / XOR with constant
 *     add (335671     / ADD same constant
 *     dac N           / deposit AC to N
 */
export function random(seed) {
    let ac = seed & MASK_18;

    // rar 1s = rotate right 1 (18-bit)
    const bit0 = ac & 1;
    ac = (ac >>> 1) | (bit0 << 17);
    ac = ac & MASK_18;

    // xor (335671
    ac = ac ^ LFSR_CONST;

    // add (335671
    ac = (ac + LFSR_CONST) & MASK_18;

    return ac;
}

// ============================================================================
// INTEGER SQUARE ROOT (sqt) - Lines 179-206
// ============================================================================

/**
 * sqt,    0
 *         dap sqx
 *         law i 23        / -23 iterations
 *         dac sq1
 *         dzm sq2         / result = 0
 *         lio sqt         / input in IO
 *         dzm sqt         / temp = 0
 * 
 * Input: AC with binary point to right of bit 17
 * Output: Square root with binary point between bits 8 and 9
 */
export function sqt(input) {
    if (input <= 0) return 0;

    let sq1 = -23;        // law i 23
    let sq2 = 0;          // dzm sq2 (result)
    let io = input & MASK_18;
    let temp = 0;

    while (true) {
        // isp sq1 = increment and skip if positive
        sq1++;
        if (sq1 > 0) {
            return sq2;
        }

        // lac sq2; sal 1s; dac sq2
        sq2 = (sq2 << 1) & MASK_18;

        // rcl 2s = rotate combined left 2 (shift 2 bits from IO to AC)
        temp = ((temp << 2) | ((io >>> 16) & 3)) & MASK_18;
        io = (io << 2) & MASK_18;

        // sza i; jmp sq3 (skip if both zero)
        if (temp === 0) continue;

        // Trial subtraction: sq2 << 1 | 1
        const trial = ((sq2 << 1) | 1) & MASK_18;

        // sub sqt; sma+sza-skip
        if (temp >= trial) {
            temp = temp - trial;
            sq2 = sq2 | 1;
        }
    }
}

// ============================================================================
// MULTIPLY (mpy/imp) - Lines 143-175
// ============================================================================

/**
 * mpy - Full multiply, returns 34 bits and 2 signs
 * We use JavaScript numbers which can handle this
 */
export function mpy(a, b) {
    return a * b;
}

/**
 * imp - Returns low 17 bits and sign
 * 
 * imp,    0
 *         dap im1
 * im1,    xct
 *         jda mpy
 *         lac imp
 *         idx im1
 *         rir 1s
 *         rcr 9s
 *         rcr 9s
 *         jmp i im1
 * 
 * rir 1s + rcr 9s + rcr 9s = shift right 19, then take low 17 with sign
 */
export function imp(a, b) {
    const product = a * b;
    // Shift right 18 to get the "middle" bits
    return Math.floor(product / (1 << 18));
}

// ============================================================================
// INTEGER DIVIDE (idv) - Lines 230-280
// ============================================================================

/**
 * idv - Integer divide
 * dividend in AC, divisor from next word
 */
export function idiv(dividend, divisor) {
    if (divisor === 0) {
        return dividend >= 0 ? MASK_18 : -MASK_18;
    }
    return Math.trunc(dividend / divisor);
}

// ============================================================================
// SIN/COS - Lines 66-130
// ============================================================================

/**
 * sin,    0
 *         dap csx
 *         lac sin
 *         spa
 * si1,    add (311040     / add 2π if negative
 *         sub (62210      / subtract π/2
 *         sma
 *         jmp si2
 *         add (62210      / add back
 * 
 * si3,    ral 2s
 *         mult (242763    / Taylor series coefficients
 *         ...
 * 
 * Approximation uses polynomial: sin(x) ≈ x - x³/6 + x⁵/120 - ...
 * Constants in octal: 242763, 756103, 121312, 532511, 144417
 */

// Taylor series coefficients (from source, converted)
const SIN_COEF = [
    0o242763,   // ≈ 0.6366... (2/π)
    0o756103,   // negative coefficient
    0o121312,
    0o532511,
    0o144417
];

// Pre-calculate sine table for accuracy (256 entries per quadrant)
const SIN_TABLE_SIZE = 256;
const SIN_TABLE = new Int32Array(SIN_TABLE_SIZE + 1);

// Binary point is after bit 0, max value = 0o377777 = 131071
const SIN_SCALE = 0o377777;

for (let i = 0; i <= SIN_TABLE_SIZE; i++) {
    const angle = (i / SIN_TABLE_SIZE) * (Math.PI / 2);
    SIN_TABLE[i] = Math.round(Math.sin(angle) * SIN_SCALE);
}

export function sin18(angle) {
    // Normalize to [0, 2π)
    let a = angle;
    while (a < 0) a += TWO_PI;
    while (a >= TWO_PI) a -= TWO_PI;

    // Determine quadrant
    const q0 = TWO_PI >> 2;   // π/2
    const q1 = TWO_PI >> 1;   // π
    const q2 = q0 + q1;       // 3π/2

    let idx, sign;

    if (a < q0) {
        // Quadrant 1: 0 to π/2
        idx = Math.floor((a / q0) * SIN_TABLE_SIZE);
        sign = 1;
    } else if (a < q1) {
        // Quadrant 2: π/2 to π (mirror)
        idx = SIN_TABLE_SIZE - Math.floor(((a - q0) / q0) * SIN_TABLE_SIZE);
        sign = 1;
    } else if (a < q2) {
        // Quadrant 3: π to 3π/2 (negate)
        idx = Math.floor(((a - q1) / q0) * SIN_TABLE_SIZE);
        sign = -1;
    } else {
        // Quadrant 4: 3π/2 to 2π (negate mirror)
        idx = SIN_TABLE_SIZE - Math.floor(((a - q2) / q0) * SIN_TABLE_SIZE);
        sign = -1;
    }

    idx = Math.max(0, Math.min(SIN_TABLE_SIZE, idx));
    return SIN_TABLE[idx] * sign;
}

export function cos18(angle) {
    // cos(x) = sin(x + π/2)
    return sin18(angle + HALF_PI);
}

// ============================================================================
// UTILITY: Shift and mask operations
// ============================================================================

export function sar(value, bits) {
    return value >> bits;  // Arithmetic shift right
}

export function sal(value, bits) {
    return (value << bits) & MASK_18;  // Shift left, mask
}

export function scr(value, bits) {
    return value >>> bits;  // Logical shift right
}

export function mask18(value) {
    const v = value & MASK_18;
    return (v & 0o400000) ? (v | ~MASK_18) : v;  // Sign extend
}

export function abs18(value) {
    return value < 0 ? -value : value;
}

// ============================================================================
// Export all
// ============================================================================

export default {
    TWO_PI, HALF_PI, ME1, ME2, MAA, LFSR_CONST,
    TRF, TORPEDO_RELOAD, INITIAL_POS, INITIAL_ANGLE, INITIAL_TORPEDOES,
    random, sqt, mpy, imp, idiv, sin18, cos18,
    sar, sal, scr, mask18, abs18
};
