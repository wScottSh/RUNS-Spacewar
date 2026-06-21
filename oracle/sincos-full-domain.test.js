/**
 * Issue 7: Full 18-bit domain sweep for sin/cos — 2×262,144 observed Vectors.
 *
 * Test structure:
 *   1. Gate unit tests over synthetic full-domain records (no live pdp1)
 *      — six-point gate passes and fails correctly
 *   2. Integration — live oracle:
 *      a. sin sweep: all 2^18 angles → {in, ac, pc} records, gated, written
 *      b. cos sweep: all 2^18 angles → {in, ac, pc} records, gated, written
 *      Each sweep gates green and writes:
 *        oracle/sincos-sin-vectors.jsonl + oracle/sincos-sin-manifest.json
 *        oracle/sincos-cos-vectors.jsonl + oracle/sincos-cos-manifest.json
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fullAngleDomain, runSinBatch, runCosBatch,
  MAX_ANGLE, ANGLE_COUNT, HALT_PC,
} from './sincos-substrate.js';
import { pdp1Version } from './simh.js';
import {
  gateFullSinDomain, gateFullCosDomain,
  gateSinCalibration, gateCosCalibration,
  gateSincosEnumerationComplete, gateSincosWidthFits, gateSincosHaltPc,
  gateSinAntisymmetry, gateCosSymmetry, gateSincosManifestComplete,
  SIN_ZERO, COS_ZERO, WORD_CEILING,
} from './sincos-gate.js';
import {
  serializeSincosVectors, buildSincosManifest, sha256File,
} from './sincos-vectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── Synthetic helpers ─────────────────────────────────────────────────────────

// A constant value for all cos records (trivially symmetric).
const COS_SYNTHETIC_VAL = COS_ZERO;

// Antisymmetric function for sin: positive angles → SVAL, negative → ~SVAL,
// zeros → 0. Matches the gate's expectation.
const SIN_SVAL = 0o050000;
const SIN_NVAL = MAX_ANGLE ^ SIN_SVAL;

function syntheticSinDomain() {
  return new Array(ANGLE_COUNT).fill(null).map((_, i) => {
    if (i === 0 || i === MAX_ANGLE) return { in: i, ac: 0, pc: HALT_PC };
    if (i < 0o400000) return { in: i, ac: SIN_SVAL, pc: HALT_PC };
    return { in: i, ac: SIN_NVAL, pc: HALT_PC };
  });
}

function syntheticCosDomain() {
  return new Array(ANGLE_COUNT).fill(null).map((_, i) => ({
    in: i, ac: COS_SYNTHETIC_VAL, pc: HALT_PC,
  }));
}

// Minimal valid manifests for gate tests.
function goodManifest(routine) {
  return {
    routine,
    entry_pc_octal: routine === 'sin' ? '0074' : '0066',
    rim_sha256: 'deadbeef',
    listing_core_status: 'verified',
    domain: { range_octal: '000000..777777', confluence_witnesses: ['a', 'b'] },
    calling_convention: { jda_Y: '...' },
    calibration: { input_octal: '000000' },
    tool_versions: { node: 'v20' },
  };
}

// ── Gate unit tests: gateFullSinDomain ───────────────────────────────────────

test('gateFullSinDomain: passes for a valid synthetic sin record set', () => {
  const records = syntheticSinDomain();
  records[0].ac = SIN_ZERO; // sin(0) = 0
  assert.doesNotThrow(() => gateFullSinDomain(records, goodManifest('sin')));
});

test('gateFullSinDomain: rejects when sin(0) is wrong', () => {
  const records = syntheticSinDomain();
  records[0].ac = 1; // wrong: sin(0) ≠ 1
  assert.throws(() => gateFullSinDomain(records, goodManifest('sin')), /sin calibration/);
});

test('gateFullSinDomain: rejects when enumeration is wrong', () => {
  const records = syntheticSinDomain();
  records[500].in = 999; // corrupt index 500
  assert.throws(() => gateFullSinDomain(records, goodManifest('sin')), /enumeration/);
});

test('gateFullSinDomain: rejects when halt-PC is wrong', () => {
  const records = syntheticSinDomain();
  records[1].pc = 0o7703; // wrong halt PC
  assert.throws(() => gateFullSinDomain(records, goodManifest('sin')), /halt-PC/);
});

test('gateFullSinDomain: rejects when antisymmetry fails', () => {
  const records = syntheticSinDomain();
  // Gate samples x = 1, 1025, 2049, ... (starting at 1, step 1024).
  // Corrupt x=1 (first sampled): sin(1)=1 → ~sin(1)=777776, but sin(~1)=SIN_NVAL≠777776.
  records[1].ac = 1;
  assert.throws(() => gateFullSinDomain(records, goodManifest('sin')), /antisymmetry/);
});

test('gateFullSinDomain: rejects when manifest is incomplete', () => {
  const records = syntheticSinDomain();
  records[0].ac = SIN_ZERO;
  const m = goodManifest('sin');
  delete m.rim_sha256;
  assert.throws(() => gateFullSinDomain(records, m), /manifest.*rim_sha256/);
});

// ── Gate unit tests: gateFullCosDomain ───────────────────────────────────────

test('gateFullCosDomain: passes for a valid synthetic cos record set', () => {
  const records = syntheticCosDomain();
  assert.doesNotThrow(() => gateFullCosDomain(records, goodManifest('cos')));
});

test('gateFullCosDomain: rejects when cos(0) is wrong', () => {
  const records = syntheticCosDomain();
  records[0].ac = 0; // wrong: cos(0) ≠ 0
  assert.throws(() => gateFullCosDomain(records, goodManifest('cos')), /cos calibration/);
});

test('gateFullCosDomain: rejects when symmetry fails', () => {
  const records = syntheticCosDomain();
  records[0].ac = COS_ZERO;
  records[MAX_ANGLE].ac = COS_ZERO + 1; // cos(~0) ≠ cos(0)
  assert.throws(() => gateFullCosDomain(records, goodManifest('cos')), /cos symmetry/);
});

// ── Integration: live full-domain sin sweep ───────────────────────────────────

test(
  'sin: full 2^18-angle domain captured, gated, and written (live oracle)',
  { timeout: 3_600_000 },
  async () => {
    const angles = fullAngleDomain();
    assert.equal(angles.length, ANGLE_COUNT, '262,144 angles enumerated');

    // Single-process capture with generous timeout.
    const records = await runSinBatch(RIM_PATH, angles, { timeout: 3_600_000 });
    assert.equal(records.length, ANGLE_COUNT, '262,144 sin records captured');

    // Statelessness: re-run a spread of angles in a fresh process and confirm
    // identical results — proves the batch loop carries no per-call state.
    const spotAngles = [0, 1, 0o020000, 0o377777, 0o400000, 0o757777, 0o777777];
    const spot = await runSinBatch(RIM_PATH, spotAngles, { timeout: 60_000 });
    for (const s of spot) {
      const full = records[s.in];
      assert.equal(s.ac, full.ac, `stateless sin AC for in=${s.in.toString(8)}`);
    }

    // Build provenance manifest.
    const prov = JSON.parse(await readFile(join(HERE, 'provenance.json'), 'utf8'));
    const manifest = buildSincosManifest({
      routine: 'sin',
      rimSha256: await sha256File(RIM_PATH),
      listingCoreStatus: prov.listing_core_status,
      callingConvention: {
        source: 'revealed by calibration and listing (sincos.test.js)',
        jda_Y: 'M[Y] ← AC (angle); AC ← PC (return address); PC ← Y+1',
        sin_entry_flow:
          'jda sin → M[0074]=angle, AC=return_PC, PC=0075; ' +
          'dap csx patches return address; lac sin loads angle; ' +
          'quadrant reduction via si1/si2/si3; result in AC on return via patched csx: jmp .',
        input_format: '18-bit signed angle (1\'s complement), binary point right of bit 3, spanning ±2π',
        output_format: '18-bit signed result (1\'s complement), binary point right of bit 0; scale = 2^17',
      },
      calibration: {
        input_octal: '000000',
        machine_ac_octal: '000000',
        interpretation: 'sin(0) = 0 — exact zero, confirmed from live Substrate',
        halt_pc_octal: HALT_PC.toString(8).padStart(6, '0'),
      },
      toolVersions: {
        simh_pdp1: await pdp1Version(),
        macro1: 'macro1.c — canonical PDP-1 Macro assembler (tools/macro1)',
        node: process.version,
      },
      vectorCount: records.length,
    });

    // Full gate — throws with witnessing case on any failure.
    gateFullSinDomain(records, manifest);

    // Write Vector set and manifest.
    await writeFile(join(HERE, 'sincos-sin-vectors.jsonl'), serializeSincosVectors(records));
    await writeFile(
      join(HERE, 'sincos-sin-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
  }
);

// ── Integration: live full-domain cos sweep ───────────────────────────────────

test(
  'cos: full 2^18-angle domain captured, gated, and written (live oracle)',
  { timeout: 3_600_000 },
  async () => {
    const angles = fullAngleDomain();
    assert.equal(angles.length, ANGLE_COUNT, '262,144 angles enumerated');

    const records = await runCosBatch(RIM_PATH, angles, { timeout: 3_600_000 });
    assert.equal(records.length, ANGLE_COUNT, '262,144 cos records captured');

    // Statelessness spot check.
    const spotAngles = [0, 1, 0o020000, 0o377777, 0o400000, 0o757777, 0o777777];
    const spot = await runCosBatch(RIM_PATH, spotAngles, { timeout: 60_000 });
    for (const s of spot) {
      const full = records[s.in];
      assert.equal(s.ac, full.ac, `stateless cos AC for in=${s.in.toString(8)}`);
    }

    // Build provenance manifest.
    const prov = JSON.parse(await readFile(join(HERE, 'provenance.json'), 'utf8'));
    const manifest = buildSincosManifest({
      routine: 'cos',
      rimSha256: await sha256File(RIM_PATH),
      listingCoreStatus: prov.listing_core_status,
      callingConvention: {
        source: 'revealed by calibration and listing (sincos.test.js)',
        jda_Y: 'M[Y] ← AC (angle); AC ← PC (return address); PC ← Y+1',
        cos_entry_flow:
          'jda cos → M[0066]=angle, AC=return_PC, PC=0067; ' +
          'dap csx; lac (62210; add cos; dac sin; jmp sin+4 — ' +
          'adjusts angle by π/2 then falls through to sin SI3 path',
        input_format: '18-bit signed angle (1\'s complement), binary point right of bit 3, spanning ±2π',
        output_format: '18-bit signed result (1\'s complement), binary point right of bit 0; scale = 2^17',
      },
      calibration: {
        input_octal: '000000',
        machine_ac_octal: COS_ZERO.toString(8).padStart(6, '0'),
        interpretation:
          'cos(0) = 377774 ≈ 1.0 (Taylor-series approximation; max positive = 377777 = 131071/131072)',
        halt_pc_octal: HALT_PC.toString(8).padStart(6, '0'),
      },
      toolVersions: {
        simh_pdp1: await pdp1Version(),
        macro1: 'macro1.c — canonical PDP-1 Macro assembler (tools/macro1)',
        node: process.version,
      },
      vectorCount: records.length,
    });

    gateFullCosDomain(records, manifest);

    await writeFile(join(HERE, 'sincos-cos-vectors.jsonl'), serializeSincosVectors(records));
    await writeFile(
      join(HERE, 'sincos-cos-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
  }
);
