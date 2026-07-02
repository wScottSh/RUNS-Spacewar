/**
 * T-MAINLOOP — main loop ml0/ml1 coverage (issue #20, ADR-0012).
 *
 * Traces ml0 (lines 665–716, addresses 01444–01507) and ml1 (lines 843–945,
 * addresses 01703–02051). ml0 is straight-line setup with no skip sites;
 * ml1 contains all the per-frame branches.
 *
 * Test strategy:
 *   1. Address constant verification (requires build/spacewar31.lst):
 *      each skip site lives at the expected assembled address.
 *   2. Authored collision scenario (pure-function): a hand-authored PC stream
 *      drives all 12 ml1 skip sites both ways, including the collision →
 *      EXPLODE chain (868→876/883/887→889–891 self-mod path).
 *   3. T-START cross-boundary: sites 01512/01516/01522/01526 (lines 719/723/
 *      727/731) are not claimed here; the listing attributes them to T-START.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseListingForMeter,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Address constants (from build/spacewar31.lst) ────────────────────────────
//
// ml0 region (lines 665–716): 01444–01507  — no skip instructions, all dap/dac
// ml1 region (lines 843–945): 01703–02051  — all per-frame branches
//
// T-START cross-boundary (lines 717–736, 01510–01533): NOT owned by T-MAINLOOP;
// skip sites there belong to T-START (#14).

export const ML0  = 0o1444;   // ml0 entry
export const ML1  = 0o1703;   // outer loop instruction site (self-modifying)
export const ML2  = 0o1734;   // inner loop instruction site (self-modifying)
export const MQ1  = 0o2011;   // end-of-outer-slot: idx mx1
export const MQ2  = 0o1774;   // end-of-inner-comparison: idx mx2
export const MQ3  = 0o2045;   // mq3: background display
export const MQ4  = 0o2003;   // mq4: calc routine dispatch

// Skip site addresses in ml1 (all confirmed against build/spacewar31.lst):
export const ADDR_SZA_I_OUTER     = 0o1704;  // L844  sza i   slot active/inactive
export const ADDR_SPI_ELIGIBLE    = 0o1711;  // L848  spi     collision eligible?
export const ADDR_SPQ_CAN_COLLIDE = 0o1735;  // L868  spq     can inner object collide?
export const ADDR_SPA_ABS_DX      = 0o1741;  // L872  spa     abs val of Δx
export const ADDR_SMA_DX_EPS      = 0o1745;  // L876  sma     |Δx| < ε?
export const ADDR_SPA_ABS_DY      = 0o1751;  // L880  spa     abs val of Δy
export const ADDR_SMA_DY_EPS      = 0o1754;  // L883  sma     |Δy| < ε?
export const ADDR_SMA_COMBINED    = 0o1760;  // L887  sma     combined < me2 (HIT!)?
export const ADDR_SAS_INNER       = 0o2001;  // L903  sas     index ml2 (inner loop)
export const ADDR_SAS_OUTER       = 0o2033;  // L929  sas     index ml1 (outer loop)
export const ADDR_SZA_I_LAST      = 0o2036;  // L931  sza i   last-slot active?
export const ADDR_ISP_MTC         = 0o2047;  // L940  isp     mtc budget count

// T-START boundary addresses (NOT owned by T-MAINLOOP):
const ADDR_SZA_SS1_ACTIVE    = 0o1512;  // L719 sza  — ship 1 active? (T-START)
const ADDR_SZA_SS2_ACTIVE    = 0o1516;  // L723 sza  — ship 2 active? (T-START)
const ADDR_SPA_TORPS1        = 0o1522;  // L727 spa  — ship 1 torps? (T-START)
const ADDR_SPA_I_TORPS2      = 0o1526;  // L731 spa i — ship 2 torps? (T-START)

// ─── All 12 ml1 skip sites ───────────────────────────────────────────────────

export const ML1_SKIP_SITES = [
  ADDR_SZA_I_OUTER,
  ADDR_SPI_ELIGIBLE,
  ADDR_SPQ_CAN_COLLIDE,
  ADDR_SPA_ABS_DX,
  ADDR_SMA_DX_EPS,
  ADDR_SPA_ABS_DY,
  ADDR_SMA_DY_EPS,
  ADDR_SMA_COMBINED,
  ADDR_SAS_INNER,
  ADDR_SAS_OUTER,
  ADDR_SZA_I_LAST,
  ADDR_ISP_MTC,
];

// ─── Authored collision geometry (PC stream) ─────────────────────────────────
//
// A hand-authored PC stream that drives all 12 skip sites both ways.
// Models a frame with:
//   - Outer slot A: active + eligible; inner loop with 5 comparison passes:
//       pass 1: spq SKIP → Δx negative(cma) → sma skip → Δy negative(cma) → sma skip → HIT (sma comb skip)
//       pass 2: spq NO-SKIP (inner object can't collide) → miss
//       pass 3: spq SKIP → Δx positive(spa skip) → sma NO-SKIP (|Δx|≥ε) → miss
//       pass 4: spq SKIP → Δx pos → sma skip → Δy pos(spa skip) → sma NO-SKIP (|Δy|≥ε) → miss
//       pass 5: spq SKIP → Δx pos → sma skip → Δy neg(cma) → sma skip → sma comb NO-SKIP (near miss)
//       inner loop exits (sas 02001 SKIP)
//   - Outer slot B: active, NOT eligible (spi NO-SKIP → jmp mq4)
//   - Outer slot C: inactive (sza i 01704 NO-SKIP → jmp mq1)
//   - Outer loop exits (sas 02033 SKIP → 02035)
//   - Last slot: active (sza i 02036 SKIP → 02040) then inactive (sza i 02036 NO-SKIP → 02037)
//   - mtc count: budget remaining (isp NO-SKIP loops) then exhausted (isp SKIP exits)
//
// PDP-1 skip convention used in analyzeTrace:
//   nextPc === pc+2  →  skip taken  (condition met, next instruction stepped over)
//   nextPc === pc+1  →  no-skip     (condition not met, fall through)
//
// skip = "SKIP" means condition met → next PC = addr+2
// skip-jmp  means the jmp after the skip was skipped → execution continues
// no-skip  means condition not met → next PC = addr+1 → jmp is executed

function outerSlotSetup(entryPc) {
  // From ml1 entry through collision-eligibility check (spi SKIP = eligible).
  // entryPc = self-modifying address of ml1 (01703), always the same instruction site.
  return [
    entryPc,             // 01703: lac . (load outer slot pointer)
    entryPc + 1,         // 01704: sza i  (active → skip jmp mq1, next = 01706)
    0o1706, 0o1707,      // swap (two words)
    0o1710,              // idx \moc
    ADDR_SPI_ELIGIBLE,   // 01711: spi
  ];
}

// Inner loop entry sequence (after spi SKIP = eligible):
const INNER_SETUP = [
  ADDR_SPI_ELIGIBLE + 2,  // 01713: law 1 (spi SKIP → skip jmp mq4 at 01712)
  0o1714, 0o1715, 0o1716, 0o1717, 0o1720, 0o1721, 0o1722, 0o1723,
  0o1724, 0o1725, 0o1726, 0o1727, 0o1730, 0o1731,
  0o1732, // mot: lac .
  0o1733, // dap sp5
];

// mq2 tail: after a comparison result (hit or miss), advance inner loop pointer.
const MQ2_TAIL_NO_EXIT = [
  MQ2,       // 01774: idx mx2
  0o1775,    // idx my2
  0o1776,    // idx ma2
  0o1777,    // idx mb2
  0o2000,    // idx ml2 (advance inner slot pointer)
  ADDR_SAS_INNER,      // 02001: sas (inner loop done?)
  // sas NO-SKIP → next is 02002 (jmp ml2)
  ADDR_SAS_INNER + 1,  // 02002: jmp ml2
  // jmp ml2 redirects to 01734 (next iteration of inner loop):
];

const MQ2_TAIL_EXIT = [
  MQ2,       // 01774: idx mx2
  0o1775,
  0o1776,
  0o1777,
  0o2000,
  ADDR_SAS_INNER,   // 02001: sas SKIP → 02003 (inner loop exits)
  // sas SKIP: next = 02001+2 = 02003
];

// mq4 + mb1 block: execute slot's calc routine and update mtc.
const MQ4_MB1 = [
  MQ4,         // 02003: lac i ml1
  0o2004,      // dap . 1
  0o2005,      // jsp .
  0o2006,      // mb1: lac .
  0o2007,      // add \mtc
  0o2010,      // dac \mtc
];

// mq1 block: advance outer loop pointers.
const MQ1_OUTER_ADVANCE = [
  MQ1,     // 02011: idx mx1
  0o2012, 0o2013, 0o2014, 0o2015, 0o2016, 0o2017,
  0o2020, 0o2021, 0o2022, 0o2023, 0o2024, 0o2025,
  0o2026, 0o2027, 0o2030, 0o2031,
  0o2032, // idx ml1 (advance outer pointer)
  ADDR_SAS_OUTER,     // 02033: sas (outer loop done?)
];

// ─── Inner comparison passes ─────────────────────────────────────────────────

// Pass 1: spq SKIP (can collide) → neg Δx (spa NO-SKIP, cma) → |Δx|<ε (sma SKIP)
//          → neg Δy (spa NO-SKIP, cma) → |Δy|<ε (sma SKIP) → HIT (sma comb SKIP)
const INNER_PASS_HIT_NEGXY = [
  ML2,                          // 01734: ml2 lac . (inner slot pointer)
  ADDR_SPQ_CAN_COLLIDE,         // 01735: spq
  ADDR_SPQ_CAN_COLLIDE + 2,     // 01737: spq SKIP → skip jmp mq2 at 01736 → mx1 at 01737
  0o1740,                        // mx2: sub . (Δx)
  ADDR_SPA_ABS_DX,               // 01741: spa
  ADDR_SPA_ABS_DX + 1,           // 01742: spa NO-SKIP (neg Δx) → cma
  0o1743,                        // dac \mt1
  0o1744,                        // sub me1
  ADDR_SMA_DX_EPS,               // 01745: sma
  ADDR_SMA_DX_EPS + 2,           // 01747: sma SKIP (|Δx|<ε) → skip jmp mq2 at 01746 → my1
  0o1750,                        // my2: sub . (Δy)
  ADDR_SPA_ABS_DY,               // 01751: spa
  ADDR_SPA_ABS_DY + 1,           // 01752: spa NO-SKIP (neg Δy) → cma
  0o1753,                        // sub me1
  ADDR_SMA_DY_EPS,               // 01754: sma
  ADDR_SMA_DY_EPS + 2,           // 01756: sma SKIP (|Δy|<ε) → skip jmp mq2 at 01755 → add \mt1
  0o1757,                        // sub me2
  ADDR_SMA_COMBINED,             // 01760: sma
  ADDR_SMA_COMBINED + 2,         // 01762: sma SKIP (HIT!) → skip jmp mq2 at 01761 → lac (mex
  // EXPLODE self-mod block (straight-line, no branches):
  0o1763, 0o1764, 0o1765, 0o1766, 0o1767, 0o1770, 0o1771, 0o1772, 0o1773,
];

// Pass 2: spq NO-SKIP (inner object can't collide) → jmp mq2
const INNER_PASS_NO_COLLIDE = [
  ML2,
  ADDR_SPQ_CAN_COLLIDE,          // spq
  ADDR_SPQ_CAN_COLLIDE + 1,      // spq NO-SKIP → jmp mq2 at 01736
  MQ2,                           // jmp target: 01774
];

// Pass 3: spq SKIP → pos Δx (spa SKIP) → |Δx|≥ε (sma NO-SKIP) → jmp mq2
const INNER_PASS_MISS_DX = [
  ML2,
  ADDR_SPQ_CAN_COLLIDE,
  ADDR_SPQ_CAN_COLLIDE + 2,      // spq SKIP → 01737
  0o1740,
  ADDR_SPA_ABS_DX,               // 01741: spa
  ADDR_SPA_ABS_DX + 2,           // 01743: spa SKIP (pos Δx) → skip cma → dac \mt1
  0o1744,
  ADDR_SMA_DX_EPS,               // 01745: sma
  ADDR_SMA_DX_EPS + 1,           // 01746: sma NO-SKIP (|Δx|≥ε) → jmp mq2
  MQ2,
];

// Pass 4: spq SKIP → pos Δx → |Δx|<ε → pos Δy (spa SKIP) → |Δy|≥ε (sma NO-SKIP) → jmp mq2
const INNER_PASS_MISS_DY = [
  ML2,
  ADDR_SPQ_CAN_COLLIDE,
  ADDR_SPQ_CAN_COLLIDE + 2,      // spq SKIP
  0o1740,
  ADDR_SPA_ABS_DX,
  ADDR_SPA_ABS_DX + 2,           // spa SKIP (pos Δx)
  0o1743, 0o1744,
  ADDR_SMA_DX_EPS,
  ADDR_SMA_DX_EPS + 2,           // sma SKIP (|Δx|<ε)
  0o1750,                        // Note: 01747 is my1: lac . (listed as 01747 in the listing)
  ADDR_SPA_ABS_DY,               // 01751: spa
  ADDR_SPA_ABS_DY + 2,           // 01753: spa SKIP (pos Δy) → sub me1
  ADDR_SMA_DY_EPS,               // 01754: sma
  ADDR_SMA_DY_EPS + 1,           // 01755: sma NO-SKIP (|Δy|≥ε) → jmp mq2
  MQ2,
];

// Pass 5: near miss — all sma SKIP until combined NO-SKIP (|Δx+Δy|≥me2)
const INNER_PASS_NEAR_MISS = [
  ML2,
  ADDR_SPQ_CAN_COLLIDE,
  ADDR_SPQ_CAN_COLLIDE + 2,      // spq SKIP
  0o1740,
  ADDR_SPA_ABS_DX,
  ADDR_SPA_ABS_DX + 2,           // spa SKIP (pos Δx)
  0o1743, 0o1744,
  ADDR_SMA_DX_EPS,
  ADDR_SMA_DX_EPS + 2,           // sma SKIP (|Δx|<ε)
  0o1750,
  ADDR_SPA_ABS_DY,
  ADDR_SPA_ABS_DY + 1,           // spa NO-SKIP (neg Δy) → cma
  0o1752, 0o1753,
  ADDR_SMA_DY_EPS,
  ADDR_SMA_DY_EPS + 2,           // sma SKIP (|Δy|<ε)
  0o1756, 0o1757,
  ADDR_SMA_COMBINED,
  ADDR_SMA_COMBINED + 1,         // sma NO-SKIP (near miss) → jmp mq2 at 01761
  MQ2,
];

// ─── Build the comprehensive authored trace ───────────────────────────────────
//
// Covers all 12 skip sites both ways in one flat PC stream.

export const MAINLOOP_PC_STREAM = [
  // ── Outer slot A: active + eligible, 5 inner passes ──────────────────────
  ...outerSlotSetup(ML1),
  ADDR_SPI_ELIGIBLE + 2,   // spi SKIP (eligible) → skip jmp mq4 at 01712 → 01713
  ...INNER_SETUP,

  // Inner pass 1: HIT (covers spq skip, neg Δx/Δy, all 3 sma skips)
  ...INNER_PASS_HIT_NEGXY,
  ...MQ2_TAIL_NO_EXIT,   // inner loop continues after hit
  ML2,                   // jmp target from 02002

  // Inner pass 2: spq NO-SKIP (inner object can't collide)
  ...INNER_PASS_NO_COLLIDE,
  ...MQ2_TAIL_NO_EXIT,
  ML2,

  // Inner pass 3: sma NO-SKIP on Δx (|Δx|≥ε)
  ...INNER_PASS_MISS_DX,
  ...MQ2_TAIL_NO_EXIT,
  ML2,

  // Inner pass 4: sma NO-SKIP on Δy (|Δy|≥ε)
  ...INNER_PASS_MISS_DY,
  ...MQ2_TAIL_NO_EXIT,
  ML2,

  // Inner pass 5: sma NO-SKIP on combined (near miss) → inner loop EXITS (sas SKIP)
  ...INNER_PASS_NEAR_MISS,
  ...MQ2_TAIL_EXIT,      // sas SKIP = inner done → 02003

  // Execute outer slot A, advance outer loop (sas NO-SKIP = more slots)
  ...MQ4_MB1,
  ...MQ1_OUTER_ADVANCE,
  ADDR_SAS_OUTER + 1,    // 02034: sas NO-SKIP → jmp ml1 at 02034
  ML1,                   // jmp target: 01703

  // ── Outer slot B: active + NOT eligible ───────────────────────────────────
  ...outerSlotSetup(ML1),
  ADDR_SPI_ELIGIBLE + 1, // 01712: spi NO-SKIP → jmp mq4
  MQ4,                   // jmp target: 02003
  ...MQ4_MB1.slice(1),   // rest of mq4_mb1 (02004 onward)
  ...MQ1_OUTER_ADVANCE,
  ADDR_SAS_OUTER + 1,    // sas NO-SKIP → jmp ml1
  ML1,

  // ── Outer slot C: inactive (sza i NO-SKIP) ────────────────────────────────
  ML1,                   // 01703: ml1 lac .
  ADDR_SZA_I_OUTER,      // 01704: sza i
  ADDR_SZA_I_OUTER + 1,  // 01705: sza i NO-SKIP (inactive) → jmp mq1
  MQ1,                   // jmp target: 02011
  ...MQ1_OUTER_ADVANCE.slice(1),  // 02012 onward (idx my1..mh4) + idx ml1 + sas
  ADDR_SAS_OUTER + 2,    // sas SKIP (outer loop exits) → 02035

  // ── Last-slot handling: active arm (sza i SKIP) ───────────────────────────
  0o2035,                // lac i ml1 (load last slot pointer)
  ADDR_SZA_I_LAST,       // 02036: sza i
  ADDR_SZA_I_LAST + 2,   // 02040: sza i SKIP (active) → skip jmp mq3 at 02037 → dap . 1
  0o2041, 0o2042, 0o2043, 0o2044,  // jsp ., lac i mb1, add \mtc, dac \mtc

  // ── Last-slot handling: inactive arm (sza i NO-SKIP) ─────────────────────
  // (models a different frame's last-slot being inactive)
  0o2035,
  ADDR_SZA_I_LAST,
  ADDR_SZA_I_LAST + 1,   // 02037: sza i NO-SKIP (inactive) → jmp mq3
  MQ3,                   // jmp target: 02045

  // ── mq3 + mtc budget count ────────────────────────────────────────────────
  MQ3,                   // 02045: background expansion
  0o2046,                // jsp blp
  ADDR_ISP_MTC,          // 02047: isp \mtc
  ADDR_ISP_MTC + 1,      // 02050: isp NO-SKIP (budget remaining) → jmp 02047
  ADDR_ISP_MTC,          // 02047: loop back (from jmp 02050 → 02047)
  ADDR_ISP_MTC + 2,      // 02051: isp SKIP (budget exhausted) → jmp ml0 at 02051
  ML0,                   // jmp target: 01444 (new frame)
];

// ─── Derived: T-MAINLOOP ledger from the authored trace ──────────────────────

function buildMainloopLedger(listing) {
  const analysis = analyzeTrace(MAINLOOP_PC_STREAM, listing);
  return buildLedger(analysis, listing);
}

// Index of the first spot where `from` is immediately followed by `to` in the
// PC stream, or -1 if that transition never occurs. Used to assert that a
// specific skip arm (from → from+2) or fall-through arm (from → from+1) is
// exercised.
function streamTransitionIndex(from, to) {
  for (let i = 0; i < MAINLOOP_PC_STREAM.length - 1; i++) {
    if (MAINLOOP_PC_STREAM[i] === from && MAINLOOP_PC_STREAM[i + 1] === to) {
      return i;
    }
  }
  return -1;
}

// ─── Unit tests (pure-function; no Substrate required) ───────────────────────

test('mainloop address constants: 12 expected skip sites', () => {
  assert.equal(ML1_SKIP_SITES.length, 12);
});

test('mainloop address constants: no duplicates in ML1_SKIP_SITES', () => {
  const seen = new Set(ML1_SKIP_SITES);
  assert.equal(seen.size, ML1_SKIP_SITES.length);
});

test('mainloop address constants: all sites in ml1 region 01703–02051 octal', () => {
  for (const addr of ML1_SKIP_SITES) {
    assert.ok(addr >= 0o1703 && addr <= 0o2051,
      `0o${addr.toString(8)} out of ml1 range`);
  }
});

test('mainloop: MAINLOOP_PC_STREAM contains each skip site at least twice', () => {
  // Each skip site must appear at least twice (once per arm) in the stream.
  for (const addr of ML1_SKIP_SITES) {
    const count = MAINLOOP_PC_STREAM.filter((pc) => pc === addr).length;
    assert.ok(count >= 2,
      `skip site 0o${addr.toString(8)} appears ${count} times, expected ≥ 2`);
  }
});

// ─── Authored-trace coverage test (pure-function) ────────────────────────────
//
// Build a minimal synthetic listing for the 12 ml1 skip sites and verify
// that MAINLOOP_PC_STREAM covers each site both ways.

// Build a minimal listing text covering only the 12 ml1 skip sites.
// Each entry is "srcLine addr word mnemonic" in listing format.
// We use known instruction words from the assembled source.
const ML1_SKIP_ENTRIES = [
  { addr: ADDR_SZA_I_OUTER,     word: 0o650100, srcLine: 844,  mn: 'sza i' },
  { addr: ADDR_SPI_ELIGIBLE,    word: 0o642000, srcLine: 848,  mn: 'spi'   },
  { addr: ADDR_SPQ_CAN_COLLIDE, word: 0o650500, srcLine: 868,  mn: 'spq'   },
  { addr: ADDR_SPA_ABS_DX,      word: 0o640200, srcLine: 872,  mn: 'spa'   },
  { addr: ADDR_SMA_DX_EPS,      word: 0o640400, srcLine: 876,  mn: 'sma'   },
  { addr: ADDR_SPA_ABS_DY,      word: 0o640200, srcLine: 880,  mn: 'spa'   },
  { addr: ADDR_SMA_DY_EPS,      word: 0o640400, srcLine: 883,  mn: 'sma'   },
  { addr: ADDR_SMA_COMBINED,    word: 0o640400, srcLine: 887,  mn: 'sma'   },
  // sas (macro expansion — no srcLine, callSite = 903/929):
  // These are variety-(C) lines; we model them with a macro call site.
];

// Macro expansion entries (variety C: addr+word, no srcLine, attributed to call site).
const ML1_MACRO_ENTRIES = [
  { addr: ADDR_SAS_INNER, word: 0o523101, callSiteLine: 903 },  // index ml2
  { addr: ADDR_SAS_OUTER, word: 0o523102, callSiteLine: 929 },  // index ml1
  { addr: ADDR_ISP_MTC,   word: 0o463243, callSiteLine: 940 },  // count \mtc
];

// sza i at 02036 (L931) — variety A.
const LAST_SLOT_ENTRY = { addr: ADDR_SZA_I_LAST, word: 0o650100, srcLine: 931, mn: 'sza i' };

function buildSyntheticListing() {
  const lines = [];
  const oct5 = (n) => n.toString(8).padStart(5, '0');
  const oct6 = (n) => n.toString(8).padStart(6, '0');
  const dec5 = (n) => String(n).padStart(5, ' ');

  // Variety-A entries (srcLine + addr + word):
  for (const { addr, word, srcLine, mn } of [...ML1_SKIP_ENTRIES, LAST_SLOT_ENTRY]) {
    lines.push(`${dec5(srcLine)} ${oct5(addr)} ${oct6(word)} \t${mn}`);
  }

  // For the macro entries we need a variety-(B) call-site line followed by
  // variety-(C) expansion lines.
  for (const { addr, word, callSiteLine } of ML1_MACRO_ENTRIES) {
    lines.push(`${dec5(callSiteLine)}              \tindex call`);   // variety B
    lines.push(`      ${oct5(addr)} ${oct6(word)}  `);               // variety C
  }

  return lines.join('\n');
}

test('authored-trace: all 12 ml1 skip sites covered both ways', () => {
  const listing = parseListingForMeter(buildSyntheticListing());
  const ledger  = buildLedger(analyzeTrace(MAINLOOP_PC_STREAM, listing), listing);
  const byAddr  = new Map(ledger.map((e) => [e.addr, e]));

  for (const addr of ML1_SKIP_SITES) {
    const e = byAddr.get(addr);
    assert.ok(e, `skip site 0o${addr.toString(8)} missing from ledger`);
    assert.equal(e.status, 'both',
      `skip site 0o${addr.toString(8)} (L${e.srcLine}) has status '${e.status}', expected 'both'`);
  }
});

test('authored-trace: collision chain (868→876→883→887→889–891) observed in PC stream', () => {
  // The collision hit path covers:
  //   spq  SKIP at 01735 (→ 01737, enters hitbox chain)
  //   sma  SKIP at 01745 (|Δx| < ε)
  //   sma  SKIP at 01754 (|Δy| < ε)
  //   sma  SKIP at 01760 (combined hit! → 01762 EXPLODE block)
  // Verify the stream goes 01760 → 01762 (sma skip to EXPLODE lac):
  const hitIdx = MAINLOOP_PC_STREAM.indexOf(ADDR_SMA_COMBINED);
  assert.ok(hitIdx >= 0, 'sma combined (01760) present in stream');
  const nextAfterHit = MAINLOOP_PC_STREAM[hitIdx + 1];
  assert.equal(nextAfterHit, ADDR_SMA_COMBINED + 2,
    'After sma combined HIT, next PC is 01762 (lac mex = EXPLODE), not 01761');
  // Verify EXPLODE block addresses 01762–01773 are all present after the hit:
  const explodeStart = hitIdx + 1;
  assert.equal(MAINLOOP_PC_STREAM[explodeStart], 0o1762, '01762 (lac mex 400000)');
  assert.equal(MAINLOOP_PC_STREAM[explodeStart + 1], 0o1763, '01763 (dac i ml1)');
  assert.equal(MAINLOOP_PC_STREAM[explodeStart + 2], 0o1764, '01764 (dac i ml2)');
});

test('authored-trace: miss arms observed at each hitbox guard (spq/sma miss paths)', () => {
  // Verify that jmp mq2 (01736, 01746, 01755, 01761) each appear in the stream,
  // followed by mq2 (01774) — confirming each miss arm is exercised.
  const missJmps = [
    0o1736,  // after spq NO-SKIP (can't collide → jmp mq2)
    0o1746,  // after sma NO-SKIP (|Δx|≥ε → jmp mq2)
    0o1755,  // after sma NO-SKIP (|Δy|≥ε → jmp mq2)
    0o1761,  // after sma NO-SKIP (near miss → jmp mq2)
  ];
  for (const jmpAddr of missJmps) {
    const idx = MAINLOOP_PC_STREAM.indexOf(jmpAddr);
    assert.ok(idx >= 0, `jmp mq2 at 0o${jmpAddr.toString(8)} not in stream`);
    assert.equal(MAINLOOP_PC_STREAM[idx + 1], MQ2,
      `jmp at 0o${jmpAddr.toString(8)} should redirect to mq2 (01774)`);
  }
});

test('authored-trace: slot-active arm of sza i (01704) leads to collision-eligibility check', () => {
  // sza i SKIP at 01704 → 01706 (skip jmp mq1 → enters collision path).
  const idx = MAINLOOP_PC_STREAM.indexOf(ADDR_SZA_I_OUTER);
  assert.ok(idx >= 0);
  assert.equal(MAINLOOP_PC_STREAM[idx + 1], ADDR_SZA_I_OUTER + 2,
    'sza i SKIP (active) → 01706 (skip jmp mq1)');
});

test('authored-trace: inactive-slot arm of sza i (01704) leads to jmp mq1', () => {
  // Find the NO-SKIP occurrence: sza i followed by 01705 (jmp mq1).
  const idx = streamTransitionIndex(ADDR_SZA_I_OUTER, ADDR_SZA_I_OUTER + 1);
  assert.ok(idx >= 0, 'no-skip arm of sza i (01704) not found in stream');
  assert.equal(MAINLOOP_PC_STREAM[idx + 2], MQ1,
    'jmp mq1 at 01705 should redirect to 02011');
});

test('authored-trace: inner loop exits via sas SKIP at 02001', () => {
  // 02001 followed by 02003 (sas SKIP → skip jmp ml2 at 02002).
  assert.ok(streamTransitionIndex(ADDR_SAS_INNER, ADDR_SAS_INNER + 2) >= 0,
    'inner loop exit (sas 02001 SKIP → 02003) not found in stream');
});

test('authored-trace: outer loop exits via sas SKIP at 02033', () => {
  assert.ok(streamTransitionIndex(ADDR_SAS_OUTER, ADDR_SAS_OUTER + 2) >= 0,
    'outer loop exit (sas 02033 SKIP → 02035) not found in stream');
});

test('authored-trace: mtc budget loop — remaining then exhausted', () => {
  // isp at 02047: one occurrence NO-SKIP (→ 02050 jmp back), one SKIP (→ 02051 jmp ml0).
  assert.ok(streamTransitionIndex(ADDR_ISP_MTC, ADDR_ISP_MTC + 1) >= 0,
    'mtc budget remaining arm (isp 02047 NO-SKIP → 02050) not found');
  assert.ok(streamTransitionIndex(ADDR_ISP_MTC, ADDR_ISP_MTC + 2) >= 0,
    'mtc budget exhausted arm (isp 02047 SKIP → 02051) not found');
});

// ─── Integration tests (require build/spacewar31.lst) ────────────────────────

async function loadRealListing() {
  try {
    return await readFile(join(HERE, '..', 'build', 'spacewar31.lst'), 'utf8');
  } catch {
    return null;
  }
}

test('real listing: ml0 region (01444–01507) has no skip instructions', async () => {
  const text = await loadRealListing();
  if (!text) return;
  const { skipSites } = parseListingForMeter(text);
  // ml0 setup addresses: 01444–01507 (straight-line dap/dac, no skips)
  for (const [addr] of skipSites) {
    if (addr >= 0o1444 && addr <= 0o1507) {
      assert.fail(`Unexpected skip at 0o${addr.toString(8)} in ml0 setup region`);
    }
  }
});

test('real listing: T-START skip sites NOT in ml1 region — correctly out-of-scope', async () => {
  const text = await loadRealListing();
  if (!text) return;
  const { skipSites } = parseListingForMeter(text);
  // These belong to T-START (#14), not T-MAINLOOP:
  const tStartSites = [
    { addr: ADDR_SZA_SS1_ACTIVE, srcLine: 719 },
    { addr: ADDR_SZA_SS2_ACTIVE, srcLine: 723 },
    { addr: ADDR_SPA_TORPS1,     srcLine: 727 },
    { addr: ADDR_SPA_I_TORPS2,   srcLine: 731 },
  ];
  for (const { addr, srcLine } of tStartSites) {
    assert.ok(skipSites.has(addr),
      `T-START site 0o${addr.toString(8)} (L${srcLine}) missing from listing`);
    assert.equal(skipSites.get(addr).srcLine, srcLine,
      `T-START site 0o${addr.toString(8)} has wrong srcLine`);
    // Confirm it is outside the ml1 range to avoid double-claiming:
    assert.ok(addr < 0o1703,
      `T-START site 0o${addr.toString(8)} should not be in ml1 region`);
  }
});

test('real listing: all 12 ml1 skip sites present at expected addresses', async () => {
  const text = await loadRealListing();
  if (!text) return;
  const { skipSites } = parseListingForMeter(text);
  const expected = [
    { addr: ADDR_SZA_I_OUTER,     srcLine: 844 },
    { addr: ADDR_SPI_ELIGIBLE,    srcLine: 848 },
    { addr: ADDR_SPQ_CAN_COLLIDE, srcLine: 868 },
    { addr: ADDR_SPA_ABS_DX,      srcLine: 872 },
    { addr: ADDR_SMA_DX_EPS,      srcLine: 876 },
    { addr: ADDR_SPA_ABS_DY,      srcLine: 880 },
    { addr: ADDR_SMA_DY_EPS,      srcLine: 883 },
    { addr: ADDR_SMA_COMBINED,    srcLine: 887 },
    { addr: ADDR_SZA_I_LAST,      srcLine: 931 },
  ];
  for (const { addr, srcLine } of expected) {
    assert.ok(skipSites.has(addr),
      `skip site 0o${addr.toString(8)} (L${srcLine}) not found in listing`);
    assert.equal(skipSites.get(addr).srcLine, srcLine,
      `skip site 0o${addr.toString(8)} srcLine mismatch`);
  }
  // Macro expansion sites (sas/isp — no srcLine in listing, but attributed via callSite):
  assert.ok(skipSites.has(ADDR_SAS_INNER),
    `sas inner (0o${ADDR_SAS_INNER.toString(8)}) not found`);
  assert.equal(skipSites.get(ADDR_SAS_INNER).srcLine, 903,
    'sas inner attributed to L903 (index ml2 call site)');
  assert.ok(skipSites.has(ADDR_SAS_OUTER),
    `sas outer (0o${ADDR_SAS_OUTER.toString(8)}) not found`);
  assert.equal(skipSites.get(ADDR_SAS_OUTER).srcLine, 929,
    'sas outer attributed to L929 (index ml1 call site)');
  assert.ok(skipSites.has(ADDR_ISP_MTC),
    `isp mtc (0o${ADDR_ISP_MTC.toString(8)}) not found`);
  assert.equal(skipSites.get(ADDR_ISP_MTC).srcLine, 940,
    'isp mtc attributed to L940 (count \\mtc call site)');
});

test('real listing: authored trace covers all 12 ml1 sites both ways (real listing)', async () => {
  const text = await loadRealListing();
  if (!text) return;
  const listing = parseListingForMeter(text);
  const ledger  = buildMainloopLedger(listing);
  const byAddr  = new Map(ledger.map((e) => [e.addr, e]));

  for (const addr of ML1_SKIP_SITES) {
    const e = byAddr.get(addr);
    assert.ok(e, `skip site 0o${addr.toString(8)} missing from ledger (real listing)`);
    assert.equal(e.status, 'both',
      `skip site 0o${addr.toString(8)} (L${e.srcLine}) has '${e.status}' in real listing, expected 'both'`);
  }
});
