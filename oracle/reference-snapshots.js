/**
 * Reference snapshots — the frozen per-frame object-table goldens for the
 * entangled (state) game routines (ADR-0004, ADR-0012).
 *
 * The math islands have frozen Vectors (oracle/*-vectors.jsonl); until now the
 * state routines' answers were computed live in the union scenarios and then
 * DISCARDED — branches proven driven, values thrown away.  This module closes
 * that gap: it re-runs the pinned union scenarios with per-frame EXAMINEs at
 * the ml0 seam and captures the raw object-table words as the recorded truth.
 *
 * The words are frozen RAW (18-bit octal strings), not decoded into game-state
 * fields: the raw words are the observed truth, and the object-table layout is
 * already witnessed listing↔core (ADR-0006).  A Realization-facing decode is a
 * phase-2 interface decision (ADR-0007 defers it to the variant author).
 *
 * Single shared code path: captureReferenceSnapshots() is used by BOTH the
 * golden generator (gen-reference-goldens.mjs) and the fail-closed compare
 * test (reference-snapshots.test.js) — there is no second, divergent runner.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanIohAddrs, buildUnionScenarios, ADDR } from './coverage-union.js';
import { pdp1Version } from './simh.js';

export const REFERENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'reference');

/**
 * Address ranges examined at every frame seam — the game-state surface of the
 * entangled routines, raw and contiguous:
 *
 *   00020            ddd (single/dual outline flag)
 *   00031            ran (PRNG state)
 *   03236–03266      shared ship scalars: mco, bx/by, mdx/mdy, mfu, mtr,
 *                    mh1–mh4, ntd, 1sc/2sc, cwg, gct, scw
 *   03476–03771      the object table proper: mtb calc column through the
 *                    2-cell ship columns (nth/nfu/ntr/nh2–nh4), i.e. every
 *                    word before the compiled outline code at nnn (03772)
 *
 * The compiled outline region (nnn on) is excluded: it is generated code, not
 * game state, and the union runner nops its wait-class iot words per frame.
 */
export const SNAPSHOT_RANGES = [
  [ADDR.DDD, ADDR.DDD],
  [ADDR.RAN, ADDR.RAN],
  [0o3236, 0o3266],
  [0o3476, ADDR.NNN - 1],
];

/**
 * The union scenarios that exercise the state routines through real game
 * frames (every runFrames-based scenario in buildUnionScenarios).  Excluded:
 * `vectors` (math islands — already frozen as Vectors), `ocSynth` (compiler
 * probe into free core), `backdisp` (display-only direct-entry passes) — none
 * of them plays game frames against the object table.
 */
export const SNAPSHOT_SCENARIOS = [
  'boot4', 'boot5single', 'gameplay', 'mixedDeath', 'collision',
  'hyper', 'hyper2', 'gravity', 'gravityExplode', 'fuelout', 'boot4match',
];

export const goldenPath = (name) => join(REFERENCE_DIR, `${name}.snapshot.json`);

const rangeLabel = ([lo, hi]) =>
  lo === hi ? lo.toString(8) : `${lo.toString(8)}-${hi.toString(8)}`;

export const RANGE_LABELS = SNAPSHOT_RANGES.map(rangeLabel);

/** Expected word count per frame (sanity floor for execution-groundedness). */
export const WORDS_PER_FRAME = SNAPSHOT_RANGES
  .reduce((n, [lo, hi]) => n + (hi - lo + 1), 0);

/**
 * Run the pinned state-routine scenarios LIVE with per-frame snapshots.
 * Returns { scenarios: { name → frames[] }, substrate } where each frame is
 * { label, words: { octalAddr → 6-digit octal word } }.
 */
export async function captureReferenceSnapshots(rimPath, {
  scenarios = SNAPSHOT_SCENARIOS,
} = {}) {
  const iohAddrs = await scanIohAddrs(rimPath);
  if (iohAddrs.length === 0) {
    throw new Error('IOH scan found no wait-class iot words — boot/compile did not run');
  }
  const all = buildUnionScenarios(rimPath, iohAddrs, { snapshotRanges: SNAPSHOT_RANGES });

  const captured = {};
  for (const name of scenarios) {
    if (typeof all[name] !== 'function') {
      throw new Error(`unknown snapshot scenario: ${name}`);
    }
    const { snapshots } = await all[name]();
    if (!snapshots || snapshots.length === 0) {
      throw new Error(`scenario ${name} produced no snapshots — SIMH did not run`);
    }
    for (const frame of snapshots) {
      const got = Object.keys(frame.words).length;
      if (got !== WORDS_PER_FRAME) {
        throw new Error(
          `scenario ${name} frame ${frame.label}: captured ${got} words, expected ${WORDS_PER_FRAME}`);
      }
    }
    captured[name] = snapshots;
  }

  const substrate = await pdp1Version();
  return { scenarios: captured, substrate };
}

/** Load a committed golden; returns null if absent (callers decide severity). */
export async function loadGolden(name) {
  try {
    return JSON.parse(await readFile(goldenPath(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Compare live frames against a golden's frames.  Returns a list of
 * human-readable mismatch strings (empty = identical).
 */
export function diffSnapshots(goldenFrames, liveFrames, { maxDiffs = 20 } = {}) {
  const diffs = [];
  if (goldenFrames.length !== liveFrames.length) {
    diffs.push(`frame count: golden ${goldenFrames.length}, live ${liveFrames.length}`);
  }
  const n = Math.min(goldenFrames.length, liveFrames.length);
  for (let i = 0; i < n && diffs.length < maxDiffs; i++) {
    const g = goldenFrames[i], l = liveFrames[i];
    if (g.label !== l.label) {
      diffs.push(`frame ${i}: label golden "${g.label}", live "${l.label}"`);
      continue;
    }
    const addrs = new Set([...Object.keys(g.words), ...Object.keys(l.words)]);
    for (const addr of addrs) {
      if (g.words[addr] !== l.words[addr]) {
        diffs.push(
          `frame ${g.label} @${addr}: golden ${g.words[addr] ?? '(absent)'}, ` +
          `live ${l.words[addr] ?? '(absent)'}`);
        if (diffs.length >= maxDiffs) break;
      }
    }
  }
  return diffs;
}
