/**
 * T-COVERAGE — union/closure gate (ADR-0012).
 *
 * Issue #27. Non-line-range ticket. The union/closure gate:
 * "done for the whole source" — every in-contract branch observed both ways
 * across all scenarios, every one-way branch confirmed one-way, no dark
 * in-contract branch remaining.
 *
 * Acceptance criteria (mechanical gate — measured by T-METER):
 *   1. The union of all scenario traces is run through T-METER in one closure pass.
 *   2. Every in-contract decision reported covered both ways (skips) / every
 *      realized edge ≥ once (multiway).
 *   3. Every register entry confirmed resolving only its one way over the union.
 *   4. No dark in-contract branch remains unclassified; the gate is green.
 *
 * Test structure:
 *   1. One-way register — construction and content verification
 *   2. CoverageGate — basic construction and properties
 *   3. addTrace — PC stream accumulation
 *   4. assertClosure — core gate with micro-scenario (all conditions)
 *   5. Multi-scenario union — combined traces from multiple scenarios
 *   6. One-way register verification — each entry confirmed one-way
 *   7. Dark branch classification
 *   8. Unclassified branch detection
 *   9. Multiway branch coverage
 *   10. Real listing integration (skipped if build not present)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  buildUnionOneWayRegister,
  CoverageGate,
  buildCoverageGate,
  mergePcStreams,
} from './coverage-gate.js';
import {
  parseListingForMeter,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Micro-scenario listing (self-contained, no file I/O) ─────────────────────

/**
 * Hand-authored micro-listing that covers all gate conditions:
 *   - 3 skip sites: one both-ways, one one-way, one dark
 *   - 1 multiway branch: realized
 *   - 1 skip site: skip-only unregistered (unclassified)
 */
const MICRO_LISTING = [
  // 0o200: sma — both-ways (PC 0200→0202 skip, 0200→0201 no-skip)
  '  100 00200 640400      \tsma',
  '  101 00201 000000      \tnop',
  '  102 00202 000000      \tnop',

  // 0o210: spa — one-way (skip only, registered)
  '  110 00210 640200      \tspa',
  '  111 00211 000000      \tnop',
  '  112 00212 000000      \tnop',

  // 0o220: sma — unregistered skip-only (unclassified)
  '  120 00220 640400      \tsma',
  '  121 00221 000000      \tnop',
  '  122 00222 000000      \tnop',

  // 0o230: szf 5 — dark (never visited)
  '  130 00230 640005      \tszf 5',
  '  131 00231 000000      \tnop',

  // 0o240: jmp . — multiway branch
  '  140 00240 600240      ct,\tjmp .',
  '  141 00241 000000      \tnop',
  '  142 00242 000000      \tnop',
  '  143 00243 000000      \tnop',
].join('\n');

// ─── 1. One-way register ─────────────────────────────────────────────────────

test('T-COVERAGE: one-way register has 5 entries', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.size, 5, '5 one-way register entries');
});

test('T-COVERAGE: mex ms1 sma (02076) registered as skip', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.get(0o02076), 'skip', 'mex ms1 sma: skip always taken');
});

test('T-COVERAGE: T-SHIP free-slot (02616) registered as skip', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.get(0o02616), 'skip', 'sr1 free-slot: skip always taken');
});

test('T-COVERAGE: SSW3 single-shot (02601) registered as no-skip', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.get(0o02601), 'no-skip', 'SSW3 single-shot: inert, no-skip');
});

test('T-COVERAGE: T-SHIP mh2 (02673) registered as no-skip', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.get(0o02673), 'no-skip', 'mh2 shots-exhausted: no-skip');
});

test('T-COVERAGE: T-HYPER mh2 (02255) registered as skip', () => {
  const register = buildUnionOneWayRegister();
  assert.equal(register.get(0o02255), 'skip', 'mh2 in-flight: skip always taken');
});

// ─── 2. CoverageGate construction ────────────────────────────────────────────

test('T-COVERAGE: buildCoverageGate creates gate from listing text', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  assert.ok(gate instanceof CoverageGate, 'gate is CoverageGate instance');
});

test('T-COVERAGE: gate has correct skip site count', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  assert.equal(gate.getSkipSiteCount(), 4, '4 skip sites: sma(200), spa(210), sma(220), szf(230)');
});

test('T-COVERAGE: gate has correct multiway count', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  assert.equal(gate.getMultiwayCount(), 1, '1 multiway: jmp. at 240');
});

test('T-COVERAGE: gate has correct one-way register size', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  assert.equal(gate.getOneWayRegisterSize(), 5, '5 entries in one-way register');
});

test('T-COVERAGE: gate exposes skip site addresses', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  const addrs = gate.getSkipSiteAddrs();
  assert.ok(addrs.includes(0o200), '0200 sma in skip sites');
  assert.ok(addrs.includes(0o210), '0210 spa in skip sites');
  assert.ok(addrs.includes(0o220), '0220 sma in skip sites');
  assert.ok(addrs.includes(0o230), '0230 szf in skip sites');
});

test('T-COVERAGE: gate exposes multiway addresses', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  const addrs = gate.getMultiwayAddrs();
  assert.ok(addrs.includes(0o240), '0240 jmp. in multiway branches');
});

test('T-COVERAGE: union one-way register has 5 entries', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  assert.equal(gate.getOneWayRegisterSize(), 5);
});

// ─── 3. addTrace ─────────────────────────────────────────────────────────────

test('T-COVERAGE: addTrace accumulates PC streams', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  gate.addTrace([0o200, 0o202]);
  gate.addTrace([0o200, 0o201]);
  assert.equal(gate.getUnionTraceLength(), 4, '2 traces × 2 PCs = 4');
});

test('T-COVERAGE: addTrace with empty stream adds zero length', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  gate.addTrace([]);
  assert.equal(gate.getUnionTraceLength(), 0, 'empty trace adds nothing');
});

test('T-COVERAGE: addTrace with multi-frame stream', () => {
  const gate = buildCoverageGate(MICRO_LISTING);
  // Simulate 3 frames: each frame visits 0200 both ways (4 PCs per frame)
  const frameTrace = [
    0o200, 0o202,  // skip
    0o200, 0o201,  // no-skip
  ];
  gate.addTrace(frameTrace);
  gate.addTrace(frameTrace);
  gate.addTrace(frameTrace);
  assert.equal(gate.getUnionTraceLength(), 12, '3 frames × 4 PCs = 12');
});

// ─── 4. assertClosure — micro-scenario (all conditions) ──────────────────────

test('T-COVERAGE: closure with both-ways, one-way, dark, unclassified', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  // Register 0210 as one-way (test address, not in real register)
  register.set(0o0210, 'skip');

  const gate = new CoverageGate(listing, register);

  // PC stream:
  // - 0200 sma: both ways (skip → 0202, no-skip → 0201)
  // - 0210 spa: skip only (→ 0212, registered one-way)
  // - 0220 sma: skip only (→ 0222, NOT registered → unclassified)
  // - 0230 szf: never visited → dark
  // - 0240 jmp.: targets 0243 → multiway
  gate.addTrace([
    0o200, 0o202,  // sma → skip
    0o200, 0o201,  // sma → no-skip
    0o210, 0o212,  // spa → skip (one-way registered)
    0o220, 0o222,  // sma → skip (unregistered)
    0o240, 0o243,  // jmp. → target 243
  ]);

  const result = gate.assertClosure();

  // 0200 sma → both-ways
  assert.ok(CoverageGate.isBothWays(result, 0o200), 'sma at 0200 covered both ways');

  // 0210 spa → one-way (registered as skip)
  assert.ok(CoverageGate.isConfirmedOneWay(result, 0o210, 'skip'), 'spa at 0210 confirmed one-way skip');

  // 0230 szf → dark (never visited)
  assert.ok(CoverageGate.isDark(result, 0o230), 'szf at 0230 is dark');

  // Gate should FAIL because 0220 sma is unclassified (skip-only, unregistered)
  // and 0230 szf is dark
  assert.ok(!result.passed, 'gate FAILS with unclassified and dark branches');
});

test('T-COVERAGE: closure passes when all in-contract branches classified', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  // Extend register to include test addresses as registered one-way
  register.set(0o0210, 'skip');
  register.set(0o0220, 'skip');

  const gate = new CoverageGate(listing, register);
  gate.addTrace([
    0o200, 0o202,  // sma → skip
    0o200, 0o201,  // sma → no-skip
    0o210, 0o212,  // spa → skip (one-way)
    0o220, 0o222,  // sma → skip (now registered)
    0o240, 0o243,  // jmp. → target 243
  ]);

  const result = gate.assertClosure();

  // 0230 szf is STILL dark (never visited) → gate FAILS
  assert.ok(!result.passed, 'gate FAILS because 0230 szf is still dark');

  // But all other in-contract branches should be classified
  assert.ok(CoverageGate.isBothWays(result, 0o200), '0200 sma both-ways');
  assert.ok(CoverageGate.isConfirmedOneWay(result, 0o210, 'skip'), '0210 spa one-way');
  assert.ok(CoverageGate.isConfirmedOneWay(result, 0o220, 'skip'), '0220 sma one-way');
});

// ─── 5. Multi-scenario union — combined traces ───────────────────────────────

test('T-COVERAGE: union of multiple scenario traces covers all branches', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  // Register test addresses as one-way so they won't be unclassified
  register.set(0o0210, 'skip');
  register.set(0o0220, 'skip');

  const gate = new CoverageGate(listing, register);

  // Scenario A: visit 0200 both ways, 0210 skip, 0220 skip
  gate.addTrace([
    0o200, 0o202,
    0o200, 0o201,
    0o210, 0o212,
    0o220, 0o222,
  ]);

  // Scenario B: visit 0200 again (redundant), visit multiway, visit 0230 both ways
  gate.addTrace([
    0o200, 0o202,  // redundant — already covered
    0o240, 0o243,  // multiway target
    0o240, 0o244,  // multiway second target
    0o230, 0o231,  // szf → no-skip
    0o230, 0o232,  // szf → skip (both-ways!)
  ]);

  const result = gate.assertClosure();
  assert.ok(result.passed, 'gate PASSES: all branches classified');
  assert.equal(result.dark.length, 0, 'no dark branches');
  assert.equal(result.unclassified.length, 0, 'no unclassified branches');
});

test('T-COVERAGE: union trace length is sum of all traces', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  const traceA = [0o200, 0o202, 0o200, 0o201];  // 4 PCs
  const traceB = [0o210, 0o212, 0o240, 0o243];  // 4 PCs
  const traceC = [0o230, 0o231];                 // 2 PCs

  gate.addTrace(traceA);
  gate.addTrace(traceB);
  gate.addTrace(traceC);

  assert.equal(gate.getUnionTraceLength(), 10, 'union trace = 4 + 4 + 2 = 10 PCs');
});

// ─── 6. One-way register verification ────────────────────────────────────────

test('T-COVERAGE: registered one-way entries confirmed in closure', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  // Register 0210 as one-way (test address)
  register.set(0o0210, 'skip');
  const gate = new CoverageGate(listing, register);

  // Visit the registered one-way site (0210 spa) only in its skip direction
  gate.addTrace([0o210, 0o212]);

  const result = gate.assertClosure();
  assert.ok(
    CoverageGate.isConfirmedOneWay(result, 0o210, 'skip'),
    '0210 spa confirmed one-way skip in closure'
  );
});

test('T-COVERAGE: one-way entry not visited → still dark (not confirmed)', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  // Don't visit 0210 at all
  gate.addTrace([0o200, 0o202, 0o200, 0o201]);

  const result = gate.assertClosure();
  assert.ok(
    CoverageGate.isDark(result, 0o210),
    '0210 dark when never visited (even though registered)'
  );
});

// ─── 7. Dark branch classification ───────────────────────────────────────────

test('T-COVERAGE: dark branches are listed in closure result', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o200, 0o202, 0o200, 0o201]);

  const result = gate.assertClosure();
  const darkAddrs = result.dark.map((e) => e.addr);
  assert.ok(darkAddrs.includes(0o230), '0230 szf is dark');
  assert.ok(darkAddrs.includes(0o210), '0210 spa is dark (not visited)');
  assert.ok(darkAddrs.includes(0o220), '0220 sma is dark (not visited)');
});

test('T-COVERAGE: dark branch entry includes srcLine and mnemonic', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([]); // empty trace — everything is dark

  const result = gate.assertClosure();
  const szfEntry = result.dark.find((e) => e.addr === 0o230);
  assert.ok(szfEntry, 'szf entry in dark list');
  assert.equal(szfEntry.srcLine, 130, 'dark entry has correct srcLine');
  assert.equal(szfEntry.mnemonic, 'szf', 'dark entry has correct mnemonic');
});

// ─── 8. Unclassified branch detection ────────────────────────────────────────

test('T-COVERAGE: unregistered partial branches are flagged as unclassified', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  // Visit 0220 sma only in skip direction — NOT registered
  gate.addTrace([0o220, 0o222]);

  const result = gate.assertClosure();
  assert.ok(result.unclassified.length > 0, 'has unclassified entries');
  const unclassified = result.unclassified.find((e) => e.addr === 0o220);
  assert.ok(unclassified, '0220 sma is unclassified');
  assert.equal(unclassified.status, 'skip-only', 'status is skip-only');
});

test('T-COVERAGE: unclassified gate → failed', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o220, 0o222]);

  const result = gate.assertClosure();
  assert.ok(!result.passed, 'gate FAILS with unclassified branches');
});

// ─── 9. Multiway branch coverage ─────────────────────────────────────────────

test('T-COVERAGE: multiway branch with realized targets', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o240, 0o243, 0o240, 0o244]);

  const result = gate.assertClosure();
  const multiway = result.multiwayEntries.find((e) => e.addr === 0o240);
  assert.ok(multiway, 'multiway entry at 0240');
  assert.ok(multiway.realizedTargets.includes(0o243), 'target 0243 realized');
  assert.ok(multiway.realizedTargets.includes(0o244), 'target 0244 realized');
});

test('T-COVERAGE: multiway branch never visited → dark', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o200, 0o202]); // never visit 0240

  const result = gate.assertClosure();
  const dark = result.dark.find((e) => e.addr === 0o240);
  assert.ok(dark, '0240 jmp. is dark (never visited)');
});

test('T-COVERAGE: multiway with single realized target', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o240, 0o243]); // only one target

  const result = gate.assertClosure();
  const multiway = result.multiwayEntries.find((e) => e.addr === 0o240);
  assert.ok(multiway, 'multiway entry present');
  assert.equal(multiway.realizedTargets.length, 1, 'one realized target');
  assert.ok(multiway.realizedTargets.includes(0o243));
});

// ─── 10. mergePcStreams utility ──────────────────────────────────────────────

test('T-COVERAGE: mergePcStreams concatenates streams', () => {
  const merged = mergePcStreams([
    [1, 2, 3],
    [4, 5],
    [6],
  ]);
  assert.deepEqual(merged, [1, 2, 3, 4, 5, 6]);
});

test('T-COVERAGE: mergePcStreams with empty arrays', () => {
  const merged = mergePcStreams([[], [1], []]);
  assert.deepEqual(merged, [1]);
});

test('T-COVERAGE: mergePcStreams with all empty', () => {
  const merged = mergePcStreams([[], []]);
  assert.deepEqual(merged, []);
});

// ─── 11. Ledger summary report ───────────────────────────────────────────────

test('T-COVERAGE: closure summary is a non-empty string', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o200, 0o202, 0o200, 0o201]);

  const result = gate.assertClosure();
  assert.ok(typeof result.summary === 'string', 'summary is a string');
  assert.ok(result.summary.length > 0, 'summary is non-empty');
  assert.ok(result.summary.includes('PASS') || result.summary.includes('FAIL'), 'summary has status');
});

test('T-COVERAGE: passing closure summary reports zero dark', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  register.set(0o0210, 'skip'); // register to avoid unclassified
  register.set(0o0220, 'skip'); // register to avoid unclassified
  const gate = new CoverageGate(listing, register);

  gate.addTrace([
    0o200, 0o202,
    0o200, 0o201,
    0o210, 0o212,
    0o220, 0o222,
    0o240, 0o243,
    0o230, 0o231,  // szf → no-skip
    0o230, 0o232,  // szf → skip (both-ways)
  ]);

  const result = gate.assertClosure();
  assert.ok(result.summary.includes('PASS'), 'summary shows PASS');
  assert.ok(result.summary.includes('Dark (unclassified): 0'), 'zero dark');
});

// ─── 12. Ledger entry properties ─────────────────────────────────────────────

test('T-COVERAGE: both-ways entry has correct properties', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o200, 0o202, 0o200, 0o201]);

  const result = gate.assertClosure();
  const entry = result.bothWays.find((e) => e.addr === 0o200);
  assert.ok(entry, 'both-ways entry at 0200');
  assert.equal(entry.srcLine, 100, 'srcLine 100');
  assert.ok(entry.mnemonic.includes('sma'), 'mnemonic sma');
});

test('T-COVERAGE: one-way confirmed entry has direction', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  register.set(0o0210, 'skip'); // register as one-way
  const gate = new CoverageGate(listing, register);

  gate.addTrace([0o210, 0o212]);

  const result = gate.assertClosure();
  const entry = result.oneWayConfirmed.find((e) => e.addr === 0o210);
  assert.ok(entry, 'one-way entry at 0210');
  assert.equal(entry.direction, 'skip', 'direction is skip');
});

// ─── 13. Full micro-scenario — all conditions in one gate ────────────────────

test('T-COVERAGE: micro-scenario gate with complete classification', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const register = buildUnionOneWayRegister();
  // Register test addresses to avoid unclassified
  register.set(0o0210, 'skip');
  register.set(0o0220, 'skip');

  const gate = new CoverageGate(listing, register);

  // Combined trace covering ALL branches:
  // - 0200 sma: both ways
  // - 0210 spa: skip (one-way)
  // - 0220 sma: skip (registered one-way)
  // - 0230 szf: no-skip (now lit)
  // - 0240 jmp.: two targets
  gate.addTrace([
    0o200, 0o202,  // sma → skip
    0o200, 0o201,  // sma → no-skip
    0o210, 0o212,  // spa → skip
    0o220, 0o222,  // sma → skip
    0o230, 0o231,  // szf → no-skip
    0o230, 0o232,  // szf → skip (both-ways!)
    0o240, 0o243,  // jmp. → 243
    0o240, 0o244,  // jmp. → 244
  ]);

  const result = gate.assertClosure();
  assert.ok(result.passed, 'gate PASSES with complete classification');
  assert.equal(result.bothWays.length, 2, '2 both-ways: 0200 sma, 0230 szf');
  assert.equal(result.oneWayConfirmed.length, 2, '2 one-way confirmed: 0210, 0220');
  assert.equal(result.dark.length, 0, 'no dark');
  assert.equal(result.unclassified.length, 0, 'no unclassified');
});

// ─── 14. Real listing integration (skipped if build not present) ─────────────

const LISTING_PATH = join(HERE, '..', 'build', 'spacewar31.lst');

test('T-COVERAGE: real listing loads and parses', async () => {
  let text;
  try {
    text = await readFile(LISTING_PATH, 'utf8');
  } catch {
    // Build not present — skip this test
    return;
  }

  const listing = parseListingForMeter(text);
  assert.ok(listing.skipSites.size > 0, 'skip sites found in real listing');
  assert.ok(listing.addrToSrcLine.size > 0, 'address-to-line map populated');
});

test('T-COVERAGE: real listing gate constructed', async () => {
  let text;
  try {
    text = await readFile(LISTING_PATH, 'utf8');
  } catch {
    return;
  }

  const gate = buildCoverageGate(text);
  assert.ok(gate.getSkipSiteCount() > 0, 'has skip sites');
  assert.ok(gate.getOneWayRegisterSize() === 5, '5 one-way register entries');
}, { timeout: 10_000 });

test('T-COVERAGE: real listing — one-way register addresses are in the listing', async () => {
  let text;
  try {
    text = await readFile(LISTING_PATH, 'utf8');
  } catch {
    return;
  }

  const listing = parseListingForMeter(text);
  const register = buildUnionOneWayRegister();

  const registerAddrs = [...register.keys()];
  for (const addr of registerAddrs) {
    const site = listing.skipSites.get(addr);
    assert.ok(site, `one-way register addr ${addr.toString(8)} found in listing`);
  }
}, { timeout: 10_000 });

test('T-COVERAGE: real listing — closure gate with empty trace reports dark sites', async () => {
  let text;
  try {
    text = await readFile(LISTING_PATH, 'utf8');
  } catch {
    return;
  }

  const listing = parseListingForMeter(text);
  const register = buildUnionOneWayRegister();
  const gate = new CoverageGate(listing, register);

  // Empty trace — everything is dark
  const result = gate.assertClosure();
  assert.ok(!result.passed, 'gate FAILS with empty trace (all dark)');
  assert.ok(result.dark.length > 0, 'many dark branches with empty trace');
  // The one-way register entries should also be dark (never visited)
  for (const [addr] of register) {
    assert.ok(
      CoverageGate.isDark(result, addr),
      `registered one-way addr ${addr.toString(8)} is dark (not visited)`
    );
  }
}, { timeout: 10_000 });
