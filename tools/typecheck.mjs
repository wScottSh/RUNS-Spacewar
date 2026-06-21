/**
 * Cross-platform syntax check for the oracle sources.
 *
 * Replaces a bash `for` loop that npm ran through cmd.exe on Windows (where the
 * loop is a parse error). Node enumerates the files and runs `node --check` on
 * each, so the check behaves identically on every host.
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORACLE = join(ROOT, 'oracle');

const files = readdirSync(ORACLE).filter((f) => f.endsWith('.js'));
let failed = 0;

for (const f of files) {
  const path = join(ORACLE, f);
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
    console.log(`ok: oracle/${f}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: oracle/${f}`);
    if (err.stderr) process.stderr.write(err.stderr);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`\n${files.length} file(s) checked, all OK.`);
