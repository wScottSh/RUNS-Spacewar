/**
 * Batch script builder and output parser for sin/cos oracle runs.
 * Drives the SIMH pdp1 simulator with a single process over all 18-bit angles.
 *
 * sin entry: 0o0074  (from assembled listing: `sin, 0` at 00074)
 * cos entry: 0o0066  (from assembled listing: `cos, 0` at 00066)
 * Input  (L191-193): angle in AC, binary point right of bit 3, spanning ±2π
 * Output (L193):     result in AC, binary point right of bit 0
 *
 * The full 18-bit domain is swept: unsigned words 0..0o777777 (262,144 values),
 * covering positive (0o000000..0o377777) and negative angles (0o400000..0o777777)
 * in 1's complement. This is exhaustive per ADR-0004; the enumeration is the
 * coverage witness.
 */
import { runPdp1 } from './simh.js';
import { parseBatchOutput } from './substrate.js';

export const SIN_ADDR     = 0o0074;     // sin entry point (listing line 207)
export const COS_ADDR     = 0o0066;     // cos entry point (listing line 200)
export const INCELL       = 0o7700;     // free memory cell for angle input
export const STUB_START   = 0o7701;     // first stub instruction address
export const LAC_INCELL   = 0o207700;   // lac 07700
export const JDA_SIN      = 0o170074;   // jda sin  (sin @ 0074)
export const JDA_COS      = 0o170066;   // jda cos  (cos @ 0066)
export const HLT          = 0o760400;   // hlt
export const HALT_PC      = 0o7704;     // SIMH increments PC during fetch; hlt at 07703
export const MAX_ANGLE    = 0o777777;   // 262143 = 2^18 - 1 (all 18-bit words)
export const ANGLE_COUNT  = 1 << 18;    // 262144

// Calling convention (L191-193):
//   input:  18-bit signed angle, binary point right of bit 3, spanning ±2π
//           scale = 2^14; e.g. angle=2π → input ≈ 102944 (0o310640)
//   output: 18-bit signed result, binary point right of bit 0
//           scale = 2^17 = 131072; sin(π/2)=1.0 → max positive = 0o377777 = 131071
export const OUTPUT_SCALE = 1 << 17;    // 131072

export { parseBatchOutput };

/**
 * All 18-bit angles as unsigned integers: 0..0o777777 (262,144 values).
 */
export function fullAngleDomain() {
  const angles = new Array(ANGLE_COUNT);
  for (let i = 0; i < ANGLE_COUNT; i++) angles[i] = i;
  return angles;
}

function buildBatch(rimPath, angles, jdaInstruction) {
  const lines = [
    `load ${rimPath}`,
    `deposit ${STUB_START.toString(8)} ${LAC_INCELL.toString(8)}`,
    `deposit ${(STUB_START + 1).toString(8)} ${jdaInstruction.toString(8)}`,
    `deposit ${(STUB_START + 2).toString(8)} ${HLT.toString(8)}`,
  ];
  for (const angle of angles) {
    lines.push(`deposit ${INCELL.toString(8)} ${angle.toString(8)}`);
    lines.push(`run ${STUB_START.toString(8)}`);
    lines.push('examine ac');
    lines.push('examine pc');
  }
  lines.push('quit');
  return lines;
}

/**
 * Build a SIMH batch script calling jda sin for each angle.
 */
export function buildSinBatch(rimPath, angles) {
  return buildBatch(rimPath, angles, JDA_SIN);
}

/**
 * Build a SIMH batch script calling jda cos for each angle.
 */
export function buildCosBatch(rimPath, angles) {
  return buildBatch(rimPath, angles, JDA_COS);
}

/**
 * Run a set of angles through sin in a single SIMH process.
 * Returns {in, ac, pc} records (raw-word Vector shape, ADR-0008).
 */
export async function runSinBatch(rimPath, angles, { timeout } = {}) {
  const script = buildSinBatch(rimPath, angles);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseBatchOutput(lines, angles.length);
  return angles.map((angle, i) => ({ in: angle, ac: raw[i].ac, pc: raw[i].pc }));
}

/**
 * Run a set of angles through cos in a single SIMH process.
 * Returns {in, ac, pc} records (raw-word Vector shape, ADR-0008).
 */
export async function runCosBatch(rimPath, angles, { timeout } = {}) {
  const script = buildCosBatch(rimPath, angles);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseBatchOutput(lines, angles.length);
  return angles.map((angle, i) => ({ in: angle, ac: raw[i].ac, pc: raw[i].pc }));
}
