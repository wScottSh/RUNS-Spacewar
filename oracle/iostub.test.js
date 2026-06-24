/**
 * T-IOSTUB — cwr entry stub + sbf correctly-dead (source lines 98–117).
 *
 * Acceptance criteria (ADR-0012 / issue #16):
 *   1. The range 98–117 is branchless: T-METER finds no skip sites.
 *   2. cwr (loc 40) is observed executing on the per-frame control-word fetch.
 *   3. sbf (loc 61–65) and the loc-3 jmp sbf vector are never reached; the
 *      block is confirmed dark across the trace — correctly dead (ADR-0007).
 *
 * Pure-function tests run without SIMH.
 * Integration tests require build/spacewar31.rim and a pdp1 binary; they
 * skip gracefully when either is absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CWR_ADDR, CWR_WORD,
  SBF_ADDRS, SBF_WORDS,
  LOC3_ADDR, LOC3_WORD,
  buildIostubTraceScript,
} from './iostub.js';
import { parseListingForMeter, parseSimhHistory, isSkipWord } from './meter.js';
import { runPdp1, PDP1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM  = join(ROOT, 'build/spacewar31.rim');
const LST  = join(ROOT, 'build/spacewar31.lst');

// ── Constants ────────────────────────────────────────────────────────────────

test('T-IOSTUB: CWR_ADDR is loc 40 octal', () => {
  assert.equal(CWR_ADDR, 0o40);
});

test('T-IOSTUB: CWR_WORD is jmp mg1 (601672 octal)', () => {
  assert.equal(CWR_WORD, 0o601672);
});

test('T-IOSTUB: SBF_ADDRS is the five-instruction block at loc 61–65', () => {
  assert.deepEqual(SBF_ADDRS, [0o61, 0o62, 0o63, 0o64, 0o65]);
});

test('T-IOSTUB: SBF_WORDS length matches SBF_ADDRS', () => {
  assert.equal(SBF_WORDS.length, SBF_ADDRS.length);
});

test('T-IOSTUB: LOC3_ADDR is 3 (octal 3 = reset vector)', () => {
  assert.equal(LOC3_ADDR, 0o3);
});

test('T-IOSTUB: LOC3_WORD is jmp sbf (600061 octal)', () => {
  assert.equal(LOC3_WORD, 0o600061);
});

// ── Branchlessness: no skip words in the cwr/sbf blocks ──────────────────────

test('T-IOSTUB: CWR_WORD (jmp mg1) is not a skip instruction', () => {
  assert.ok(!isSkipWord(CWR_WORD), 'jmp mg1 is not a skip');
});

test('T-IOSTUB: all SBF_WORDS are not skip instructions', () => {
  for (let i = 0; i < SBF_WORDS.length; i++) {
    assert.ok(
      !isSkipWord(SBF_WORDS[i]),
      `sbf word at addr ${SBF_ADDRS[i].toString(8)} (${SBF_WORDS[i].toString(8)}) must not be a skip`,
    );
  }
});

test('T-IOSTUB: LOC3_WORD (jmp sbf) is not a skip instruction', () => {
  assert.ok(!isSkipWord(LOC3_WORD), 'jmp sbf is not a skip');
});

// ── Listing snippet: parseListingForMeter finds no skip sites in range ────────

// Hand-authored listing snippet for lines 98–117 (instructions only; comments,
// directives, and blank lines are as produced by macro1, verified against
// build/spacewar31.lst).
const IOSTUB_LISTING_SNIPPET = [
  // loc-3 reset vector (line 67 source, variety B srcLine+addr+no-word, then
  // variety C no-srcLine+addr+word for the assembled instruction)
  '   67 00003             3/\tjmp sbf\t\t/ ignore seq. break',
  '      00003 600061',
  // cwr stub (line 106, variety A regular instruction)
  '  106 00040 601672      cwr,\tjmp mg1\t/ normally iot 11 control',
  // sbf block (lines 112–116, variety A)
  '  112 00061 720004      sbf,\ttyi',
  '  113 00062 220002      \tlio 2',
  '  114 00063 200000      \tlac 0',
  '  115 00064 720054      \tlsm',
  '  116 00065 610001      \tjmp i 1',
].join('\n');

test('T-IOSTUB: listing snippet has zero skip sites in cwr/sbf range', () => {
  const { skipSites } = parseListingForMeter(IOSTUB_LISTING_SNIPPET);
  // All addresses in scope: 0o3, 0o40, 0o61–0o65
  const rangeAddrs = [LOC3_ADDR, CWR_ADDR, ...SBF_ADDRS];
  for (const addr of rangeAddrs) {
    assert.ok(
      !skipSites.has(addr),
      `addr ${addr.toString(8)} must not be a skip site`,
    );
  }
  // Branchless: no skip sites at all from this snippet
  assert.equal(skipSites.size, 0, 'listing snippet contains zero skip sites');
});

test('T-IOSTUB: listing snippet has zero multiway branches in cwr/sbf range', () => {
  const { multiwayBranches } = parseListingForMeter(IOSTUB_LISTING_SNIPPET);
  assert.equal(multiwayBranches.size, 0, 'no jmp. (multiway) instructions in range');
});

test('T-IOSTUB: listing snippet maps cwr address to source line 106', () => {
  const { addrToSrcLine } = parseListingForMeter(IOSTUB_LISTING_SNIPPET);
  assert.equal(addrToSrcLine.get(CWR_ADDR), 106);
});

test('T-IOSTUB: listing snippet maps sbf addresses to correct source lines', () => {
  const { addrToSrcLine } = parseListingForMeter(IOSTUB_LISTING_SNIPPET);
  assert.equal(addrToSrcLine.get(0o61), 112);
  assert.equal(addrToSrcLine.get(0o62), 113);
  assert.equal(addrToSrcLine.get(0o63), 114);
  assert.equal(addrToSrcLine.get(0o64), 115);
  assert.equal(addrToSrcLine.get(0o65), 116);
});

// ── Real listing integration (build/spacewar31.lst required) ─────────────────

test('T-IOSTUB: real listing — no skip sites in range 98–117 (addr 3, 40, 61–65)', async () => {
  if (!existsSync(LST)) return;
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(LST, 'utf8');
  const { skipSites } = parseListingForMeter(text);
  const rangeAddrs = [LOC3_ADDR, CWR_ADDR, ...SBF_ADDRS];
  for (const addr of rangeAddrs) {
    assert.ok(
      !skipSites.has(addr),
      `real listing: addr ${addr.toString(8)} must not be a skip site`,
    );
  }
});

test('T-IOSTUB: real listing — cwr word matches CWR_WORD (601672)', async () => {
  if (!existsSync(LST)) return;
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(LST, 'utf8');
  // Extract the cwr line from the listing text directly.
  const m = text.match(/^  106 00040 ([0-7]{6})/m);
  assert.ok(m, 'cwr line found in listing (line 106, addr 00040)');
  assert.equal(parseInt(m[1], 8), CWR_WORD, 'cwr word matches CWR_WORD constant');
});

test('T-IOSTUB: real listing — sbf words match SBF_WORDS constants', async () => {
  if (!existsSync(LST)) return;
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(LST, 'utf8');
  const srcLines = [112, 113, 114, 115, 116];
  const addrs    = ['00061', '00062', '00063', '00064', '00065'];
  for (let i = 0; i < srcLines.length; i++) {
    const pattern = new RegExp(`^  ${srcLines[i]} ${addrs[i]} ([0-7]{6})`, 'm');
    const m = text.match(pattern);
    assert.ok(m, `sbf line ${srcLines[i]} at addr ${addrs[i]} found in listing`);
    assert.equal(
      parseInt(m[1], 8),
      SBF_WORDS[i],
      `sbf word at addr ${addrs[i]} matches SBF_WORDS[${i}]`,
    );
  }
});

// ── SIMH integration (pdp1 binary + build/spacewar31.rim required) ───────────

test(
  'T-IOSTUB: cwr (loc 40) is reached on per-frame control-word fetch',
  { timeout: 30_000 },
  async () => {
    if (!existsSync(RIM) || !existsSync(PDP1)) return;

    const script = buildIostubTraceScript(RIM, 5000);
    const { stdout } = await runPdp1(script, { timeout: 25_000 });
    const pcs = parseSimhHistory(stdout);

    assert.ok(
      pcs.includes(CWR_ADDR),
      `cwr at addr ${CWR_ADDR.toString(8)} must appear in 5000-step trace`,
    );
  },
);

test(
  'T-IOSTUB: sbf (loc 61–65) is never reached — correctly dead (ADR-0007)',
  { timeout: 30_000 },
  async () => {
    if (!existsSync(RIM) || !existsSync(PDP1)) return;

    const script = buildIostubTraceScript(RIM, 5000);
    const { stdout } = await runPdp1(script, { timeout: 25_000 });
    const pcs = parseSimhHistory(stdout);
    const pcSet = new Set(pcs);

    for (const addr of SBF_ADDRS) {
      assert.ok(
        !pcSet.has(addr),
        `sbf addr ${addr.toString(8)} must NOT appear in trace (correctly dead)`,
      );
    }
  },
);

test(
  'T-IOSTUB: loc-3 jmp sbf reset vector is never reached — correctly dead (ADR-0007)',
  { timeout: 30_000 },
  async () => {
    if (!existsSync(RIM) || !existsSync(PDP1)) return;

    const script = buildIostubTraceScript(RIM, 5000);
    const { stdout } = await runPdp1(script, { timeout: 25_000 });
    const pcs = parseSimhHistory(stdout);

    assert.ok(
      !pcs.includes(LOC3_ADDR),
      `loc-3 reset vector (addr 3) must NOT appear in trace (correctly dead)`,
    );
  },
);
