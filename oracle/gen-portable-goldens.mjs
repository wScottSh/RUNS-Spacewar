/**
 * Freeze the portable-frame goldens in oracle/reference/*.portable.json.
 *
 *   node oracle/gen-portable-goldens.mjs
 *
 * decode.js is a PURE function over the committed raw goldens (no Substrate),
 * so this generator just re-projects each raw golden and writes its portable
 * form.  The freeze is the T-REFERENCE pattern one level up: the git diff of
 * the *.portable.json files IS the review artifact — a changed portable word or
 * a re-binned field is a changed answer, and a reviewer must ask what changed
 * decode.  Run this ONLY when decode's ledger intentionally changes.
 */
import { writeFile } from 'node:fs/promises';

import { SNAPSHOT_SCENARIOS, loadGolden } from './reference-snapshots.js';
import { decodeGolden, portablePath } from './decode.js';

let missing = 0;
for (const name of SNAPSHOT_SCENARIOS) {
  const raw = await loadGolden(name);
  if (!raw || !Array.isArray(raw.frames) || raw.frames.length === 0) {
    console.error(`raw golden missing/empty for ${name} — regenerate raw goldens first`);
    missing++;
    continue;
  }
  const portable = decodeGolden(raw); // throws (fail-closed) on an unmapped calc word
  await writeFile(portablePath(name), JSON.stringify(portable, null, 2) + '\n');
  console.error(`wrote ${portablePath(name)} (${portable.frames.length} frames)`);
}
if (missing) {
  console.error(`REFUSING to complete: ${missing} raw golden(s) missing.`);
  process.exit(1);
}
console.error('review the git diff of oracle/reference/*.portable.json before committing.');
