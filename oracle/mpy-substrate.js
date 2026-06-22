/**
 * Batch script builder, output parser, and serialization helpers for mpy/imp Oracle runs.
 * Drives the SIMH pdp1 simulator over the branch-complete + boundary-sample case set.
 *
 * Calling convention (source L257-258):
 *   "Call_. lac one factor, jda mpy or imp, lac other factor."
 *
 * Stub layout (4 words at STUB_START):
 *   STUB_START+0: lac INCELL1   — first factor loaded into AC
 *   STUB_START+1: jda mpy/imp  — M[entry]=f1, AC=return_PC(=STUB_START+2), PC=entry+1
 *   STUB_START+2: lac INCELL2  — "other factor" instruction; xct mp1 / xct im1 executes this
 *   STUB_START+3: hlt          — control returns here after idx mp1 + jmp i mp1
 *
 * mpy (L273): returns 34-bit double-length product — AC = high word (sign+17 bits), IO = low word.
 * imp (L260): returns "low 17 bits and sign in AC" — single-precision derivative of mpy.
 */
import { runPdp1 } from './simh.js';

// Entry addresses from listing symbol table (tools/build/spacewar31.lst)
export const MPY_ADDR    = 0o0171;   // mpy entry point
export const IMP_ADDR    = 0o0156;   // imp entry point

// Free-cell + stub addresses (chosen above the game image, no conflict with sqt's 07701 stub)
export const INCELL1     = 0o7676;   // holds first factor f1
export const INCELL2     = 0o7677;   // holds second factor f2
export const STUB_START  = 0o7700;   // 4-word stub: lac f1; jda entry; lac f2; hlt

// Instruction encodings for the stub
export const LAC_INCELL1 = 0o207676; // lac 07676
export const LAC_INCELL2 = 0o207677; // lac 07677
export const JDA_MPY     = 0o170171; // jda mpy  (mpy @ 0171)
export const JDA_IMP     = 0o170156; // jda imp  (imp @ 0156)
export const HLT         = 0o760400; // hlt

// hlt is at STUB_START+3 = 07703; SIMH increments PC in fetch, so PC = 07704 after halt.
export const HALT_PC     = STUB_START + 4; // 0o7704

// PDP-1 18-bit ones'-complement sign bit, SIMH JS representation: bit 17 = weight 2^17.
export const SIGN_BIT    = 0o400000; // (1 << 17); set means negative

// Boundary constants
export const MAX_MAG_POS = 0o177777; // max positive 17-bit magnitude in ones' complement
export const MAX_MAG_NEG = 0o600000; // ones' complement of MAX_MAG_POS = max negative
export const NEG_ONE     = 0o777776; // ones' complement of +1

/**
 * Nine boundary cases that together witness all three sign-handling branches both ways:
 *   L276 spa (f1 sign): ++ / +- cases have f1 positive; -+ / -- cases have f1 negative.
 *   L281 spa (f2 sign): ++ / -+ cases have f2 positive; +- / -- cases have f2 negative.
 *   L289 sma (result sign): same-sign (++/--) → positive; different-sign (+-/-+) → negative.
 */
export const BOUNDARY_CASES = [
  { f1: 0,           f2: 0           }, // 0 × 0 (zero boundary)
  { f1: 1,           f2: 1           }, // 1 × 1   (++ small)
  { f1: 1,           f2: NEG_ONE     }, // 1 × -1  (+- small)
  { f1: NEG_ONE,     f2: 1           }, // -1 × 1  (-+ small)
  { f1: NEG_ONE,     f2: NEG_ONE     }, // -1 × -1 (-- small)
  { f1: MAX_MAG_POS, f2: MAX_MAG_POS }, // max_pos × max_pos (++ max)
  { f1: MAX_MAG_POS, f2: MAX_MAG_NEG }, // max_pos × max_neg (+- max)
  { f1: MAX_MAG_NEG, f2: MAX_MAG_POS }, // max_neg × max_pos (-+ max)
  { f1: MAX_MAG_NEG, f2: MAX_MAG_NEG }, // max_neg × max_neg (-- max)
];

const oct = (v) => v.toString(8).padStart(6, '0');

// ── batch script builders ─────────────────────────────────────────────────────

/**
 * Build a SIMH batch script that runs the routine entered via `jda` for each
 * {f1, f2} case in one process. The 4-word stub is deposited once; each case
 * deposits both factors, runs, and examines the result registers. mpy needs
 * AC, IO, and PC; imp needs only AC and PC (`examineIo` selects between them).
 */
function buildBatchScript(rimPath, cases, { jda, examineIo }) {
  const lines = [
    `load ${rimPath}`,
    `deposit ${STUB_START.toString(8)} ${LAC_INCELL1.toString(8)}`,
    `deposit ${(STUB_START + 1).toString(8)} ${jda.toString(8)}`,
    `deposit ${(STUB_START + 2).toString(8)} ${LAC_INCELL2.toString(8)}`,
    `deposit ${(STUB_START + 3).toString(8)} ${HLT.toString(8)}`,
  ];
  for (const { f1, f2 } of cases) {
    lines.push(`deposit ${INCELL1.toString(8)} ${f1.toString(8)}`);
    lines.push(`deposit ${INCELL2.toString(8)} ${f2.toString(8)}`);
    lines.push(`run ${STUB_START.toString(8)}`);
    lines.push('examine ac');
    if (examineIo) lines.push('examine io');
    lines.push('examine pc');
  }
  lines.push('quit');
  return lines;
}

/**
 * Build a SIMH batch script that runs mpy for each {f1, f2} case in one process.
 * Each run emits: examine ac; examine io; examine pc.
 */
export function buildMpyBatchScript(rimPath, cases) {
  return buildBatchScript(rimPath, cases, { jda: JDA_MPY, examineIo: true });
}

/**
 * Build a SIMH batch script that runs imp for each {f1, f2} case in one process.
 * Each run emits: examine ac; examine pc.
 */
export function buildImpBatchScript(rimPath, cases) {
  return buildBatchScript(rimPath, cases, { jda: JDA_IMP, examineIo: false });
}

// ── output parsers ────────────────────────────────────────────────────────────

/**
 * Parse SIMH batch output into per-case records, pulling the named `registers`
 * (e.g. ['AC', 'IO', 'PC']) in order for each case. Each register name becomes a
 * lowercase field holding its integer value. `label` names the caller in the
 * error thrown when an expected register is missing or out of order.
 */
function parseBatchOutput(lines, numCases, registers, label) {
  const wanted = new Set(registers);
  const values = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9]+):\s+([0-7]+)/);
    if (m) {
      const name = m[1].toUpperCase();
      if (wanted.has(name)) values.push({ name, value: parseInt(m[2], 8) });
    }
  }
  const stride = registers.length;
  const records = [];
  for (let i = 0; i < numCases; i++) {
    const record = {};
    for (let j = 0; j < stride; j++) {
      const expected = registers[j];
      const slot = values[i * stride + j];
      if (!slot || slot.name !== expected) {
        throw new Error(`${label}: missing ${expected} at case ${i}`);
      }
      record[expected.toLowerCase()] = slot.value;
    }
    records.push(record);
  }
  return records;
}

/**
 * Parse SIMH batch output for mpy: extract AC, IO, PC triplets in order.
 * Returns array of {ac, io, pc} as JS integers.
 */
export function parseMpyBatchOutput(lines, numCases) {
  return parseBatchOutput(lines, numCases, ['AC', 'IO', 'PC'], 'parseMpyBatchOutput');
}

/**
 * Parse SIMH batch output for imp: extract AC, PC pairs in order.
 * Returns array of {ac, pc} as JS integers.
 */
export function parseImpBatchOutput(lines, numCases) {
  return parseBatchOutput(lines, numCases, ['AC', 'PC'], 'parseImpBatchOutput');
}

// ── substrate runners ─────────────────────────────────────────────────────────

/**
 * Run the boundary cases for mpy through SIMH; return {f1, f2, ac, io, pc} records.
 */
export async function runMpyBatch(rimPath, cases, { timeout } = {}) {
  const script = buildMpyBatchScript(rimPath, cases);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseMpyBatchOutput(lines, cases.length);
  return cases.map(({ f1, f2 }, i) => ({ f1, f2, ac: raw[i].ac, io: raw[i].io, pc: raw[i].pc }));
}

/**
 * Run the boundary cases for imp through SIMH; return {f1, f2, ac, pc} records.
 */
export async function runImpBatch(rimPath, cases, { timeout } = {}) {
  const script = buildImpBatchScript(rimPath, cases);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseImpBatchOutput(lines, cases.length);
  return cases.map(({ f1, f2 }, i) => ({ f1, f2, ac: raw[i].ac, pc: raw[i].pc }));
}

// ── serialization ─────────────────────────────────────────────────────────────

/**
 * Serialize mpy records {f1, f2, ac, io, pc} to JSONL; every field a zero-padded 6-digit
 * octal string (the raw machine word, per ADR-0008).
 */
export function serializeMpyVectors(records) {
  return (
    records
      .map((r) =>
        JSON.stringify({ f1: oct(r.f1), f2: oct(r.f2), ac: oct(r.ac), io: oct(r.io), pc: oct(r.pc) })
      )
      .join('\n') + '\n'
  );
}

/**
 * Serialize imp records {f1, f2, ac, pc} to JSONL; every field a zero-padded 6-digit
 * octal string (the raw machine word, per ADR-0008).
 */
export function serializeImpVectors(records) {
  return (
    records
      .map((r) =>
        JSON.stringify({ f1: oct(r.f1), f2: oct(r.f2), ac: oct(r.ac), pc: oct(r.pc) })
      )
      .join('\n') + '\n'
  );
}

// ── manifest builder ──────────────────────────────────────────────────────────

/**
 * Build the provenance manifest for the mpy/imp Vector sets (ADR-0008).
 * Inputs are explicit so the function is pure and unit-testable.
 */
export function buildMpyManifest({
  rimSha256,
  listingCoreStatus,
  callingConvention,
  calibration,
  toolVersions,
  mpyCaseCount,
  impCaseCount,
}) {
  return {
    routines: ['mpy', 'imp'],
    entry_pc_octal: {
      mpy: MPY_ADDR.toString(8).padStart(4, '0'),
      imp: IMP_ADDR.toString(8).padStart(4, '0'),
    },
    rim_sha256: rimSha256,
    listing_core_status: listingCoreStatus,
    domain: {
      cardinality: '~2^36 operand pairs (binary; not enumerable)',
      strength: 'branch-complete + boundary sample (ADR-0004)',
      residual: 'untested operand classes beyond the boundary sample',
      sample_classes: [
        'zero: both factors zero (0, 0)',
        'sign combinations ++/+-/-+/-- with small values (1, -1)',
        'max magnitude (0o177777 / 0o600000) with all four sign combinations',
      ],
      branch_witness: {
        'L276_spa_f1_sign': 'observed both ways: f1≥0 in ++ and +- cases; f1<0 in -+ and -- cases',
        'L281_spa_f2_sign': 'observed both ways: f2≥0 in ++ and -+ cases; f2<0 in +- and -- cases',
        'L289_sma_result_sign': 'observed both ways: positive result (++ and --); negative result (+- and -+)',
      },
      confluence_witnesses: [
        'source header L257-258: "BBN multiply subroutine; Call_. lac one factor, jda mpy or imp, lac other factor."',
        'source L260: "imp, returns low 17 bits and sign in ac"; L273: "mpy, returns 34 bits and 2 signs"',
        'listing symbol table: imp @ 000156, mpy @ 000171 (tools/build/spacewar31.lst)',
        'masswerk pt6 §Multiplication: mus step algorithm, imp = single-precision derivative of mpy',
      ],
    },
    calling_convention: callingConvention,
    calibration,
    tool_versions: toolVersions,
    mpy_vector_file: 'mpy-vectors.jsonl',
    imp_vector_file: 'imp-vectors.jsonl',
    mpy_case_count: mpyCaseCount,
    imp_case_count: impCaseCount,
  };
}
