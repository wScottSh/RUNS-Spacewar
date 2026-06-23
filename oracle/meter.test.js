/**
 * T-METER — coverage meter tests.
 * Pure-function tests over hand-authored listing snippets and PC streams.
 * No SIMH required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSkipWord,
  skipMnemonicFromWord,
  isJmpDot,
  parseListingForMeter,
  parseSimhHistory,
  analyzeTrace,
  buildLedger,
  RUNTIME_GEN_LOW,
  RUNTIME_GEN_HIGH,
} from './meter.js';

// ─── isSkipWord ───────────────────────────────────────────────────────────────

test('isSkipWord: spa (640200) is a skip', () => {
  assert.ok(isSkipWord(0o640200));
});
test('isSkipWord: sma (640400) is a skip', () => {
  assert.ok(isSkipWord(0o640400));
});
test('isSkipWord: sza (640100) is a skip', () => {
  assert.ok(isSkipWord(0o640100));
});
test('isSkipWord: spi (642000) is a skip', () => {
  assert.ok(isSkipWord(0o642000));
});
test('isSkipWord: szs 40 (640040) is a skip', () => {
  assert.ok(isSkipWord(0o640040));
});
test('isSkipWord: szs 60 (640060) is a skip', () => {
  assert.ok(isSkipWord(0o640060));
});
test('isSkipWord: szf 6 (640006) is a skip', () => {
  assert.ok(isSkipWord(0o640006));
});
test('isSkipWord: szf 5 (640005) is a skip', () => {
  assert.ok(isSkipWord(0o640005));
});
test('isSkipWord: szm (640500) is a skip (sza|sma compound)', () => {
  assert.ok(isSkipWord(0o640500));
});
test('isSkipWord: spq=szm i (650500) is a skip (indirect OPR skip)', () => {
  assert.ok(isSkipWord(0o650500));
});
test('isSkipWord: sza i (650100) is a skip', () => {
  assert.ok(isSkipWord(0o650100));
});
test('isSkipWord: isp (460304) is a skip', () => {
  assert.ok(isSkipWord(0o460304));
});
test('isSkipWord: isp i (473246) is a skip', () => {
  assert.ok(isSkipWord(0o473246));
});
test('isSkipWord: sas (523256) is a skip', () => {
  assert.ok(isSkipWord(0o523256));
});
test('isSkipWord: sad i (513246) is a skip', () => {
  assert.ok(isSkipWord(0o513246));
});
test('isSkipWord: jmp (600061) is NOT a skip', () => {
  assert.ok(!isSkipWord(0o600061));
});
test('isSkipWord: hlt (760400) is NOT a skip', () => {
  assert.ok(!isSkipWord(0o760400));
});
test('isSkipWord: lac (207700) is NOT a skip', () => {
  assert.ok(!isSkipWord(0o207700));
});
test('isSkipWord: dac (243275) is NOT a skip', () => {
  assert.ok(!isSkipWord(0o243275));
});
test('isSkipWord: sar 4s (675017) is NOT a skip (shift, not OPR skip)', () => {
  assert.ok(!isSkipWord(0o675017));
});

// ─── skipMnemonicFromWord ────────────────────────────────────────────────────

test('skipMnemonicFromWord: spa → "spa"', () => {
  assert.match(skipMnemonicFromWord(0o640200), /spa/);
});
test('skipMnemonicFromWord: sma → contains "sma"', () => {
  assert.match(skipMnemonicFromWord(0o640400), /sma/);
});
test('skipMnemonicFromWord: isp → "isp"', () => {
  assert.equal(skipMnemonicFromWord(0o460304), 'isp');
});
test('skipMnemonicFromWord: isp i → "isp i"', () => {
  assert.equal(skipMnemonicFromWord(0o473246), 'isp i');
});
test('skipMnemonicFromWord: sas → "sas"', () => {
  assert.equal(skipMnemonicFromWord(0o523256), 'sas');
});
test('skipMnemonicFromWord: sad i → "sad i"', () => {
  assert.equal(skipMnemonicFromWord(0o513246), 'sad i');
});

// ─── isJmpDot ────────────────────────────────────────────────────────────────

test('isJmpDot: bjm jmp . at 00715 (600715)', () => {
  assert.ok(isJmpDot(0o600715, 0o715));
});
test('isJmpDot: dispatch expansion jmp . at 00443 (600443)', () => {
  assert.ok(isJmpDot(0o600443, 0o443));
});
test('isJmpDot: jmp to other address is NOT jmp.', () => {
  assert.ok(!isJmpDot(0o600261, 0o255));  // jmp sq3 from sqt
});
test('isJmpDot: jmp to self at 00260 (sqx)', () => {
  assert.ok(isJmpDot(0o600260, 0o260));  // sqx, jmp .
});

// ─── parseListingForMeter ────────────────────────────────────────────────────

// Minimal listing snippet exercising regular instructions
const LISTING_REGULAR = [
  '  210 00077 640200      \tspa',
  '  213 00102 640400      \tsma',
  '  317 00255 460304      sq3,\tisp sq1',
  '  318 00256 600261      \tjmp .+3',
].join('\n');

test('parseListingForMeter: finds spa at addr 0o77', () => {
  const { skipSites } = parseListingForMeter(LISTING_REGULAR);
  assert.ok(skipSites.has(0o77), 'spa at addr 077');
  assert.equal(skipSites.get(0o77).srcLine, 210);
  assert.match(skipSites.get(0o77).mnemonic, /spa/);
});

test('parseListingForMeter: finds sma at addr 0o102', () => {
  const { skipSites } = parseListingForMeter(LISTING_REGULAR);
  assert.ok(skipSites.has(0o102));
  assert.equal(skipSites.get(0o102).srcLine, 213);
});

test('parseListingForMeter: finds isp at addr 0o255', () => {
  const { skipSites } = parseListingForMeter(LISTING_REGULAR);
  assert.ok(skipSites.has(0o255));
  assert.equal(skipSites.get(0o255).srcLine, 317);
  assert.match(skipSites.get(0o255).mnemonic, /isp/);
});

test('parseListingForMeter: regular jmp NOT in skipSites', () => {
  const { skipSites } = parseListingForMeter(LISTING_REGULAR);
  assert.ok(!skipSites.has(0o256));  // jmp .+3 is not a skip
});

// Regular instruction callSiteLine == srcLine (not a macro expansion)
test('parseListingForMeter: regular skip has callSiteLine == srcLine', () => {
  const { skipSites } = parseListingForMeter(LISTING_REGULAR);
  const site = skipSites.get(0o77);
  assert.equal(site.callSiteLine, site.srcLine);
});

// Macro expansion attribution: ranct sma at 02541 → call site 1218
const LISTING_MACRO_EXPANSION = [
  ' 1218                   \tranct sar 9s, sar 4s, \\src',
  '      02532 200031',
  '      02533 671001',
  '      02534 063050',
  '      02535 403050',
  '      02536 240031',
  '      02537 675777',
  '      02540 675017',
  '      02541 640400',  // sma (0o640400)
  '      02542 761000',
  '      02543 243275',
  ' 1219 02544 223266      \tlio \\scw',
].join('\n');

test('parseListingForMeter: macro expansion sma attributed to call site 1218', () => {
  const { skipSites } = parseListingForMeter(LISTING_MACRO_EXPANSION);
  assert.ok(skipSites.has(0o2541), 'sma at 02541 found');
  const site = skipSites.get(0o2541);
  assert.equal(site.srcLine, 1218, 'srcLine = call site 1218');
  assert.equal(site.callSiteLine, 1218, 'callSiteLine = 1218');
});

test('parseListingForMeter: instruction after macro expansion NOT attributed to macro', () => {
  const { skipSites, addrToSrcLine } = parseListingForMeter(LISTING_MACRO_EXPANSION);
  // lio \scw at 02544 is a regular instruction (srcLine=1219)
  assert.equal(addrToSrcLine.get(0o2544), 1219);
  // it's not a skip
  assert.ok(!skipSites.has(0o2544));
});

// dispatch macro expansion — jmp . at 00443 is a multiway branch
const LISTING_DISPATCH = [
  '  440                   \tdispatch',
  '      00441 403004',
  '      00442 260443',
  '      00443 600443',  // jmp . at 00443
  '  441 00444 760000      \topr',
].join('\n');

test('parseListingForMeter: dispatch jmp. at 00443 in multiwayBranches', () => {
  const { multiwayBranches } = parseListingForMeter(LISTING_DISPATCH);
  assert.ok(multiwayBranches.has(0o443));
  assert.equal(multiwayBranches.get(0o443).srcLine, 440);
});

test('parseListingForMeter: dispatch jmp. NOT in skipSites', () => {
  const { skipSites } = parseListingForMeter(LISTING_DISPATCH);
  assert.ok(!skipSites.has(0o443));
});

// bjm, jmp . at 00715 is a multiway branch (labeled)
const LISTING_BJM = [
  '  549 00712 260715      \tdap bjm',
  '  552 00715 600715      bjm,\tjmp .',
].join('\n');

test('parseListingForMeter: bjm jmp. at 00715 in multiwayBranches', () => {
  const { multiwayBranches } = parseListingForMeter(LISTING_BJM);
  assert.ok(multiwayBranches.has(0o715));
  assert.equal(multiwayBranches.get(0o715).srcLine, 552);
});

// ─── parseSimhHistory ────────────────────────────────────────────────────────

test('parseSimhHistory: extracts PC values from SIMH history output', () => {
  const historyText = [
    'CPU instruction history:',
    'PC      OV  EA      AC      IO',
    '000255  0   000304  000000  000000',
    '000256  0   000261  000000  000000',
    '000261  0   000305  000000  000000',
    '',
  ].join('\n');
  const pcs = parseSimhHistory(historyText);
  assert.deepEqual(pcs, [0o255, 0o256, 0o261]);
});

test('parseSimhHistory: ignores non-PC lines', () => {
  const pcs = parseSimhHistory('CPU instruction history:\nPC      OV  EA\n');
  assert.deepEqual(pcs, []);
});

// ─── analyzeTrace ─────────────────────────────────────────────────────────────

// Listing with one sma at 0o102 and one jmp. (multiway) at 0o443
const LISTING_FOR_ANALYSIS = [
  '  213 00102 640400      \tsma',
  '  210 00077 640200      \tspa',
  '      00443 600443',  // dispatch jmp . — treated as expansion of the preceding call site
  '  440 00444 760000      \topr',
].join('\n');

// We need the dispatch call site to appear before the jmp. expansion.
// Let me use a better listing that properly has the dispatch expansion:
const LISTING_WITH_DISPATCH = [
  '  213 00102 640400      \tsma',
  '  440                   \tdispatch',
  '      00441 403004',
  '      00442 260443',
  '      00443 600443',
  '  441 00444 760000      \topr',
].join('\n');

test('analyzeTrace: sma skip-taken (PC+2) recorded as skipped', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  // PC stream: 0102 → 0104 (diff=2, skip taken)
  const { skipCoverage } = analyzeTrace([0o102, 0o104], listing);
  const cov = skipCoverage.get(0o102);
  assert.ok(cov, 'coverage entry exists');
  assert.ok(cov.skipped, 'skip was taken');
  assert.ok(!cov.notSkipped, 'no-skip was NOT observed');
});

test('analyzeTrace: sma no-skip (PC+1) recorded as notSkipped', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  // PC stream: 0102 → 0103 (diff=1, no skip)
  const { skipCoverage } = analyzeTrace([0o102, 0o103], listing);
  const cov = skipCoverage.get(0o102);
  assert.ok(cov);
  assert.ok(!cov.skipped, 'skip was NOT observed');
  assert.ok(cov.notSkipped, 'no-skip was observed');
});

test('analyzeTrace: covered both-ways after two passes', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  // First pass: skip taken; second pass: not taken
  const pcStream = [0o100, 0o102, 0o104, 0o100, 0o102, 0o103, 0o105];
  const { skipCoverage } = analyzeTrace(pcStream, listing);
  const cov = skipCoverage.get(0o102);
  assert.ok(cov.skipped, 'skip observed');
  assert.ok(cov.notSkipped, 'no-skip observed');
});

test('analyzeTrace: site never visited → no coverage entry', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const { skipCoverage } = analyzeTrace([0o100, 0o101], listing);
  assert.ok(!skipCoverage.has(0o102), 'no coverage entry for unvisited site');
});

test('analyzeTrace: multiway branch records realized targets', () => {
  const listing = parseListingForMeter(LISTING_WITH_DISPATCH);
  // dispatch jmp. at 00443, targets 00445 and 00557
  const pcStream = [0o440, 0o441, 0o442, 0o443, 0o445, 0o441, 0o442, 0o443, 0o557];
  const { multiwayTargets } = analyzeTrace(pcStream, listing);
  assert.ok(multiwayTargets.has(0o443), 'jmp. at 00443 tracked');
  const targets = multiwayTargets.get(0o443).targets;
  assert.ok(targets.has(0o445), 'target 00445 recorded');
  assert.ok(targets.has(0o557), 'target 00557 recorded');
});

test('analyzeTrace: runtime-generated PCs flagged', () => {
  const listing = parseListingForMeter('');
  // PC in runtime-generated range [RUNTIME_GEN_LOW, RUNTIME_GEN_HIGH]
  const genPc = RUNTIME_GEN_LOW + 5;
  const { runtimeGenPcs } = analyzeTrace([genPc], listing);
  assert.ok(runtimeGenPcs.has(genPc), 'runtime-gen PC flagged');
});

test('analyzeTrace: PC below RUNTIME_GEN_LOW not flagged as runtime-generated', () => {
  const listing = parseListingForMeter('');
  const { runtimeGenPcs } = analyzeTrace([RUNTIME_GEN_LOW - 1], listing);
  assert.ok(!runtimeGenPcs.has(RUNTIME_GEN_LOW - 1));
});

test('analyzeTrace: PC above RUNTIME_GEN_HIGH not flagged as runtime-generated', () => {
  const listing = parseListingForMeter('');
  const { runtimeGenPcs } = analyzeTrace([RUNTIME_GEN_HIGH + 1], listing);
  assert.ok(!runtimeGenPcs.has(RUNTIME_GEN_HIGH + 1));
});

// ─── buildLedger ─────────────────────────────────────────────────────────────

test('buildLedger: both-ways status when skip goes both ways', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o102, 0o104, 0o102, 0o103];
  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.ok(entry, 'ledger entry for sma');
  assert.equal(entry.status, 'both');
});

test('buildLedger: skip-only when only skip direction observed', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o102, 0o104];
  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.equal(entry.status, 'skip-only');
});

test('buildLedger: no-skip-only when only no-skip direction observed', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o102, 0o103];
  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.equal(entry.status, 'no-skip-only');
});

test('buildLedger: dark when site never visited', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o100, 0o101];
  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.ok(entry, 'dark entry still appears in ledger');
  assert.equal(entry.status, 'dark');
});

// One-way register: a registered skip-only branch is "one-way", not a gap
test('buildLedger: registered skip-only → "one-way"', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o102, 0o104];  // only skip taken
  const analysis = analyzeTrace(pcStream, listing);
  const oneWayRegister = new Map([[0o102, 'skip']]);
  const ledger = buildLedger(analysis, listing, oneWayRegister);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.equal(entry.status, 'one-way');
});

// One-way register: a registered no-skip-only branch is "one-way"
test('buildLedger: registered no-skip-only → "one-way"', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [0o102, 0o103];  // only no-skip taken
  const analysis = analyzeTrace(pcStream, listing);
  const oneWayRegister = new Map([[0o102, 'no-skip']]);
  const ledger = buildLedger(analysis, listing, oneWayRegister);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.equal(entry.status, 'one-way');
});

// Registered but dark → still dark (never reached = can't confirm even one-way)
test('buildLedger: registered but dark → "dark"', () => {
  const listing = parseListingForMeter('  213 00102 640400      \tsma\n');
  const pcStream = [];
  const analysis = analyzeTrace(pcStream, listing);
  const oneWayRegister = new Map([[0o102, 'skip']]);
  const ledger = buildLedger(analysis, listing, oneWayRegister);
  const entry = ledger.find((e) => e.addr === 0o102);
  assert.equal(entry.status, 'dark');
});

// Multiway branch entry in ledger
test('buildLedger: multiway branch gets "multiway" type entry', () => {
  const listing = parseListingForMeter(LISTING_WITH_DISPATCH);
  const pcStream = [0o443, 0o445];
  const analysis = analyzeTrace(pcStream, listing);
  const ledger = buildLedger(analysis, listing);
  const entry = ledger.find((e) => e.addr === 0o443);
  assert.ok(entry, 'multiway entry present');
  assert.equal(entry.type, 'multiway');
  assert.ok(Array.isArray(entry.realizedTargets));
  assert.ok(entry.realizedTargets.includes(0o445));
});

// ─── Calibration ─────────────────────────────────────────────────────────────

// Hand-authored micro-scenario with independently-known expected ledger:
// - Two skip sites: sma at 0o200 (goes both ways) and spa at 0o210 (skip-only)
// - One one-way site: isp at 0o220, registered as skip-only
// - One dark site: szf at 0o230, never visited
// - One multiway branch: jmp . at 0o240 (targets 0o245 and 0o250)
//
// This is the calibration scenario. The meter must produce the exact expected ledger.

const MICRO_LISTING = [
  '  100 00200 640400      \tsma',
  '  101 00201 000000      \tnop',
  '  102 00202 000000      \tnop',
  '  103 00210 640200      \tspa',
  '  104 00211 000000      \tnop',
  '  105 00212 000000      \tnop',
  '  106 00220 460230      \tisp counter',
  '  107 00221 000000      \tnop',
  '  108 00222 000000      \tnop',
  '  109 00230 640005      \tszf 5',
  '  110 00231 000000      \tnop',
  '  111 00232 000000      \tnop',
  '  112 00240 600240      ct,\tjmp .',
].join('\n');

// PC stream driving the calibration scenario:
// - sma at 0200: first visit → skip (→ 0202), second visit → no-skip (→ 0201) → BOTH
// - spa at 0210: only visit → skip (→ 0212) → SKIP-ONLY
// - isp at 0220: only visit → skip (→ 0222) → registered ONE-WAY
// - szf at 0230: never visited → DARK
// - jmp. at 0240: two visits → targets 0245 and 0250 → MULTIWAY
const MICRO_PC_STREAM = [
  0o200, 0o202,   // sma → skip
  0o200, 0o201,   // sma → no-skip
  0o210, 0o212,   // spa → skip
  0o220, 0o222,   // isp → skip
  0o240, 0o245,   // jmp. → target 245
  0o240, 0o250,   // jmp. → target 250
];

const ONE_WAY_REGISTER = new Map([[0o220, 'skip']]);

test('calibration: micro-scenario produces correct ledger', () => {
  const listing = parseListingForMeter(MICRO_LISTING);
  const analysis = analyzeTrace(MICRO_PC_STREAM, listing);
  const ledger = buildLedger(analysis, listing, ONE_WAY_REGISTER);

  const byAddr = new Map(ledger.map((e) => [e.addr, e]));

  // sma at 0200 → both
  const sma = byAddr.get(0o200);
  assert.ok(sma, 'sma entry present');
  assert.equal(sma.status, 'both', 'sma covered both ways');
  assert.equal(sma.srcLine, 100);

  // spa at 0210 → skip-only
  const spa = byAddr.get(0o210);
  assert.ok(spa, 'spa entry present');
  assert.equal(spa.status, 'skip-only', 'spa skip-only');

  // isp at 0220 → one-way (registered)
  const isp = byAddr.get(0o220);
  assert.ok(isp, 'isp entry present');
  assert.equal(isp.status, 'one-way', 'isp correctly one-way');

  // szf at 0230 → dark
  const szf = byAddr.get(0o230);
  assert.ok(szf, 'szf entry present');
  assert.equal(szf.status, 'dark', 'szf dark (never visited)');

  // jmp. at 0240 → multiway with targets 0245 and 0250
  const mw = byAddr.get(0o240);
  assert.ok(mw, 'multiway entry present');
  assert.equal(mw.type, 'multiway');
  assert.ok(mw.realizedTargets.includes(0o245), 'target 0245 recorded');
  assert.ok(mw.realizedTargets.includes(0o250), 'target 0250 recorded');
});

// ─── Integration: parse real spacewar listing ─────────────────────────────────

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

test('real listing: sqt skip sites found at correct addresses', async () => {
  let listing;
  try {
    const text = await readFile(join(HERE, '..', 'build', 'spacewar31.lst'), 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    // Build not present — skip this test
    return;
  }
  const { skipSites, multiwayBranches } = listing;

  // sqt skip sites (from the listing):
  assert.ok(skipSites.has(0o255), 'isp sq1 at 00255');
  assert.match(skipSites.get(0o255).mnemonic, /isp/);
  assert.equal(skipSites.get(0o255).srcLine, 317);

  assert.ok(skipSites.has(0o266), 'sza i at 00266');
  assert.equal(skipSites.get(0o266).srcLine, 327);

  assert.ok(skipSites.has(0o275), 'sma+sza-skip at 00275');
  assert.equal(skipSites.get(0o275).srcLine, 334);

  assert.ok(skipSites.has(0o277), 'spa at 00277');
  assert.equal(skipSites.get(0o277).srcLine, 336);

  // sqx jmp . at 00260 is a multiway branch
  assert.ok(multiwayBranches.has(0o260), 'sqx jmp . at 00260 is multiway');
});

test('real listing: ranct sma at 02541 attributed to call site 1218', async () => {
  let listing;
  try {
    const text = await readFile(join(HERE, '..', 'build', 'spacewar31.lst'), 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;
  assert.ok(skipSites.has(0o2541), 'ranct sma at 02541 found');
  assert.equal(skipSites.get(0o2541).srcLine, 1218, 'attributed to call site 1218');
  assert.equal(skipSites.get(0o2541).callSiteLine, 1218);
});

test('real listing: dispatch jmp. at 00443 is a multiway branch attributed to line 440', async () => {
  let listing;
  try {
    const text = await readFile(join(HERE, '..', 'build', 'spacewar31.lst'), 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { multiwayBranches } = listing;
  assert.ok(multiwayBranches.has(0o443), 'dispatch jmp. at 00443 is multiway');
  assert.equal(multiwayBranches.get(0o443).srcLine, 440);
});

test('real listing: bjm jmp. at 00715 is a multiway branch (T-STARDISP)', async () => {
  let listing;
  try {
    const text = await readFile(join(HERE, '..', 'build', 'spacewar31.lst'), 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { multiwayBranches } = listing;
  assert.ok(multiwayBranches.has(0o715), 'bjm jmp. is multiway');
});

test('real listing: runtime-generated range constants correct', () => {
  assert.equal(RUNTIME_GEN_LOW, 0o3773, 'RUNTIME_GEN_LOW = 03773 octal');
  assert.equal(RUNTIME_GEN_HIGH, 0o5245, 'RUNTIME_GEN_HIGH = 05245 octal');
});
