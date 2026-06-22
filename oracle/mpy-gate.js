/**
 * Acceptance gate for the mpy/imp Oracle (branch-complete + boundary-sample, ADR-0004).
 *
 * Strength: every conditional skip observed both ways over the boundary sample;
 * mathematical sign-correctness verified; zero-product corner-case anchored;
 * manifest attested per ADR-0008. The gate is pure — no Substrate required.
 *
 * mpy records: {f1, f2, ac, io, pc} as JS integers (18-bit ones'-complement words).
 * imp records: {f1, f2, ac, pc} as JS integers.
 */
import { BOUNDARY_CASES, HALT_PC, SIGN_BIT } from './mpy-substrate.js';

const oct = (v) => v.toString(8).padStart(6, '0');

// ── shared property checks ────────────────────────────────────────────────────
// mpy and imp run the same checks; they differ only by the message `tag` and a
// couple of routine-specific extras (the L289 detail text, and whether IO is
// checked for the zero case). The exported gateMpy*/gateImp* wrappers below bind
// those parameters.

/**
 * Property 1 — boundary complete: every expected {f1, f2} pair is present in records.
 * Witnesses all four sign combinations + zero + max magnitude per the issue spec.
 */
function checkBoundaryComplete(records, tag) {
  for (const expected of BOUNDARY_CASES) {
    const r = records.find((r) => r.f1 === expected.f1 && r.f2 === expected.f2);
    if (!r) {
      throw new Error(
        `gate FAIL ${tag}(boundary complete): missing case f1=${oct(expected.f1)} f2=${oct(expected.f2)}`
      );
    }
  }
}

/**
 * Property 2 — halt-PC: every case returned to the caller stub (no infinite loop).
 */
function checkHaltPc(records, haltPc, tag) {
  for (const r of records) {
    if (r.pc !== haltPc) {
      throw new Error(
        `gate FAIL ${tag}(halt-PC): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `expected PC=${haltPc.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
}

/**
 * Property 3 — branch coverage (L276 spa, L281 spa, L289 sma observed both ways).
 * Structural: verifies the BOUNDARY_CASES span the required sign combinations.
 * `l289` carries the routine-specific detail appended to the L289 messages.
 */
function checkBranchCoverage(records, tag, l289) {
  // L276 spa: f1 non-negative → skip cma (++/+- cases); f1 negative → cma (-+/-- cases)
  const hasF1Pos = records.some((r) => (r.f1 & SIGN_BIT) === 0);
  const hasF1Neg = records.some((r) => (r.f1 & SIGN_BIT) !== 0);
  if (!hasF1Pos) throw new Error(`gate FAIL ${tag}(L276 spa): no case with f1 non-negative`);
  if (!hasF1Neg) throw new Error(`gate FAIL ${tag}(L276 spa): no case with f1 negative`);

  // L281 spa: f2 non-negative → skip cma (++/-+ cases); f2 negative → cma (+-/-- cases)
  const hasF2Pos = records.some((r) => (r.f2 & SIGN_BIT) === 0);
  const hasF2Neg = records.some((r) => (r.f2 & SIGN_BIT) !== 0);
  if (!hasF2Pos) throw new Error(`gate FAIL ${tag}(L281 spa): no case with f2 non-negative`);
  if (!hasF2Neg) throw new Error(`gate FAIL ${tag}(L281 spa): no case with f2 negative`);

  // L289 sma: same-sign → positive result, jmp mp3 (++/-- and zero cases);
  //           diff-sign → sma skips, negate code path (+- and -+ cases)
  const hasSameSign = records.some((r) => {
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    return f1Neg === f2Neg; // includes the 0×0 case (both non-negative)
  });
  const hasDiffSign = records.some((r) => {
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    return f1Neg !== f2Neg;
  });
  if (!hasSameSign) throw new Error(`gate FAIL ${tag}(L289 sma): no same-sign case${l289.sameSign}`);
  if (!hasDiffSign) throw new Error(`gate FAIL ${tag}(L289 sma): no diff-sign case${l289.diffSign}`);
}

/**
 * Property 4 — sign correctness: the observed AC sign bit matches the operand sign
 * combination. Pure mathematical: same-sign → positive result; diff-sign → negative.
 * Zero products are excluded from the sign check (0 is non-negative in ones'-complement).
 */
function checkSignCorrectness(records, tag) {
  for (const r of records) {
    if (r.f1 === 0 || r.f2 === 0) continue; // zero product — sign inapplicable
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    const sameSign = f1Neg === f2Neg;
    const acNeg = (r.ac & SIGN_BIT) !== 0;
    if (sameSign && acNeg) {
      throw new Error(
        `gate FAIL ${tag}(sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `same-sign but AC has negative sign bit: AC=${oct(r.ac)}`
      );
    }
    if (!sameSign && !acNeg) {
      throw new Error(
        `gate FAIL ${tag}(sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `diff-sign but AC has non-negative sign bit: AC=${oct(r.ac)}`
      );
    }
  }
}

/**
 * Property 5 — zero product: 0 × 0 yields AC = 0 (and, for mpy, IO = 0).
 */
function checkZero(records, tag, checkIo) {
  const r = records.find((r) => r.f1 === 0 && r.f2 === 0);
  if (!r) throw new Error(`gate FAIL ${tag}(zero): no record for f1=0 f2=0`);
  if (r.ac !== 0) {
    throw new Error(`gate FAIL ${tag}(zero): 0×0 expected AC=000000 got ${oct(r.ac)}`);
  }
  if (checkIo && r.io !== 0) {
    throw new Error(`gate FAIL ${tag}(zero): 0×0 expected IO=000000 got ${oct(r.io)}`);
  }
}

// ── mpy gate ──────────────────────────────────────────────────────────────────

const MPY_L289_DETAIL = {
  sameSign: ' (positive-result path not observed)',
  diffSign: ' (negate path not observed)',
};

export function gateMpyBoundaryComplete(records) {
  checkBoundaryComplete(records, '');
}

export function gateMpyHaltPc(records, haltPc = HALT_PC) {
  checkHaltPc(records, haltPc, '');
}

export function gateMpyBranchCoverage(records) {
  checkBranchCoverage(records, '', MPY_L289_DETAIL);
}

export function gateMpySignCorrectness(records) {
  checkSignCorrectness(records, '');
}

export function gateMpyZero(records) {
  checkZero(records, '', true);
}

/**
 * Property 6 — manifest complete (ADR-0008): every required field present and non-empty,
 * with at least one confluence witness in domain.
 */
const REQUIRED_MPY_MANIFEST_FIELDS = [
  'routines',
  'entry_pc_octal',
  'rim_sha256',
  'listing_core_status',
  'domain',
  'calling_convention',
  'calibration',
  'tool_versions',
];

export function gateMpyManifestComplete(manifest) {
  for (const field of REQUIRED_MPY_MANIFEST_FIELDS) {
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
 * The full mpy gate: all six properties must pass. Throws with witnessing case on
 * the first failure.
 */
export function gateMpy(records, manifest) {
  gateMpyBoundaryComplete(records);
  gateMpyHaltPc(records);
  gateMpyBranchCoverage(records);
  gateMpySignCorrectness(records);
  gateMpyZero(records);
  gateMpyManifestComplete(manifest);
}

// ── imp gate ──────────────────────────────────────────────────────────────────

// imp runs the same property checks as mpy (imp delegates to mpy), differing only
// in the `[imp]` message tag and that imp returns a single-precision AC with no IO.
const IMP_L289_DETAIL = { sameSign: '', diffSign: '' };

export function gateImpBoundaryComplete(records) {
  checkBoundaryComplete(records, '[imp] ');
}

export function gateImpHaltPc(records, haltPc = HALT_PC) {
  checkHaltPc(records, haltPc, '[imp] ');
}

export function gateImpBranchCoverage(records) {
  checkBranchCoverage(records, '[imp] ', IMP_L289_DETAIL);
}

export function gateImpSignCorrectness(records) {
  checkSignCorrectness(records, '[imp] ');
}

export function gateImpZero(records) {
  checkZero(records, '[imp] ', false);
}

/**
 * The full imp gate.
 */
export function gateImp(records, manifest) {
  gateImpBoundaryComplete(records);
  gateImpHaltPc(records);
  gateImpBranchCoverage(records);
  gateImpSignCorrectness(records);
  gateImpZero(records);
  gateMpyManifestComplete(manifest); // same manifest covers both routines
}
