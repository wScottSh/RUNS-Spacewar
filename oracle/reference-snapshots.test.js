/**
 * T-REFERENCE — frozen per-frame object-table goldens for the state routines
 * (ADR-0004, ADR-0012: "the per-frame object-table snapshot records the truth").
 *
 * The math islands assert against frozen Vectors; this gate does the same for
 * the entangled game routines: every pinned union scenario is re-run LIVE in
 * SIMH and its per-frame raw object-table words must equal the committed
 * golden in oracle/reference/ — not merely "the branch fired".
 *
 * Discipline mirrors the coverage gate (ADR-0011, ADR-0013):
 *
 *   FAIL-CLOSED. Substrate absent ⇒ red, not skip (same named opt-out,
 *     ORACLE_ALLOW_NO_SUBSTRATE=1, never in CI). A missing or empty golden is
 *     ALWAYS red — deleting an answer must not make the check cheaper.
 *
 *   EXECUTION-GROUNDED. The comparison source is a live capture through the
 *     same captureReferenceSnapshots() path the generator uses; the per-frame
 *     word-count and nonzero floors make a stubbed run fail loudly.
 *
 *   FROZEN. The goldens are committed raw words. Any behavioral drift —
 *     substrate, image, or scenario — lands as a reviewable value diff.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureReferenceSnapshots,
  loadGolden,
  diffSnapshots,
  SNAPSHOT_SCENARIOS,
  RANGE_LABELS,
  WORDS_PER_FRAME,
} from './reference-snapshots.js';
import { PDP1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIM_PATH = join(HERE, '..', 'build', 'spacewar31.rim');

function substrateStatus() {
  const missing = [];
  if (!existsSync(PDP1)) missing.push(`SIMH pdp1 (${PDP1})`);
  if (!existsSync(RIM_PATH)) missing.push('build/spacewar31.rim');
  return { present: missing.length === 0, missing };
}

test(
  'T-REFERENCE: state-routine per-frame snapshots match the frozen goldens',
  { timeout: 600_000 },
  async (t) => {
    // Goldens must exist for every pinned scenario — checked BEFORE the
    // substrate gate so a deleted golden is red even where SIMH is absent.
    const goldens = {};
    const absent = [];
    for (const name of SNAPSHOT_SCENARIOS) {
      const golden = await loadGolden(name);
      if (!golden || !Array.isArray(golden.frames) || golden.frames.length === 0) {
        absent.push(name);
      } else {
        goldens[name] = golden;
      }
    }
    assert.equal(absent.length, 0,
      `frozen golden missing/empty for: ${absent.join(', ') || 'none'} — ` +
      `regenerate with gen-reference-goldens.mjs and review the diff`);

    // FAIL-CLOSED substrate gate (same shape as the coverage gate).
    const { present, missing } = substrateStatus();
    if (!present) {
      if (process.env.ORACLE_ALLOW_NO_SUBSTRATE === '1') {
        t.skip(`Substrate absent (${missing.join(', ')}); bypassed via ORACLE_ALLOW_NO_SUBSTRATE=1`);
        return;
      }
      assert.fail(
        `Oracle reference gate cannot run: ${missing.join(', ')} missing.\n` +
        `The goldens are SIMH-observed truth; a green suite that never re-ran the ` +
        `Substrate proves nothing. Build the image and the pdp1 binary, then re-run.\n` +
        `To bypass for pure-unit iteration ONLY, set ORACLE_ALLOW_NO_SUBSTRATE=1 (never in CI).`,
      );
    }

    // Run every scenario LIVE through the single shared capture path.
    const live = await captureReferenceSnapshots(RIM_PATH);

    // Execution-proof: a real SIMH banner and real, populated frames.
    assert.match(live.substrate, /simulator/i, 'Substrate reports a real SIMH banner');

    for (const name of SNAPSHOT_SCENARIOS) {
      const golden = goldens[name];
      const frames = live.scenarios[name];

      assert.deepEqual(golden.ranges, RANGE_LABELS,
        `${name}: golden captured the current snapshot ranges (regenerate if ranges changed)`);

      // Every frame carries the full examined surface, and the scenario
      // populates the object table (some boots reach the ml0 seam before the
      // table fill, so the floor is over all frames) — a stub cannot fake this.
      for (const frame of frames) {
        assert.equal(Object.keys(frame.words).length, WORDS_PER_FRAME,
          `${name} frame ${frame.label}: full ${WORDS_PER_FRAME}-word snapshot captured`);
      }
      const maxNonzero = Math.max(...frames.map(
        (f) => Object.values(f.words).filter((w) => w !== '000000').length));
      assert.ok(maxNonzero >= 10,
        `${name}: max ${maxNonzero} nonzero words per frame — the object table was populated`);

      // The frozen contract: raw per-frame words, exactly.
      const diffs = diffSnapshots(golden.frames, frames);
      assert.equal(diffs.length, 0,
        `${name}: live snapshot deviates from frozen golden:\n  ${diffs.join('\n  ')}`);
    }
  },
);
