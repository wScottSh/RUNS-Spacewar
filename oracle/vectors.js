/**
 * Vector-set serialization and provenance-manifest construction (ADR-0008).
 *
 * A Vector set is recorded as raw 18-bit machine words in octal, so a future
 * Realization reproduces the original's *bits*, not someone's decimal reading of
 * them (user story 2). The manifest binds the words to the exact Image and
 * convention that produced them, so a skeptic can re-derive or distrust the set
 * on evidence (user stories 10–11).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SQT_ADDR } from './substrate.js';

const oct = (v) => v.toString(8).padStart(6, '0');

/**
 * Serialize {in, ac, pc} records to JSONL, one record per line, every field a
 * zero-padded 6-digit octal string (the raw machine word). Stable field order.
 */
export function serializeVectors(records) {
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
 * Build the complete provenance manifest for the sqt Vector set (ADR-0008):
 * routine + entry PC, the .rim hash and listing↔core status, the domain bound
 * with its ADR-0007 confluence witnesses, the calibration result, the revealed
 * calling convention, and the tool versions that produced it.
 *
 * Inputs are explicit so the function is pure and unit-testable without the
 * Substrate; the caller supplies the live rim hash, calibration, and versions.
 */
export function buildManifest({
  rimSha256,
  listingCoreStatus,
  callingConvention,
  calibration,
  toolVersions,
  vectorCount,
  maxInput,
}) {
  return {
    routine: 'sqt',
    entry_pc_octal: SQT_ADDR.toString(8).padStart(4, '0'),
    rim_sha256: rimSha256,
    listing_core_status: listingCoreStatus,
    domain: {
      range_octal: `000000..${oct(maxInput)}`,
      cardinality: vectorCount,
      coverage: 'exhaustive — every input enumerated (ADR-0004); enumeration is the coverage witness, no trace instrumentation built',
      confluence_witnesses: [
        "source comment '/largest input number = 177777' (Translator-class, not authoritative alone)",
        'static reading of gravity str computation (sole caller, jda sqt at L1145)',
        'masswerk account of sqt input range',
      ],
      out_of_contract_note:
        'sqt is total over all 2^18 words; values for negatives and inputs above the band are out of the game\'s reach and not pinned here (ADR-0007)',
    },
    calling_convention: callingConvention,
    calibration,
    tool_versions: toolVersions,
    vector_file: 'sqt-vectors.jsonl',
    vector_count: vectorCount,
  };
}
