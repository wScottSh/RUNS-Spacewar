/**
 * Issue 9: T-DVD — branch-complete + boundary-sample Vectors for idv/dvd divide.
 *
 * idv/dvd is the BBN Divide subroutine (source lines 346–397).
 * Entry signatures (L348 comment):
 *   idv: lac dividend, jda idv, lac divisor  → quotient in AC, remainder in IO
 *   dvd: lac hi-div, lio lo-div, jda dvd, lac divisor → same outputs
 *
 * Branch obligations (acceptance criteria §2):
 *   L362 0o320  spa  — skip if divisor ≥ 0             (covered: idv pos/neg divisor)
 *   L366 0o324  sma  — skip if hi-dividend < 0         (covered: dvd neg hi-div)
 *   L375 0o335  sma→dve — overflow / ÷0 test           (covered: both entries)
 *   L383 0o366  spi  — quotient-sign skip in normal path (covered: dvd neg hi-div)
 *   L393 0o400  spi  — IO-sign skip in dve overflow path (covered: dvd overflow cases)
 *
 * Test structure:
 *   1. Unit tests for stub encoding (no Substrate).
 *   2. Unit tests for gate logic over synthetic records.
 *   3. Integration: live Substrate capture, gate, vector + manifest write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDV_ADDR, DVD_ADDR,
  IDIV_CELL, IDSOR_CELL,
  IDV_HALT_NORMAL, IDV_HALT_OVERFLOW,
  HDIV_CELL, LDIV_CELL, DSOR_CELL,
  DVD_HALT_NORMAL, DVD_HALT_OVERFLOW,
  WORD_MASK,
  buildIdvScript, buildDvdScript, parseBatch,
  runIdvBatch, runDvdBatch,
} from './dvd-substrate.js';
import {
  gateIdvBranchComplete, gateDvdBranchComplete,
  gateBoundaryPresent, gateDvdManifestComplete,
} from './dvd-gate.js';
import { pdp1Version } from './simh.js';
import { sha256File } from './vectors.js';

const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(HERE, '..');
const RIM   = join(ROOT, 'build/spacewar31.rim');

// ── helpers ────────────────────────────────────────────────────────────────

const oct6 = (v) => (v & WORD_MASK).toString(8).padStart(6, '0');

// Ones-complement negation: -N = WORD_MASK ^ N.
const neg1c = (n) => WORD_MASK ^ n;

// ── unit: stub encoding ────────────────────────────────────────────────────

test('idv stub: instruction encodings are correct 18-bit words', () => {
  // jda = opcode 0o17 × 2^12 = 0o170000 | address
  assert.equal(0o170000 | IDV_ADDR, 0o170306, 'jda idv encoding');
  // lac = opcode 0o20 × 2^12 = 0o200000 | address
  assert.equal(0o200000 | IDIV_CELL,  0o207700, 'lac IDIV_CELL');
  assert.equal(0o200000 | IDSOR_CELL, 0o207701, 'lac IDSOR_CELL');
  // hlt = 0o760400
  assert.equal(0o760400, 0o760400, 'hlt encoding');
});

test('dvd stub: instruction encodings are correct 18-bit words', () => {
  assert.equal(0o170000 | DVD_ADDR, 0o170315, 'jda dvd encoding');
  assert.equal(0o200000 | HDIV_CELL, 0o207710, 'lac HDIV_CELL');
  // lio = opcode 0o22 × 2^12 = 0o220000 | address
  assert.equal(0o220000 | LDIV_CELL, 0o227711, 'lio LDIV_CELL');
  assert.equal(0o200000 | DSOR_CELL, 0o207712, 'lac DSOR_CELL');
});

test('buildIdvScript: produces correct deposit + run + examine pattern', () => {
  const script = buildIdvScript('/fake.rim', [{ dividend: 6, divisor: 2 }]);
  assert.ok(script[0].startsWith('load '), 'starts with load');
  // The 5 stub deposits come first.
  assert.equal(script[1], `deposit 7702 207700`, 'stub+0: lac IDIV_CELL');
  assert.equal(script[2], `deposit 7703 170306`, 'stub+1: jda idv');
  assert.equal(script[3], `deposit 7704 207701`, 'stub+2: lac IDSOR_CELL (divisor xct slot)');
  assert.equal(script[4], `deposit 7705 760400`, 'stub+3: hlt (overflow return)');
  assert.equal(script[5], `deposit 7706 760400`, 'stub+4: hlt (normal return)');
  // Per-case deposits for dividend=6, divisor=2.
  assert.equal(script[6], 'deposit 7700 6', 'deposit dividend');
  assert.equal(script[7], 'deposit 7701 2', 'deposit divisor');
  assert.equal(script[8], 'run 7702', 'run stub');
  assert.equal(script[9], 'examine ac');
  assert.equal(script[10], 'examine io');
  assert.equal(script[11], 'examine pc');
  assert.equal(script[12], 'quit');
});

test('buildDvdScript: produces correct deposit + run + examine pattern', () => {
  const script = buildDvdScript('/fake.rim', [{ hiDiv: 0, loDiv: 6, divisor: 2 }]);
  assert.ok(script[0].startsWith('load '), 'starts with load');
  assert.equal(script[1], `deposit 7713 207710`, 'stub+0: lac HDIV_CELL');
  assert.equal(script[2], `deposit 7714 227711`, 'stub+1: lio LDIV_CELL');
  assert.equal(script[3], `deposit 7715 170315`, 'stub+2: jda dvd');
  assert.equal(script[4], `deposit 7716 207712`, 'stub+3: lac DSOR_CELL (divisor xct slot)');
  assert.equal(script[5], `deposit 7717 760400`, 'stub+4: hlt (overflow return)');
  assert.equal(script[6], `deposit 7720 760400`, 'stub+5: hlt (normal return)');
  // Per-case: hiDiv=0, loDiv=6, divisor=2.
  assert.equal(script[7], 'deposit 7710 0');
  assert.equal(script[8], 'deposit 7711 6');
  assert.equal(script[9], 'deposit 7712 2');
  assert.equal(script[10], 'run 7713');
  assert.equal(script[11], 'examine ac');
  assert.equal(script[12], 'examine io');
  assert.equal(script[13], 'examine pc');
  assert.equal(script[14], 'quit');
});

test('parseBatch: extracts AC/IO/PC triples in order', () => {
  const output = [
    'AC:\t000003',
    'IO:\t000001',
    'PC:\t007707',
    'AC:\t000000',
    'IO:\t000000',
    'PC:\t007706',
  ].join('\n').split('\n');
  const records = parseBatch(output, 2);
  assert.deepEqual(records[0], { ac: 0o3, io: 0o1, pc: 0o7707 });
  assert.deepEqual(records[1], { ac: 0, io: 0, pc: 0o7706 });
});

test('parseBatch: throws with case index on missing IO', () => {
  const output = ['AC:\t000003', 'PC:\t007707'].join('\n').split('\n');
  assert.throws(() => parseBatch(output, 1), /missing IO at case 0/);
});

// ── unit: idv gate ─────────────────────────────────────────────────────────

function makeIdvRec(overrides) {
  return {
    dividend: 6,
    divisor: 2,
    ac: 3,
    io: 0,
    pc: IDV_HALT_NORMAL,
    ...overrides,
  };
}

test('gateIdvBranchComplete: passes for a minimal covering set', () => {
  const records = [
    makeIdvRec({ divisor: 2,         pc: IDV_HALT_NORMAL }),    // L362 spa taken
    makeIdvRec({ divisor: neg1c(2),  pc: IDV_HALT_NORMAL }),    // L362 spa not taken
    makeIdvRec({ divisor: 0,         pc: IDV_HALT_OVERFLOW }),   // L375 overflow
  ];
  assert.doesNotThrow(() => gateIdvBranchComplete(records));
});

test('gateIdvBranchComplete: fails when normal path missing', () => {
  const records = [makeIdvRec({ pc: IDV_HALT_OVERFLOW })];
  assert.throws(() => gateIdvBranchComplete(records), /L375.*normal-path/);
});

test('gateIdvBranchComplete: fails when overflow path missing', () => {
  const records = [
    makeIdvRec({ divisor: 2,        pc: IDV_HALT_NORMAL }),
    makeIdvRec({ divisor: neg1c(2), pc: IDV_HALT_NORMAL }),
  ];
  assert.throws(() => gateIdvBranchComplete(records), /L375.*overflow/);
});

test('gateIdvBranchComplete: fails when only positive divisors present', () => {
  const records = [
    makeIdvRec({ divisor: 2, pc: IDV_HALT_NORMAL }),
    makeIdvRec({ divisor: 0, pc: IDV_HALT_OVERFLOW }),
  ];
  assert.throws(() => gateIdvBranchComplete(records), /L362.*negative-divisor/);
});

// ── unit: dvd gate ─────────────────────────────────────────────────────────

function makeDvdRec(overrides) {
  return {
    hiDiv: 0,
    loDiv: 6,
    divisor: 2,
    ac: 3,
    io: 0,
    pc: DVD_HALT_NORMAL,
    ...overrides,
  };
}

test('gateDvdBranchComplete: passes for a minimal covering set', () => {
  const records = [
    makeDvdRec({ hiDiv: 0,         pc: DVD_HALT_NORMAL }),        // L366 sma not taken
    makeDvdRec({ hiDiv: neg1c(1),  pc: DVD_HALT_NORMAL }),        // L366 sma taken
    makeDvdRec({ hiDiv: 3, loDiv: 0,          pc: DVD_HALT_OVERFLOW }), // L375 overflow, L393 spi taken
    makeDvdRec({ hiDiv: 3, loDiv: neg1c(1),   pc: DVD_HALT_OVERFLOW }), // L393 spi not taken
  ];
  assert.doesNotThrow(() => gateDvdBranchComplete(records));
});

test('gateDvdBranchComplete: fails when L366 negative hi-div missing', () => {
  const records = [
    makeDvdRec({ hiDiv: 0,         pc: DVD_HALT_NORMAL }),
    makeDvdRec({ hiDiv: 3, loDiv: 0, pc: DVD_HALT_OVERFLOW }),
    makeDvdRec({ hiDiv: 3, loDiv: neg1c(1), pc: DVD_HALT_OVERFLOW }),
  ];
  assert.throws(() => gateDvdBranchComplete(records), /L366.*sma-taken/);
});

test('gateDvdBranchComplete: fails when dve path missing positive lo-div', () => {
  const records = [
    makeDvdRec({ hiDiv: 0, pc: DVD_HALT_NORMAL }),
    makeDvdRec({ hiDiv: neg1c(1), pc: DVD_HALT_NORMAL }),
    makeDvdRec({ hiDiv: 3, loDiv: neg1c(1), pc: DVD_HALT_OVERFLOW }),
  ];
  assert.throws(() => gateDvdBranchComplete(records), /L393.*positive lo-div/);
});

// ── unit: boundary gate ────────────────────────────────────────────────────

test('gateBoundaryPresent: passes for a complete boundary set', () => {
  const idvRecs = [
    makeIdvRec({ dividend: 0, divisor: 5, pc: IDV_HALT_NORMAL }),
    makeIdvRec({ dividend: 0, divisor: 0, pc: IDV_HALT_OVERFLOW }),
    makeIdvRec({ dividend: 0o177777, divisor: 1, pc: IDV_HALT_NORMAL }),
    makeIdvRec({ dividend: neg1c(6), divisor: 2, pc: IDV_HALT_NORMAL }),
    makeIdvRec({ divisor: 2, pc: IDV_HALT_NORMAL }),
    makeIdvRec({ divisor: neg1c(2), pc: IDV_HALT_NORMAL }),
    makeIdvRec({ divisor: 0, pc: IDV_HALT_OVERFLOW }),
  ];
  assert.doesNotThrow(() => gateBoundaryPresent(idvRecs, []));
});

test('gateBoundaryPresent: fails without zero dividend', () => {
  const idvRecs = [
    makeIdvRec({ divisor: 0, pc: IDV_HALT_OVERFLOW }),
    makeIdvRec({ dividend: 0o177777, divisor: 1 }),
    makeIdvRec({ dividend: neg1c(6), divisor: 2 }),
  ];
  assert.throws(() => gateBoundaryPresent(idvRecs, []), /zero-dividend/);
});

test('gateBoundaryPresent: fails without ÷0 case', () => {
  const idvRecs = [
    makeIdvRec({ dividend: 0, divisor: 1 }),
    makeIdvRec({ dividend: 0o177777, divisor: 1 }),
    makeIdvRec({ dividend: neg1c(6), divisor: 2 }),
  ];
  assert.throws(() => gateBoundaryPresent(idvRecs, []), /÷0/);
});

// ── unit: manifest gate ────────────────────────────────────────────────────

function goodManifest() {
  return {
    routine: 'idv/dvd',
    entries: ['idv', 'dvd'],
    rim_sha256: 'abc123',
    listing_core_status: 'verified',
    domain: {
      confluence_witnesses: ['source comment L346-397', 'game uses jda idv at L1157/1163'],
    },
    calling_convention: { jda_Y: 'M[Y]←AC; AC←PC; PC←Y+1' },
    strength: 'branch-complete + boundary sample (ADR-0004)',
    branch_coverage: { L362_spa: 'both', L366_sma: 'both', L375_sma: 'both' },
    tool_versions: { node: process.version },
  };
}

test('gateDvdManifestComplete: passes for a complete manifest', () => {
  assert.doesNotThrow(() => gateDvdManifestComplete(goodManifest()));
});

test('gateDvdManifestComplete: fails when rim_sha256 missing', () => {
  const m = goodManifest();
  delete m.rim_sha256;
  assert.throws(() => gateDvdManifestComplete(m), /rim_sha256/);
});

test('gateDvdManifestComplete: fails when confluence_witnesses absent', () => {
  const m = goodManifest();
  m.domain.confluence_witnesses = [];
  assert.throws(() => gateDvdManifestComplete(m), /confluence_witnesses/);
});

// ── integration: live Substrate capture, gate, write ──────────────────────

/**
 * Boundary-sample + branch-complete Vector set for idv.
 *
 * Each case is annotated with the branches it exercises (guide, not gate input):
 *   A: (6,   2)       — L362 spa taken (positive divisor); normal path
 *   B: (6, -2)        — L362 spa NOT taken (negative divisor, cma); normal path
 *   C: (1,   0)       — ÷0 → dve overflow; L375 sma NOT taken
 *   D: (0,   5)       — zero dividend; normal path
 *   E: (0o177777, 1)  — max positive ÷ 1; normal path (boundary max magnitude)
 *   F: (-6,  2)       — negative dividend (boundary sign combo); normal path
 *   G: (-6, -2)       — both negative (all sign combos); normal path
 */
const IDV_CASES = [
  { dividend: 6,        divisor: 2,        label: 'A: pos÷pos' },
  { dividend: 6,        divisor: neg1c(2), label: 'B: pos÷neg' },
  { dividend: 1,        divisor: 0,        label: 'C: ÷0 overflow' },
  { dividend: 0,        divisor: 5,        label: 'D: zero dividend' },
  { dividend: 0o177777, divisor: 1,        label: 'E: max positive' },
  { dividend: neg1c(6), divisor: 2,        label: 'F: neg dividend' },
  { dividend: neg1c(6), divisor: neg1c(2), label: 'G: both negative' },
];

/**
 * Boundary-sample + branch-complete Vector set for dvd.
 *
 *   H: (hi=0,    lo=6,     div=2)       — L366 sma NOT taken; normal; L383 spi taken
 *   I: (hi=-1,   lo=6,     div=2)       — L366 sma taken; normal; L383 spi NOT taken
 *   J: (hi=3,    lo=0,     div=1)       — overflow; L393 spi taken (lo=0 positive)
 *   K: (hi=3,    lo=-1,    div=1)       — overflow; L393 spi NOT taken (lo negative)
 */
const DVD_CASES = [
  { hiDiv: 0,        loDiv: 6,        divisor: 2, label: 'H: pos hi÷pos' },
  { hiDiv: neg1c(1), loDiv: 6,        divisor: 2, label: 'I: neg hi÷pos' },
  { hiDiv: 3,        loDiv: 0,        divisor: 1, label: 'J: overflow pos lo' },
  { hiDiv: 3,        loDiv: neg1c(1), divisor: 1, label: 'K: overflow neg lo' },
];

test(
  'idv: branch-complete + boundary-sample vectors captured and gated (live Substrate)',
  { timeout: 120_000 },
  async () => {
    const cases = IDV_CASES.map(({ dividend, divisor }) => ({ dividend, divisor }));
    const records = await runIdvBatch(RIM, cases);
    assert.equal(records.length, IDV_CASES.length, 'one record per case');

    // Branch coverage gate.
    gateIdvBranchComplete(records);

    // Spot-check: normal cases have normal halt-PC; overflow case has overflow halt-PC.
    for (const [i, { label }] of IDV_CASES.entries()) {
      const { pc } = records[i];
      if (label === 'C: ÷0 overflow') {
        assert.equal(
          pc, IDV_HALT_OVERFLOW,
          `case ${label}: expected overflow halt-PC ${oct6(IDV_HALT_OVERFLOW)} got ${oct6(pc)}`
        );
      } else {
        assert.equal(
          pc, IDV_HALT_NORMAL,
          `case ${label}: expected normal halt-PC ${oct6(IDV_HALT_NORMAL)} got ${oct6(pc)}`
        );
      }
    }

    // Write idv vector file.
    const idvVectors = records.map((r, i) => ({
      entry:    'idv',
      dividend: oct6(r.dividend),
      divisor:  oct6(r.divisor),
      ac:       oct6(r.ac),
      io:       oct6(r.io),
      pc:       oct6(r.pc),
    }));
    await writeFile(
      join(HERE, 'dvd-idv-vectors.jsonl'),
      idvVectors.map((v) => JSON.stringify(v)).join('\n') + '\n'
    );
  }
);

test(
  'dvd: branch-complete + boundary-sample vectors captured and gated (live Substrate)',
  { timeout: 120_000 },
  async () => {
    const cases = DVD_CASES.map(({ hiDiv, loDiv, divisor }) => ({ hiDiv, loDiv, divisor }));
    const records = await runDvdBatch(RIM, cases);
    assert.equal(records.length, DVD_CASES.length, 'one record per case');

    // Branch coverage gate.
    gateDvdBranchComplete(records);

    // Spot-check overflow cases (J, K).
    for (const [i, { label }] of DVD_CASES.entries()) {
      const { pc } = records[i];
      if (label.includes('overflow')) {
        assert.equal(
          pc, DVD_HALT_OVERFLOW,
          `case ${label}: expected overflow halt-PC ${oct6(DVD_HALT_OVERFLOW)} got ${oct6(pc)}`
        );
      } else {
        assert.equal(
          pc, DVD_HALT_NORMAL,
          `case ${label}: expected normal halt-PC ${oct6(DVD_HALT_NORMAL)} got ${oct6(pc)}`
        );
      }
    }

    // Write dvd vector file.
    const dvdVectors = records.map((r) => ({
      entry:  'dvd',
      hi_div: oct6(r.hiDiv),
      lo_div: oct6(r.loDiv),
      divisor: oct6(r.divisor),
      ac:      oct6(r.ac),
      io:      oct6(r.io),
      pc:      oct6(r.pc),
    }));
    await writeFile(
      join(HERE, 'dvd-dvd-vectors.jsonl'),
      dvdVectors.map((v) => JSON.stringify(v)).join('\n') + '\n'
    );
  }
);

test(
  'boundary gate passes over combined idv+dvd set (live)',
  { timeout: 30_000 },
  async () => {
    const idvRecs = await runIdvBatch(RIM, IDV_CASES.map(({ dividend, divisor }) => ({ dividend, divisor })));
    const dvdRecs = await runDvdBatch(RIM, DVD_CASES.map(({ hiDiv, loDiv, divisor }) => ({ hiDiv, loDiv, divisor })));
    gateBoundaryPresent(idvRecs, dvdRecs);
  }
);

test(
  'provenance manifest written for idv/dvd Vector set',
  { timeout: 60_000 },
  async () => {
    const prov = JSON.parse(await readFile(join(HERE, 'provenance.json'), 'utf8'));
    const rimSha256 = await sha256File(RIM);
    const simhVer   = await pdp1Version();

    const manifest = {
      routine: 'idv/dvd',
      entries: ['idv', 'dvd'],
      entry_pcs_octal: { idv: IDV_ADDR.toString(8).padStart(4, '0'), dvd: DVD_ADDR.toString(8).padStart(4, '0') },
      rim_sha256: rimSha256,
      listing_core_status: prov.listing_core_status,
      domain: {
        description: 'branch-complete + boundary sample; binary space ~2^36 (36-bit dividend × 18-bit divisor) so exhaustive enumeration is out of contract (ADR-0004)',
        idv_cases: IDV_CASES.length,
        dvd_cases: DVD_CASES.length,
        confluence_witnesses: [
          'source comment L346-348: calling convention and return contract',
          'listing symbol table confirms idv=0306, dvd=0315, dv1=0317 (build/spacewar31.lst)',
          'game calls jda idv at L1157 (0o2416) and L1163 (0o2424) — gravity calc',
          'halt-PC distinguishes normal (2×idx dv1) from overflow (1×idx dv1)',
        ],
      },
      calling_convention: {
        source: 'revealed by source comment L348 and tracing jda+dap+xct through SIMH',
        jda_Y: 'M[Y] ← AC (hi-dividend / dividend); AC ← return-PC; PC ← Y+1',
        idv_entry: 'dividend in AC; jda idv; lac divisor (at return address, xct\'d by dv1)',
        dvd_entry: 'lac hi-dividend; lio lo-dividend; jda dvd; lac divisor',
        returns: 'quotient in AC, remainder in IO',
        dv1_mechanism: 'dap dv1 patches the xct slot with return-PC; dv1 executes lac divisor to load divisor into AC; idx dv1 twice (normal) or once (overflow/dve) advances return target',
        overflow_path: 'dve fires when hi-div - |divisor| ≥ 0 (quotient would not fit 18 bits); also fires for ÷0; returns 0 in AC for ÷0 (game gravity ÷0 produces 0, per EPIC §Final Note)',
      },
      strength: 'branch-complete + boundary sample (ADR-0004)',
      branch_coverage: {
        L362_0o320_spa_divisor_sign: {
          taken:     'positive divisor — skip cma, |divisor|=divisor',
          not_taken: 'negative divisor — cma, |divisor|=~divisor',
          witness:   'idv cases A (div=2) and B (div=-2)',
        },
        L366_0o324_sma_hi_dividend_sign: {
          taken:     'hi-dividend negative — adjustment code (cma+rcr×4)',
          not_taken: 'hi-dividend ≥ 0 — jmp dv2 directly',
          witness:   'dvd cases H (hi=0) and I (hi=-1)',
        },
        L375_0o335_sma_overflow_test: {
          taken:     'dv2-adjusted - |divisor| < 0 — normal 22-step dis division',
          not_taken: 'dv2-adjusted - |divisor| ≥ 0 — jmp dve (overflow/÷0)',
          witness:   'idv case C (÷0→overflow), dvd cases J+K (hi≥divisor)',
        },
        L383_0o366_spi_quotient_sign: {
          taken:     'IO ≥ 0 at L383 — skip cma (positive quotient direction)',
          not_taken: 'IO < 0 at L383 — cma (negative quotient direction)',
          witness:   'dvd cases H (hi=0→IO=0 at L383) and I (hi=-1→IO negative at L383)',
        },
        L393_0o400_spi_at_dve: {
          taken:     'IO ≥ 0 at dve — positive lo-dividend',
          not_taken: 'IO < 0 at dve — negative lo-dividend',
          witness:   'dvd cases J (lo=0) and K (lo=-1)',
        },
      },
      idv_vector_file: 'dvd-idv-vectors.jsonl',
      dvd_vector_file: 'dvd-dvd-vectors.jsonl',
      idv_vector_count: IDV_CASES.length,
      dvd_vector_count: DVD_CASES.length,
      tool_versions: {
        simh_pdp1: simhVer,
        macro1: 'macro1.c — canonical PDP-1 Macro assembler (tools/macro1)',
        node: process.version,
      },
    };

    gateDvdManifestComplete(manifest);

    await writeFile(
      join(HERE, 'dvd-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );

    // Verify the file is readable and valid.
    const written = JSON.parse(await readFile(join(HERE, 'dvd-manifest.json'), 'utf8'));
    assert.equal(written.routine, 'idv/dvd');
    assert.equal(written.rim_sha256, rimSha256);
    assert.equal(written.strength, 'branch-complete + boundary sample (ADR-0004)');
    assert.ok(written.branch_coverage.L362_0o320_spa_divisor_sign);
    assert.ok(written.branch_coverage.L366_0o324_sma_hi_dividend_sign);
    assert.ok(written.branch_coverage.L375_0o335_sma_overflow_test);
    assert.ok(written.branch_coverage.L383_0o366_spi_quotient_sign);
    assert.ok(written.branch_coverage.L393_0o400_spi_at_dve);
  }
);
