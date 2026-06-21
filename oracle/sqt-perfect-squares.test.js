/**
 * Issue 3: Capture every in-range perfect square and verify each returns its exact root.
 *
 * Test structure:
 *   1. substrate unit tests (no live pdp1 — uses recorded fixture)
 *   2. gate unit tests (synthetic record sets — no live pdp1)
 *   3. integration: live oracle runs all 256 cases and gates each result
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBatchScript,
  parseBatchOutput,
  perfectSquareInputs,
  runBatch,
  STUB_START, LAC_INCELL, JDA_SQT, HLT, INCELL, HALT_PC, ROOT_SCALE,
} from './substrate.js';
import { gatePerfectSquares } from './gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── perfectSquareInputs ───────────────────────────────────────────────────────

test('perfectSquareInputs enumerates n=0..255 (256 cases)', () => {
  const cases = perfectSquareInputs();
  assert.equal(cases.length, 256, '256 perfect squares in range');
  assert.deepEqual(cases[0],   { n: 0,   nsq: 0   });
  assert.deepEqual(cases[1],   { n: 1,   nsq: 1   });
  assert.deepEqual(cases[2],   { n: 2,   nsq: 4   });
  assert.deepEqual(cases[255], { n: 255, nsq: 65025 });
  assert.ok(cases[255].nsq <= 0o177777, 'max n² within 0177777');
  assert.ok(256 * 256 > 0o177777,       'n=256 excluded');
});

// ── substrate: buildBatchScript ───────────────────────────────────────────────

test('buildBatchScript: starts with load, deposits stub once, then per-case blocks', () => {
  const cases = [{ n: 1, nsq: 1 }, { n: 2, nsq: 4 }];
  const script = buildBatchScript('/tmp/test.rim', cases);

  assert.equal(script[0], 'load /tmp/test.rim');
  assert.equal(script[1], `deposit ${STUB_START.toString(8)} ${LAC_INCELL.toString(8)}`);
  assert.equal(script[2], `deposit ${(STUB_START + 1).toString(8)} ${JDA_SQT.toString(8)}`);
  assert.equal(script[3], `deposit ${(STUB_START + 2).toString(8)} ${HLT.toString(8)}`);

  // case 0: n²=1
  assert.equal(script[4], `deposit ${INCELL.toString(8)} 1`);
  assert.equal(script[5], `run ${STUB_START.toString(8)}`);
  assert.equal(script[6], 'examine ac');
  assert.equal(script[7], 'examine pc');

  // case 1: n²=4
  assert.equal(script[8], `deposit ${INCELL.toString(8)} 4`);
  assert.equal(script[9], `run ${STUB_START.toString(8)}`);
  assert.equal(script[10], 'examine ac');
  assert.equal(script[11], 'examine pc');

  assert.equal(script[script.length - 1], 'quit');
  // total: 4 header + 4*numCases + 1 quit
  assert.equal(script.length, 4 + 4 * cases.length + 1);
});

// ── substrate: parseBatchOutput ───────────────────────────────────────────────

test('parseBatchOutput: extracts AC/PC pairs from recorded fixture', async () => {
  const fixture = await readFile(join(HERE, 'fixtures/sqt-batch-3cases.txt'), 'utf8');
  const records = parseBatchOutput(fixture.split('\n'), 3);

  assert.equal(records.length, 3);
  // n=1, n²=1 → AC = 1×512 = 0o1000
  assert.equal(records[0].ac, 0o1000, 'n=1 AC');
  assert.equal(records[0].pc, HALT_PC,   'n=1 PC');
  // n=2, n²=4 → AC = 2×512 = 0o2000
  assert.equal(records[1].ac, 0o2000, 'n=2 AC');
  assert.equal(records[1].pc, HALT_PC,   'n=2 PC');
  // n=3, n²=9 → AC = 3×512 = 0o3000
  assert.equal(records[2].ac, 0o3000, 'n=3 AC');
  assert.equal(records[2].pc, HALT_PC,   'n=3 PC');
});

test('parseBatchOutput: handles leading zeros (AC=0 for n=0)', () => {
  const lines = ['AC:\t000000', 'PC:\t007704'];
  const [r] = parseBatchOutput(lines, 1);
  assert.equal(r.ac, 0);
  assert.equal(r.pc, 0o7704);
});

test('parseBatchOutput: throws if AC/PC pair is incomplete', () => {
  const lines = ['AC:\t001000']; // missing PC
  assert.throws(() => parseBatchOutput(lines, 1), /Missing PC at case 0/);
});

// ── gate ──────────────────────────────────────────────────────────────────────

test('gate: passes when all records have exact roots', () => {
  const records = perfectSquareInputs().map(({ n, nsq }) => ({
    n, nsq, ac: n * ROOT_SCALE, pc: HALT_PC,
  }));
  assert.doesNotThrow(() => gatePerfectSquares(records));
});

test('gate: fails with witnessing case when one root is wrong', () => {
  const records = perfectSquareInputs().map(({ n, nsq }) => ({
    n, nsq, ac: n * ROOT_SCALE, pc: HALT_PC,
  }));
  records[5].ac += 1; // corrupt n=5
  assert.throws(() => gatePerfectSquares(records), /gate FAIL.*n=5/);
});

test('gate: fails with witnessing case when halt-PC is wrong', () => {
  const records = perfectSquareInputs().map(({ n, nsq }) => ({
    n, nsq, ac: n * ROOT_SCALE, pc: HALT_PC,
  }));
  records[3].pc = 0o7703; // wrong PC for n=3
  assert.throws(() => gatePerfectSquares(records), /gate FAIL.*n=3/);
});

test('gate: correct synthetic set for n=0 (AC=0)', () => {
  const records = [{ n: 0, nsq: 0, ac: 0, pc: HALT_PC }];
  assert.doesNotThrow(() => gatePerfectSquares(records));
});

// ── integration: live oracle over all in-range perfect squares ────────────────

test('all in-range perfect squares yield exact root (live oracle)', { timeout: 120_000 }, async () => {
  const cases = perfectSquareInputs();
  const records = await runBatch(RIM_PATH, cases);

  assert.equal(records.length, 256, '256 cases captured');

  // gate: throws with witnessing case if any root is wrong
  gatePerfectSquares(records);

  // spot-check anchored on Slice 1 calibration: n=2 (n²=4) → AC=002000
  const slice1 = records.find(r => r.n === 2);
  assert.equal(slice1.ac, 0o2000, 'Slice 1 calibration anchor: n=2 AC=002000');

  // write captured set to JSONL
  await mkdir(HERE, { recursive: true });
  const jsonl = records
    .map(r => JSON.stringify({
      n:   r.n,
      nsq: r.nsq.toString(8).padStart(6, '0'),
      ac:  r.ac.toString(8).padStart(6, '0'),
      pc:  r.pc.toString(8).padStart(6, '0'),
    }))
    .join('\n') + '\n';
  await writeFile(join(HERE, 'sqt-perfect-squares.jsonl'), jsonl);
});
