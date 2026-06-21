/**
 * Acceptance gate for the sin/cos Oracle.
 *
 * Properties (seven-point gate, analogous to the sqt gate in ADR-0009):
 *   1. Calibration anchor  — sin(0)=000000 or cos(0)=377774 (revealed from Substrate)
 *   2. Enumeration complete — all 2^18 angles enumerated, in order
 *   3. Width               — every AC fits 18 bits
 *   4. Halt PC             — every call returned normally via the stub's hlt
 *   5. Sin antisymmetry    — sin(~x)=~sin(x) for a sample (1's complement negation)
 *      Cos symmetry         — cos(~x)=cos(x) for a sample
 *   6. (Not applicable — no monotone or perfect-square test for trig)
 *   7. Manifest complete   — all ADR-0008 provenance fields present
 *
 * All checkers are pure functions over captured records — no Substrate needed (ADR-0009).
 * Each throws with the witnessing case on first failure.
 */
import { HALT_PC, MAX_ANGLE, ANGLE_COUNT } from './sincos-substrate.js';

export const WORD_CEILING = 1 << 18;  // 0o1000000 — 18-bit boundary

// Calibration anchors observed from the live Substrate:
//   sin(0) = 000000 (exact zero: a mathematical certainty)
//   cos(0) = 377774 (Taylor-series approximation of 1.0; revealed by sincos.test.js)
export const SIN_ZERO = 0;           // sin(0) = 000000
export const COS_ZERO = 0o377774;    // cos(0) = 377774

const oct  = (v) => v.toString(8).padStart(6, '0');
// 1's complement negation of an 18-bit value: ~x = MAX_ANGLE ^ x = 0o777777 ^ x
const neg1s = (x) => MAX_ANGLE ^ x;

/**
 * Property 1 — calibration anchor for sin: sin(0) = 000000.
 */
export function gateSinCalibration(records) {
  const r = records.find((x) => x.in === 0);
  if (!r) throw new Error('gate FAIL (sin calibration): no record for angle 0');
  if (r.ac !== SIN_ZERO) {
    throw new Error(
      `gate FAIL (sin calibration): sin(0) expected AC=${oct(SIN_ZERO)} got ${oct(r.ac)}`
    );
  }
}

/**
 * Property 1 — calibration anchor for cos: cos(0) = 377774 (observed convention).
 */
export function gateCosCalibration(records) {
  const r = records.find((x) => x.in === 0);
  if (!r) throw new Error('gate FAIL (cos calibration): no record for angle 0');
  if (r.ac !== COS_ZERO) {
    throw new Error(
      `gate FAIL (cos calibration): cos(0) expected AC=${oct(COS_ZERO)} got ${oct(r.ac)}`
    );
  }
}

/**
 * Property 2 — enumeration complete: records cover exactly 0..0o777777, in order.
 */
export function gateSincosEnumerationComplete(records) {
  if (records.length !== ANGLE_COUNT) {
    throw new Error(
      `gate FAIL (enumeration): expected ${ANGLE_COUNT} records, got ${records.length}`
    );
  }
  for (let i = 0; i < ANGLE_COUNT; i++) {
    if (records[i].in !== i) {
      throw new Error(
        `gate FAIL (enumeration): record at index ${i} has in=${oct(records[i].in)}, ` +
        `expected ${oct(i)}`
      );
    }
  }
}

/**
 * Property 3 — width: every AC value fits 18 bits (0..0o777777).
 */
export function gateSincosWidthFits(records) {
  for (const r of records) {
    if (r.ac < 0 || r.ac >= WORD_CEILING) {
      throw new Error(
        `gate FAIL (width): in=${oct(r.in)} AC=${r.ac} does not fit 18 bits`
      );
    }
  }
}

/**
 * Property 4 — halt PC: every call returned via the stub's hlt instruction.
 */
export function gateSincosHaltPc(records) {
  for (const r of records) {
    if (r.pc !== HALT_PC) {
      throw new Error(
        `gate FAIL (halt-PC): in=${oct(r.in)} expected PC=${HALT_PC.toString(8)} ` +
        `got ${r.pc.toString(8)}`
      );
    }
  }
}

// 2π in the fixed-point (binary point right of bit 3, scale=2^14): 2π×16384 ≈ 102944 = 0o311040.
// The routine reduces angles modulo 2π; for |angle| > 2π the reduction result is implementation-
// defined and the antisymmetry sin(-x)=-sin(x) need not hold exactly. Limit the check to the
// valid domain [1, 0o311040).
const MAX_VALID_ANGLE = 0o311040;

/**
 * Property 5 — sin antisymmetry: sin(~x) = ~sin(x) for a sample of in-range positive inputs.
 *
 * In 1's complement, negation is bitwise NOT: ~x = 0o777777 ^ x.
 * Only checks angles in [1, 0o311040) — the valid ±2π input domain.
 * At x=0 (and angle=2π=0o311040), sin = 0 and the zero-sign ambiguity is excluded.
 */
export function gateSinAntisymmetry(records) {
  const byInput = new Map(records.map((r) => [r.in, r]));
  for (let x = 1; x < MAX_VALID_ANGLE; x += 1024) {
    const negX = neg1s(x);
    const rx    = byInput.get(x);
    const rNegX = byInput.get(negX);
    if (!rx)    throw new Error(`gate FAIL (antisymmetry): missing record for in=${oct(x)}`);
    if (!rNegX) throw new Error(`gate FAIL (antisymmetry): missing record for in=${oct(negX)}`);
    const expected = neg1s(rx.ac);
    if (rNegX.ac !== expected) {
      throw new Error(
        `gate FAIL (antisymmetry): sin(${oct(negX)}) = ${oct(rNegX.ac)}, ` +
        `expected ~sin(${oct(x)}) = ~${oct(rx.ac)} = ${oct(expected)}`
      );
    }
  }
}

/**
 * Property 5 — cos symmetry: cos(~x) = cos(x) for a sample of in-range inputs.
 *
 * Cosine is an even function: cos(-x) = cos(x). In 1's complement: cos(~x) = cos(x).
 * Only checks angles in [0, 0o311040) — the valid ±2π input domain. For |angle| > 2π
 * the reduction behavior is implementation-defined and symmetry need not hold exactly.
 */
export function gateCosSymmetry(records) {
  const byInput = new Map(records.map((r) => [r.in, r]));
  // valid positive range including zero: 0..MAX_VALID_ANGLE
  for (let x = 0; x < MAX_VALID_ANGLE; x += 1024) {
    const negX  = neg1s(x);
    const rx    = byInput.get(x);
    const rNegX = byInput.get(negX);
    if (!rx)    throw new Error(`gate FAIL (cos symmetry): missing record for in=${oct(x)}`);
    if (!rNegX) throw new Error(`gate FAIL (cos symmetry): missing record for in=${oct(negX)}`);
    if (rNegX.ac !== rx.ac) {
      throw new Error(
        `gate FAIL (cos symmetry): cos(${oct(negX)}) = ${oct(rNegX.ac)}, ` +
        `expected cos(${oct(x)}) = ${oct(rx.ac)}`
      );
    }
  }
}

const REQUIRED_MANIFEST_FIELDS = [
  'routine',
  'entry_pc_octal',
  'rim_sha256',
  'listing_core_status',
  'domain',
  'calling_convention',
  'calibration',
  'tool_versions',
];

/**
 * Property 7 — manifest complete (ADR-0008): every required provenance field present.
 */
export function gateSincosManifestComplete(manifest) {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const v = manifest?.[field];
    const empty =
      v == null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) {
      throw new Error(`gate FAIL (manifest): missing or empty field "${field}"`);
    }
  }
  const witnesses = manifest.domain?.confluence_witnesses;
  if (!Array.isArray(witnesses) || witnesses.length === 0) {
    throw new Error('gate FAIL (manifest): domain.confluence_witnesses missing (ADR-0007)');
  }
}

/**
 * Full gate for the sin Vector set.
 * Properties: calibration, enumeration, width, halt-PC, antisymmetry, manifest.
 */
export function gateFullSinDomain(records, manifest) {
  gateSinCalibration(records);
  gateSincosEnumerationComplete(records);
  gateSincosWidthFits(records);
  gateSincosHaltPc(records);
  gateSinAntisymmetry(records);
  gateSincosManifestComplete(manifest);
}

/**
 * Full gate for the cos Vector set.
 * Properties: calibration, enumeration, width, halt-PC, symmetry, manifest.
 */
export function gateFullCosDomain(records, manifest) {
  gateCosCalibration(records);
  gateSincosEnumerationComplete(records);
  gateSincosWidthFits(records);
  gateSincosHaltPc(records);
  gateCosSymmetry(records);
  gateSincosManifestComplete(manifest);
}
