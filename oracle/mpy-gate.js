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

/**
 * Property 1 — boundary complete: every expected {f1, f2} pair is present in records.
 * Witnesses all four sign combinations + zero + max magnitude per the issue spec.
 */
export function gateMpyBoundaryComplete(records) {
  for (const expected of BOUNDARY_CASES) {
    const r = records.find((r) => r.f1 === expected.f1 && r.f2 === expected.f2);
    if (!r) {
      throw new Error(
        `gate FAIL (boundary complete): missing case f1=${oct(expected.f1)} f2=${oct(expected.f2)}`
      );
    }
  }
}

/**
 * Property 2 — halt-PC: every case returned to the caller stub (no infinite loop).
 */
export function gateMpyHaltPc(records, haltPc = HALT_PC) {
  for (const r of records) {
    if (r.pc !== haltPc) {
      throw new Error(
        `gate FAIL (halt-PC): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `expected PC=${haltPc.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
}

/**
 * Property 3 — branch coverage (L276 spa, L281 spa, L289 sma observed both ways).
 * Structural: verifies the BOUNDARY_CASES span the required sign combinations.
 */
export function gateMpyBranchCoverage(records) {
  // L276 spa: f1 non-negative → skip cma (++/+- cases); f1 negative → cma (-+/-- cases)
  const hasF1Pos = records.some((r) => (r.f1 & SIGN_BIT) === 0);
  const hasF1Neg = records.some((r) => (r.f1 & SIGN_BIT) !== 0);
  if (!hasF1Pos) throw new Error('gate FAIL (L276 spa): no case with f1 non-negative');
  if (!hasF1Neg) throw new Error('gate FAIL (L276 spa): no case with f1 negative');

  // L281 spa: f2 non-negative → skip cma (++/-+ cases); f2 negative → cma (+-/-- cases)
  const hasF2Pos = records.some((r) => (r.f2 & SIGN_BIT) === 0);
  const hasF2Neg = records.some((r) => (r.f2 & SIGN_BIT) !== 0);
  if (!hasF2Pos) throw new Error('gate FAIL (L281 spa): no case with f2 non-negative');
  if (!hasF2Neg) throw new Error('gate FAIL (L281 spa): no case with f2 negative');

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
  if (!hasSameSign) throw new Error('gate FAIL (L289 sma): no same-sign case (positive-result path not observed)');
  if (!hasDiffSign) throw new Error('gate FAIL (L289 sma): no diff-sign case (negate path not observed)');
}

/**
 * Property 4 — sign correctness: the observed AC sign bit matches the operand sign
 * combination. Pure mathematical: same-sign → positive result; diff-sign → negative.
 * Zero products are excluded from the sign check (0 is non-negative in ones'-complement).
 */
export function gateMpySignCorrectness(records) {
  for (const r of records) {
    if (r.f1 === 0 || r.f2 === 0) continue; // zero product — sign inapplicable
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    const sameSign = f1Neg === f2Neg;
    const acNeg = (r.ac & SIGN_BIT) !== 0;
    if (sameSign && acNeg) {
      throw new Error(
        `gate FAIL (sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `same-sign but AC has negative sign bit: AC=${oct(r.ac)}`
      );
    }
    if (!sameSign && !acNeg) {
      throw new Error(
        `gate FAIL (sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `diff-sign but AC has non-negative sign bit: AC=${oct(r.ac)}`
      );
    }
  }
}

/**
 * Property 5 — zero product: 0 × 0 yields AC = 0 and IO = 0 for mpy.
 */
export function gateMpyZero(records) {
  const r = records.find((r) => r.f1 === 0 && r.f2 === 0);
  if (!r) throw new Error('gate FAIL (zero): no record for f1=0 f2=0');
  if (r.ac !== 0) {
    throw new Error(`gate FAIL (zero): 0×0 expected AC=000000 got ${oct(r.ac)}`);
  }
  if (r.io !== 0) {
    throw new Error(`gate FAIL (zero): 0×0 expected IO=000000 got ${oct(r.io)}`);
  }
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

/**
 * Property 1 — boundary complete (imp): same as mpy; same BOUNDARY_CASES.
 */
export function gateImpBoundaryComplete(records) {
  for (const expected of BOUNDARY_CASES) {
    const r = records.find((r) => r.f1 === expected.f1 && r.f2 === expected.f2);
    if (!r) {
      throw new Error(
        `gate FAIL [imp] (boundary complete): missing case f1=${oct(expected.f1)} f2=${oct(expected.f2)}`
      );
    }
  }
}

/**
 * Property 2 — halt-PC (imp).
 */
export function gateImpHaltPc(records, haltPc = HALT_PC) {
  for (const r of records) {
    if (r.pc !== haltPc) {
      throw new Error(
        `gate FAIL [imp] (halt-PC): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `expected PC=${haltPc.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
}

/**
 * Property 3 — branch coverage (imp): same sign-handling skips as mpy (imp delegates to mpy).
 */
export function gateImpBranchCoverage(records) {
  const hasF1Pos = records.some((r) => (r.f1 & SIGN_BIT) === 0);
  const hasF1Neg = records.some((r) => (r.f1 & SIGN_BIT) !== 0);
  if (!hasF1Pos) throw new Error('gate FAIL [imp] (L276 spa): no case with f1 non-negative');
  if (!hasF1Neg) throw new Error('gate FAIL [imp] (L276 spa): no case with f1 negative');

  const hasF2Pos = records.some((r) => (r.f2 & SIGN_BIT) === 0);
  const hasF2Neg = records.some((r) => (r.f2 & SIGN_BIT) !== 0);
  if (!hasF2Pos) throw new Error('gate FAIL [imp] (L281 spa): no case with f2 non-negative');
  if (!hasF2Neg) throw new Error('gate FAIL [imp] (L281 spa): no case with f2 negative');

  const hasSameSign = records.some((r) => {
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    return f1Neg === f2Neg;
  });
  const hasDiffSign = records.some((r) => {
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    return f1Neg !== f2Neg;
  });
  if (!hasSameSign) throw new Error('gate FAIL [imp] (L289 sma): no same-sign case');
  if (!hasDiffSign) throw new Error('gate FAIL [imp] (L289 sma): no diff-sign case');
}

/**
 * Property 4 — sign correctness (imp): same-sign → AC bit 17 clear; diff-sign → AC bit 17 set.
 */
export function gateImpSignCorrectness(records) {
  for (const r of records) {
    if (r.f1 === 0 || r.f2 === 0) continue;
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    const sameSign = f1Neg === f2Neg;
    const acNeg = (r.ac & SIGN_BIT) !== 0;
    if (sameSign && acNeg) {
      throw new Error(
        `gate FAIL [imp] (sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `same-sign but AC has negative sign bit: AC=${oct(r.ac)}`
      );
    }
    if (!sameSign && !acNeg) {
      throw new Error(
        `gate FAIL [imp] (sign correctness): f1=${oct(r.f1)} f2=${oct(r.f2)} ` +
          `diff-sign but AC has non-negative sign bit: AC=${oct(r.ac)}`
      );
    }
  }
}

/**
 * Property 5 — zero product (imp): 0 × 0 → AC = 0.
 */
export function gateImpZero(records) {
  const r = records.find((r) => r.f1 === 0 && r.f2 === 0);
  if (!r) throw new Error('gate FAIL [imp] (zero): no record for f1=0 f2=0');
  if (r.ac !== 0) {
    throw new Error(`gate FAIL [imp] (zero): 0×0 expected AC=000000 got ${oct(r.ac)}`);
  }
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
