/**
 * Issue 2: Capture and attest a single sqt square-root answer.
 *
 * Stub: lac incell; jda sqt; hlt
 *   incell  = 07700  (holds the input)
 *   stub+0  = 07701  lac 07700
 *   stub+1  = 07702  jda sqt   (sqt @ 0246)
 *   stub+2  = 07703  hlt
 *
 * Acceptance criteria tested here:
 *   - real jda call: stub deposited, run from stub+0
 *   - AC at halt = machine sqrt answer
 *   - halt-PC = 07704 (= stub+3, one past hlt, per SIMH fetch-then-execute)
 *   - 3-way confluence: machine AC == hand-computed == masswerk-format
 *   - attested record written to oracle/sqt-calibration.jsonl
 *   - provenance manifest written to oracle/provenance.json
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ── constants ────────────────────────────────────────────────────────────────

const SQT_ADDR   = 0o0246;   // sqt entry point from listing
const INCELL     = 0o7700;   // free memory cell for the input
const STUB_START = 0o7701;   // address of lac incell
const HLT_ADDR   = 0o7703;   // address of hlt (stub+2)

// Instruction encodings (PDP-1, big-endian 18-bit words in octal)
const LAC_INCELL = 0o207700; // lac 07700
const JDA_SQT    = 0o170246; // jda sqt
const HLT        = 0o760400; // hlt

// Test vector: input = 4 (perfect square, √4 = 2)
const INPUT_OCTAL = 4;       // 04 octal = 4 decimal
// Expected AC in 9.9 fixed-point (binary point between bits 8 and 9):
//   √4 = 2 → 2 × 2^9 = 1024 = 02000 octal
const EXPECTED_AC = 0o2000;
// Expected halt-PC: stub+3 (SIMH increments PC in fetch, so PC is past hlt)
const EXPECTED_PC = 0o7704;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Run one sqt calibration via SIMH.
 * Returns { ac, pc, sqtCell } as integer values.
 */
async function runSqtCalibration(inputOctal) {
  const { runPdp1, parseExamine } = await import('./simh.js');
  const rimPath = join(ROOT, 'build/spacewar31.rim');
  const script = [
    `load ${rimPath}`,
    `deposit ${INCELL.toString(8)} ${inputOctal}`,
    `deposit ${STUB_START.toString(8)} ${LAC_INCELL.toString(8)}`,
    `deposit ${(STUB_START+1).toString(8)} ${JDA_SQT.toString(8)}`,
    `deposit ${(STUB_START+2).toString(8)} ${HLT.toString(8)}`,
    `run ${STUB_START.toString(8)}`,
    'examine ac',
    'examine pc',
    `examine ${SQT_ADDR.toString(8)}`,
    'quit',
  ];
  const { lines } = await runPdp1(script);
  const regs = parseExamine(lines);
  return {
    ac: parseInt(regs['AC'] ?? '0', 8),
    pc: parseInt(regs['PC'] ?? '0', 8),
    sqtCell: parseInt(regs[SQT_ADDR.toString(8).toUpperCase()] ?? (regs['246'] ?? '0'), 8),
  };
}

/**
 * Hand-compute the expected sqt output for a perfect-square input.
 * Format: 9.9 fixed-point → floor(sqrt(input)) * 512
 */
function handComputeSqt(input) {
  return Math.floor(Math.sqrt(input)) * 512;  // 512 = 2^9
}

// ── tests ────────────────────────────────────────────────────────────────────

test('sqt stub deposits & instructions are correct 18-bit words', () => {
  assert.equal(LAC_INCELL, 0o207700, 'lac encoding');
  assert.equal(JDA_SQT,    0o170246, 'jda sqt encoding');
  assert.equal(HLT,        0o760400, 'hlt encoding');
  assert.equal(SQT_ADDR,   0o246,    'sqt entry point');
});

test('jda calling convention revealed: jda Y stores AC at M[Y], puts return-PC in AC', async () => {
  // The SIMH pdp1_cpu.c source states:
  //   MB = AC; AC = EPC_WORD; PC = INCR_ADDR(MA); Write(); (mem[MA] = MB)
  // We verify this by inspecting M[sqt] after the call (should be 0 — cleared by dzm sqt)
  // and confirming AC holds the result (not the input).
  const { ac, sqtCell } = await runSqtCalibration(INPUT_OCTAL);
  assert.equal(sqtCell, 0, 'sqt cell cleared by dzm sqt inside routine');
  assert.notEqual(ac, INPUT_OCTAL, 'AC is result, not the raw input (jda deposited input at M[sqt])');
});

test('machine AC matches expected 9.9 fixed-point sqrt for input 4', async () => {
  const { ac } = await runSqtCalibration(INPUT_OCTAL);
  assert.equal(ac, EXPECTED_AC, `AC should be ${EXPECTED_AC} (octal ${EXPECTED_AC.toString(8)})`);
});

test('halt-PC is one past hlt instruction (stub+3)', async () => {
  const { pc } = await runSqtCalibration(INPUT_OCTAL);
  assert.equal(pc, EXPECTED_PC, `PC should be ${EXPECTED_PC.toString(8)} octal (past hlt at ${HLT_ADDR.toString(8)})`);
});

test('3-way confluence: machine AC == hand-computed sqrt == masswerk fixed-point format', async () => {
  const { ac: machineAc } = await runSqtCalibration(INPUT_OCTAL);

  // 1. Machine result
  assert.equal(machineAc, EXPECTED_AC, 'machine AC');

  // 2. Hand-computed: floor(sqrt(4)) * 2^9 = 2 * 512 = 1024 = 02000 octal
  const handComputed = handComputeSqt(INPUT_OCTAL);
  assert.equal(handComputed, EXPECTED_AC, 'hand-computed value matches expected');
  assert.equal(machineAc, handComputed, 'machine AC == hand-computed');

  // 3. Masswerk cross-check: Translator says "answer in ac with binary point
  //    between bits 8 and 9" — integer 2 with no fractional part → 002000 octal.
  //    We verify the upper 9 bits (integer part) equal floor(sqrt(input)).
  const integerPart = machineAc >> 9;
  const fractionalPart = machineAc & 0o777;
  assert.equal(integerPart, 2, 'integer part of result');
  assert.equal(fractionalPart, 0, 'no fractional part for a perfect square');
});

test('attested record written to oracle/sqt-calibration.jsonl', async () => {
  const path = join(HERE, 'sqt-calibration.jsonl');
  const content = await readFile(path, 'utf8');
  const record = JSON.parse(content.trim().split('\n')[0]);
  assert.equal(record.in,  '000004', 'input in octal');
  assert.equal(record.ac,  '002000', 'AC in octal');
  assert.ok(record.pc, 'PC present');
  assert.equal(record.routine, 'sqt', 'routine name');
});

test('provenance manifest written to oracle/provenance.json', async () => {
  const path = join(HERE, 'provenance.json');
  const prov = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(prov.routine, 'sqt', 'routine');
  assert.equal(prov.entry_pc_octal, '0246', 'entry PC');
  assert.ok(prov.rim_sha256, 'rim hash present');
  assert.ok(prov.calling_convention, 'calling convention documented');
  assert.ok(prov.calibration, 'calibration result present');
});
