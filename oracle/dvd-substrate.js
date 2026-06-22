/**
 * Batch script builder and output parser for idv/dvd oracle runs.
 *
 * idv/dvd is the BBN Divide subroutine (lines 346–397, addresses 0306–0403).
 *
 * Entry signatures (from source comment L348):
 *   idv — integer divide: dividend in AC, jda idv, then lac divisor.
 *   dvd — 36-bit divide: lac hi-dividend, lio lo-dividend, jda dvd, lac divisor.
 *   Both return: quotient in AC, remainder in IO.
 *
 * Stub layout for idv (addresses 0o7702–0o7706):
 *   0o7702  lac IDIV_CELL   ; load dividend → AC
 *   0o7703  jda idv         ; call (M[idv]=dividend, AC=return-PC=0o7704)
 *   0o7704  lac IDSOR_CELL  ; ← xct'd by dv1; loads divisor into AC
 *   0o7705  hlt             ; overflow/÷0 return (1 × idx dv1 → 0o7705)
 *   0o7706  hlt             ; normal return (2 × idx dv1 → 0o7706)
 *
 * Stub layout for dvd (addresses 0o7710–0o7720):
 *   0o7710  lac HDIV_CELL   ; load hi-dividend → AC
 *   0o7711  lio LDIV_CELL   ; load lo-dividend → IO
 *   0o7712  jda dvd         ; call (M[dvd]=hi-div, AC=return-PC=0o7713)
 *   0o7713  lac DSOR_CELL   ; ← xct'd by dv1; loads divisor into AC
 *   0o7717  hlt             ; overflow/÷0 return (1 × idx dv1 → 0o7717, PC=0o7720)
 *   0o7720  hlt             ; normal return (2 × idx dv1 → 0o7720, PC=0o7721)
 *
 * Halt-PC derivation: SIMH increments PC past hlt during fetch; jmp i dv1 targets
 * the hlt word, so halt-PC = hlt_address + 1.
 */
import { runPdp1 } from './simh.js';

// Addresses from the assembly listing (build/spacewar31.lst).
export const IDV_ADDR = 0o306;   // 'idv' entry point (integer divide)
export const DVD_ADDR = 0o315;   // 'dvd' entry point (36-bit divide)
export const DV1_ADDR = 0o317;   // 'dv1' internal xct slot, patched per call by dap

// 18-bit PDP-1 ones-complement constants.
// In ones complement: -N = 0o777777 XOR N.  Sign bit is bit 0 (MSB).
export const WORD_MASK = 0o777777;   // 18-bit mask
export const SIGN_BIT  = 0o400000;   // bit 0 (MSB); set → negative

// ── idv stub memory layout ─────────────────────────────────────────────────

export const IDIV_CELL  = 0o7700;   // deposit cell: 18-bit dividend
export const IDSOR_CELL = 0o7701;   // deposit cell: divisor (xct'd by dv1)
export const IDV_STUB   = 0o7702;   // stub start address

// Halt-PCs (= hlt_address + 1, since SIMH increments PC during fetch).
export const IDV_HALT_NORMAL   = 0o7707;  // normal division (2 × idx dv1 → hlt at 0o7706)
export const IDV_HALT_OVERFLOW = 0o7706;  // overflow / ÷0 (1 × idx dv1 → hlt at 0o7705)

// ── dvd stub memory layout ─────────────────────────────────────────────────

export const HDIV_CELL  = 0o7710;   // deposit cell: hi 18 bits of dividend
export const LDIV_CELL  = 0o7711;   // deposit cell: lo 18 bits of dividend (also in IO)
export const DSOR_CELL  = 0o7712;   // deposit cell: divisor
export const DVD_STUB   = 0o7713;   // stub start address

// Halt-PCs (= hlt_address + 1; jda at DVD_STUB+2=0o7715 → return-PC=0o7716).
export const DVD_HALT_NORMAL   = 0o7721;  // normal   (2 × idx → dv1.addr=0o7720 → hlt → PC=0o7721)
export const DVD_HALT_OVERFLOW = 0o7720;  // overflow (1 × idx → dv1.addr=0o7717 → hlt → PC=0o7720)

// ── PDP-1 instruction encodings ────────────────────────────────────────────
// Format: (opcode << 12) | 12-bit address.  Opcodes from the listing.
const LAC = (a) => 0o200000 | (a & 0o7777);  // lac — load AC from memory
const LIO = (a) => 0o220000 | (a & 0o7777);  // lio — load IO from memory
const JDA = (a) => 0o170000 | (a & 0o7777);  // jda — jump and deposit AC
const HLT = 0o760400;

// ── script builders ────────────────────────────────────────────────────────

/**
 * Build a SIMH batch script for idv (integer divide).
 * `cases` is an array of {dividend, divisor} as 18-bit PDP-1 words (octal or integer).
 */
export function buildIdvScript(rimPath, cases) {
  const lines = [
    `load ${rimPath}`,
    // Stub deposits (fixed per script, done once).
    `deposit ${IDV_STUB.toString(8)} ${LAC(IDIV_CELL).toString(8)}`,
    `deposit ${(IDV_STUB + 1).toString(8)} ${JDA(IDV_ADDR).toString(8)}`,
    `deposit ${(IDV_STUB + 2).toString(8)} ${LAC(IDSOR_CELL).toString(8)}`,
    `deposit ${(IDV_STUB + 3).toString(8)} ${HLT.toString(8)}`,
    `deposit ${(IDV_STUB + 4).toString(8)} ${HLT.toString(8)}`,
  ];
  for (const { dividend, divisor } of cases) {
    lines.push(`deposit ${IDIV_CELL.toString(8)} ${(dividend & WORD_MASK).toString(8)}`);
    lines.push(`deposit ${IDSOR_CELL.toString(8)} ${(divisor & WORD_MASK).toString(8)}`);
    lines.push(`run ${IDV_STUB.toString(8)}`);
    lines.push('examine ac');
    lines.push('examine io');
    lines.push('examine pc');
  }
  lines.push('quit');
  return lines;
}

/**
 * Build a SIMH batch script for dvd (36-bit divide).
 * `cases` is an array of {hiDiv, loDiv, divisor} as 18-bit PDP-1 words.
 */
export function buildDvdScript(rimPath, cases) {
  const lines = [
    `load ${rimPath}`,
    // Stub deposits (fixed per script, done once).
    `deposit ${DVD_STUB.toString(8)} ${LAC(HDIV_CELL).toString(8)}`,
    `deposit ${(DVD_STUB + 1).toString(8)} ${LIO(LDIV_CELL).toString(8)}`,
    `deposit ${(DVD_STUB + 2).toString(8)} ${JDA(DVD_ADDR).toString(8)}`,
    `deposit ${(DVD_STUB + 3).toString(8)} ${LAC(DSOR_CELL).toString(8)}`,
    `deposit ${(DVD_STUB + 4).toString(8)} ${HLT.toString(8)}`,
    `deposit ${(DVD_STUB + 5).toString(8)} ${HLT.toString(8)}`,
  ];
  for (const { hiDiv, loDiv, divisor } of cases) {
    lines.push(`deposit ${HDIV_CELL.toString(8)} ${(hiDiv & WORD_MASK).toString(8)}`);
    lines.push(`deposit ${LDIV_CELL.toString(8)} ${(loDiv & WORD_MASK).toString(8)}`);
    lines.push(`deposit ${DSOR_CELL.toString(8)} ${(divisor & WORD_MASK).toString(8)}`);
    lines.push(`run ${DVD_STUB.toString(8)}`);
    lines.push('examine ac');
    lines.push('examine io');
    lines.push('examine pc');
  }
  lines.push('quit');
  return lines;
}

// ── output parsers ─────────────────────────────────────────────────────────

/**
 * Parse SIMH batch output into per-case {ac, io, pc} records (integer values).
 * Expects numCases × (AC examine, IO examine, PC examine) triples, in order.
 */
export function parseBatch(lines, numCases) {
  const values = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9]+):\s+([0-7]+)/);
    if (m) {
      const name = m[1].toUpperCase();
      if (name === 'AC' || name === 'IO' || name === 'PC') {
        values.push({ name, value: parseInt(m[2], 8) });
      }
    }
  }
  const records = [];
  for (let i = 0; i < numCases; i++) {
    const ac = values[i * 3];
    const io = values[i * 3 + 1];
    const pc = values[i * 3 + 2];
    if (!ac || ac.name !== 'AC') throw new Error(`parseBatch: missing AC at case ${i}`);
    if (!io || io.name !== 'IO') throw new Error(`parseBatch: missing IO at case ${i}`);
    if (!pc || pc.name !== 'PC') throw new Error(`parseBatch: missing PC at case ${i}`);
    records.push({ ac: ac.value, io: io.value, pc: pc.value });
  }
  return records;
}

// ── live oracle runners ────────────────────────────────────────────────────

/**
 * Run idv test cases through the Substrate.
 * Returns {dividend, divisor, ac, io, pc} records.
 */
export async function runIdvBatch(rimPath, cases, { timeout = 60_000 } = {}) {
  const script = buildIdvScript(rimPath, cases);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseBatch(lines, cases.length);
  return cases.map((c, i) => ({
    dividend: c.dividend & WORD_MASK,
    divisor:  c.divisor  & WORD_MASK,
    ac: raw[i].ac,
    io: raw[i].io,
    pc: raw[i].pc,
  }));
}

/**
 * Run dvd test cases through the Substrate.
 * Returns {hiDiv, loDiv, divisor, ac, io, pc} records.
 */
export async function runDvdBatch(rimPath, cases, { timeout = 60_000 } = {}) {
  const script = buildDvdScript(rimPath, cases);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseBatch(lines, cases.length);
  return cases.map((c, i) => ({
    hiDiv:   c.hiDiv   & WORD_MASK,
    loDiv:   c.loDiv   & WORD_MASK,
    divisor: c.divisor & WORD_MASK,
    ac: raw[i].ac,
    io: raw[i].io,
    pc: raw[i].pc,
  }));
}
