/**
 * Acceptance gate for the sqt Oracle (ADR-0009).
 *
 * The gate is a pure function over captured records — no Substrate (ADR, user
 * story 18). It is a *confluence* of independent properties, every one expressed
 * against the convention revealed at calibration (ROOT_SCALE), never a
 * hand-derived scaling. Each checker throws with the witnessing case on first
 * failure so a domain-wide systematic error self-identifies.
 *
 * Full-domain records are {in, ac, pc}; perfect-square records are {n, nsq, ac, pc}.
 */
import { HALT_PC, ROOT_SCALE, MAX_INPUT } from './substrate.js';

// Result-width ceiling: sqt's answer is an 18-bit word (9.9 fixed-point).
export const WORD_CEILING = 1 << 18; // 0o1000000

/**
 * Validate that every record satisfies:
 *   ac === n × ROOT_SCALE  (9.9 fixed-point: integer root in upper 9 bits)
 *   pc === haltPc          (stub+3 per SIMH fetch-before-execute)
 *
 * Throws with the witnessing case on first failure.
 * records: array of {n, nsq, ac, pc}
 */
export function gatePerfectSquares(records, haltPc = HALT_PC) {
  for (const r of records) {
    const expectedAc = r.n * ROOT_SCALE;
    if (r.ac !== expectedAc) {
      throw new Error(
        `gate FAIL: n=${r.n} n²=${r.nsq} ` +
        `expected AC=${expectedAc.toString(8).padStart(6, '0')} ` +
        `got ${r.ac.toString(8).padStart(6, '0')}`
      );
    }
    if (r.pc !== haltPc) {
      throw new Error(
        `gate FAIL: n=${r.n} n²=${r.nsq} ` +
        `expected PC=${haltPc.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
}

const oct = (v) => v.toString(8).padStart(6, '0');

/**
 * Property 2 — enumeration complete: records cover exactly 0..max, in order,
 * none missing and none duplicated. Throws with the first offending index.
 */
export function gateEnumerationComplete(records, max = MAX_INPUT) {
  if (records.length !== max + 1) {
    throw new Error(
      `gate FAIL (enumeration): expected ${max + 1} records, got ${records.length}`
    );
  }
  for (let i = 0; i <= max; i++) {
    if (records[i].in !== i) {
      throw new Error(
        `gate FAIL (enumeration): record at index ${i} has in=${oct(records[i].in)}, ` +
        `expected ${oct(i)} (gap or out-of-order at ${oct(i)})`
      );
    }
  }
}

/**
 * Property 3 — √0 = 0: the record for input 0 carries AC 0.
 */
export function gateSqrtZero(records) {
  const r = records.find((x) => x.in === 0);
  if (!r) throw new Error('gate FAIL (√0): no record for input 0');
  if (r.ac !== 0) {
    throw new Error(`gate FAIL (√0): in=000000 expected AC=000000 got ${oct(r.ac)}`);
  }
}

/**
 * Property 4 — monotone non-decreasing: AC never drops as input rises. This is
 * the strand that catches a domain-wide systematic scaling error that a single
 * calibration point cannot. Records must be in input order. Throws with the
 * witnessing pair.
 */
export function gateMonotone(records) {
  for (let i = 1; i < records.length; i++) {
    if (records[i].ac < records[i - 1].ac) {
      throw new Error(
        `gate FAIL (monotonicity): in=${oct(records[i].in)} AC=${oct(records[i].ac)} ` +
        `< previous in=${oct(records[i - 1].in)} AC=${oct(records[i - 1].ac)}`
      );
    }
  }
}

/**
 * Property 5 — exact at every in-range perfect square, over full-domain records:
 * input n² yields exactly n in 9.9 fixed-point (n × ROOT_SCALE). Checks the
 * revealed convention at hundreds of points, i.e. that calibration generalises.
 */
export function gatePerfectSquaresInDomain(records, max = MAX_INPUT) {
  const byInput = new Map(records.map((r) => [r.in, r]));
  for (let n = 0; n * n <= max; n++) {
    const r = byInput.get(n * n);
    if (!r) {
      throw new Error(`gate FAIL (perfect square): no record for n²=${oct(n * n)} (n=${n})`);
    }
    const expectedAc = n * ROOT_SCALE;
    if (r.ac !== expectedAc) {
      throw new Error(
        `gate FAIL (perfect square): n=${n} n²=${oct(n * n)} ` +
        `expected AC=${oct(expectedAc)} got ${oct(r.ac)}`
      );
    }
  }
}

/**
 * Property 6a — max-input boundary: the top of the domain yields the expected
 * top-of-range answer. Anchored on the revealed convention — the integer part
 * (AC ≫ 9) must equal floor(√max), a mathematical fact, not a hand-derived AC.
 */
export function gateMaxBoundary(records, max = MAX_INPUT) {
  const r = records.find((x) => x.in === max);
  if (!r) throw new Error(`gate FAIL (max boundary): no record for in=${oct(max)}`);
  const expectedInt = Math.floor(Math.sqrt(max));
  const gotInt = r.ac >> 9;
  if (gotInt !== expectedInt) {
    throw new Error(
      `gate FAIL (max boundary): in=${oct(max)} integer part ${gotInt} ` +
      `(AC=${oct(r.ac)}) expected floor(√${max})=${expectedInt}`
    );
  }
}

/**
 * Property 6b — width: every answer fits sqt's result width (an 18-bit word).
 */
export function gateWidthFits(records) {
  for (const r of records) {
    if (r.ac < 0 || r.ac >= WORD_CEILING) {
      throw new Error(
        `gate FAIL (width): in=${oct(r.in)} AC=${oct(r.ac)} does not fit 18 bits`
      );
    }
  }
}

// Fields a complete Vector-set manifest must carry (ADR-0008).
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
 * Property 7 — manifest complete (ADR-0008): every required provenance field is
 * present and non-empty. Domain must additionally carry its ADR-0007 confluence
 * witnesses.
 */
export function gateManifestComplete(manifest) {
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
 * The full seven-point gate (ADR-0009). A captured full-domain Vector set is
 * trusted only when it passes all of: calibration anchor present, enumeration
 * complete, √0=0, monotone, exact at every perfect square, max boundary + width,
 * manifest complete. Throws with the witnessing case on the first failure.
 */
export function gateFullDomain(records, manifest, max = MAX_INPUT) {
  // Property 1 — the calibration anchor (in=4 → 2.0) is present in the set,
  // tying the whole enumeration to the revealed convention.
  const anchor = records.find((r) => r.in === 4);
  if (!anchor || anchor.ac !== 2 * ROOT_SCALE) {
    throw new Error(
      `gate FAIL (calibration anchor): in=000004 expected AC=${oct(2 * ROOT_SCALE)} ` +
      `got ${anchor ? oct(anchor.ac) : 'absent'}`
    );
  }
  gateEnumerationComplete(records, max);
  gateSqrtZero(records);
  gateMonotone(records);
  gatePerfectSquaresInDomain(records, max);
  gateMaxBoundary(records, max);
  gateWidthFits(records);
  // Per-case halt-PC sanity: every call returned normally (stub+3).
  for (const r of records) {
    if (r.pc !== HALT_PC) {
      throw new Error(
        `gate FAIL (halt-PC): in=${oct(r.in)} expected PC=${HALT_PC.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
  gateManifestComplete(manifest);
}
