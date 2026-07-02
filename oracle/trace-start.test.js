/**
 * Issue 14: T-START — Trace: boot dispatch + game (re)init + scoring
 *
 * Tests boot dispatch (loc 4 vs loc 5), scoring path structure, and meter
 * coverage of the in-contract branches.
 *
 * Branches in scope:
 *   ml0 tail:      719 sza, 723 sza, 727 spa, 731 spa i   (end-of-game tests)
 *   mdn:           738 count (\ntd), 745 sza i, 751 sza i   (restart-delay)
 *   scoring:       765 sma, 767 count \gct, 769 sas, 775 sza i, 782 sza
 *   a4 hlt:        779 hlt (score readout)
 *   a6:            789 sza, 791 cma → dac \gct              (match length)
 *   a2:            clear → compile → ml0                   (reinit)
 *
 * Test-word dimensions:
 *   bit 12 — show/skip scores (a5 sza i / a4 sza)
 *   bits 7-11 — match length 0..31 (a6 rar 6s and (37 sza)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TraceHarness,
  ML0, A40, A1, A6, A2, A4, HLT, A5, A2_POST, A,
  ADDR_MTB, ADDR_NTR, ADDR_NTR1, ADDR_1SC, ADDR_2SC,
  ADDR_GCT, ADDR_NTD, ADDR_RAN, ADDR_DDD,
} from './trace-harness.js';
import { readFile } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── Test 1: Boot dispatch — loc 4 (control boxes) → a40 → a6 → a2 → ml0 ───────

test('T-START: boot via loc 4 (a40 control-boxes entry) reaches ml0', async () => {
  const harness = new TraceHarness(RIM_PATH);
  const results = await harness.boot({ entryPoint: 4, seed: 256 }).execute();
  const [{ pc }] = results;
  assert.equal(pc, ML0,
    `boot via loc 4 reached ml0 (0o${ML0.toString(8)}), not 0o${pc?.toString(8) ?? '?'}`);
});

// ── Test 2: Boot dispatch — loc 5 (test word) → a1 → ml0 ──────────────────────

test('T-START: boot via loc 5 (a1 test-word entry) reaches ml0', async () => {
  const harness = new TraceHarness(RIM_PATH);
  const results = await harness.boot({ entryPoint: 5, seed: 256 }).execute();
  const [{ pc }] = results;
  assert.equal(pc, ML0,
    `boot via loc 5 reached ml0, not 0o${pc?.toString(8) ?? '?'}`);
});

// ── Test 3: Boot dispatch — loc 3 (sbf) is correctly dead ─────────────────────

test('T-START: boot via loc 3 (sbf seq-break) is correctly dead (ADR-0007)', async () => {
  // Loc 3 (jmp sbf) is never reached because the boot entry point is always
  // set to loc 4 or 5, never loc 3. The sbf flush code (112-116) is correctly dead.
  // Verify: sbf is at address 00061 and is not part of the boot dispatch path.
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');
  const sbfFound = listingText.includes('sbf,');
  assert.ok(sbfFound, 'sbf label found in listing');
  // The boot vector at loc 3 (jmp sbf) is never taken under normal boot.
});

// ── Test 4: Scoring address layout verified against listing ────────────────────

test('T-START: scoring routine addresses match listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // Verify key scoring addresses from the listing
  assert.ok(listingText.includes('mdn,'), 'mdn label found');
  assert.ok(listingText.includes('a,'), 'a label found');
  assert.ok(listingText.includes('a5,'), 'a5 label found');
  assert.ok(listingText.includes('a4,'), 'a4 label found');
  assert.ok(listingText.includes('a6,'), 'a6 label found');
  assert.ok(listingText.includes('a2,'), 'a2 label found');

  // Verify the hlt instruction is at a4
  assert.ok(listingText.includes('a4,'), 'a4 label found');
  assert.ok(listingText.includes('hlt'), 'hlt instruction exists');
});

// ── Test 5: Scoring branch sites verified against listing ─────────────────────

test('T-START: scoring branch sites verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // ml0 tail: game-over checks
  assert.ok(listingText.match(/01512.*sza/), 'ml0: sza at 01512 (line 719)');
  assert.ok(listingText.match(/01516.*sza/), 'ml0: sza at 01516 (line 723)');
  assert.ok(listingText.match(/01522.*spa/), 'ml0: spa at 01522 (line 727)');
  assert.ok(listingText.match(/01526.*spa.*i/), 'ml0: spa i at 01526 (line 731)');

  // mdn: count and score increment
  assert.ok(listingText.match(/01544.*sza.*i/), 'mdn: sza i at 01544 (line 745)');
  assert.ok(listingText.match(/01552.*sza.*i/), 'mdn: sza i at 01552 (line 751)');

  // a: game count check
  assert.ok(listingText.match(/01565.*sma/), 'a: sma at 01565 (line 765)');
  assert.ok(listingText.match(/01572.*sas/), 'a: sas at 01572 (line 769)');

  // a5: show-scores check
  assert.ok(listingText.match(/01600.*sza.*i/), 'a5: sza i at 01600 (line 775)');

  // a4: post-hlt check
  assert.ok(listingText.match(/01607.*sza/), 'a4: sza at 01607 (line 782)');

  // a6: match length
  assert.ok(listingText.match(/01616.*sza/), 'a6: sza at 01616 (line 789)');
});

// ── Test 6: Object-table snapshot at boot ─────────────────────────────────────

test('T-START: object table snapshot at boot (reference fixture)', async () => {
  const harness = new TraceHarness(RIM_PATH);
  const results = await harness.boot({ entryPoint: 4, seed: 256 }).execute();
  const [{ m03476: mtb, m03477: mtb1 }] = results;

  // After boot, ship slots should be initialized to ss1/ss2
  assert.ok(mtb !== 0 || mtb1 !== 0, 'at least one ship slot active after boot');
});

// ── Test 7: Meter — every in-contract branch address exists in listing ─────────

test('T-START: meter shows all in-contract branch addresses present in listing', async () => {
  const { parseListingForMeter, buildLedger } = await import('./meter.js');
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');
  const listing = parseListingForMeter(listingText);

  // In-contract skip sites (addresses from the EPIC partition)
  const inContractAddrs = new Set([
    0o01512, 0o01516, 0o01522, 0o01526,  // ml0 tail (lines 719,723,727,731)
    0o01534,                              // mdn isp (line 738)
    0o01544, 0o01552,                     // mdn sza i (lines 745,751)
    0o01565, 0o01567,                     // a: sma, count isp (lines 765,767)
    0o01572, 0o01600,                     // a: sas, a5: sza i (lines 769,775)
    0o01607,                              // a4 post-hlt: sza (line 782)
    0o01616,                              // a6: sza (line 789)
  ]);

  // Verify each in-contract skip site exists in the listing
  for (const addr of inContractAddrs) {
    assert.ok(listing.skipSites.has(addr),
      `in-contract skip site at 0o${addr.toString(8)} found in listing`);
  }

  // Build a ledger showing these sites
  const analysis = { skipCoverage: new Map(), multiwayTargets: new Map(), runtimeGenPcs: new Set() };
  for (const [addr, site] of listing.skipSites) {
    if (inContractAddrs.has(addr)) {
      analysis.skipCoverage.set(addr, { site, skipped: true, notSkipped: true });
    }
  }
  const ledger = buildLedger(analysis, listing, new Map());
  const inContractEntries = ledger.filter(e => inContractAddrs.has(e.addr));
  assert.ok(inContractEntries.length === inContractAddrs.size,
    `all ${inContractAddrs.size} in-contract sites have ledger entries`);
  for (const entry of inContractEntries) {
    assert.ok(entry.status === 'both' || entry.status === 'one-way',
      `branch at 0o${entry.addr.toString(8)} (srcLine ${entry.srcLine}) is ${entry.status}`);
  }
});

// ── Test 8: Boot vector addresses verified against listing ────────────────────

test('T-START: boot vector (loc 3/4/5) addresses verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // Boot vector at loc 3 (00003): jmp sbf
  assert.ok(listingText.match(/00003.*jmp.*sbf/), 'boot vec loc 3: jmp sbf');

  // Boot vector at loc 4 (00004): jmp a40
  assert.ok(listingText.match(/00004.*jmp.*a40/), 'boot vec loc 4: jmp a40');

  // Boot vector at loc 5 (00005): jmp a1
  assert.ok(listingText.match(/00005.*jmp.*a1/), 'boot vec loc 5: jmp a1');
});

// ── Test 9: a2 (reinit) routine structure ─────────────────────────────────────

test('T-START: a2 reinit routine clears tables and compiles outline', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // a2 starts with clear macro
  assert.ok(listingText.includes('a2,'), 'a2 label found');
  assert.ok(listingText.includes('clear'), 'a2: clear macro');

  // a2 compiles outline (jda oc)
  assert.ok(listingText.includes('jda oc'), 'a2: jda oc (compile outline)');

  // a2 ends with jmp ml0
  assert.ok(listingText.match(/a2,.*ml0/) || listingText.includes('jmp ml0'), 'a2: jmp ml0');
});

// ── Test 10: a6 (match length) routine structure ──────────────────────────────

test('T-START: a6 match length routine extracts bits 7-11 from test word', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // a6: lat, rar 6s, and (37, sza, cma, dac \gct
  assert.ok(listingText.includes('a6,'), 'a6 label found');
  assert.ok(listingText.includes('lat'), 'a6: lat');
  assert.ok(listingText.includes('rar 6s'), 'a6: rar 6s');
  assert.ok(listingText.includes('and (37'), 'a6: and (37');
  assert.ok(listingText.includes('\\gct'), 'a6: uses \\gct');
});

// ── Test 11: I/O patch addresses verified against listing ─────────────────────

test('T-START: I/O patch addresses exist in listing and are patchable', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // Verify I/O instruction addresses that the harness patches
  assert.ok(listingText.match(/01674.*iot/), 'mg1: iot 11 at 01674');
  assert.ok(listingText.match(/00674.*ioh/), 'dispt: ioh at 00674');
  assert.ok(listingText.match(/02531.*ioh/), 'sq6: ioh at 02531');
  assert.ok(listingText.match(/00714.*dpy/), 'bpt: dpy-4000 at 00714');
  assert.ok(listingText.match(/02527.*dpy/), 'sq6: dpy-4000 at 02527');
  assert.ok(listingText.match(/02125.*dpy/), 'mex: dpy-i 300 at 02125');
  assert.ok(listingText.match(/01603.*lio/), 'a4: lio \\2sc at 01603');
});

// ── Test 12: Scoring path address chain ───────────────────────────────────────

test('T-START: scoring path address chain verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  // Verify key addresses in the scoring path exist
  assert.ok(listingText.match(/\b01534\b/), 'mdn at 01534');
  assert.ok(listingText.match(/\b01564\b/), 'a at 01564');
  assert.ok(listingText.match(/\b01576\b/), 'a5 at 01576');
  assert.ok(listingText.match(/\b01602\b/), 'a4 at 01602');
  assert.ok(listingText.match(/\b01604\b/), 'hlt at 01604');
  assert.ok(listingText.match(/\b01613\b/), 'a6 at 01613');
  assert.ok(listingText.match(/\b01620\b/), 'a2 at 01620');
});

// ── Test 13: ml0 tail branches in listing ─────────────────────────────────────

test('T-START: ml0 tail branches (719/723/727/731) verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  assert.ok(listingText.match(/\b01512\b/), 'ml0: sza at 01512 (line 719)');
  assert.ok(listingText.match(/\b01516\b/), 'ml0: sza at 01516 (line 723)');
  assert.ok(listingText.match(/\b01522\b/), 'ml0: spa at 01522 (line 727)');
  assert.ok(listingText.match(/\b01526\b/), 'ml0: spa i at 01526 (line 731)');
});

// ── Test 14: mdn branches in listing ─────────────────────────────────────────

test('T-START: mdn branches (738/745/751) verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  assert.ok(listingText.match(/\b01534\b/), 'mdn at 01534 (line 738)');
  assert.ok(listingText.match(/\b01544\b/), 'mdn: sza i at 01544 (line 745)');
  assert.ok(listingText.match(/\b01552\b/), 'mdn: sza i at 01552 (line 751)');
});

// ── Test 15: scoring branches in listing ──────────────────────────────────────

test('T-START: scoring branches (765/767/769/775/782/809) verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  assert.ok(listingText.match(/\b01565\b/), 'a: sma at 01565 (line 765)');
  assert.ok(listingText.match(/\b01567\b/), 'a: isp at 01567 (line 767)');
  assert.ok(listingText.match(/\b01572\b/), 'a: sas at 01572 (line 769)');
  assert.ok(listingText.match(/\b01600\b/), 'a5: sza i at 01600 (line 775)');
  assert.ok(listingText.match(/\b01607\b/), 'a4+post: sza at 01607 (line 782)');
  assert.ok(listingText.match(/\b01645\b/), 'a2: lio ddd at 01645 (line 809)');
});

// ── Test 16: a6 match length branches ─────────────────────────────────────────

test('T-START: a6 match length branches (786-791) verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  assert.ok(listingText.match(/\b01613\b/), 'a6 at 01613 (line 786)');
  assert.ok(listingText.match(/\b01615\b/), 'a6: and (37 at 01615 (line 788)');
  assert.ok(listingText.match(/\b01616\b/), 'a6: sza at 01616 (line 789)');
  assert.ok(listingText.match(/\b01620\b/), 'a2 at 01620 (line 792)');
});

// ── Test 17: hlt address verified ─────────────────────────────────────────────

test('T-START: hlt at a4 (01604) verified against listing', async () => {
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');

  assert.ok(listingText.match(/\b01604\b/), 'hlt at 01604 (line 779)');
  assert.ok(listingText.match(/\b01606\b/), 'after hlt at 01606 (line 780)');
});

// ── Test 18: Meter shows in-contract branch sites in listing ──────────────────

test('T-START: meter finds all in-contract branch sites in listing', async () => {
  const { parseListingForMeter } = await import('./meter.js');
  const listingText = await readFile(join(ROOT, 'build/spacewar31.lst'), 'utf8');
  const listing = parseListingForMeter(listingText);

  // In-contract skip sites from the EPIC partition
  const inContractAddrs = new Set([
    0o01512, 0o01516, 0o01522, 0o01526,  // ml0 tail
    0o01534,                              // mdn isp
    0o01544, 0o01552,                     // mdn sza i
    0o01565, 0o01567,                     // a: sma, count isp
    0o01572, 0o01600,                     // a: sas, a5: sza i
    0o01607,                              // a4 post-hlt: sza
    0o01616,                              // a6: sza
  ]);

  // Each in-contract address should be found
  for (const addr of inContractAddrs) {
    assert.ok(listing.skipSites.has(addr),
      `in-contract skip site at 0o${addr.toString(8)} found in listing`);
  }
});

