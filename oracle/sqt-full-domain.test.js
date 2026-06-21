/**
 * Issue 4: Produce the complete, gated, self-attesting sqt Vector set over the
 * full game-exercised domain 0..0177777.
 *
 * Test structure:
 *   1. gate property unit tests over synthetic record sets (no live pdp1):
 *      enumeration-complete, √0, monotonicity, perfect-squares, max boundary,
 *      width, manifest-complete, and the seven-point composer.
 *   2. vectors unit tests: serialization + manifest construction (no live pdp1).
 *   3. integration: live oracle enumerates all 65,536 inputs in one process,
 *      gates the whole set, confirms statelessness, and writes the Vector file
 *      plus its complete provenance manifest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fullDomainInputs,
  runDomainBatch,
  MAX_INPUT,
  ROOT_SCALE,
  HALT_PC,
} from './substrate.js';
import { pdp1Version } from './simh.js';
import {
  gateEnumerationComplete,
  gateSqrtZero,
  gateMonotone,
  gatePerfectSquaresInDomain,
  gateMaxBoundary,
  gateWidthFits,
  gateManifestComplete,
  gateFullDomain,
  WORD_CEILING,
} from './gate.js';
import { serializeVectors, buildManifest, sha256File } from './vectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── synthetic record helpers ──────────────────────────────────────────────────

// A record set that satisfies every gate property: ac = round(√in · ROOT_SCALE).
// Monotone, exact at perfect squares, √0=0, width-fitting — a valid stand-in for
// the captured set so gate logic can be tested without the Substrate.
function syntheticDomain(max = MAX_INPUT) {
  const records = new Array(max + 1);
  for (let i = 0; i <= max; i++) {
    records[i] = { in: i, ac: Math.round(Math.sqrt(i) * ROOT_SCALE), pc: HALT_PC };
  }
  return records;
}

function smallSynthetic() {
  // 0..24 → exercises perfect squares 0,1,4,9,16 and the max boundary at 24.
  return syntheticDomain(24);
}

// ── gate: enumeration complete ────────────────────────────────────────────────

test('gateEnumerationComplete: passes for a contiguous 0..max set', () => {
  assert.doesNotThrow(() => gateEnumerationComplete(smallSynthetic(), 24));
});

test('gateEnumerationComplete: fails (witness) on a gap / out-of-order input', () => {
  const records = smallSynthetic();
  records[10].in = 999; // count intact, but index 10 no longer holds input 10
  assert.throws(() => gateEnumerationComplete(records, 24), /enumeration.*index 10/);
});

test('gateEnumerationComplete: fails when count is wrong', () => {
  assert.throws(
    () => gateEnumerationComplete(smallSynthetic(), 25),
    /expected 26 records, got 25/
  );
});

// ── gate: √0 ──────────────────────────────────────────────────────────────────

test('gateSqrtZero: passes when input 0 yields AC 0', () => {
  assert.doesNotThrow(() => gateSqrtZero(smallSynthetic()));
});

test('gateSqrtZero: fails (witness) when √0 ≠ 0', () => {
  const records = smallSynthetic();
  records[0].ac = 1;
  assert.throws(() => gateSqrtZero(records), /√0.*expected AC=000000/);
});

// ── gate: monotonicity ────────────────────────────────────────────────────────

test('gateMonotone: passes for a non-decreasing set', () => {
  assert.doesNotThrow(() => gateMonotone(smallSynthetic()));
});

test('gateMonotone: fails (witness) on a drop — the systematic-error catch', () => {
  const records = smallSynthetic();
  records[12].ac = records[11].ac - 1; // a dip
  assert.throws(() => gateMonotone(records), /monotonicity.*in=000014/);
});

// ── gate: perfect squares over full-domain records ────────────────────────────

test('gatePerfectSquaresInDomain: passes when every n² yields n·ROOT_SCALE', () => {
  assert.doesNotThrow(() => gatePerfectSquaresInDomain(smallSynthetic(), 24));
});

test('gatePerfectSquaresInDomain: fails (witness) on a wrong root', () => {
  const records = smallSynthetic();
  records[16].ac += 1; // n=4, n²=16 corrupted
  assert.throws(() => gatePerfectSquaresInDomain(records, 24), /perfect square.*n=4/);
});

// ── gate: max boundary ────────────────────────────────────────────────────────

test('gateMaxBoundary: integer part equals floor(√max)', () => {
  // For max=24, floor(√24)=4; synthetic ac=round(√24·512), ac>>9 = 4.
  assert.doesNotThrow(() => gateMaxBoundary(smallSynthetic(), 24));
});

test('gateMaxBoundary: fails when the top answer is off', () => {
  const records = smallSynthetic();
  records[24].ac = 0; // integer part 0 ≠ 4
  assert.throws(() => gateMaxBoundary(records, 24), /max boundary/);
});

// ── gate: width ───────────────────────────────────────────────────────────────

test('gateWidthFits: passes when every AC fits 18 bits', () => {
  assert.doesNotThrow(() => gateWidthFits(smallSynthetic()));
});

test('gateWidthFits: fails when an AC overflows the result width', () => {
  const records = smallSynthetic();
  records[5].ac = WORD_CEILING; // one past the 18-bit ceiling
  assert.throws(() => gateWidthFits(records), /width.*in=000005/);
});

// ── gate: manifest complete ───────────────────────────────────────────────────

function goodManifest() {
  return {
    routine: 'sqt',
    entry_pc_octal: '0246',
    rim_sha256: 'deadbeef',
    listing_core_status: 'verified',
    domain: { range_octal: '000000..177777', confluence_witnesses: ['a', 'b'] },
    calling_convention: { jda_Y: '...' },
    calibration: { input_octal: '000004' },
    tool_versions: { node: 'v20' },
  };
}

test('gateManifestComplete: passes for a complete manifest', () => {
  assert.doesNotThrow(() => gateManifestComplete(goodManifest()));
});

test('gateManifestComplete: fails when a required field is missing', () => {
  const m = goodManifest();
  delete m.rim_sha256;
  assert.throws(() => gateManifestComplete(m), /manifest.*rim_sha256/);
});

test('gateManifestComplete: fails when domain has no confluence witnesses', () => {
  const m = goodManifest();
  m.domain.confluence_witnesses = [];
  assert.throws(() => gateManifestComplete(m), /confluence_witnesses/);
});

// ── gate: the seven-point composer ────────────────────────────────────────────

test('gateFullDomain: passes for a clean synthetic set + complete manifest', () => {
  const records = smallSynthetic();
  assert.doesNotThrow(() => gateFullDomain(records, goodManifest(), 24));
});

test('gateFullDomain: rejects a set whose calibration anchor is wrong', () => {
  const records = smallSynthetic();
  records[4].ac = 0; // anchor in=4 should be 2·ROOT_SCALE
  assert.throws(() => gateFullDomain(records, goodManifest(), 24), /calibration anchor/);
});

// ── vectors: serialization ────────────────────────────────────────────────────

test('serializeVectors: raw octal words, stable field order, one per line', () => {
  const jsonl = serializeVectors([
    { in: 0, ac: 0, pc: HALT_PC },
    { in: 4, ac: 2 * ROOT_SCALE, pc: HALT_PC },
  ]);
  const lines = jsonl.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '{"in":"000000","ac":"000000","pc":"007704"}');
  assert.equal(lines[1], '{"in":"000004","ac":"002000","pc":"007704"}');
});

// ── vectors: manifest construction ────────────────────────────────────────────

test('buildManifest: assembles a complete manifest that passes the gate', () => {
  const manifest = buildManifest({
    rimSha256: 'abc123',
    listingCoreStatus: 'verified — byte-for-byte',
    callingConvention: { jda_Y: 'M[Y]←AC; AC←PC; PC←Y+1' },
    calibration: { input_octal: '000004', machine_ac_octal: '002000' },
    toolVersions: { simh_pdp1: 'Open SIMH V4.1-0', node: process.version },
    vectorCount: MAX_INPUT + 1,
    maxInput: MAX_INPUT,
  });
  assert.equal(manifest.routine, 'sqt');
  assert.equal(manifest.entry_pc_octal, '0246');
  assert.equal(manifest.rim_sha256, 'abc123');
  assert.equal(manifest.vector_count, MAX_INPUT + 1);
  assert.equal(manifest.domain.range_octal, '000000..177777');
  assert.ok(manifest.domain.confluence_witnesses.length >= 1);
  assert.doesNotThrow(() => gateManifestComplete(manifest));
});

// ── integration: live full-domain capture, gate, and write ────────────────────

test('full domain 0..0177777 captured, gated, and written (live oracle)', { timeout: 600_000 }, async () => {
  const inputs = fullDomainInputs();
  assert.equal(inputs.length, MAX_INPUT + 1, '65,536 inputs enumerated');

  // Single-process capture with a generous timeout guarding against a non-halt.
  const records = await runDomainBatch(RIM_PATH, inputs, { timeout: 600_000 });
  assert.equal(records.length, MAX_INPUT + 1, '65,536 records captured');

  // Statelessness: re-run a spread of inputs in a *fresh* process and confirm
  // identical answers — proving the batch loop carries no per-call reset.
  const spotInputs = [0, 1, 4, 2, 65535, 9, 100, 65535, 0];
  const spot = await runDomainBatch(RIM_PATH, spotInputs, { timeout: 60_000 });
  for (const s of spot) {
    const full = records[s.in];
    assert.equal(s.ac, full.ac, `stateless AC for in=${s.in.toString(8)}`);
    assert.equal(s.pc, full.pc, `stateless PC for in=${s.in.toString(8)}`);
  }

  // Build the complete provenance manifest from live evidence.
  const prov = JSON.parse(await readFile(join(HERE, 'provenance.json'), 'utf8'));
  const manifest = buildManifest({
    rimSha256: await sha256File(RIM_PATH),
    listingCoreStatus: prov.listing_core_status,
    callingConvention: prov.calling_convention,
    calibration: prov.calibration,
    toolVersions: {
      simh_pdp1: await pdp1Version(),
      macro1: 'macro1.c — canonical PDP-1 Macro assembler (tools/macro1)',
      node: process.version,
    },
    vectorCount: records.length,
    maxInput: MAX_INPUT,
  });

  // The full seven-point gate. Throws with a witnessing case on any failure.
  gateFullDomain(records, manifest, MAX_INPUT);

  // Write the Vector set (raw octal words) and its manifest.
  await writeFile(join(HERE, 'sqt-vectors.jsonl'), serializeVectors(records));
  await writeFile(join(HERE, 'sqt-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
});
