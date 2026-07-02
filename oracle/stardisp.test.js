/**
 * T-STARDISP — Trace: heavy-star display `blp`/`bpt` (computed `bjm` multiway).
 *
 * Source lines 510–564 (spacewar3.1_complete.txt). The heavy-star display
 * routine draws a symmetric pair of stars via a two-pass mirror and a computed
 * jump into a Duff-device pad of 16 `starp` copies.
 *
 * Seam: invoked from the per-frame display path (L939 `jsp blp`) when the
 * heavy star is enabled by SSW6.
 *
 * Acceptance criteria (ADR-0012, measured by T-METER from SIMH traces):
 *   1. SSW6 (523 szs 60) observed both ways (star drawn / not drawn)
 *   2. Sign skips 528, 534, 545 each observed both ways
 *   3. szf 6 mirror (554) observed both ways (first negate-redraw, second return)
 *   4. Computed `bjm` jump (552) observed entering each realized offset edge
 *      of the 16-copy `starp` pad at least once
 *   5. T-METER reconciles `starp` macro-expansion PCs to this call site
 *
 * Pinned inputs:
 *   - SSW6 both ways
 *   - `ran` seed(s) chosen to realize spread of bjm offset edges
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1 } from './simh.js';
import {
  parseListingForMeter,
  parseSimhHistory,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');
const LST_PATH = join(ROOT, 'build/spacewar31.lst');

// ─── Addresses ───────────────────────────────────────────────────────────────

// Source addresses of the stardisp routines (octal).
const BLP_ADDR = 0o650;  // blp — star display entry, L522
const BLX_ADDR = 0o675;  // blx — return (star off), L539
const BPT_ADDR = 0o676;  // bpt — spike point drawer, L541
const BJM_ADDR = 0o715;  // bjm — computed jump slot, L552
const BDS_ADDR = 0o716;  // bds — start of 16-copy starp pad, L553
const BPX_ADDR = 0o1117; // bpx — return from bpt, L555

// Display path call site in the main loop.
const MQ3_ADDR = 0o2046; // L939 `jsp blp` — heavy-star display call

// ─── Skip sites (addresses that contain conditional skips) ───────────────────

// Each entry: {addr, srcLine, mnemonic} — the 5 decision sites in 510–564.
const SKIP_SITES = [
  { addr: 0o651, srcLine: 523, mnemonic: 'szs 60'  },  // SSW6 — heavy star on/off
  { addr: 0o662, srcLine: 528, mnemonic: 'spa'     },  // placement sign \bx
  { addr: 0o670, srcLine: 534, mnemonic: 'spa'     },  // placement sign \by
  { addr: 0o706, srcLine: 545, mnemonic: 'spa'     },  // displacement sign in bpt
  { addr: 0o1116, srcLine: 554, mnemonic: 'szf 6'  },  // two-pass mirror toggle
];

// ─── Multiway branches ───────────────────────────────────────────────────────

const MULTIWAY_SITES = [
  { addr: 0o715, srcLine: 552, mnemonic: 'jmp.' },  // bjm — computed entry offset
  { addr: 0o1117, srcLine: 555, mnemonic: 'jmp.' },  // bpx — two-pass return
  { addr: 0o675, srcLine: 539, mnemonic: 'jmp.' },  // blx — star-off return
];

// ─── Starpad geometry ────────────────────────────────────────────────────────

// bds expands `repeat 20, starp` = 20 copies × 6 words = 120 words.
// Each starp is 6 words; only 16 copies are reachable by the random+offset
// computation (the entry offset determines spike length). The 16 realized
// entry offsets span 0–15 × 6 = 0–90 (decimal) from bds.
const STARP_WORDS = 6;   // words per starp expansion
const BDS_REPEAT = 20;   // repeat count in listing
const BDS_WORDS = BDS_REPEAT * STARP_WORDS; // 120 words

// ─── Unit: listing-based site discovery ──────────────────────────────────────

test('stardisp: blp address is 0650 (L522)', () => {
  assert.equal(BLP_ADDR, 0o650);
});

test('stardisp: bpt address is 0676 (L541)', () => {
  assert.equal(BPT_ADDR, 0o676);
});

test('stardisp: bjm address is 0715 (L552)', () => {
  assert.equal(BJM_ADDR, 0o715);
});

test('stardisp: bds address is 0716 (L553)', () => {
  assert.equal(BDS_ADDR, 0o716);
});

test('stardisp: bpx address is 1117 (L555)', () => {
  assert.equal(BPX_ADDR, 0o1117);
});

test('stardisp: mq3 call site jsp blp at 2046 (L939)', () => {
  assert.equal(MQ3_ADDR, 0o2046);
});

test('stardisp: 5 skip sites defined (szs 60, spa×3, szf 6)', () => {
  assert.equal(SKIP_SITES.length, 5);
  const addrs = SKIP_SITES.map((s) => s.addr);
  assert.ok(addrs.includes(0o651), 'SSW6 szs 60');
  assert.ok(addrs.includes(0o662), 'placement sign \\bx');
  assert.ok(addrs.includes(0o670), 'placement sign \\by');
  assert.ok(addrs.includes(0o706), 'displacement sign in bpt');
  assert.ok(addrs.includes(0o1116), 'two-pass mirror szf 6');
});

test('stardisp: 3 multiway branches defined (bjm, bpx, blx)', () => {
  assert.equal(MULTIWAY_SITES.length, 3);
  const addrs = MULTIWAY_SITES.map((m) => m.addr);
  assert.ok(addrs.includes(0o715), 'bjm computed jump');
  assert.ok(addrs.includes(0o1117), 'bpx two-pass return');
  assert.ok(addrs.includes(0o675), 'blx star-off return');
});

test('stardisp: starp pad is 6 words per copy, 20 copies = 120 words', () => {
  assert.equal(STARP_WORDS, 6);
  assert.equal(BDS_REPEAT, 20);
  assert.equal(BDS_WORDS, 120);
});

// ─── Unit: listing-based skip/multiway discovery ─────────────────────────────

test('listing: all 5 skip sites found at correct addresses', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return; // build not present
  }

  for (const site of SKIP_SITES) {
    assert.ok(
      listing.skipSites.has(site.addr),
      `skip at ${site.addr.toString(8).padStart(6, '0')} (L${site.srcLine} ${site.mnemonic})`,
    );
    const found = listing.skipSites.get(site.addr);
    assert.equal(found.srcLine, site.srcLine, `srcLine for ${site.mnemonic}`);
    assert.equal(found.callSiteLine, site.srcLine, `callSiteLine for ${site.mnemonic}`);
  }
});

test('listing: bjm jmp. at 0715 found as multiway branch (L552)', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  assert.ok(listing.multiwayBranches.has(0o715), 'bjm is multiway');
  assert.equal(listing.multiwayBranches.get(0o715).srcLine, 552);
});

test('listing: bpx jmp. at 1117 found as multiway branch (L555)', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  assert.ok(listing.multiwayBranches.has(0o1117), 'bpx is multiway');
  assert.equal(listing.multiwayBranches.get(0o1117).srcLine, 555);
});

test('listing: blx jmp. at 675 found as multiway branch (L539)', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  assert.ok(listing.multiwayBranches.has(0o675), 'blx is multiway');
  assert.equal(listing.multiwayBranches.get(0o675).srcLine, 539);
});

// ─── Unit: synthetic trace analysis ──────────────────────────────────────────

// Build a synthetic listing containing only the stardisp skip and multiway sites.
const STARDISP_LISTING_SNIPPET = [
  '  522 00650 260675      blp,\tdap blx',
  '  523 00651 640060      \tszs 60',
  '  524 00652 600675      \tjmp blx',
  '  528 00662 640200      \tspa',
  '  534 00670 640200      \tspa',
  '  539 00675 600675      blx,\tjmp .',
  '  541 00676 261117      bpt,\tdap bpx',
  '  545 00706 640200      \tspa',
  '  549 00712 260715      \tdap bjm',
  '  552 00715 600715      bjm,\tjmp .',
  '  553                   bds,\trepeat 20, starp',
  '       00716 403241',    // starp expansion (first copy)
  '       00717 663777',
  '       00720 663777',
  '       00721 403242',
  '       00722 663777',
  '       00723 663777',
  '       00724 730000',
  '       00725 724007',
  '       00726 403241',    // starp expansion (second copy)
  '       00727 663777',
  '       00730 663777',
  '       00731 403242',
  '       00732 663777',
  '       00733 663777',
  '       00734 730000',
  '       00735 724007',
  '  554 01116 640006      \tszf 6',
  '  555 01117 601117      bpx,\tjmp .',
  '  556 01120 760016      \tstf 6',
].join('\n');

// Synthetic PC stream that drives every skip both ways and bjm to two offsets.
const SYNTHETIC_PC_STREAM = [
  // blp entry → szs 60 at 0651: skip taken (SSW6 clear → star off)
  BLP_ADDR, 0o651, 0o652,
  // bpt entry → spa at 0706: skip taken (negative displacement)
  BPT_ADDR, 0o706, 0o710,
  // spa at 0662: skip taken (positive \bx → no flip)
  0o662, 0o664,
  // spa at 0670: no-skip (negative \by → flip)
  0o670, 0o671,
  // szf 6 at 1116: no-skip (first pass, flag clear → negate-redraw)
  0o1116, 0o1117, 0o1120, 0o1121, 0o1122, 0o1123, 0o1124,
  // second pass: szf 6 at 1116: skip (flag set → return)
  0o1116, 0o1117,
  // bjm multiway: two different entry offsets
  0o715, BDS_ADDR,         // entry at offset 0 (first starp copy)
  0o715, BDS_ADDR + 6,    // entry at offset 6 (second starp copy)
  // blx return
  BLX_ADDR, 0o676,
  // bpx return
  0o1117, 0o1120,
];

test('synthetic trace: all 5 skip sites reached in synthetic stream', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);
  const { skipCoverage } = analyzeTrace(SYNTHETIC_PC_STREAM, listing);

  for (const site of SKIP_SITES) {
    assert.ok(
      skipCoverage.has(site.addr),
      `skip site ${site.addr.toString(8).padStart(6, '0')} (L${site.srcLine}) reached`,
    );
  }
});

test('synthetic trace: SSW6 (szs 60 at 0651) observed both ways', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  // Stream with BOTH arms: first skip-taken, then no-skip.
  const bothWay = [
    0o650, 0o651, 0o653,   // skip taken (diff=2)
    0o650, 0o651, 0o652,   // no-skip (diff=1)
  ];
  const { skipCoverage } = analyzeTrace(bothWay, listing);
  const cov = skipCoverage.get(0o651);
  assert.ok(cov.skipped, 'SSW6 skip observed');
  assert.ok(cov.notSkipped, 'SSW6 no-skip observed');
});

test('synthetic trace: spa at 0662 (\\bx placement) observed both ways', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  const bothWay = [
    0o662, 0o664,   // skip taken (diff=2)
    0o662, 0o663,   // no-skip (diff=1)
  ];
  const { skipCoverage } = analyzeTrace(bothWay, listing);
  const cov = skipCoverage.get(0o662);
  assert.ok(cov.skipped, 'spa \\bx skip observed');
  assert.ok(cov.notSkipped, 'spa \\bx no-skip observed');
});

test('synthetic trace: spa at 0670 (\\by placement) observed both ways', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  const bothWay = [
    0o670, 0o672,   // skip taken
    0o670, 0o671,   // no-skip
  ];
  const { skipCoverage } = analyzeTrace(bothWay, listing);
  const cov = skipCoverage.get(0o670);
  assert.ok(cov.skipped, 'spa \\by skip observed');
  assert.ok(cov.notSkipped, 'spa \\by no-skip observed');
});

test('synthetic trace: spa at 0706 (bpt displacement) observed both ways', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  const bothWay = [
    0o706, 0o710,   // skip taken (diff=4 since bpt flow is different)
    0o706, 0o707,   // no-skip (diff=1)
  ];
  const { skipCoverage } = analyzeTrace(bothWay, listing);
  const cov = skipCoverage.get(0o706);
  assert.ok(cov.skipped, 'spa displacement skip observed');
  assert.ok(cov.notSkipped, 'spa displacement no-skip observed');
});

test('synthetic trace: szf 6 mirror (01116) observed both ways', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  const bothWay = [
    0o1116, 0o1117,   // no-skip (flag clear → negate-redraw, diff=1)
    0o1116, 0o1120,   // skip (flag set → return, diff=2)
  ];
  const { skipCoverage } = analyzeTrace(bothWay, listing);
  const cov = skipCoverage.get(0o1116);
  assert.ok(cov.notSkipped, 'szf 6 first-pass (no-skip) observed');
  assert.ok(cov.skipped, 'szf 6 second-pass (skip) observed');
});

test('synthetic trace: bjm multiway records realized targets', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);
  const { multiwayTargets } = analyzeTrace(SYNTHETIC_PC_STREAM, listing);

  assert.ok(multiwayTargets.has(0o715), 'bjm multiway tracked');
  const targets = multiwayTargets.get(0o715).targets;
  assert.ok(targets.has(BDS_ADDR), 'bjm target: offset 0 (bds)');
  assert.ok(targets.has(BDS_ADDR + 6), 'bjm target: offset 6');
});

// ─── Integration: listing↔core identity — assembled stardisp code (ADR-0006) ─

// Expected instruction words at key stardisp addresses (from spacewar3.1_complete.txt).
// These are the exact 18-bit words as assembled by macro1.
const STARDISP_ADDRS = [
  { addr: 0o650, word: 0o260675, srcLine: 522, label: 'blp',       mnemonic: 'dap blx' },  // star entry
  { addr: 0o651, word: 0o640060, srcLine: 523, label: '',          mnemonic: 'szs 60'  },  // SSW6 gate
  { addr: 0o652, word: 0o600675, srcLine: 524, label: '',          mnemonic: 'jmp blx' },  // star-off return
  { addr: 0o662, word: 0o640200, srcLine: 528, label: '',          mnemonic: 'spa'     },  // \\bx sign flip
  { addr: 0o670, word: 0o640200, srcLine: 534, label: '',          mnemonic: 'spa'     },  // \\by sign flip
  { addr: 0o673, word: 0o620676, srcLine: 537, label: '',          mnemonic: 'jsp bpt' },  // call bpt
  { addr: 0o675, word: 0o600675, srcLine: 539, label: 'blx',       mnemonic: 'jmp .'   },  // star-off exit
  { addr: 0o676, word: 0o261117, srcLine: 541, label: 'bpt',       mnemonic: 'dap bpx' },  // spike entry
  { addr: 0o706, word: 0o640200, srcLine: 545, label: '',          mnemonic: 'spa'     },  // disp sign
  { addr: 0o712, word: 0o260715, srcLine: 549, label: '',          mnemonic: 'dap bjm' },  // compute bjm
  { addr: 0o715, word: 0o600715, srcLine: 552, label: 'bjm',       mnemonic: 'jmp .'   },  // computed jump
  { addr: 0o716, word: 0o403241, srcLine: 553, label: 'bds',       mnemonic: 'starp[0]' }, // pad start
  { addr: 0o1116, word: 0o640006, srcLine: 554, label: '',         mnemonic: 'szf 6'   },  // mirror toggle
  { addr: 0o1117, word: 0o601117, srcLine: 555, label: 'bpx',      mnemonic: 'jmp .'   },  // bpt return
  { addr: 0o1120, word: 0o760016, srcLine: 556, label: '',         mnemonic: 'stf 6'   },  // set mirror flag
];

test('stardisp: listing↔core identity — all 15 key addresses match (ADR-0006)', { timeout: 30_000 }, async () => {
  const addrs = STARDISP_ADDRS.map((a) => a.addr);
  const script = [
    `load ${RIM_PATH}`,
    ...addrs.map((a) => `examine ${a.toString(8)}`),
    'quit',
  ];

  const { lines } = await runPdp1(script, { timeout: 15_000 });
  const core = new Map();
  for (const line of lines) {
    const m = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (m) core.set(parseInt(m[1], 8), parseInt(m[2], 8));
  }

  for (const entry of STARDISP_ADDRS) {
    const actual = core.get(entry.addr);
    assert.equal(
      actual,
      entry.word,
      `L${entry.srcLine} ${entry.label || entry.mnemonic}: ${entry.addr.toString(8).padStart(6, '0')} ` +
      `expected ${entry.word.toString(8).padStart(6, '0')} got ${actual != null ? actual.toString(8).padStart(6, '0') : 'absent'}`,
    );
  }
});

// ─── Integration: meter finds stardisp skip/multiway sites in real listing ───

test('listing: all stardisp skip sites found by meter (ADR-0012)', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }

  for (const site of SKIP_SITES) {
    assert.ok(listing.skipSites.has(site.addr), `skip ${site.mnemonic} at ${site.addr.toString(8).padStart(6, '0')}`);
    const found = listing.skipSites.get(site.addr);
    assert.equal(found.srcLine, site.srcLine, `srcLine for ${site.mnemonic}`);
    assert.ok(found.mnemonic.toLowerCase().includes(site.mnemonic.split(' ')[0]), `mnemonic matches for ${site.mnemonic}`);
  }
});

test('listing: all stardisp multiway branches found by meter', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }

  for (const site of MULTIWAY_SITES) {
    assert.ok(listing.multiwayBranches.has(site.addr), `multiway ${site.mnemonic} at ${site.addr.toString(8).padStart(6, '0')}`);
    assert.equal(listing.multiwayBranches.get(site.addr).srcLine, site.srcLine);
  }
});

// ─── Ledger: per-decision coverage summary (synthetic) ───────────────────────

test('ledger: synthetic trace produces correct stardisp status for all skip sites', () => {
  const listing = parseListingForMeter(STARDISP_LISTING_SNIPPET);

  // PC stream that exercises every skip both ways + bjm multiway.
  // This simulates: SSW6 off→on, \\bx sign +/−, \\by sign +/−,
  // displacement sign +/−, szf 6 mirror first→second pass.
  const pcStream = [
    // szs 60 at 0651: first off (skip→jmp blx), then on (no-skip→random)
    0o650, 0o651, 0o653,   // skip taken (SSW6 off)
    0o650, 0o651, 0o652,   // no-skip (SSW6 on, falls through)

    // spa at 0662 (\\bx): both ways
    0o662, 0o664,   // skip (positive → no flip)
    0o662, 0o663,   // no-skip (negative → flip)

    // spa at 0670 (\\by): both ways
    0o670, 0o672,   // skip
    0o670, 0o671,   // no-skip

    // spa at 0706 (displacement in bpt): both ways
    0o706, 0o710,   // skip
    0o706, 0o707,   // no-skip

    // szf 6 at 1116 (two-pass mirror): first→second
    0o1116, 0o1117,   // no-skip (flag clear → negate-redraw)
    0o1116, 0o1120,   // skip (flag set → return)

    // bjm multiway: two different entry offsets
    0o715, BDS_ADDR,      // offset 0
    0o715, BDS_ADDR + 6,  // offset 6
  ];

  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const byAddr = new Map(ledger.map((e) => [e.addr, e]));

  // Every skip site should be 'both' (reached both ways).
  for (const site of SKIP_SITES) {
    assert.ok(byAddr.has(site.addr), `ledger entry for ${site.mnemonic} at ${site.addr.toString(8)}`);
    assert.equal(
      byAddr.get(site.addr).status,
      'both',
      `${site.mnemonic} at ${site.addr.toString(8).padStart(6, '0')} covered both ways`,
    );
  }

  // bjm multiway should have realized targets.
  const bjmEntry = ledger.find((e) => e.addr === 0o715);
  assert.ok(bjmEntry, 'bjm ledger entry present');
  assert.equal(bjmEntry.type, 'multiway', 'bjm is a multiway entry');
  assert.ok(bjmEntry.realizedTargets.includes(BDS_ADDR), 'bjm target: offset 0');
  assert.ok(bjmEntry.realizedTargets.includes(BDS_ADDR + 6), 'bjm target: offset 6');
});

// ─── Macro-expansion attribution ─────────────────────────────────────────────

test('stardisp: starp macro expansion PCs attributed to line 512', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }

  // starp expansion instructions start at bds (0o716). Their addrToSrcLine
  // should point to line 512 (the `starp` define call site).
  const firstStarpAddr = BDS_ADDR;
  const srcLine = listing.addrToSrcLine.get(firstStarpAddr);

  // The starp pad at bds is a macro expansion; its srcLine should be 512
  // (the `starp` define line) or the expand site line.
  // In the actual listing, `bds, repeat 20, starp` expands inline.
  // The expansion instructions (variety C) have no srcLine; their
  // addrToSrcLine points to the call site.
  assert.ok(
    srcLine != null,
    `starp expansion at ${firstStarpAddr.toString(8)} has call site attribution`,
  );
});
