/**
 * Batch script builder and output parser for sqt oracle runs.
 * Drives the SIMH pdp1 simulator with a single process over many inputs.
 */
import { runPdp1 } from './simh.js';

export const SQT_ADDR   = 0o0246;
export const INCELL     = 0o7700;
export const STUB_START = 0o7701;
export const LAC_INCELL = 0o207700;  // lac 07700
export const JDA_SQT    = 0o170246;  // jda sqt
export const HLT        = 0o760400;
export const HALT_PC    = 0o7704;    // SIMH increments PC during fetch; hlt at 07703
export const MAX_INPUT  = 0o177777;  // 65535 — stated max input in sqt listing header
export const ROOT_SCALE = 512;       // 2^9 — 9.9 fixed-point scale (integer root in upper 9 bits)

/**
 * All {n, nsq} pairs where n² ≤ MAX_INPUT (0177777 = 65535).
 * n runs from 0 to 255 inclusive (256² = 65536 exceeds range).
 */
export function perfectSquareInputs() {
  const cases = [];
  for (let n = 0; n * n <= MAX_INPUT; n++) {
    cases.push({ n, nsq: n * n });
  }
  return cases;
}

/**
 * Every input sqt can be handed in-game: 0..MAX_INPUT (0177777 = 65535),
 * enumerated exhaustively per ADR-0004/0007. Returns 65,536 integers.
 */
export function fullDomainInputs() {
  const inputs = new Array(MAX_INPUT + 1);
  for (let i = 0; i <= MAX_INPUT; i++) inputs[i] = i;
  return inputs;
}

/**
 * Build a SIMH batch script that runs sqt for each input in a single process.
 * Stub instructions are deposited once; each input is deposited then run.
 * `inputs` is an array of integer inputs (the value handed to sqt).
 */
export function buildBatchScript(rimPath, inputs) {
  const lines = [
    `load ${rimPath}`,
    `deposit ${STUB_START.toString(8)} ${LAC_INCELL.toString(8)}`,
    `deposit ${(STUB_START + 1).toString(8)} ${JDA_SQT.toString(8)}`,
    `deposit ${(STUB_START + 2).toString(8)} ${HLT.toString(8)}`,
  ];
  for (const input of inputs) {
    lines.push(`deposit ${INCELL.toString(8)} ${input.toString(8)}`);
    lines.push(`run ${STUB_START.toString(8)}`);
    lines.push('examine ac');
    lines.push('examine pc');
  }
  lines.push('quit');
  return lines;
}

/**
 * Parse SIMH batch stdout into per-case {ac, pc} records (integer values).
 * Expects numCases consecutive AC-then-PC examine pairs in the output.
 */
export function parseBatchOutput(lines, numCases) {
  const values = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9]+):\s+([0-7]+)/);
    if (m) {
      const name = m[1].toUpperCase();
      if (name === 'AC' || name === 'PC') {
        values.push({ name, value: parseInt(m[2], 8) });
      }
    }
  }
  const records = [];
  for (let i = 0; i < numCases; i++) {
    const ac = values[i * 2];
    const pc = values[i * 2 + 1];
    if (!ac || ac.name !== 'AC') throw new Error(`Missing AC at case ${i}`);
    if (!pc || pc.name !== 'PC') throw new Error(`Missing PC at case ${i}`);
    records.push({ ac: ac.value, pc: pc.value });
  }
  return records;
}

/**
 * Run the perfect-square cases through SIMH and return {n, nsq, ac, pc} records.
 * The deposited input is each case's nsq (the perfect square handed to sqt).
 */
export async function runBatch(rimPath, cases) {
  const script = buildBatchScript(rimPath, cases.map((c) => c.nsq));
  const { lines } = await runPdp1(script);
  const raw = parseBatchOutput(lines, cases.length);
  return cases.map(({ n, nsq }, i) => ({ n, nsq, ac: raw[i].ac, pc: raw[i].pc }));
}

/**
 * Run a list of raw integer inputs through SIMH in a single process and return
 * {in, ac, pc} records (the raw-word Vector shape, ADR-0008).
 * `timeout` (ms) guards the whole batch against a non-halting call.
 */
export async function runDomainBatch(rimPath, inputs, { timeout } = {}) {
  const script = buildBatchScript(rimPath, inputs);
  const { lines } = await runPdp1(script, { timeout });
  const raw = parseBatchOutput(lines, inputs.length);
  return inputs.map((input, i) => ({ in: input, ac: raw[i].ac, pc: raw[i].pc }));
}
