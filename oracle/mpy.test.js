/**
 * Issue 8: T-MPY — branch-complete + boundary-sample Vectors for imp/mpy multiply.
 *
 * Source L257–303 (mpy @ 000171, imp @ 000156).
 * Calling convention: lac f1; jda mpy/imp; lac f2.
 * mpy returns 34-bit double-length product (AC = high word, IO = low word).
 * imp returns low 17 bits + sign in AC (single-precision derivative of mpy).
 *
 * Acceptance criteria (from issue #8):
 *   - Both entries captured as observed Vectors.
 *   - Sign-handling skips L276 spa, L281 spa, L289 sma observed both ways.
 *   - Boundary operands: zero, max magnitude, all four sign combinations ++/+-/-+/--.
 *   - Gated green; provenance attested; strength = branch-complete + boundary sample (ADR-0004).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_CASES,
  HALT_PC,
  SIGN_BIT,
  MPY_ADDR,
  IMP_ADDR,
  STUB_START,
  INCELL1,
  INCELL2,
  LAC_INCELL1,
  LAC_INCELL2,
  JDA_MPY,
  JDA_IMP,
  HLT,
  MAX_MAG_POS,
  MAX_MAG_NEG,
  NEG_ONE,
  buildMpyBatchScript,
  buildImpBatchScript,
  parseMpyBatchOutput,
  parseImpBatchOutput,
  runMpyBatch,
  runImpBatch,
  serializeMpyVectors,
  serializeImpVectors,
  buildMpyManifest,
} from './mpy-substrate.js';
import { pdp1Version } from './simh.js';
import { sha256File } from './vectors.js';
import {
  gateMpyBoundaryComplete,
  gateMpyHaltPc,
  gateMpyBranchCoverage,
  gateMpySignCorrectness,
  gateMpyZero,
  gateMpyManifestComplete,
  gateMpy,
  gateImpBoundaryComplete,
  gateImpHaltPc,
  gateImpBranchCoverage,
  gateImpSignCorrectness,
  gateImpZero,
  gateImp,
} from './mpy-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── constants sanity ─────────────────────────────────────────────────────────

test('addresses and encodings are correct 18-bit octal words', () => {
  assert.equal(MPY_ADDR, 0o0171, 'mpy entry point from listing symbol table');
  assert.equal(IMP_ADDR, 0o0156, 'imp entry point from listing symbol table');
  assert.equal(JDA_MPY, 0o170171, 'jda mpy encoding');
  assert.equal(JDA_IMP, 0o170156, 'jda imp encoding');
  assert.equal(LAC_INCELL1, 0o207676, 'lac INCELL1 encoding');
  assert.equal(LAC_INCELL2, 0o207677, 'lac INCELL2 encoding');
  assert.equal(HLT, 0o760400, 'hlt encoding');
  assert.equal(HALT_PC, STUB_START + 4, 'halt-PC = stub+4 (SIMH fetches past hlt)');
  assert.equal(NEG_ONE, 0o777776, 'ones-complement of +1');
  assert.equal(MAX_MAG_POS, 0o177777, 'max positive 17-bit ones-complement magnitude');
  assert.equal(MAX_MAG_NEG, 0o600000, 'ones-complement of MAX_MAG_POS');
  assert.equal(SIGN_BIT, 0o400000, 'PDP-1 sign bit = bit 17');
});

// ── BOUNDARY_CASES sanity ────────────────────────────────────────────────────

test('BOUNDARY_CASES contains all four sign combinations + zero + max magnitude', () => {
  // zero case
  assert.ok(BOUNDARY_CASES.some((c) => c.f1 === 0 && c.f2 === 0), 'zero case present');

  // ++ small (positive × positive)
  assert.ok(
    BOUNDARY_CASES.some((c) => (c.f1 & SIGN_BIT) === 0 && (c.f2 & SIGN_BIT) === 0 && c.f1 !== 0),
    '++ case present'
  );

  // +- small (positive × negative)
  assert.ok(
    BOUNDARY_CASES.some((c) => (c.f1 & SIGN_BIT) === 0 && (c.f2 & SIGN_BIT) !== 0 && c.f1 !== 0),
    '+- case present'
  );

  // -+ small (negative × positive)
  assert.ok(
    BOUNDARY_CASES.some((c) => (c.f1 & SIGN_BIT) !== 0 && (c.f2 & SIGN_BIT) === 0),
    '-+ case present'
  );

  // -- small (negative × negative)
  assert.ok(
    BOUNDARY_CASES.some((c) => (c.f1 & SIGN_BIT) !== 0 && (c.f2 & SIGN_BIT) !== 0),
    '-- case present'
  );

  // max magnitude cases
  assert.ok(
    BOUNDARY_CASES.some((c) => c.f1 === MAX_MAG_POS && c.f2 === MAX_MAG_POS),
    '++ max present'
  );
  assert.ok(
    BOUNDARY_CASES.some((c) => c.f1 === MAX_MAG_NEG && c.f2 === MAX_MAG_NEG),
    '-- max present'
  );
});

// ── buildMpyBatchScript ───────────────────────────────────────────────────────

test('buildMpyBatchScript: stub deposits and per-case run/examine commands', () => {
  const cases = [{ f1: 1, f2: 2 }, { f1: 3, f2: 4 }];
  const lines = buildMpyBatchScript('/fake.rim', cases);

  // Header: load + 4 stub deposits
  assert.equal(lines[0], 'load /fake.rim');
  assert.ok(lines.some((l) => l.includes(LAC_INCELL1.toString(8))), 'lac INCELL1 deposited');
  assert.ok(lines.some((l) => l.includes(JDA_MPY.toString(8))), 'jda mpy deposited');
  assert.ok(lines.some((l) => l.includes(LAC_INCELL2.toString(8))), 'lac INCELL2 deposited');
  assert.ok(lines.some((l) => l.includes(HLT.toString(8))), 'hlt deposited');

  // Per-case: deposit f1, deposit f2, run, examine ac, examine io, examine pc
  const caseLines = lines.filter((l) => l.startsWith('deposit') || l.startsWith('run') || l.startsWith('examine'));
  // 4 stub deposits + (2 deposits + 1 run + 3 examines) × 2 cases = 4 + 12 = 16
  assert.equal(caseLines.length, 16);
  assert.ok(lines.some((l) => l === 'examine io'), 'mpy script examines IO');
  assert.equal(lines[lines.length - 1], 'quit');
});

test('buildImpBatchScript: uses jda imp and no io examine', () => {
  const cases = [{ f1: 1, f2: 2 }];
  const lines = buildImpBatchScript('/fake.rim', cases);

  assert.ok(lines.some((l) => l.includes(JDA_IMP.toString(8))), 'jda imp deposited');
  assert.ok(!lines.some((l) => l === 'examine io'), 'imp script does NOT examine IO');
  assert.ok(lines.some((l) => l === 'examine ac'), 'imp script examines AC');
  assert.ok(lines.some((l) => l === 'examine pc'), 'imp script examines PC');
});

// ── parseMpyBatchOutput ───────────────────────────────────────────────────────

test('parseMpyBatchOutput: extracts AC/IO/PC triplets from SIMH output', () => {
  const raw = [
    'HALT instruction, PC: 007704',
    'AC:\t000001',
    'IO:\t000002',
    'PC:\t007704',
    'HALT instruction, PC: 007704',
    'AC:\t777777',
    'IO:\t777776',
    'PC:\t007704',
  ];
  const records = parseMpyBatchOutput(raw, 2);
  assert.equal(records.length, 2);
  assert.equal(records[0].ac, 0o000001);
  assert.equal(records[0].io, 0o000002);
  assert.equal(records[0].pc, 0o007704);
  assert.equal(records[1].ac, 0o777777);
  assert.equal(records[1].io, 0o777776);
  assert.equal(records[1].pc, 0o007704);
});

test('parseMpyBatchOutput: throws with informative error on missing AC', () => {
  const raw = ['PC:\t007704']; // no AC before PC
  assert.throws(() => parseMpyBatchOutput(raw, 1), /missing AC at case 0/);
});

// ── parseImpBatchOutput ───────────────────────────────────────────────────────

test('parseImpBatchOutput: extracts AC/PC pairs from SIMH output', () => {
  const raw = [
    'AC:\t000001',
    'PC:\t007704',
    'AC:\t777776',
    'PC:\t007704',
  ];
  const records = parseImpBatchOutput(raw, 2);
  assert.equal(records.length, 2);
  assert.equal(records[0].ac, 0o000001);
  assert.equal(records[0].pc, 0o007704);
  assert.equal(records[1].ac, 0o777776);
  assert.equal(records[1].pc, 0o007704);
});

test('parseImpBatchOutput: throws with informative error on missing AC', () => {
  const raw = ['PC:\t007704']; // no AC before PC
  assert.throws(() => parseImpBatchOutput(raw, 1), /missing AC at case 0/);
});

// ── serializeMpyVectors ───────────────────────────────────────────────────────

test('serializeMpyVectors: raw octal words, stable field order, one per line', () => {
  const records = [
    { f1: 0, f2: 0, ac: 0, io: 0, pc: HALT_PC },
    { f1: 1, f2: 1, ac: 0, io: 1, pc: HALT_PC },
  ];
  const jsonl = serializeMpyVectors(records);
  const lines = jsonl.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '{"f1":"000000","f2":"000000","ac":"000000","io":"000000","pc":"007704"}');
  assert.equal(lines[1], '{"f1":"000001","f2":"000001","ac":"000000","io":"000001","pc":"007704"}');
});

// ── serializeImpVectors ───────────────────────────────────────────────────────

test('serializeImpVectors: raw octal words, stable field order, one per line', () => {
  const records = [
    { f1: 0, f2: 0, ac: 0, pc: HALT_PC },
    { f1: 1, f2: 1, ac: 1, pc: HALT_PC },
  ];
  const jsonl = serializeImpVectors(records);
  const lines = jsonl.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '{"f1":"000000","f2":"000000","ac":"000000","pc":"007704"}');
  assert.equal(lines[1], '{"f1":"000001","f2":"000001","ac":"000001","pc":"007704"}');
});

// ── buildMpyManifest ─────────────────────────────────────────────────────────

test('buildMpyManifest: assembles a complete manifest that passes the gate', () => {
  const manifest = buildMpyManifest({
    rimSha256: 'abc123',
    listingCoreStatus: 'verified — listing↔core identity',
    callingConvention: { stub: 'lac f1; jda entry; lac f2' },
    calibration: { mpy_1x1: { f1: '000001', f2: '000001', ac: '000000', io: '000001' } },
    toolVersions: { simh_pdp1: 'Open SIMH V4.1-0', node: process.version },
    mpyCaseCount: 9,
    impCaseCount: 9,
  });
  assert.deepEqual(manifest.routines, ['mpy', 'imp']);
  assert.equal(manifest.entry_pc_octal.mpy, '0171');
  assert.equal(manifest.entry_pc_octal.imp, '0156');
  assert.equal(manifest.rim_sha256, 'abc123');
  assert.equal(manifest.mpy_case_count, 9);
  assert.equal(manifest.imp_case_count, 9);
  assert.ok(manifest.domain.strength.includes('branch-complete'), 'strength recorded');
  assert.ok(manifest.domain.confluence_witnesses.length >= 1, 'witnesses present');
  assert.doesNotThrow(() => gateMpyManifestComplete(manifest));
});

// ── gate: boundary complete ───────────────────────────────────────────────────

function syntheticMpyRecords() {
  // Synthetic records matching BOUNDARY_CASES with plausible results (no live Substrate).
  return BOUNDARY_CASES.map(({ f1, f2 }) => {
    const f1Neg = (f1 & SIGN_BIT) !== 0;
    const f2Neg = (f2 & SIGN_BIT) !== 0;
    const sameSign = f1Neg === f2Neg;
    const isZero = f1 === 0 || f2 === 0;
    const ac = isZero ? 0 : sameSign ? 0 : SIGN_BIT; // positive=0, negative=SIGN_BIT
    const io = isZero ? 0 : sameSign ? 1 : (SIGN_BIT | 0o377776);
    return { f1, f2, ac, io, pc: HALT_PC };
  });
}

function syntheticImpRecords() {
  return BOUNDARY_CASES.map(({ f1, f2 }) => {
    const f1Neg = (f1 & SIGN_BIT) !== 0;
    const f2Neg = (f2 & SIGN_BIT) !== 0;
    const sameSign = f1Neg === f2Neg;
    const isZero = f1 === 0 || f2 === 0;
    const ac = isZero ? 0 : sameSign ? 1 : (SIGN_BIT | 0o377776);
    return { f1, f2, ac, pc: HALT_PC };
  });
}

test('gateMpyBoundaryComplete: passes when all boundary cases are present', () => {
  assert.doesNotThrow(() => gateMpyBoundaryComplete(syntheticMpyRecords()));
});

test('gateMpyBoundaryComplete: fails with witness when a boundary case is missing', () => {
  const records = syntheticMpyRecords().filter((r) => !(r.f1 === 0 && r.f2 === 0));
  assert.throws(() => gateMpyBoundaryComplete(records), /boundary complete.*f1=000000.*f2=000000/);
});

// ── gate: halt-PC ────────────────────────────────────────────────────────────

test('gateMpyHaltPc: passes when all records have the correct halt-PC', () => {
  assert.doesNotThrow(() => gateMpyHaltPc(syntheticMpyRecords()));
});

test('gateMpyHaltPc: fails with witness when a case has the wrong PC', () => {
  const records = syntheticMpyRecords();
  records[1].pc = 0o1234;
  assert.throws(() => gateMpyHaltPc(records), /halt-PC.*expected.*got 1234/);
});

// ── gate: branch coverage ────────────────────────────────────────────────────

test('gateMpyBranchCoverage: passes for the full boundary case set', () => {
  assert.doesNotThrow(() => gateMpyBranchCoverage(syntheticMpyRecords()));
});

test('gateMpyBranchCoverage: fails when no f1-negative case is present', () => {
  const records = syntheticMpyRecords().filter((r) => (r.f1 & SIGN_BIT) === 0);
  assert.throws(() => gateMpyBranchCoverage(records), /L276 spa.*f1 negative/);
});

test('gateMpyBranchCoverage: fails when no diff-sign case is present', () => {
  // Keep only same-sign cases
  const records = syntheticMpyRecords().filter((r) => {
    const f1Neg = (r.f1 & SIGN_BIT) !== 0;
    const f2Neg = (r.f2 & SIGN_BIT) !== 0;
    return f1Neg === f2Neg;
  });
  assert.throws(() => gateMpyBranchCoverage(records), /L289 sma.*diff-sign case/);
});

// ── gate: sign correctness ────────────────────────────────────────────────────

test('gateMpySignCorrectness: passes for correctly-signed synthetic records', () => {
  assert.doesNotThrow(() => gateMpySignCorrectness(syntheticMpyRecords()));
});

test('gateMpySignCorrectness: fails when same-sign result has negative AC', () => {
  const records = syntheticMpyRecords();
  const ppCase = records.find((r) => r.f1 === 1 && r.f2 === 1);
  ppCase.ac = SIGN_BIT; // corrupt: positive product should not have sign bit
  assert.throws(() => gateMpySignCorrectness(records), /sign correctness.*same-sign.*negative sign bit/);
});

test('gateMpySignCorrectness: fails when diff-sign result has non-negative AC', () => {
  const records = syntheticMpyRecords();
  const pmCase = records.find((r) => r.f1 === 1 && r.f2 === NEG_ONE);
  pmCase.ac = 0; // corrupt: negative product should have sign bit set
  assert.throws(() => gateMpySignCorrectness(records), /sign correctness.*diff-sign.*non-negative sign bit/);
});

// ── gate: zero product ────────────────────────────────────────────────────────

test('gateMpyZero: passes when 0×0 yields AC=0, IO=0', () => {
  assert.doesNotThrow(() => gateMpyZero(syntheticMpyRecords()));
});

test('gateMpyZero: fails when 0×0 AC is not zero', () => {
  const records = syntheticMpyRecords();
  records.find((r) => r.f1 === 0 && r.f2 === 0).ac = 1;
  assert.throws(() => gateMpyZero(records), /zero.*expected AC=000000/);
});

test('gateMpyZero: fails when 0×0 IO is not zero', () => {
  const records = syntheticMpyRecords();
  records.find((r) => r.f1 === 0 && r.f2 === 0).io = 1;
  assert.throws(() => gateMpyZero(records), /zero.*expected IO=000000/);
});

// ── gate: manifest complete ───────────────────────────────────────────────────

function goodMpyManifest() {
  return buildMpyManifest({
    rimSha256: 'deadbeef',
    listingCoreStatus: 'verified',
    callingConvention: { stub: 'lac f1; jda entry; lac f2' },
    calibration: { mpy_1x1: { f1: '000001', f2: '000001', ac: '000000', io: '000001' } },
    toolVersions: { simh_pdp1: 'v4', node: 'v20' },
    mpyCaseCount: 9,
    impCaseCount: 9,
  });
}

test('gateMpyManifestComplete: passes for a complete manifest', () => {
  assert.doesNotThrow(() => gateMpyManifestComplete(goodMpyManifest()));
});

test('gateMpyManifestComplete: fails when a required field is missing', () => {
  const m = goodMpyManifest();
  delete m.rim_sha256;
  assert.throws(() => gateMpyManifestComplete(m), /manifest.*rim_sha256/);
});

test('gateMpyManifestComplete: fails when domain has no confluence witnesses', () => {
  const m = goodMpyManifest();
  m.domain.confluence_witnesses = [];
  assert.throws(() => gateMpyManifestComplete(m), /confluence_witnesses/);
});

// ── gate: imp ────────────────────────────────────────────────────────────────

test('gateImpBoundaryComplete: passes for the full boundary case set', () => {
  assert.doesNotThrow(() => gateImpBoundaryComplete(syntheticImpRecords()));
});

test('gateImpHaltPc: fails with witness when a case has the wrong PC', () => {
  const records = syntheticImpRecords();
  records[2].pc = 0o5555;
  assert.throws(() => gateImpHaltPc(records), /halt-PC.*expected.*got 5555/);
});

test('gateImpSignCorrectness: passes for correctly-signed synthetic records', () => {
  assert.doesNotThrow(() => gateImpSignCorrectness(syntheticImpRecords()));
});

test('gateImpZero: passes when 0×0 yields AC=0', () => {
  assert.doesNotThrow(() => gateImpZero(syntheticImpRecords()));
});

test('gateImpZero: fails when 0×0 AC is not zero', () => {
  const records = syntheticImpRecords();
  records.find((r) => r.f1 === 0 && r.f2 === 0).ac = 1;
  assert.throws(() => gateImpZero(records), /zero.*expected AC=000000/);
});

// ── integration: live mpy/imp capture, gate, and write ───────────────────────

test(
  'mpy boundary cases captured, gated, and written (live oracle)',
  { timeout: 120_000 },
  async () => {
    const records = await runMpyBatch(RIM_PATH, BOUNDARY_CASES, { timeout: 60_000 });
    assert.equal(records.length, BOUNDARY_CASES.length, 'all boundary cases captured');

    // Calibration anchor: 1 × 1 (both positive) → positive result.
    // Sign correctness: same-sign ++ → AC sign bit = 0 (non-negative).
    // Exact magnitude is observed, not derived (ADR-0008).
    const oneXone = records.find((r) => r.f1 === 1 && r.f2 === 1);
    assert.ok(oneXone, '1×1 case present');
    assert.equal(oneXone.ac & SIGN_BIT, 0, '1×1: AC non-negative (same-sign product)');
    assert.equal(oneXone.io & SIGN_BIT, 0, '1×1: IO non-negative (same-sign product)');

    // Build manifest from the live evidence.
    const provenance = JSON.parse(await readFile(join(HERE, 'provenance.json'), 'utf8'));
    const manifest = buildMpyManifest({
      rimSha256: await sha256File(RIM_PATH),
      listingCoreStatus: provenance.listing_core_status,
      callingConvention: {
        stub: 'lac INCELL1; jda entry; lac INCELL2 (xct\'d by routine for second factor)',
        mpy_returns: '34-bit product: AC = high word (sign + high-17), IO = low word (sign + low-17)',
        imp_returns: 'low-17 bits + sign in AC (single-precision derivative via mpy)',
        source: 'spacewar3.1_complete.txt L257-258',
      },
      calibration: {
        mpy_1x1: {
          f1: '000001',
          f2: '000001',
          ac: oneXone.ac.toString(8).padStart(6, '0'),
          io: oneXone.io.toString(8).padStart(6, '0'),
          pc: oneXone.pc.toString(8).padStart(6, '0'),
          note: '1×1: both factors positive; observed AC and IO are the raw machine words',
        },
      },
      toolVersions: {
        simh_pdp1: await pdp1Version(),
        macro1: 'macro1.c — canonical PDP-1 Macro assembler (tools/macro1)',
        node: process.version,
      },
      mpyCaseCount: records.length,
      impCaseCount: BOUNDARY_CASES.length,
    });

    // Full gate.
    gateMpy(records, manifest);

    // Write vector set + manifest.
    await writeFile(join(HERE, 'mpy-vectors.jsonl'), serializeMpyVectors(records));
    await writeFile(join(HERE, 'mpy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
);

test(
  'imp boundary cases captured, gated, and appended to manifest (live oracle)',
  { timeout: 120_000 },
  async () => {
    const records = await runImpBatch(RIM_PATH, BOUNDARY_CASES, { timeout: 60_000 });
    assert.equal(records.length, BOUNDARY_CASES.length, 'all boundary cases captured');

    // Calibration anchor: imp(1, 1) = 1 (low 17 bits of +1 product, positive).
    const oneXone = records.find((r) => r.f1 === 1 && r.f2 === 1);
    assert.ok(oneXone, '1×1 case present');
    assert.equal(oneXone.ac & SIGN_BIT, 0, 'imp(1,1): AC non-negative (positive product)');

    // Read the mpy manifest to fold imp counts in.
    const manifest = JSON.parse(
      await readFile(join(HERE, 'mpy-manifest.json'), 'utf8')
    );
    manifest.imp_case_count = records.length;
    manifest.calibration.imp_1x1 = {
      f1: '000001',
      f2: '000001',
      ac: oneXone.ac.toString(8).padStart(6, '0'),
      pc: oneXone.pc.toString(8).padStart(6, '0'),
      note: 'imp(1,1) = low-17 bits of +1 product; sign non-negative',
    };

    gateImp(records, manifest);

    await writeFile(join(HERE, 'imp-vectors.jsonl'), serializeImpVectors(records));
    await writeFile(join(HERE, 'mpy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
);
