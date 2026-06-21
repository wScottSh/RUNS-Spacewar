/**
 * Vector-set serialization and provenance-manifest construction for sin/cos (ADR-0008).
 *
 * Raw 18-bit words in octal, so a future Realization reproduces the original's bits,
 * not someone's decimal reading of them. The manifest binds the words to the exact
 * Image and convention that produced them.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SIN_ADDR, COS_ADDR, MAX_ANGLE, ANGLE_COUNT } from './sincos-substrate.js';

const oct = (v) => v.toString(8).padStart(6, '0');

/**
 * Serialize {in, ac, pc} records to JSONL — one record per line, every field a
 * zero-padded 6-digit octal string. Stable field order.
 */
export function serializeSincosVectors(records) {
  return (
    records
      .map((r) => JSON.stringify({ in: oct(r.in), ac: oct(r.ac), pc: oct(r.pc) }))
      .join('\n') + '\n'
  );
}

/** SHA-256 of a file's bytes, lowercase hex. */
export async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Build the provenance manifest for a sin or cos Vector set (ADR-0008).
 *   routine        — 'sin' or 'cos'
 *   rimSha256      — SHA-256 of the assembled Image
 *   listingCoreStatus — byte-for-byte match status
 *   callingConvention — revealed calling convention
 *   calibration    — the anchor observation (sin(0)=0 or cos(0)=377774)
 *   toolVersions   — { simh_pdp1, macro1, node }
 *   vectorCount    — number of records (must be 2^18 = 262144)
 */
export function buildSincosManifest({
  routine,
  rimSha256,
  listingCoreStatus,
  callingConvention,
  calibration,
  toolVersions,
  vectorCount,
}) {
  const entryPc = routine === 'sin' ? SIN_ADDR : COS_ADDR;
  return {
    routine,
    entry_pc_octal: entryPc.toString(8).padStart(4, '0'),
    rim_sha256: rimSha256,
    listing_core_status: listingCoreStatus,
    domain: {
      range_octal: `000000..${oct(MAX_ANGLE)}`,
      cardinality: vectorCount,
      coverage:
        'exhaustive — every 18-bit input enumerated (ADR-0004); ' +
        'enumeration is the coverage witness, every in-domain branch necessarily observed',
      confluence_witnesses: [
        "source header L191-193: 'argument is between .+2 pi, with binary point to right of bit 3' (Translator-class)",
        'ADR-0004: unary routines with domain ≤2^18 are vectored exhaustively',
        'ADR-0007: game-scoped domain; caller at L1118 (jda sin) and L1171 (jda cos)',
      ],
    },
    calling_convention: callingConvention,
    calibration,
    tool_versions: toolVersions,
    vector_file: `sincos-${routine}-vectors.jsonl`,
    vector_count: vectorCount,
    strength: 'exhaustive / proof (ADR-0004, ADR-0012)',
  };
}
