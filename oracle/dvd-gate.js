/**
 * Acceptance gate for the idv/dvd Oracle (ADR-0009, strength: branch-complete
 * + boundary sample, ADR-0004).
 *
 * The gate is a pure function over captured records — no Substrate.
 *
 * Branch obligations (issue #9 acceptance criteria):
 *   L362 0o320  spa   — skip if divisor ≥ 0        (both entries share this code)
 *   L366 0o324  sma   — skip if hi-dividend < 0    (observed via dvd entry)
 *   L375 0o335  sma   — skip if dv2-adjusted < 0   (normal) / not skip → dve (overflow)
 *   L383 0o366  spi   — skip if IO ≥ 0 (quotient sign, normal path)
 *   L393 0o400  spi   — skip if IO ≥ 0 (at dve, overflow path)
 *
 * Halt-PC distinguishes paths:
 *   idv normal    = IDV_HALT_NORMAL   (0o7707)
 *   idv overflow  = IDV_HALT_OVERFLOW (0o7706)
 *   dvd normal    = DVD_HALT_NORMAL   (0o7716)
 *   dvd overflow  = DVD_HALT_OVERFLOW (0o7715)
 */
import {
  IDV_HALT_NORMAL,
  IDV_HALT_OVERFLOW,
  DVD_HALT_NORMAL,
  DVD_HALT_OVERFLOW,
  SIGN_BIT,
  WORD_MASK,
} from './dvd-substrate.js';

const oct = (v) => (v & WORD_MASK).toString(8).padStart(6, '0');
const isNeg = (w) => (w & SIGN_BIT) !== 0;

// ── idv branch gate ────────────────────────────────────────────────────────

/**
 * Verify that the idv Vector set observes all required branches both ways.
 *
 * Checks:
 *   - L362 spa: at least one positive-divisor record (taken) and one negative (not taken).
 *   - L375 sma: at least one normal-path record and one overflow-path record.
 *   - L383 spi is covered transitively when L366 is covered via dvd; idv cases
 *     with M[dvd]=0 always produce IO=0 at L383 (spi taken) — that side is here.
 *
 * `records` is the array returned by runIdvBatch().
 */
export function gateIdvBranchComplete(records) {
  // L375: both sides require normal and overflow halt-PCs.
  const hasNormal   = records.some((r) => r.pc === IDV_HALT_NORMAL);
  const hasOverflow = records.some((r) => r.pc === IDV_HALT_OVERFLOW);
  if (!hasNormal) {
    throw new Error(
      'gate FAIL (idv branch L375): no normal-path record ' +
      `(expected halt-PC ${oct(IDV_HALT_NORMAL)} not found)`
    );
  }
  if (!hasOverflow) {
    throw new Error(
      'gate FAIL (idv branch L375): no overflow-path record ' +
      `(expected halt-PC ${oct(IDV_HALT_OVERFLOW)} not found)`
    );
  }

  // L362: positive and negative divisor.
  const hasPosDiv = records.some((r) => !isNeg(r.divisor));
  const hasNegDiv = records.some((r) => isNeg(r.divisor));
  if (!hasPosDiv) {
    throw new Error(
      'gate FAIL (idv branch L362 spa): no positive-divisor record ' +
      '(spa-taken side not observed)'
    );
  }
  if (!hasNegDiv) {
    throw new Error(
      'gate FAIL (idv branch L362 spa): no negative-divisor record ' +
      '(spa-not-taken / cma side not observed)'
    );
  }
}

// ── dvd branch gate ────────────────────────────────────────────────────────

/**
 * Verify that the dvd Vector set observes all required branches both ways.
 *
 * Checks:
 *   - L366 sma: one positive hi-dividend record (not taken) and one negative (taken).
 *   - L375 sma: normal and overflow halt-PCs present.
 *   - L383 spi: positive hi-div → IO=M[dvd]=0 at L383 (taken); negative hi-div → taken=false.
 *     Verified transitively by L366 coverage (positive / negative hi-div records).
 *   - L393 spi (at dve): overflow cases must include one with positive lo-dividend (taken)
 *     and one with negative lo-dividend (not taken).
 *
 * `records` is the array returned by runDvdBatch().
 */
export function gateDvdBranchComplete(records) {
  // L375: normal and overflow.
  const hasNormal   = records.some((r) => r.pc === DVD_HALT_NORMAL);
  const hasOverflow = records.some((r) => r.pc === DVD_HALT_OVERFLOW);
  if (!hasNormal) {
    throw new Error(
      'gate FAIL (dvd branch L375): no normal-path record ' +
      `(halt-PC ${oct(DVD_HALT_NORMAL)} not found)`
    );
  }
  if (!hasOverflow) {
    throw new Error(
      'gate FAIL (dvd branch L375): no overflow-path record ' +
      `(halt-PC ${oct(DVD_HALT_OVERFLOW)} not found)`
    );
  }

  // L366: positive and negative hi-dividend.
  const hasPosHi = records.some((r) => !isNeg(r.hiDiv));
  const hasNegHi = records.some((r) => isNeg(r.hiDiv));
  if (!hasPosHi) {
    throw new Error(
      'gate FAIL (dvd branch L366 sma): no positive-hi-dividend record ' +
      '(sma-not-taken side not observed)'
    );
  }
  if (!hasNegHi) {
    throw new Error(
      'gate FAIL (dvd branch L366 sma): no negative-hi-dividend record ' +
      '(sma-taken side not observed)'
    );
  }

  // L393 spi at dve: overflow records must cover positive and negative lo-dividend.
  const dveRecs = records.filter((r) => r.pc === DVD_HALT_OVERFLOW);
  const hasPosLo = dveRecs.some((r) => !isNeg(r.loDiv));
  const hasNegLo = dveRecs.some((r) => isNeg(r.loDiv));
  if (!hasPosLo) {
    throw new Error(
      'gate FAIL (dvd branch L393 spi in dve): no overflow record with ' +
      'positive lo-dividend (spi-taken side not observed)'
    );
  }
  if (!hasNegLo) {
    throw new Error(
      'gate FAIL (dvd branch L393 spi in dve): no overflow record with ' +
      'negative lo-dividend (spi-not-taken side not observed)'
    );
  }
}

// ── boundary gate ──────────────────────────────────────────────────────────

/**
 * Verify that boundary operands are present in the combined idv+dvd sets.
 *
 * Required by the acceptance criteria:
 *   zero dividend, ÷0 (zero divisor), max positive magnitude, negative dividend.
 */
export function gateBoundaryPresent(idvRecords, dvdRecords) {
  const MAX_POS = 0o177777;  // largest positive 18-bit ones-complement value

  if (!idvRecords.some((r) => r.dividend === 0)) {
    throw new Error('gate FAIL (boundary): no zero-dividend record in idv set');
  }
  if (!idvRecords.some((r) => r.divisor === 0)) {
    throw new Error('gate FAIL (boundary): no ÷0 record (zero divisor) in idv set');
  }
  if (!idvRecords.some((r) => r.dividend === MAX_POS)) {
    throw new Error(
      `gate FAIL (boundary): no max-positive-dividend (${oct(MAX_POS)}) record`
    );
  }
  if (!idvRecords.some((r) => isNeg(r.dividend))) {
    throw new Error('gate FAIL (boundary): no negative-dividend record in idv set');
  }
}

// ── manifest gate ──────────────────────────────────────────────────────────

const REQUIRED_MANIFEST_FIELDS = [
  'routine',
  'entries',
  'rim_sha256',
  'listing_core_status',
  'domain',
  'calling_convention',
  'strength',
  'branch_coverage',
  'tool_versions',
];

/**
 * Verify that the provenance manifest carries all required ADR-0008 fields.
 */
export function gateDvdManifestComplete(manifest) {
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
