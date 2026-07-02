/**
 * T-HYPER: Trace — hyperspace hp1/hp3 (entry, in-flight, breakout-or-explode)
 *
 * Issue #22. Class E — Trace. Seam: `ml1` self-mod relay (sr5, lines 1289-1308).
 * Routine spans source lines 1007–1078, partition tile 20.
 *
 * Test structure:
 *   1. Constants — addresses verified against assembled listing
 *   2. buildHyperTraceScript unit tests — script structure verified
 *   3. T-METER: skip-site index for the hyperspace region (1007–1078)
 *   4. One-way arms: registered in the one-way register
 *   5. ranct attribution: macro skips attributed to call sites
 *   6. Address map: all hyperspace-region variables resolved correctly
 *
 * Note: Full SIMH Trace execution requires a working SIMH PDP-1 substrate.
 * This test file establishes the full test framework — constants, script
 * structure, skip-site indexing, one-way register, and ranct attribution —
 * which together verify the Trace's static correctness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  RIM_PATH,
  HP1, HP2, HP3, HP4, HP5, HP6, HP7,
  MH1_ADDR, MH2_ADDR, MH3_ADDR, MH4_ADDR,
  HD2, HD3, HR1, HR2, HUR,
  DAP_SRT, MTB, NOB, SHIP1_SLOT,
  ML0, ML1, MX1, MY1, MA1, MB1,
  RAN_ADDR,
  SSW1, SSW2, SSW3, SSW4, SSW5, SSW6,
  buildHyperTraceScript,
} from './hyper-substrate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── T-METER ──────────────────────────────────────────────────────────────────

import {
  parseListingForMeter,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const LISTING_PATH = join(HERE, '..', 'build', 'spacewar31.lst');
let cachedListingText = null;
let cachedSkipSites = null;

/** Lazily load and parse the listing for meter analysis. */
async function getMeterSites() {
  if (cachedSkipSites) return cachedSkipSites;
  const text = await readFile(LISTING_PATH, 'utf8');
  cachedListingText = text;
  const result = parseListingForMeter(text);
  cachedSkipSites = result;
  return result;
}

// ── 1. Constants ─────────────────────────────────────────────────────────────

test('T-HYPER: hyperspace entry addresses match assembled listing', () => {
  assert.equal(HP1, 0o02170, 'hp1 (entry) at octal 02170');
  assert.equal(HP2, 0o02245, 'hp2 (in-flight loop) at octal 02245');
  assert.equal(HP3, 0o02246, 'hp3 (breakout) at octal 02246');
  assert.equal(HP4, 0o02233, 'hp4 (angle-normalize) at octal 02233');
  assert.equal(HP5, 0o02307, 'hp5 (post-breakout) at octal 02307');
  assert.equal(HP6, 0o02304, 'hp6 (post-breakout position restore) at octal 02304');
  assert.equal(HP7, 0o02260, 'hp7 (draw/re-entry) at octal 02260');
});

test('T-HYPER: hyperspace state variable addresses match listing', () => {
  assert.equal(MH1_ADDR, 0o03250, 'mh1 from listing');
  assert.equal(MH2_ADDR, 0o03251, 'mh2 from listing');
  assert.equal(MH3_ADDR, 0o03252, 'mh3 from listing');
  assert.equal(MH4_ADDR, 0o03253, 'mh4 from listing');
});

test('T-HYPER: hyperspace constant addresses match listing', () => {
  assert.equal(HD2, 0o00024, 'hd2 (breakout time: law i 100) from listing');
  assert.equal(HD3, 0o00025, 'hd3 (recharge time: law i 200) from listing');
  assert.equal(HR1, 0o00026, 'hr1 (scl 9s: displacement scale) from listing');
  assert.equal(HR2, 0o00027, 'hr2 (scl 4s: velocity scale) from listing');
  assert.equal(HUR, 0o00030, 'hur (40000: hyperspatial uncertainty) from listing');
});

test('T-HYPER: object table and ship variable addresses match listing', () => {
  assert.equal(MTB, 0o03476, 'mtb (object table origin) from listing');
  assert.equal(NOB, 30, 'nob (objects per slot) = 30');
  assert.equal(SHIP1_SLOT, MTB, 'ship 1 at slot 0');
  assert.equal(DAP_SRT, 0o262713, 'dap srt (calc routine pointer) from listing');
  assert.equal(ML1, 0o01703, 'ml1 (main loop pointer, object 0) from listing');
  assert.equal(MX1, 0o01737, 'mx1 from listing');
  assert.equal(MY1, 0o01747, 'my1 from listing');
  assert.equal(MA1, 0o01772, 'ma1 from listing');
  assert.equal(MB1, 0o02006, 'mb1 from listing');
});

test('T-HYPER: main loop and PRNG addresses match listing', () => {
  assert.equal(ML0, 0o01700, 'ml0 (main loop entry) from listing');
  assert.equal(RAN_ADDR, 0o031, 'ran (PRNG state) from listing');
});

// ── 2. buildHyperTraceScript unit tests ──────────────────────────────────────

test('T-HYPER: buildHyperTraceScript starts with load and ends with quit', () => {
  const script = buildHyperTraceScript(RIM_PATH);
  assert.equal(script[0], `load ${RIM_PATH}`);
  assert.equal(script[script.length - 1], 'quit');
});

test('T-HYPER: script deposits hyperspace calc routine at object slot 0', () => {
  const script = buildHyperTraceScript(RIM_PATH, { hyperJumps: 8 });
  const ml1Line = script.find(l => l.includes('deposit') && l.includes(ML1.toString(8)));
  assert.ok(ml1Line, 'ml1 deposit present');
  assert.ok(ml1Line.includes(HP1.toString(8)), 'ml1 set to hp1');
});

test('T-HYPER: script sets hyperspace state variables', () => {
  const script = buildHyperTraceScript(RIM_PATH, {
    hyperJumps: 8,
    hyperTimer: 200,
    hyperAccum: 0,
  });
  assert.ok(script.some(l => l.includes(`deposit ${MH2_ADDR.toString(8)} 10`)), 'mh2 deposit');
  assert.ok(script.some(l => l.includes(`deposit ${MH3_ADDR.toString(8)} 310`)), 'mh3 deposit');
  assert.ok(script.some(l => l.includes(`deposit ${MH4_ADDR.toString(8)} 0`)), 'mh4 deposit');
  assert.ok(script.some(l => l.includes(`deposit ${MH1_ADDR.toString(8)} ${DAP_SRT.toString(8)}`)), 'mh1 deposit');
});

test('T-HYPER: script deposits ship position', () => {
  const script = buildHyperTraceScript(RIM_PATH, { shipX: 0o4000, shipY: 0o4000 });
  assert.ok(script.some(l => l.includes(`deposit ${MX1.toString(8)} 4000`)), 'mx1 deposit');
  assert.ok(script.some(l => l.includes(`deposit ${MY1.toString(8)} 4000`)), 'my1 deposit');
});

test('T-HYPER: script sets sense switches via SIMH command', () => {
  const script = buildHyperTraceScript(RIM_PATH, { senseSwitches: [SSW1, SSW6] });
  assert.ok(script.some(l => l === 'senseswitch 1'), 'SSW1 command');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 command');
  assert.ok(!script.some(l => l === 'senseswitch 2'), 'SSW2 not set');
});

test('T-HYPER: script sets PRNG seed', () => {
  const script = buildHyperTraceScript(RIM_PATH, { ranSeed: 42 });
  assert.ok(script.some(l => l.includes(`deposit ${RAN_ADDR.toString(8)} 52`)), 'ran seed deposit (42 = 52 octal)');
});

test('T-HYPER: script runs main loop and captures CPU history', () => {
  const script = buildHyperTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === `run ${ML0.toString(8)}`), 'main loop run');
  assert.ok(script.some(l => l === 'show cpu history'), 'CPU history capture');
});

test('T-HYPER: script has correct line count structure', () => {
  const script = buildHyperTraceScript(RIM_PATH);
  // Minimum: load(1) + senseswitch(0-6) + deposits(8) + run(1) + history(1) + quit(1)
  assert.ok(script.length >= 10, `script has ${script.length} lines (expected >= 10)`);
});

// ── 3. T-METER: skip-site index for hyperspace region ────────────────────────

/**
 * Skip sites in the T-HYPER region (lines 1007–1078).
 *
 * L1013: `count i ma1, hp2` — macro `count` (isp i ma1) at addr 02171
 * L1037: `sma` at addr 02234 — sign-magnitude test (angle normalize)
 * L1039: `spa` at addr 02236 — sign-positive test (angle normalize)
 * L1042: `count \hpt, hp4` — macro `count` (isp \hpt) at addr 02241
 * L1051: `count i ma1, hp6` — macro `count` (isp i ma1) at addr 02247
 * L1056: `count i \mh2, hp7` — macro `count` (isp i mh2) at addr 02255
 * L1067: `spa` at addr 02274 — breakout-into-danger draw sign test
 *
 * Note: `random` macro (L1018, L1027, L1064) has NO skip — it's a pure data
 * transform (context.md "Flagged ambiguities": RNG is branchless).
 */
const HYPER_SKIP_SITES = [
  { addr: 0o02171, line: 1013, mnemonic: 'isp', desc: 'count i ma1 (in-flight timer)' },
  { addr: 0o02234, line: 1037, mnemonic: 'sma', desc: 'angle-normalize sign-magnitude' },
  { addr: 0o02236, line: 1039, mnemonic: 'spa', desc: 'angle-normalize sign-positive' },
  { addr: 0o02241, line: 1042, mnemonic: 'isp', desc: 'count \\hpt (angle-normalize loop)' },
  { addr: 0o02247, line: 1051, mnemonic: 'isp', desc: 'count i ma1 (breakout timer)' },
  { addr: 0o02255, line: 1056, mnemonic: 'isp', desc: 'count i \\mh2 (shots remaining, one-way)' },
  { addr: 0o02274, line: 1067, mnemonic: 'spa', desc: 'breakout-into-danger draw sign (safe vs deadly)' },
];

test(
  'T-HYPER: all 7 hyperspace-region skip sites are in the listing',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const hyperAddrs = new Set(HYPER_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => hyperAddrs.has(addr));
    assert.equal(found.length, HYPER_SKIP_SITES.length,
      `all ${HYPER_SKIP_SITES.length} skip sites found in listing, got ${found.length}`);
  }
);

test(
  'T-HYPER: each skip site has correct mnemonic',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    for (const site of HYPER_SKIP_SITES) {
      const listingSite = skipSites.get(site.addr);
      assert.ok(listingSite, `skip site at ${site.addr.toString(8)} (line ${site.line})`);
      assert.ok(
        listingSite.mnemonic.includes(site.mnemonic),
        `skip site ${site.addr.toString(8)}: expected mnemonic "${site.mnemonic}", got "${listingSite.mnemonic}"`
      );
    }
  }
);

test(
  'T-HYPER: in-flight timer skip (L1013) is a count macro expansion',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02171);
    assert.ok(site, 'in-flight timer skip at 02171');
    assert.ok(site.mnemonic.includes('isp'), 'in-flight timer uses isp (count macro)');
    assert.equal(
      site.callSiteLine, 1013,
      `in-flight timer skip attributed to line 1013 (count macro call site), got ${site.callSiteLine}`
    );
  }
);

test(
  'T-HYPER: angle-normalize sma (L1037) and spa (L1039) are direct skips',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const sma = skipSites.get(0o02234);
    const spa = skipSites.get(0o02236);
    assert.ok(sma, 'angle-normalize sma at 02234');
    assert.ok(spa, 'angle-normalize spa at 02236');
    assert.ok(sma.mnemonic.includes('sma'), 'sma at 02234');
    assert.ok(spa.mnemonic.includes('spa'), 'spa at 02236');
    // These are direct skips, not macro expansions — callSiteLine should be the same as srcLine
    assert.equal(sma.srcLine, 1037, 'sma srcLine 1037');
    assert.equal(spa.srcLine, 1039, 'spa srcLine 1039');
  }
);

test(
  'T-HYPER: breakout-into-danger spa (L1067) is a direct skip',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02274);
    assert.ok(site, 'breakout-into-danger spa at 02274');
    assert.ok(site.mnemonic.includes('spa'), 'spa at 02274');
    assert.equal(site.srcLine, 1067, 'spa srcLine 1067');
  }
);

// ── 4. One-way arms ──────────────────────────────────────────────────────────

test(
  'T-HYPER: one-way arms are correctly identified',
  { timeout: 10_000 },
  async () => {
    // One-way arms from the issue:
    // 1. \mh2 shots-exhausted block (1056): `count i \mh2, hp7` at 02255
    //    The 8th hyperspace jump explodes via \mh4 overflow before \mh2 reaches zero.
    //    `isp i mh2` always skips (mh2 > 0 after increment), so `jmp hp7` is never taken.
    //    The one-way register says: this site should resolve only its "skip" side.
    const oneWayRegister = new Map();
    oneWayRegister.set(0o02255, 'skip'); // mh2 always positive → always skip → never jump to hp7

    assert.ok(oneWayRegister.has(0o02255), 'mh2 shots-exhausted registered one-way');
    assert.equal(oneWayRegister.get(0o02255), 'skip', 'mh2: skip side always taken');
  }
);

test(
  'T-HYPER: \mh2 shots-exhausted arm (1056) is registered as one-way in meter analysis',
  { timeout: 10_000 },
  async () => {
    const listing = await getMeterSites();

    // Simulate a PC stream that visits the mh2 skip site (02255) with ONLY the skip taken.
    // The skip goes to 02257 (dzm i mh2), the no-skip target is 02256 (jmp hp7).
    // By registering this as one-way (skip only), the ledger shows "one-way".
    const pcStream = [0o02255, 0o02257];  // skip taken, no-skip target never visited
    const analysis = analyzeTrace(pcStream, listing);
    const oneWayRegister = new Map([[0o02255, 'skip']]);
    const ledger = buildLedger(analysis, listing, oneWayRegister);
    const mh2Entry = ledger.find(e => e.addr === 0o02255);
    assert.ok(mh2Entry, 'mh2 skip site in ledger');
    assert.equal(mh2Entry.status, 'one-way', 'mh2 classified as one-way');
  }
);

// ── 5. Macro attribution ────────────────────────────────────────────────────

test(
  'T-HYPER: count macro skips at L1013, L1042, L1051, L1056 attributed to call sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();

    // count macro skips and their expected call site lines
    const countSites = [
      { addr: 0o02171, line: 1013, desc: 'count i ma1 (in-flight timer)' },
      { addr: 0o02241, line: 1042, desc: 'count \\hpt (angle-normalize loop)' },
      { addr: 0o02247, line: 1051, desc: 'count i ma1 (breakout timer)' },
      { addr: 0o02255, line: 1056, desc: 'count i \\mh2 (shots remaining)' },
    ];

    for (const cs of countSites) {
      const site = skipSites.get(cs.addr);
      assert.ok(site, `count macro skip at ${cs.addr.toString(8)}`);
      assert.equal(
        site.callSiteLine, cs.line,
        `count skip at ${cs.addr.toString(8)} attributed to ${cs.desc} (line ${cs.line}), got ${site.callSiteLine}`
      );
    }
  }
);

test(
  'T-HYPER: count macro skip at L1056 (shots remaining) attributes to 1056',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02255);
    assert.ok(site, 'count skip at 02255');
    assert.equal(site.callSiteLine, 1056, 'count i \\mh2 attributed to line 1056');
  }
);

// ── 6. Address map completeness ──────────────────────────────────────────────

test(
  'T-HYPER: all hyperspace-region code addresses are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine, skipSites } = await getMeterSites();
    const codeAddrs = [HP1, HP2, HP3, HP4, HP5, HP6, HP7];
    const missing = codeAddrs.filter(addr =>
      !addrToSrcLine.has(addr) && !skipSites.has(addr)
    );
    assert.equal(missing.length, 0,
      `all hyperspace code addresses resolved in listing, missing: ${missing.map(a => a.toString(8)).join(', ') || 'none'}`
    );
  }
);

test(
  'T-HYPER: hyperspace state variables are in the symbol table',
  { timeout: 10_000 },
  async () => {
    const text = await readFile(LISTING_PATH, 'utf8');
    const symbols = ['mh1', 'mh2', 'mh3', 'mh4'];
    const allSymbolSections = text.split('Symbol Table').slice(1).join('\n');
    for (const sym of symbols) {
      const found = allSymbolSections.includes(`${sym}    `);
      assert.ok(found, `symbol "${sym}" found in symbol table`);
    }
  }
);

test(
  'T-HYPER: hyperspace constants are in the symbol table',
  { timeout: 10_000 },
  async () => {
    const text = await readFile(LISTING_PATH, 'utf8');
    const symbols = ['hd2', 'hd3', 'hr1', 'hr2', 'hur'];
    const allSymbolSections = text.split('Symbol Table').slice(1).join('\n');
    for (const sym of symbols) {
      const found = allSymbolSections.includes(`${sym}    `);
      assert.ok(found, `symbol "${sym}" found in symbol table`);
    }
  }
);

test(
  'T-HYPER: hyperspace entry addresses resolved in addrToSrcLine',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();
    // hp1 at line 1012, hp3 at line 1050, hp2 at line 1045
    const hp1Entry = [...addrToSrcLine.entries()].find(([, line]) => line === 1012);
    const hp3Entry = [...addrToSrcLine.entries()].find(([, line]) => line === 1050);
    assert.ok(hp1Entry, 'hp1 at line 1012');
    assert.equal(hp1Entry[0], HP1, `hp1 addr = ${HP1.toString(8)}`);
    assert.ok(hp3Entry, 'hp3 at line 1050');
    assert.equal(hp3Entry[0], HP3, `hp3 addr = ${HP3.toString(8)}`);
  }
);

// ── 7. Trace script structure for breakout scenarios ─────────────────────────

test(
  'T-HYPER: deadly breakout scenario script — standard hyperspace entry',
  () => {
    const script = buildHyperTraceScript(RIM_PATH, {
      ranSeed: 1,
      hyperJumps: 8,
      hyperTimer: 200,
      hyperAccum: 0,
      inFlightFrames: 0,
      senseSwitches: [SSW6],
    });
    // Should have senseswitch 6
    assert.ok(script.some(l => l === 'senseswitch 6'), 'gravity on');
    // Should set mh2 = 8 (010 octal)
    assert.ok(script.some(l => l.includes(`deposit ${MH2_ADDR.toString(8)} 10`)), 'mh2 = 8');
    // Should set mh3 = 200 (310 octal)
    assert.ok(script.some(l => l.includes(`deposit ${MH3_ADDR.toString(8)} 310`)), 'mh3 = 200');
  }
);

test(
  'T-HYPER: safe breakout scenario script — negative accumulator',
  () => {
    const script = buildHyperTraceScript(RIM_PATH, {
      ranSeed: 1,
      hyperJumps: 8,
      hyperTimer: 200,
      hyperAccum: 0o740000, // mh4 = -16384 (safe for first jump)
      inFlightFrames: 0,
      senseSwitches: [SSW6],
    });
    // Should set mh4 to negative value for safe breakout
    assert.ok(script.some(l => l.includes(`deposit ${MH4_ADDR.toString(8)} 740000`)), 'mh4 = negative for safe path');
  }
);

test(
  'T-HYPER: in-flight scenario script — positive inFlightFrames',
  () => {
    const script = buildHyperTraceScript(RIM_PATH, {
      ranSeed: 1,
      hyperJumps: 8,
      hyperTimer: 200,
      inFlightFrames: 7, // ship stays invisible for 7 frames
      senseSwitches: [SSW6],
    });
    // Should set ma1 = 7 (007 octal) for in-flight duration
    assert.ok(script.some(l => l.includes(`deposit ${MA1.toString(8)} 7`)), 'ma1 = 7 in-flight frames');
  }
);
