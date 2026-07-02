/**
 * Regenerate oracle/coverage-baseline.json — the coverage ratchet floor.
 *
 *   node oracle/gen-coverage-baseline.mjs
 *
 * Runs the full union closure LIVE against the Substrate, asserts it is green,
 * and writes the baseline derived from that passing run (never hand-typed).
 *
 * Run this ONLY when you intend to change the coverage contract — after adding
 * scenarios/branches, or after a reviewed decision to reclassify a branch as
 * correctly dead. The resulting git diff to coverage-baseline.json IS the
 * review artifact: a shrunk set or an edited register is exactly where a
 * reviewer must ask "is a real gap being hidden here?"
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runUnionClosure } from './coverage-union.js';
import { buildBaseline } from './coverage-ratchet.js';
import { PDP1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIM_PATH = join(HERE, '..', 'build', 'spacewar31.rim');
const LST_PATH = join(HERE, '..', 'build', 'spacewar31.lst');
const BASELINE_PATH = join(HERE, 'coverage-baseline.json');

for (const [label, p] of [['SIMH pdp1', PDP1], ['RIM image', RIM_PATH], ['listing', LST_PATH]]) {
  if (!existsSync(p)) {
    console.error(`cannot regenerate baseline: ${label} not found at ${p}`);
    console.error('build the Substrate (assemble the image, build tools/pdp1) first.');
    process.exit(1);
  }
}

console.error('running union closure live against the Substrate…');
const run = await runUnionClosure(RIM_PATH, LST_PATH);

if (!run.result.passed) {
  console.error('REFUSING to regenerate: the union closure is NOT green.');
  console.error(run.result.summary);
  console.error('dark:', run.result.dark.map((d) => d.addr.toString(8)).join(',') || 'none');
  console.error('unclassified:', run.result.unclassified.map((u) => u.addr.toString(8)).join(',') || 'none');
  process.exit(1);
}

const baseline = buildBaseline(run);
await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');

console.error(`wrote ${BASELINE_PATH}`);
console.error(
  `  in-contract: ${baseline.inContractSkipSites.length} skip sites, ` +
  `${baseline.inContractMultiwaySites.length} multiway`);
console.error(`  one-way register: ${Object.keys(baseline.oneWayRegister).length} entries`);
console.error(`  dead multiway: ${baseline.deadMultiway.length}, dead skip: ${baseline.deadSkipSites.length}`);
console.error(`  min distinct PCs: ${baseline.minDistinctPcs} (observed ${run.allPcs.size})`);
console.error('review the git diff of coverage-baseline.json before committing.');
