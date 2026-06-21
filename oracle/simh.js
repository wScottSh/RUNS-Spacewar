/**
 * Thin wrapper around the SIMH pdp1 simulator.
 * Runs a script file and returns parsed register/memory values.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

// Path to the pdp1 binary built from open-simh source
export const PDP1 = '/tmp/simh-sparse/pdp1';

/**
 * Run a SIMH pdp1 session with the given script lines.
 * Returns { stdout, lines } where lines is the raw output split on newlines.
 */
export async function runPdp1(scriptLines) {
  const script = scriptLines.join('\n') + '\n';
  const tmp = join(tmpdir(), `pdp1-${Date.now()}.simh`);
  await writeFile(tmp, script);
  try {
    const { stdout, stderr } = await execFileAsync(PDP1, [tmp], {
      timeout: 30_000,
    });
    return { stdout: stdout + stderr, lines: (stdout + stderr).split('\n') };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * Parse SIMH "NAME:\tVALUE" examine output lines into an object of name→octal string.
 * Names are upper-cased and leading zeros are stripped from values.
 * e.g. "AC:\t002000" → { AC: '2000' }
 */
export function parseExamine(lines) {
  const out = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9]+):\s+([0-7]+)/);
    if (m) out[m[1].toUpperCase()] = m[2].replace(/^0+/, '') || '0';
  }
  return out;
}
