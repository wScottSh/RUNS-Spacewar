/**
 * Regenerate the frozen per-frame object-table goldens in oracle/reference/.
 *
 *   node oracle/gen-reference-goldens.mjs
 *
 * Runs every state-routine union scenario LIVE against the Substrate TWICE,
 * refuses to write unless both captures are bit-identical (the scenarios are
 * pinned-input and must be deterministic — a mismatch means the recipe is not
 * a recipe), and writes one golden per scenario (never hand-typed).
 *
 * Run this ONLY when the scenario set or snapshot ranges intentionally change.
 * The git diff of oracle/reference/ IS the review artifact: a changed word is
 * a changed answer, and a reviewer must ask what changed it.
 */
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureReferenceSnapshots,
  SNAPSHOT_SCENARIOS,
  RANGE_LABELS,
  REFERENCE_DIR,
  goldenPath,
  diffSnapshots,
} from './reference-snapshots.js';
import { PDP1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIM_PATH = join(HERE, '..', 'build', 'spacewar31.rim');

for (const [label, p] of [['SIMH pdp1', PDP1], ['RIM image', RIM_PATH]]) {
  if (!existsSync(p)) {
    console.error(`cannot regenerate goldens: ${label} not found at ${p}`);
    console.error('build the Substrate (assemble the image, build tools/pdp1) first.');
    process.exit(1);
  }
}

console.error('capture pass 1/2 (live SIMH)…');
const first = await captureReferenceSnapshots(RIM_PATH);
console.error('capture pass 2/2 (determinism check)…');
const second = await captureReferenceSnapshots(RIM_PATH);

let nondeterministic = false;
for (const name of SNAPSHOT_SCENARIOS) {
  const diffs = diffSnapshots(first.scenarios[name], second.scenarios[name]);
  if (diffs.length > 0) {
    nondeterministic = true;
    console.error(`NONDETERMINISTIC scenario ${name}:`);
    for (const d of diffs) console.error(`  ${d}`);
  }
}
if (nondeterministic) {
  console.error('REFUSING to write goldens: two live captures disagree.');
  process.exit(1);
}

await mkdir(REFERENCE_DIR, { recursive: true });
for (const name of SNAPSHOT_SCENARIOS) {
  const frames = first.scenarios[name];
  const golden = {
    scenario: name,
    instrument: 'per-frame object-table snapshot, raw 18-bit octal words (ADR-0004, ADR-0012)',
    ranges: RANGE_LABELS,
    generated: new Date().toISOString(),
    substrate: first.substrate,
    frames,
  };
  await writeFile(goldenPath(name), JSON.stringify(golden, null, 2) + '\n');
  console.error(`wrote ${goldenPath(name)} (${frames.length} frames)`);
}
console.error('review the git diff of oracle/reference/ before committing.');
