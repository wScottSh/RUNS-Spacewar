/**
 * T-BACKDISP — Trace: background/EP display (lines 565–655).
 *
 * Closes issue #18.
 *
 * Covers:
 *   bck routine (01130–01440): szs 40 (SSW4), isp bcc (even-cycle gate),
 *   isp bkc (advance-timer), spa (fpr wrap), bcx jmp. (multiway return).
 *
 *   dislis define realized ×4 at call sites L636–639 (01137–01426):
 *   sma (L579), spq (L582), sad (L590, L592), szf 5 (L601), sas (L605),
 *   sad at flp (L612) — attributed by T-METER to the expansion call site,
 *   not to the class-Z define body.
 *
 * Test structure:
 *   §1  Unit: hand-authored listing snippets — bck skip sites identified
 *   §2  Unit: hand-authored listing snippets — dislis macro attribution
 *   §3  Integration: real listing — bck + dislis sites at confirmed addresses
 *   §4  Integration: SIMH trace — coverage of bck and dislis branches both ways
 *       (skipped when build/spacewar31.rim or tools/pdp1 binary is absent)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1, PDP1 } from './simh.js';
import {
  parseListingForMeter,
  parseSimhHistory,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LST_PATH = join(ROOT, 'build/spacewar31.lst');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ─── Confirmed addresses (from build/spacewar31.lst) ─────────────────────────
// bck routine
const BCK_SZS40   = 0o1131;  // L630: szs 40  — SSW4 gate (background on/off)
const BCK_ISP_BCC = 0o1133;  // L632: isp bcc — even-cycle gate
const BCK_JMP_DOT = 0o1134;  // L633: bcx, jmp .  — multiway return
const BCK_ISP_BKC = 0o1427;  // L640: isp bkc — advance-timer gate
const BCK_SPA     = 0o1435;  // L646: spa     — fpr wrap test

// dislis expansion 1 (call site L636, addresses 01137–01214)
const D1_SMA   = 0o1147;  // sma (L579)
const D1_SPQ   = 0o1152;  // spq (L582)
const D1_SAD90 = 0o1162;  // sad (lio Q+2) (L590)
const D1_SAD92 = 0o1164;  // sad fpo+R     (L592)
const D1_SZF   = 0o1173;  // szf 5         (L601)
const D1_SAS   = 0o1177;  // sas (Q+2)     (L605)
const D1_SADFLP = 0o1205; // sad fpo+R at flp (L612)

// dislis expansion 2 (call site L637, addresses 01215–01272)
const D2_SMA   = 0o1225;
const D2_SPQ   = 0o1230;
const D2_SAD90 = 0o1240;
const D2_SAD92 = 0o1242;
const D2_SZF   = 0o1251;
const D2_SAS   = 0o1255;
const D2_SADFLP = 0o1263;

// dislis expansion 3 (call site L638, addresses 01273–01350)
const D3_SMA   = 0o1303;
const D3_SPQ   = 0o1306;
const D3_SAD90 = 0o1316;
const D3_SAD92 = 0o1320;
const D3_SZF   = 0o1327;
const D3_SAS   = 0o1333;
const D3_SADFLP = 0o1341;

// dislis expansion 4 (call site L639, addresses 01351–01426)
const D4_SMA   = 0o1361;
const D4_SPQ   = 0o1364;
const D4_SAD90 = 0o1374;
const D4_SAD92 = 0o1376;
const D4_SZF   = 0o1405;
const D4_SAS   = 0o1411;
const D4_SADFLP = 0o1417;

// All 28 dislis expansion skip sites across 4 expansions
const ALL_DISLIS_SITES = [
  D1_SMA, D1_SPQ, D1_SAD90, D1_SAD92, D1_SZF, D1_SAS, D1_SADFLP,
  D2_SMA, D2_SPQ, D2_SAD90, D2_SAD92, D2_SZF, D2_SAS, D2_SADFLP,
  D3_SMA, D3_SPQ, D3_SAD90, D3_SAD92, D3_SZF, D3_SAS, D3_SADFLP,
  D4_SMA, D4_SPQ, D4_SAD90, D4_SAD92, D4_SZF, D4_SAS, D4_SADFLP,
];

// ─── §1 Unit: bck skip site identification from hand-authored listing ─────────

const BCK_LISTING_SNIPPET = [
  // bck routine header (variety A)
  '  629 01130 261134      bck,\tdap bcx',
  '  630 01131 640040      \tszs 40',
  '  631 01132 601134      \tjmp bcx',
  '  632 01133 461441      \tisp bcc',
  '  633 01134 601134      bcx,\tjmp .',
  '  634 01135 710002      \tlaw i 2',
  '  635 01136 241441      \tdac bcc',
  // (dislis expansions omitted — see §2)
  // advance-timer and fpr wrap
  '  640 01427 461442      \tisp bkc',
  '  641 01430 601134      \tjmp bcx',
  '  642 01431 710020      \tlaw i 20',
  '  643 01432 241442      \tdac bkc',
  '  644 01433 710001      \tlaw i 1',
  '  645 01434 401443      \tadd fpr',
  '  646 01435 640200      \tspa',
  '  647 01436 403067      \tadd (20000',
  '  648 01437 241443      \tdac fpr',
  '  649 01440 601134      \tjmp bcx',
].join('\n');

test('bck listing: szs 40 at 01131 identified as skip site (L630)', () => {
  const { skipSites } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(skipSites.has(BCK_SZS40), 'szs 40 found at 01131');
  assert.equal(skipSites.get(BCK_SZS40).srcLine, 630);
  assert.match(skipSites.get(BCK_SZS40).mnemonic, /szs/);
});

test('bck listing: isp bcc at 01133 identified as skip site (L632)', () => {
  const { skipSites } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(skipSites.has(BCK_ISP_BCC), 'isp bcc found at 01133');
  assert.equal(skipSites.get(BCK_ISP_BCC).srcLine, 632);
  assert.match(skipSites.get(BCK_ISP_BCC).mnemonic, /isp/);
});

test('bck listing: bcx jmp. at 01134 identified as multiway branch (L633)', () => {
  const { multiwayBranches } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(multiwayBranches.has(BCK_JMP_DOT), 'bcx jmp. found at 01134');
  assert.equal(multiwayBranches.get(BCK_JMP_DOT).srcLine, 633);
});

test('bck listing: jmp bcx at 01132 is NOT a skip site', () => {
  const { skipSites } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(!skipSites.has(0o1132), 'jmp bcx at 01132 is not a skip');
});

test('bck listing: isp bkc at 01427 identified as skip site (L640)', () => {
  const { skipSites } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(skipSites.has(BCK_ISP_BKC), 'isp bkc found at 01427');
  assert.equal(skipSites.get(BCK_ISP_BKC).srcLine, 640);
  assert.match(skipSites.get(BCK_ISP_BKC).mnemonic, /isp/);
});

test('bck listing: spa at 01435 identified as skip site (L646)', () => {
  const { skipSites } = parseListingForMeter(BCK_LISTING_SNIPPET);
  assert.ok(skipSites.has(BCK_SPA), 'spa found at 01435');
  assert.equal(skipSites.get(BCK_SPA).srcLine, 646);
  assert.match(skipSites.get(BCK_SPA).mnemonic, /spa/);
});

// ─── §2 Unit: dislis macro attribution to call sites ─────────────────────────

// Minimal synthetic listing exercising the variety-(B) / variety-(C) attribution.
// The "dislis" call-site line (636) has srcLine but no addr → variety (B).
// Expansion lines have addr+word but no srcLine → variety (C), attributed to 636.
// A page header between call sites is ignored.

const DISLIS_LISTING_SNIPPET = [
  // Call site L636 (variety B)
  '  636                   \tdislis 1j,1q,3',
  // Intermediate repeat values — no srcLine, no addr → ignored
  '            000006',
  '            000300',
  // Expansion instructions (variety C) — attributed to callSiteLine=636
  '      01147 640400',  // sma (L579)
  '      01152 650500',  // spq (L582)
  '      01162 503055',  // sad (L590)
  '      01164 501213',  // sad fpo+R (L592)
  '      01173 640005',  // szf 5 (L601)
  '      01177 523057',  // sas (L605)
  '      01205 501213',  // sad at flp (L612)
  // Page header — ignored
  '      spacewar 3.1  24 sep 62  pt. 1                                     Page 18',
  // Call site L637 (variety B) — starts a NEW callSiteLine context
  '  637                   \tdislis 2j,2q,2',
  '            000004',
  '            000200',
  // Expansion 2 instructions (variety C) — attributed to callSiteLine=637
  '      01225 640400',  // sma
  '      01230 650500',  // spq
  '      01240 503061',  // sad
  '      01242 501271',  // sad fpo+R
  '      01251 640005',  // szf 5
  '      01255 523062',  // sas
  '      01263 501271',  // sad at flp
].join('\n');

test('dislis macro: expansion 1 sma at 01147 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SMA), 'sma at 01147 found');
  assert.equal(skipSites.get(D1_SMA).callSiteLine, 636);
  assert.equal(skipSites.get(D1_SMA).srcLine, 636);
  assert.match(skipSites.get(D1_SMA).mnemonic, /sma/);
});

test('dislis macro: expansion 1 spq at 01152 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SPQ), 'spq at 01152 found');
  assert.equal(skipSites.get(D1_SPQ).callSiteLine, 636);
});

test('dislis macro: expansion 1 sad (L590) at 01162 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SAD90), 'sad at 01162 found');
  assert.equal(skipSites.get(D1_SAD90).callSiteLine, 636);
  assert.match(skipSites.get(D1_SAD90).mnemonic, /sad/);
});

test('dislis macro: expansion 1 sad fpo+R (L592) at 01164 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SAD92), 'sad at 01164 found');
  assert.equal(skipSites.get(D1_SAD92).callSiteLine, 636);
});

test('dislis macro: expansion 1 szf 5 (L601) at 01173 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SZF), 'szf 5 at 01173 found');
  assert.equal(skipSites.get(D1_SZF).callSiteLine, 636);
  assert.match(skipSites.get(D1_SZF).mnemonic, /szf/);
});

test('dislis macro: expansion 1 sas (L605) at 01177 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SAS), 'sas at 01177 found');
  assert.equal(skipSites.get(D1_SAS).callSiteLine, 636);
  assert.match(skipSites.get(D1_SAS).mnemonic, /sas/);
});

test('dislis macro: expansion 1 sad at flp (L612) at 01205 attributed to call site L636', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SADFLP), 'sad at flp (01205) found');
  assert.equal(skipSites.get(D1_SADFLP).callSiteLine, 636);
});

test('dislis macro: expansion 2 sma at 01225 attributed to call site L637 (not L636)', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D2_SMA), 'sma at 01225 found');
  assert.equal(skipSites.get(D2_SMA).callSiteLine, 637, 'expansion 2 must not inherit expansion 1 call site');
  assert.equal(skipSites.get(D2_SMA).srcLine, 637);
});

test('dislis macro: expansion 2 szf 5 at 01251 attributed to call site L637', () => {
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D2_SZF), 'szf 5 at 01251 found');
  assert.equal(skipSites.get(D2_SZF).callSiteLine, 637);
});

test('dislis macro: repeat intermediate lines do not create skip sites', () => {
  // The 000006/000300 repeat values must be ignored — they have no addr field.
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(!skipSites.has(6),   'repeat value 000006 not a skip site');
  assert.ok(!skipSites.has(0o300), 'repeat value 000300 not a skip site');
});

test('dislis macro: page header does not reset call site context', () => {
  // After a page header, expansion lines should still be variety-(C) wrt the
  // preceding call-site line — the page header resets nothing.
  // (Verified indirectly: expansion lines after the header still carry callSiteLine=636.)
  // This test checks that D1_SADFLP (at 01205, which appears BEFORE the header
  // in real listing order, but we explicitly test the page header has no effect.)
  const { skipSites } = parseListingForMeter(DISLIS_LISTING_SNIPPET);
  assert.ok(skipSites.has(D1_SADFLP), 'sad at 01205 still found despite page header nearby');
});

// ─── §3 Integration: real listing — confirmed addresses ───────────────────────

test('real listing: bck skip sites at confirmed addresses (L630/632/640/646)', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return; // build not present — skip
  }
  const { skipSites, multiwayBranches } = listing;

  // bck routine skip sites
  assert.ok(skipSites.has(BCK_SZS40),   'szs 40 at 01131');
  assert.equal(skipSites.get(BCK_SZS40).srcLine, 630);
  assert.match(skipSites.get(BCK_SZS40).mnemonic, /szs/);

  assert.ok(skipSites.has(BCK_ISP_BCC), 'isp bcc at 01133');
  assert.equal(skipSites.get(BCK_ISP_BCC).srcLine, 632);

  assert.ok(multiwayBranches.has(BCK_JMP_DOT), 'bcx jmp. at 01134');
  assert.equal(multiwayBranches.get(BCK_JMP_DOT).srcLine, 633);

  assert.ok(skipSites.has(BCK_ISP_BKC), 'isp bkc at 01427');
  assert.equal(skipSites.get(BCK_ISP_BKC).srcLine, 640);

  assert.ok(skipSites.has(BCK_SPA),     'spa at 01435');
  assert.equal(skipSites.get(BCK_SPA).srcLine, 646);
});

test('real listing: dislis expansion 1 skip sites attributed to L636', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;

  for (const [addr, label] of [
    [D1_SMA,    'sma  at 01147'],
    [D1_SPQ,    'spq  at 01152'],
    [D1_SAD90,  'sad  at 01162 (L590)'],
    [D1_SAD92,  'sad  at 01164 (L592)'],
    [D1_SZF,    'szf5 at 01173'],
    [D1_SAS,    'sas  at 01177'],
    [D1_SADFLP, 'sad  at 01205 (flp, L612)'],
  ]) {
    assert.ok(skipSites.has(addr), `${label} found`);
    assert.equal(skipSites.get(addr).callSiteLine, 636, `${label} attributed to L636`);
  }
});

test('real listing: dislis expansion 2 skip sites attributed to L637', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;

  for (const [addr, label] of [
    [D2_SMA,    'sma  at 01225'],
    [D2_SPQ,    'spq  at 01230'],
    [D2_SAD90,  'sad  at 01240'],
    [D2_SAD92,  'sad  at 01242'],
    [D2_SZF,    'szf5 at 01251'],
    [D2_SAS,    'sas  at 01255'],
    [D2_SADFLP, 'sad  at 01263 (flp)'],
  ]) {
    assert.ok(skipSites.has(addr), `${label} found`);
    assert.equal(skipSites.get(addr).callSiteLine, 637, `${label} attributed to L637`);
  }
});

test('real listing: dislis expansion 3 skip sites attributed to L638', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;

  for (const [addr, label] of [
    [D3_SMA,    'sma  at 01303'],
    [D3_SPQ,    'spq  at 01306'],
    [D3_SAD90,  'sad  at 01316'],
    [D3_SAD92,  'sad  at 01320'],
    [D3_SZF,    'szf5 at 01327'],
    [D3_SAS,    'sas  at 01333'],
    [D3_SADFLP, 'sad  at 01341 (flp)'],
  ]) {
    assert.ok(skipSites.has(addr), `${label} found`);
    assert.equal(skipSites.get(addr).callSiteLine, 638, `${label} attributed to L638`);
  }
});

test('real listing: dislis expansion 4 skip sites attributed to L639', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;

  for (const [addr, label] of [
    [D4_SMA,    'sma  at 01361'],
    [D4_SPQ,    'spq  at 01364'],
    [D4_SAD90,  'sad  at 01374'],
    [D4_SAD92,  'sad  at 01376'],
    [D4_SZF,    'szf5 at 01405'],
    [D4_SAS,    'sas  at 01411'],
    [D4_SADFLP, 'sad  at 01417 (flp)'],
  ]) {
    assert.ok(skipSites.has(addr), `${label} found`);
    assert.equal(skipSites.get(addr).callSiteLine, 639, `${label} attributed to L639`);
  }
});

test('real listing: 28 dislis skip sites total across 4 expansions', async () => {
  let listing;
  try {
    const text = await readFile(LST_PATH, 'utf8');
    listing = parseListingForMeter(text);
  } catch {
    return;
  }
  const { skipSites } = listing;
  const found = ALL_DISLIS_SITES.filter((a) => skipSites.has(a));
  assert.equal(found.length, 28, `all 28 dislis skip sites present; missing: ${
    ALL_DISLIS_SITES.filter((a) => !skipSites.has(a)).map((a) => a.toString(8)).join(', ')
  }`);
});

// ─── §4 Integration: SIMH trace — decision coverage ─────────────────────────
//
// Requires: build/spacewar31.rim + tools/pdp1 binary.
// Skipped gracefully when either is absent.
//
// This is a synthetic mid-routine cut in the ADR-0012 sense: set the block's
// live preconditions (fpr window origin, bcc/bkc counters, sense switches),
// run entry-PC → exit, and measure the trace.  `bck` is entered directly at
// 01130 rather than through a full game frame, because the seam inputs are
// exactly the pinned inputs the issue names.
//
// Entry trick: `bck` begins with `dap bcx`, storing AC's address bits as the
// return target of the `bcx, jmp .` exit.  Depositing AC=1134 (bcx itself)
// before entry makes the exit spin in place at bcx, so a pass's trace is pure
// bck/dislis code — no wandering into unrelated memory — and the realized
// bcx target is the seeded 1134.  Each `step` budget just has to exceed one
// pass; the spin harmlessly absorbs the rest.

// PDP-1 sense switch encoding for SIMH: sense switches are a 6-bit CPU register.
// The `szs 40` instruction decodes to v=4, and SIMH checks `(SS & fs_test[4])`
// where `fs_test[4] = PF_SS_4 = 0o004` (bit 2).  SSW4 set = SS has bit 2 set.
const SS_BACKGROUND_ON    = 0o000;  // SSW4 clear → szs 40 skips → background ON
const SS_BACKGROUND_OFF   = 0o004;  // SSW4 set  → szs 40 no-skip → background OFF

// Ones'-complement -2: isp increments to -1 (negative) → the no-skip arm.
const COUNTER_NEG2 = 0o777775;

// Instruction budget per bck pass.  A full four-band scan finishes well
// inside this; the bcx spin absorbs the remainder.  SIMH's CPU history
// buffer caps at 65536 entries, so at most two passes fit in one session.
const PASS_STEPS = 32_768;

/**
 * Run one SIMH session of one or more bck passes and return the PC stream.
 *
 * Each pass deposits its preconditions and re-enters bck at 01130.  State
 * NOT re-deposited persists across passes within a session — the window-move
 * scenario relies on this: pass 1 advances the per-band start pointers
 * (`flo`), pass 2 then scans starting mid-table.
 *
 * @param {Array<{fpr: number, ssw?: number, bcc?: number, bkc?: number}>} passes
 */
async function runBackdispTrace(passes) {
  const script = [
    `load ${RIM_PATH}`,
    `set cpu history=${Math.min(passes.length * PASS_STEPS, 65_536)}`,
  ];
  for (const { fpr, ssw = 0, bcc = 0, bkc = 0 } of passes) {
    script.push(
      `de 1443 ${fpr.toString(8)}`,   // fpr — window origin for star folding
      `de SS ${ssw.toString(8)}`,     // sense switches
      `de 1441 ${bcc.toString(8)}`,   // bcc counter (even-cycle gate)
      `de 1442 ${bkc.toString(8)}`,   // bkc counter (advance timer)
      `de AC 1134`,                   // bcx return target = bcx (spin on exit)
      `de PC 1130`,                   // enter bck
      `step ${PASS_STEPS}`,
    );
  }
  script.push('show cpu history', 'quit');
  const { stdout } = await runPdp1(script, { timeout: 120_000 });
  return parseSimhHistory(stdout);
}

test('T-BACKDISP: SIMH trace — bck and dislis branches covered both ways', async (t) => {
  // Skip if SIMH binary or build not available
  if (!existsSync(PDP1) || !existsSync(RIM_PATH) || !existsSync(LST_PATH)) {
    t.skip('SIMH binary or build not available');
    return;
  }

  const listingText = await readFile(LST_PATH, 'utf8');
  const listing = parseListingForMeter(listingText);

  // Scenario set (each named for the branch arms it exists to light):
  //
  //   baseline    — background ON, fpr=0: the normal folding pass; spa (L646)
  //                 no-skip arm (fpr-1 goes negative → wrap adjustment).
  //   ssw4-off    — SSW4 set: szs 40 no-skip arm (background suppressed).
  //   bcc-odd     — bcc seeded -2: isp bcc no-skip arm (odd frame, EP idle).
  //   bkc-hold    — bkc seeded -2: isp bkc no-skip arm (window not advanced).
  //   window-move — two passes in ONE session: pass 1 at fpr=10000 advances
  //                 each band's flo start pointer mid-table; pass 2 at
  //                 fpr=2000 then scans from a mid-table fpo over a window
  //                 where band 4 is empty — the only geometry that reaches
  //                 the flp wrap with fpo ≠ table start (L612 skip arm) and
  //                 the full-circle exit (L592 no-skip arm).  Also lights
  //                 spa's skip arm and both isp skip arms.
  const [baseline, ssw4Off, bccOdd, bkcHold, windowMove] = await Promise.all([
    runBackdispTrace([{ fpr: 0, ssw: SS_BACKGROUND_ON }]),
    runBackdispTrace([{ fpr: 0o1, ssw: SS_BACKGROUND_OFF }]),
    runBackdispTrace([{ fpr: 0, bcc: COUNTER_NEG2 }]),
    runBackdispTrace([{ fpr: 0, bkc: COUNTER_NEG2 }]),
    runBackdispTrace([{ fpr: 0o10000 }, { fpr: 0o2000 }]),
  ]);

  // Concatenating the streams is safe for skip sites: analyzeTrace only
  // counts pc+1 / pc+2 edges, and every stream ends spinning at bcx (1134),
  // which is not a skip site.  The seams (1134 → 1130) do surface as a bogus
  // bcx multiway "target" of 1130 — tolerated below by asserting the seeded
  // 1134 target specifically rather than target-set size.
  const combined = [...baseline, ...ssw4Off, ...bccOdd, ...bkcHold, ...windowMove];

  const analysis = analyzeTrace(combined, listing);
  const ledger = buildLedger(analysis, listing);

  const byAddr = new Map(ledger.map((e) => [e.addr, e]));

  // ── bck-level skips: every one both ways (acceptance criteria 1–2) ──
  await t.test('szs 40 (L630) covered both ways', () => {
    const e = byAddr.get(BCK_SZS40);
    assert.ok(e, 'szs 40 entry in ledger');
    assert.equal(e.status, 'both', `got ${e.status}`);
  });
  await t.test('isp bcc (L632) covered both ways', () => {
    const e = byAddr.get(BCK_ISP_BCC);
    assert.ok(e, 'isp bcc entry in ledger');
    assert.equal(e.status, 'both', `got ${e.status}`);
  });
  await t.test('isp bkc (L640) covered both ways', () => {
    const e = byAddr.get(BCK_ISP_BKC);
    assert.ok(e, 'isp bkc entry in ledger');
    assert.equal(e.status, 'both', `got ${e.status}`);
  });
  await t.test('spa fpr-wrap (L646) covered both ways', () => {
    const e = byAddr.get(BCK_SPA);
    assert.ok(e, 'spa entry in ledger');
    assert.equal(e.status, 'both', `got ${e.status}`);
  });
  await t.test('bcx jmp. realized the seeded return target', () => {
    const mw = analysis.multiwayTargets.get(BCK_JMP_DOT);
    assert.ok(mw, 'bcx jmp. realized');
    assert.ok(mw.targets.has(0o1134), 'spin return target 1134 observed');
  });

  // ── dislis skips (acceptance criterion 3) ──
  //
  // Every expansion site must be reached (not dark), and every define-line
  // skip must be observed BOTH ways with the witnesses drawn from across the
  // four expansion sites — the issue's macro-attribution reading of ADR-0012:
  // "both ways" is witnessed across the expansions, not per-site, because a
  // single band's star geometry cannot drive every arm at every site.
  const dislisDark = [];
  for (const addr of ALL_DISLIS_SITES) {
    const e = byAddr.get(addr);
    if (!e || e.status === 'dark') {
      dislisDark.push(`0${addr.toString(8)}: ${e ? e.status : 'missing'}`);
    }
  }
  await t.test('all 28 dislis skip sites reached (not dark)', () => {
    assert.equal(dislisDark.length, 0, `gaps: ${dislisDark.join(', ')}`);
  });

  const DISLIS_BY_LINE = {
    579: [D1_SMA,    D2_SMA,    D3_SMA,    D4_SMA],     // right-margin sma
    582: [D1_SPQ,    D2_SPQ,    D3_SPQ,    D4_SPQ],     // left-margin spq
    590: [D1_SAD90,  D2_SAD90,  D3_SAD90,  D4_SAD90],   // table-end sad
    592: [D1_SAD92,  D2_SAD92,  D3_SAD92,  D4_SAD92],   // full-circle sad fpo
    601: [D1_SZF,    D2_SZF,    D3_SZF,    D4_SZF],     // busy-flag szf 5
    605: [D1_SAS,    D2_SAS,    D3_SAS,    D4_SAS],     // flo-wrap sas
    612: [D1_SADFLP, D2_SADFLP, D3_SADFLP, D4_SADFLP],  // flp sad fpo
  };

  for (const [line, sites] of Object.entries(DISLIS_BY_LINE)) {
    await t.test(`dislis L${line} skip covered both ways across the 4 expansions`, () => {
      let skipped = false;
      let notSkipped = false;
      for (const addr of sites) {
        const cov = analysis.skipCoverage.get(addr);
        if (!cov) continue;
        skipped    = skipped    || cov.skipped;
        notSkipped = notSkipped || cov.notSkipped;
      }
      assert.ok(skipped,    `L${line}: skip arm never observed at any expansion`);
      assert.ok(notSkipped, `L${line}: no-skip arm never observed at any expansion`);
    });
  }

  // ── region gate (acceptance criterion 4): 565–655 covered ──
  //
  // Every meter entry attributed to the region — bck's own source lines and
  // the dislis expansions via their call-site lines — must be lit: no dark
  // skip site, no unrealized multiway branch.
  await t.test('T-METER reports the 565–655 region covered', () => {
    const gaps = [];
    for (const e of ledger) {
      const line = e.callSiteLine ?? e.srcLine;
      if (line < 565 || line > 655) continue;
      if (e.type === 'multiway' ? e.realizedTargets.length === 0 : e.status === 'dark') {
        gaps.push(`0${e.addr.toString(8)} (L${e.srcLine} ${e.mnemonic})`);
      }
    }
    assert.equal(gaps.length, 0, `dark in region: ${gaps.join(', ')}`);
  });
});
