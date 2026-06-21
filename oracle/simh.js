/**
 * Thin wrapper around the SIMH pdp1 simulator.
 * Runs a script file and returns parsed register/memory values.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

/**
 * Locate the SIMH pdp1 Substrate binary.
 *
 * The binary is a gitignored build artifact, so its path differs per host:
 * the repo-local build lives at tools/pdp1[.exe], while a CI/sandbox build may
 * live anywhere. Resolution order:
 *   1. $PDP1 — explicit override for any host (e.g. the Sandcastle harness).
 *   2. tools/pdp1.exe (win32) or tools/pdp1 (POSIX), relative to this repo.
 *
 * No host-specific absolute path is baked into the source.
 */
function resolvePdp1() {
  if (process.env.PDP1) return process.env.PDP1;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const exe = process.platform === 'win32' ? 'pdp1.exe' : 'pdp1';
  return join(repoRoot, 'tools', exe);
}

// Path to the pdp1 binary that runs the Substrate (see resolvePdp1).
export const PDP1 = resolvePdp1();

/**
 * Run a SIMH pdp1 session with the given script lines.
 * Returns { stdout, lines } where lines is the raw output split on newlines.
 *
 * `timeout` (ms) guards against a routine that loops instead of halting; the
 * full-domain capture needs a longer guard than a single calibration call, so
 * the bound is a parameter rather than a baked-in constant.
 */
export async function runPdp1(scriptLines, { timeout = 30_000 } = {}) {
  const script = scriptLines.join('\n') + '\n';
  const tmp = join(tmpdir(), `pdp1-${Date.now()}.simh`);
  await writeFile(tmp, script);
  try {
    const { stdout, stderr } = await execFileAsync(PDP1, [tmp], {
      timeout,
      maxBuffer: 256 * 1024 * 1024,
    });
    const output = stdout + stderr;
    return { stdout: output, lines: output.split('\n') };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * Probe the SIMH pdp1 Substrate's version banner (for the provenance manifest).
 * Returns the first banner line, e.g. "PDP-1 simulator Open SIMH V4.1-0 Current".
 */
export async function pdp1Version() {
  const { lines } = await runPdp1(['show version', 'quit']);
  const banner = lines.find((l) => /simulator/i.test(l));
  return banner ? banner.trim() : 'unknown';
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
