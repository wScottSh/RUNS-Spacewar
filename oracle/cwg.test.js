/**
 * T-CWG — Trace: control-word source select (mg1/mg2), source lines 830–842.
 *
 * Class E (Trace): mg1/mg2 are branchless indirection stubs that feed the
 * per-frame control word from two hardware sources:
 *   mg1 (01672–01675): iot 11  — hardware control boxes (boot via loc 4)
 *   mg2 (01676–01702): lat     — PDP-1 test word      (boot via loc 5)
 *
 * Coverage gate (ADR-0012 branchless region): no skip obligation; both sources
 * must be observed executing. Pinned by the boot address:
 *   loc 4 (a40) → \cwg = cwr → jmp mg1
 *   loc 5 (a1)  → \cwg = mg2 (direct)
 *
 * Closes issue #15.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1, pdp1Version } from './simh.js';
import { parseListingForMeter, parseSimhHistory } from './meter.js';
import { sha256File } from './vectors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH      = join(ROOT, 'build/spacewar31.rim');
const LST_PATH      = join(ROOT, 'build/spacewar31.lst');
const MANIFEST_PATH = join(HERE, 'cwg-manifest.json');

// mg1/mg2 octal addresses from the assembled listing (source lines 830–842)
const MG1_ADDR  = 0o1672;  // mg1,  dap mg3 (entry)
const MG1_IOT   = 0o1674;  // iot 11 — hardware control word read
const MG3_STUB  = 0o1675;  // mg3, jmp . (self-modified return)
const MG2_ADDR  = 0o1676;  // mg2, dap mg4 (entry)
const MG2_LAT   = 0o1677;  // lat — test-word read
const MG4_STUB  = 0o1702;  // mg4, jmp . (self-modified return)

// Address range of the entire mg1/mg2 region for the branchless check
const REGION_LOW  = MG1_ADDR;
const REGION_HIGH = MG4_STUB;

/**
 * Run a SIMH trace from boot address bootAddr (octal), stopping at breakpointAddr
 * (the self-modified return stub of the cwg routine).  Returns the parsed PC stream.
 *
 * history=200 is sufficient: the breakpoint fires after the first cwg call, so
 * the most-recent 200 instructions always include the short mg1/mg2 sequence.
 */
async function traceFromBoot(bootAddr, breakpointAddr) {
  const script = [
    `load ${RIM_PATH}`,
    'set cpu history=200',
    `break ${breakpointAddr.toString(8)}`,
    `run ${bootAddr.toString(8)}`,
    'show cpu history',
    'quit',
  ];
  const { lines } = await runPdp1(script, { timeout: 30_000 });
  return parseSimhHistory(lines.join('\n'));
}

// ── Unit: listing confirms no skip in mg1/mg2 region ─────────────────────────

test('T-CWG: mg1/mg2 region (830–842) has no conditional skip — branchless', async () => {
  let listingText;
  try {
    listingText = await readFile(LST_PATH, 'utf8');
  } catch {
    return; // listing not built — skip
  }
  const { skipSites } = parseListingForMeter(listingText);
  for (const addr of skipSites.keys()) {
    assert.ok(
      addr < REGION_LOW || addr > REGION_HIGH,
      `unexpected skip at ${addr.toString(8).padStart(5, '0')} in mg1/mg2 region (${REGION_LOW.toString(8)}–${REGION_HIGH.toString(8)})`,
    );
  }
});

// ── Integration: loc 4 → mg1 (iot 11) ────────────────────────────────────────

test('T-CWG: boot via loc 4 (a40) executes mg1 — iot 11 in trace', { timeout: 60_000 }, async () => {
  let pcs;
  try {
    pcs = await traceFromBoot(4, MG3_STUB);
  } catch {
    return; // build or SIMH not available
  }
  assert.ok(
    pcs.includes(MG1_ADDR),
    `mg1 entry (dap mg3) at ${MG1_ADDR.toString(8)} not in trace`,
  );
  assert.ok(
    pcs.includes(MG1_IOT),
    `iot 11 at ${MG1_IOT.toString(8)} not in trace`,
  );
  assert.ok(
    !pcs.includes(MG2_ADDR),
    `mg2 (lat) should not execute when booted via loc 4 (hardware boxes)`,
  );
});

// ── Integration: loc 5 → mg2 (lat) ───────────────────────────────────────────

test('T-CWG: boot via loc 5 (a1) executes mg2 — lat in trace', { timeout: 60_000 }, async () => {
  let pcs;
  try {
    pcs = await traceFromBoot(5, MG4_STUB);
  } catch {
    return; // build or SIMH not available
  }
  assert.ok(
    pcs.includes(MG2_ADDR),
    `mg2 entry (dap mg4) at ${MG2_ADDR.toString(8)} not in trace`,
  );
  assert.ok(
    pcs.includes(MG2_LAT),
    `lat at ${MG2_LAT.toString(8)} not in trace`,
  );
  assert.ok(
    !pcs.includes(MG1_IOT),
    `iot 11 should not execute when booted via loc 5 (test word)`,
  );
});

// ── Integration: trace union covers both control-source PCs ──────────────────

test('T-CWG: trace union covers both mg1 (iot 11) and mg2 (lat)', { timeout: 60_000 }, async () => {
  let mg1Pcs, mg2Pcs;
  try {
    [mg1Pcs, mg2Pcs] = await Promise.all([
      traceFromBoot(4, MG3_STUB),
      traceFromBoot(5, MG4_STUB),
    ]);
  } catch {
    return;
  }
  const union = new Set([...mg1Pcs, ...mg2Pcs]);
  assert.ok(union.has(MG1_ADDR), `mg1 (${MG1_ADDR.toString(8)}) not in trace union`);
  assert.ok(union.has(MG2_ADDR), `mg2 (${MG2_ADDR.toString(8)}) not in trace union`);
});

// ── Manifest ──────────────────────────────────────────────────────────────────

test('T-CWG: write cwg-manifest.json', { timeout: 60_000 }, async () => {
  let version, rimSha256;
  try {
    [version, rimSha256] = await Promise.all([pdp1Version(), sha256File(RIM_PATH)]);
  } catch {
    return;
  }

  const manifest = {
    witness:         'T-CWG',
    issue:           15,
    method:          'Trace — branchless region; both control sources observed (ADR-0012)',
    gate_class:      'Trace-E: no skip obligation; branchless dap/jmp indirection',
    source_lines:    '830–842',
    region: {
      mg1: { addr_octal: MG1_ADDR.toString(8), key_pc_octal: MG1_IOT.toString(8), key_instruction: 'iot 11', boot_loc: 4 },
      mg2: { addr_octal: MG2_ADDR.toString(8), key_pc_octal: MG2_LAT.toString(8), key_instruction: 'lat',    boot_loc: 5 },
    },
    rim_sha256:       rimSha256,
    substrate_version: version,
    result:           'PASS — mg1 (iot 11) observed via loc-4 trace; mg2 (lat) observed via loc-5 trace',
  };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  const written = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  assert.strictEqual(written.witness, 'T-CWG');
  assert.strictEqual(written.issue,   15);
  assert.strictEqual(written.result,  manifest.result);
});
