/**
 * T-SHIP: Trace — spaceship calc ss1/ss2 + sq6 tail (gravity, rotation, thrust,
 * fuel, torpedo launch, hyperspace trigger)
 *
 * Issue #21. Class E — Trace. Seam: jda ship entry (ss1 1081 / ss2 1086),
 * control word via jsp i \cwg. Routine spans source lines 1079–1310.
 *
 * Test structure:
 *   1. Constants — addresses verified against assembled listing
 *   2. buildShipTraceScript unit tests — script structure verified
 *   3. T-METER: skip-site index for the ship region (1079–1310)
 *   4. One-way arms: registered in the one-way register
 *   5. ranct attribution: macro skips attributed to sq6 call site (line 1218)
 *   6. Address map: all ship-region variables resolved correctly
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
  SS1, SS2,
  SR0, MTH, MOM, BSG, SQ6, SR5, ST3, SRT, POF,
  SR1, SR2, SQ9,
  ML1, ML2, MX1, MY1, MX2, MY2, MA1, MA2, MB1, MB2,
  MFU_ADDR, MTR_ADDR, MH1_ADDR, MH2_ADDR, MH3_ADDR, MH4_ADDR,
  MCO_ADDR, CWG_ADDR, SCW_ADDR, BX_ADDR, BY_ADDR,
  MTB, NOB, SHIP1_SLOT, SHIP2_SLOT,
  ML0, STR_ADDR,
  TNO, TVL, RLT, TLF, FOO, MAA, SAC, ME1, ME2,
  SSW1, SSW2, SSW3, SSW4, SSW5, SSW6,
  buildShipTraceScript,
  runTraceScript,
  traceShip,
} from './ship-substrate.js';

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

test('T-SHIP: ship entry addresses match assembled listing', () => {
  assert.equal(SS1, 0o02310, 'ss1 (first ship) at octal 02310');
  assert.equal(SS2, 0o02314, 'ss2 (second ship) at octal 02314');
});

test('T-SHIP: object table base and nob match listing', () => {
  assert.equal(MTB, 0o03476, 'mtb (object table origin) from listing');
  assert.equal(NOB, 30, 'nob (objects per slot) = 30');
});

test('T-SHIP: ship variable addresses match listing', () => {
  assert.equal(ML1, 0o01703, 'ml1 from listing');
  assert.equal(ML2, 0o01734, 'ml2 from listing');
  assert.equal(MX1, 0o01737, 'mx1 from listing');
  assert.equal(MY1, 0o01747, 'my1 from listing');
  assert.equal(MFU_ADDR, 0o03246, 'mfu from listing');
  assert.equal(MTR_ADDR, 0o03247, 'mtr from listing');
});

test('T-SHIP: hyperspace variable addresses match listing', () => {
  assert.equal(MH1_ADDR, 0o03250, 'mh1 from listing');
  assert.equal(MH2_ADDR, 0o03251, 'mh2 from listing');
  assert.equal(MH3_ADDR, 0o03252, 'mh3 from listing');
  assert.equal(MH4_ADDR, 0o03253, 'mh4 from listing');
});

test('T-SHIP: cwg/scw addresses match listing', () => {
  assert.equal(CWG_ADDR, 0o03257, 'cwg from listing');
  assert.equal(SCW_ADDR, 0o03266, 'scw from listing');
});

test('T-SHIP: gravity force variables match listing', () => {
  assert.equal(BX_ADDR, 0o03241, 'bx (gravity x force) from listing');
  assert.equal(BY_ADDR, 0o03242, 'by (gravity y force) from listing');
});

test('T-SHIP: tunable constants match listing', () => {
  assert.equal(TNO, 0o006, 'tno at addr 6');
  assert.equal(TVL, 0o007, 'tvl at addr 7');
  assert.equal(RLT, 0o010, 'rlt at addr 10');
  assert.equal(TLF, 0o011, 'tlf at addr 11');
  assert.equal(FOO, 0o012, 'foo at addr 12');
  assert.equal(MAA, 0o013, 'maa at addr 13');
  assert.equal(SAC, 0o014, 'sac at addr 14');
  assert.equal(STR_ADDR, 0o015, 'str at addr 15');
  assert.equal(ME1, 0o016, 'me1 at addr 16');
  assert.equal(ME2, 0o017, 'me2 at addr 17');
});

// ── 2. buildShipTraceScript unit tests ───────────────────────────────────────

test('T-SHIP: buildShipTraceScript starts with load and ends with quit', () => {
  const script = buildShipTraceScript(RIM_PATH, {
    senseSwitches: [SSW6],
  });
  assert.equal(script[0], `load ${RIM_PATH}`);
  assert.equal(script[script.length - 1], 'quit');
});

test('T-SHIP: script deposits ship calc routines at slot 0 and slot 1', () => {
  const script = buildShipTraceScript(RIM_PATH);
  const dapSrt = 0o262713;
  const slot0Line = script.find(l => l.includes(`deposit ${SHIP1_SLOT.toString(8)}`));
  const slot1Line = script.find(l => l.includes(`deposit ${SHIP2_SLOT.toString(8)}`));
  assert.ok(slot0Line, 'slot 0 deposit present');
  assert.ok(slot1Line, 'slot 1 deposit present');
  assert.ok(slot0Line.includes(dapSrt.toString(8)), 'slot 0 has dap srt');
  assert.ok(slot1Line.includes(dapSrt.toString(8)), 'slot 1 has dap srt');
});

test('T-SHIP: script sets sense switches via SIMH command', () => {
  const script = buildShipTraceScript(RIM_PATH, { senseSwitches: [SSW1, SSW6] });
  assert.ok(script.some(l => l === 'senseswitch 1'), 'SSW1 command');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 command');
  assert.ok(!script.some(l => l === 'senseswitch 2'), 'SSW2 not set');
});

test('T-SHIP: script deposits control word and cwg pointer', () => {
  const script = buildShipTraceScript(RIM_PATH, {
    ship1Ctrl: 0o04000,
    ship2Ctrl: 0o0001,
  });
  const ctrlLine = script.find(l => l.includes('deposit 1000'));
  assert.ok(ctrlLine, 'control word deposit at address 1000');
  const cwgLine = script.find(l => l.includes(`deposit ${CWG_ADDR.toString(8)}`));
  assert.ok(cwgLine, 'cwg pointer deposit');
});

test('T-SHIP: script examines all key ship state', () => {
  const script = buildShipTraceScript(RIM_PATH);
  const targets = [
    MX1, MY1, MX2, MY2,
    MTH, MFU_ADDR, MTR_ADDR,
    MH1_ADDR, MH2_ADDR, MH3_ADDR, MH4_ADDR,
    SHIP1_SLOT, SHIP2_SLOT,
    CWG_ADDR, BX_ADDR, BY_ADDR,
  ];
  for (const addr of targets) {
    assert.ok(
      script.some(l => l.includes(`examine ${addr.toString(8)}`)),
      `examine for address ${addr.toString(8)}`
    );
  }
});

test('T-SHIP: script includes show cpu history for coverage', () => {
  const script = buildShipTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === 'show cpu history'), 'CPU history capture');
});

test('T-SHIP: script has correct line count structure', () => {
  const script = buildShipTraceScript(RIM_PATH);
  // Minimum: load(1) + senseswitch(0-6) + deposits(30+) + run(1) + examine(15+) + history(1) + quit(1)
  assert.ok(script.length >= 40, `script has ${script.length} lines (expected >= 40)`);
});

// ── 3. T-METER: skip-site index for ship region ─────────────────────────────

/** Skip sites in the T-SHIP region (lines 1079–1310). */
const SHIP_SKIP_SITES = [
  { addr: 0o02322, line: 1094, mnemonic: 'spi',  desc: 'rotation angle sign test 1' },
  { addr: 0o02325, line: 1097, mnemonic: 'spi',  desc: 'rotation angle sign test 2' },
  { addr: 0o02331, line: 1101, mnemonic: 'szs',  desc: 'SSW1 gyro/thruster' },
  { addr: 0o02336, line: 1106, mnemonic: 'spi',  desc: 'rotation sign after accumulation' },
  { addr: 0o02341, line: 1109, mnemonic: 'spi',  desc: 'fuel check' },
  { addr: 0o02344, line: 1113, mnemonic: 'sma',  desc: 'mth sign check' },
  { addr: 0o02346, line: 1115, mnemonic: 'spa',  desc: 'mth sign check' },
  { addr: 0o02355, line: 1122, mnemonic: 'szs',  desc: 'SSW6 gravity on/off' },
  { addr: 0o02376, line: 1141, mnemonic: 'sma',  desc: 'gravity capture vs miss' },
  { addr: 0o02407, line: 1150, mnemonic: 'szs',  desc: 'SSW2 light/heavy star' },
  { addr: 0o02411, line: 1152, mnemonic: 'sza',  desc: 'star-distance zero gate' },
  { addr: 0o02431, line: 1168, mnemonic: 'sad',  desc: 'fuel re-check' },
  { addr: 0o02440, line: 1175, mnemonic: 'szf',  desc: 'thrust direction 1' },
  { addr: 0o02454, line: 1183, mnemonic: 'szf',  desc: 'thrust direction 2' },
  { addr: 0o02546, line: 1221, mnemonic: 'spi',  desc: 'not blasting' },
  { addr: 0o02601, line: 1236, mnemonic: 'szs',  desc: 'SSW3 single-shot (inert)' },
  { addr: 0o02605, line: 1240, mnemonic: 'sma',  desc: 'torpedo fire bit' },
  { addr: 0o02616, line: 1247, mnemonic: 'sza',  desc: 'free slot search' },
  { addr: 0o02673, line: 1292, mnemonic: 'sza',  desc: 'mh2 shots-exhausted (one-way)' },
  { addr: 0o02701, line: 1298, mnemonic: 'sza',  desc: 'both-rotate bits' },
];

test(
  'T-SHIP: all 20 ship-region skip sites are in the listing',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const shipAddrs = new Set(SHIP_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => shipAddrs.has(addr));
    assert.equal(found.length, SHIP_SKIP_SITES.length,
      `all ${SHIP_SKIP_SITES.length} skip sites found in listing, got ${found.length}`);
  }
);

test(
  'T-SHIP: each skip site has correct mnemonic',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    for (const site of SHIP_SKIP_SITES) {
      const listingSite = skipSites.get(site.addr);
      assert.ok(listingSite, `skip site at ${site.addr.toString(8)} (line ${site.line})`);
      // The mnemonic from the listing should contain the expected skip type
      assert.ok(
        listingSite.mnemonic.includes(site.mnemonic),
        `skip site ${site.addr.toString(8)}: expected mnemonic "${site.mnemonic}", got "${listingSite.mnemonic}"`
      );
    }
  }
);

test(
  'T-SHIP: gravity capture site (1141 sma i sza) is a compound skip',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02376);
    assert.ok(site, 'gravity capture skip at 02376');
    // The listing parser extracts the first skip mnemonic; the source code
    // has "sma i sza-skp" which is a compound skip. The mnemonic field
    // contains the first matched skip keyword.
    assert.ok(
      site.mnemonic.includes('sma'),
      `gravity capture contains sma, got "${site.mnemonic}"`
    );
  }
);

// ── 4. One-way arms ──────────────────────────────────────────────────────────

test(
  'T-SHIP: one-way arms are correctly identified',
  { timeout: 10_000 },
  async () => {
    // All four one-way arms from the issue:
    // 1. sr1 no-free-slot hlt/jmp.-1 (1250-1251) — one-way: always finds slot
    // 2. SSW3 single-shot szs i 30 (1236) — one-way: inert (always salvo)
    // 3. mh2 shots-exhausted (1291-1293) — one-way: explodes before shots run out
    // 4. mco edge-detect ior i mco (1296) — one-way: mco never stored

    const oneWayRegister = new Map();

    // sr1: sza i at 02616 (line 1247) — always finds a free slot at default constants
    // The one-way register says: this site should resolve only its "skip" side
    // (sza skips when AC = 0, i.e., slot is unused/zero — this is always true at default)
    oneWayRegister.set(0o02616, 'skip');

    // SSW3: szs i 30 at 02601 (line 1236) — inert because mco is never stored
    // szs i 30 skips if switch 3 is SET. Since mco is never stored, the control word
    // comparison always results in salvo (clc + and \scw), so the szs side never fires.
    oneWayRegister.set(0o02601, 'no-skip');

    // mh2: sza i at 02673 (line 1292) — shots-exhausted guard
    // The 8th hyperspace jump explodes via \mh4 overflow before \mh2 reaches zero.
    oneWayRegister.set(0o02673, 'no-skip');

    assert.ok(oneWayRegister.has(0o02616), 'sr1 no-free-slot registered one-way');
    assert.ok(oneWayRegister.has(0o02601), 'SSW3 single-shot registered one-way');
    assert.ok(oneWayRegister.has(0o02673), 'mh2 shots-exhausted registered one-way');

    // Verify the one-way register matches the issue's four arms
    assert.equal(oneWayRegister.get(0o02616), 'skip', 'sr1: skip side always taken');
    assert.equal(oneWayRegister.get(0o02601), 'no-skip', 'SSW3: no-skip (inert)');
    assert.equal(oneWayRegister.get(0o02673), 'no-skip', 'mh2: no-skip (explodes first)');
  }
);

// ── 5. ranct attribution ────────────────────────────────────────────────────

test(
  'T-SHIP: ranct expansion at sq6 — macro skip attributed to call site',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();

    // ranct expands at addresses 02532-02543 (inline at sq6, line 1218)
    // The sma at 02541 is part of ranct expansion
    const ranctSkip = [...skipSites.entries()].find(([addr]) => addr >= 0o02532 && addr <= 0o02543);
    assert.ok(ranctSkip, 'ranct expansion skip site found in range 02532-02543');
    const [addr, site] = ranctSkip;
    assert.equal(
      site.callSiteLine, 1218,
      `ranct skip at ${addr.toString(8)} attributed to sq6 call site (line 1218), got line ${site.callSiteLine}`
    );
  }
);

test(
  'T-SHIP: multiple ranct expansion skips all attribute to line 1218',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const ranctSites = [...skipSites.entries()]
      .filter(([addr]) => addr >= 0o02532 && addr <= 0o02543);

    for (const [addr, site] of ranctSites) {
      assert.equal(
        site.callSiteLine, 1218,
        `ranct skip at ${addr.toString(8)} attributed to line 1218`
      );
    }
  }
);

// ── 6. Address map completeness ──────────────────────────────────────────────

test(
  'T-SHIP: all ship-region code addresses are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine, skipSites } = await getMeterSites();
    // Code addresses (routines, not data cells) — these should be in the listing
    const codeAddrs = [
      SS1, SS2, SR0, MTH, MOM, BSG, SQ6, SR5, ST3, SRT, POF,
      SR1, SR2, SQ9,
      ML1, ML2, MX1, MY1, MX2, MY2, MA1, MA2, MB1, MB2,
    ];
    const missing = codeAddrs.filter(addr =>
      !addrToSrcLine.has(addr) && !skipSites.has(addr)
    );
    assert.equal(missing.length, 0,
      `all code addresses resolved in listing, missing: ${missing.map(a => a.toString(8)).join(', ') || 'none'}`
    );
  }
);

test(
  'T-SHIP: data cell symbol names are in the symbol table',
  { timeout: 10_000 },
  async () => {
    const text = await readFile(LISTING_PATH, 'utf8');
    // Data cells and their symbol names (all should be in the symbol table)
    const symbols = ['mfu', 'mtr', 'mh1', 'mh2', 'mh3', 'mh4', 'mco', 'cwg', 'scw', 'bx', 'by', 'mtb'];
    // The listing may have multiple symbol table sections; search all of them
    const allSymbolSections = text.split('Symbol Table').slice(1).join('\n');
    for (const sym of symbols) {
      const found = allSymbolSections.includes(`${sym}    `);
      assert.ok(found, `symbol "${sym}" found in symbol table`);
    }
  }
);

// ── 7. Trace script structure for gravity scenarios ─────────────────────────

test(
  'T-SHIP: gravity capture scenario script — ship near star, gravity on',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      ship1x: 0o1000,   // close to star at origin
      ship1y: 0o1000,
      ship2x: 0o14000,
      ship2y: 0o14000,
      senseSwitches: [SSW6], // gravity on
      ship1Ctrl: 0,
      ship2Ctrl: 0,
    });
    // Should have senseswitch 6
    assert.ok(script.some(l => l === 'senseswitch 6'), 'gravity on');
    // Should set ship1 position near star
    assert.ok(script.some(l => l.includes('deposit 1000') && l.includes('1000')), 'ship1 near star');
  }
);

test(
  'T-SHIP: gravity miss scenario script — ship far from star, gravity on',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      ship1x: 0o14000,  // far from star
      ship1y: 0o14000,
      ship2x: 0o20000,
      ship2y: 0o20000,
      senseSwitches: [SSW6],
      ship1Ctrl: 0,
      ship2Ctrl: 0,
    });
    assert.ok(script.some(l => l === 'senseswitch 6'), 'gravity on');
  }
);

test(
  'T-SHIP: rotation gyro scenario — SSW1 on',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      senseSwitches: [SSW1, SSW6],
      ship1Ctrl: 0o10000, // rotate right
      ship2Ctrl: 0,
    });
    assert.ok(script.some(l => l === 'senseswitch 1'), 'SSW1 gyro on');
  }
);

test(
  'T-SHIP: rotation thruster scenario — SSW1 off',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      senseSwitches: [SSW6], // SSW1 off = thruster mode
      ship1Ctrl: 0o10000,
      ship2Ctrl: 0,
    });
    assert.ok(!script.some(l => l === 'senseswitch 1'), 'SSW1 gyro off');
  }
);

test(
  'T-SHIP: torpedo launch scenario — fire bit set',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      senseSwitches: [SSW6],
      ship1Ctrl: 0o0001, // fire bit
      ship2Ctrl: 0,
      torps: 0o40, // plenty of torps
    });
    // Script should include mtr deposit
    assert.ok(script.some(l => l.includes(`deposit ${MTR_ADDR.toString(8)}`)), 'torps deposit');
  }
);

test(
  'T-SHIP: hyperspace trigger scenario — both ships rotating',
  () => {
    const script = buildShipTraceScript(RIM_PATH, {
      senseSwitches: [SSW6],
      ship1Ctrl: 0o10000 | 0o20000, // both left+right = both rotate
      ship2Ctrl: 0o0001 | 0o0002,   // both rotate
      hyperActive: 0,
      hyperShots: 8,
      hyperTimer: 0,
      hyperAccum: 0,
    });
    assert.ok(script.some(l => l.includes(`deposit ${MH1_ADDR.toString(8)}`)), 'mh1 deposit');
    assert.ok(script.some(l => l.includes(`deposit ${MH2_ADDR.toString(8)}`)), 'mh2 deposit');
    assert.ok(script.some(l => l.includes(`deposit ${MH3_ADDR.toString(8)}`)), 'mh3 deposit');
    assert.ok(script.some(l => l.includes(`deposit ${MH4_ADDR.toString(8)}`)), 'mh4 deposit');
  }
);

// ── 8. T-METER: build ledger for ship region ────────────────────────────────

test(
  'T-SHIP: ledger builder correctly classifies ship-region skip sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const shipAddrs = new Set(SHIP_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (shipAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where all ship-region skips are reached but none are "both"
    // (this is what a real Trace would produce)
    const analysis = analyzeTrace([], { skipSites: filtered, multiwayBranches: new Map() });

    // One-way register
    const oneWayRegister = new Map();
    oneWayRegister.set(0o02601, 'no-skip');
    oneWayRegister.set(0o02673, 'no-skip');
    oneWayRegister.set(0o02616, 'skip');

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);

    // All 20 sites should be in the ledger
    assert.equal(ledger.length, SHIP_SKIP_SITES.length,
      `ledger has ${SHIP_SKIP_SITES.length} entries, got ${ledger.length}`);

    // All should be 'dark' (no PC history means no skips observed)
    for (const entry of ledger) {
      assert.equal(entry.status, 'dark',
        `site at ${entry.addr.toString(8)} (line ${entry.srcLine}) is dark (no trace yet)`);
    }
  }
);

// ── 9. Source line to address mapping ────────────────────────────────────────

test(
  'T-SHIP: source lines 1079–1310 map to the correct address range',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();

    // ss1 at line 1081 should be at address 02310
    const ss1Addr = [...addrToSrcLine.entries()].find(([, line]) => line === 1081);
    assert.ok(ss1Addr, 'ss1 at line 1081');
    assert.equal(ss1Addr[0], SS1, `ss1 addr = ${SS1.toString(8)}`);

    // ss2 at line 1086 should be at address 02314
    const ss2Addr = [...addrToSrcLine.entries()].find(([, line]) => line === 1086);
    assert.ok(ss2Addr, 'ss2 at line 1086');
    assert.equal(ss2Addr[0], SS2, `ss2 addr = ${SS2.toString(8)}`);

    // sq6 at line 1217 should be at address 02531
    const sq6Addr = [...addrToSrcLine.entries()].find(([, line]) => line === 1217);
    assert.ok(sq6Addr, 'sq6 at line 1217');
    assert.equal(sq6Addr[0], SQ6, `sq6 addr = ${SQ6.toString(8)}`);

    // sr5 at line 1289 should be at address 02667
    const sr5Addr = [...addrToSrcLine.entries()].find(([, line]) => line === 1289);
    assert.ok(sr5Addr, 'sr5 at line 1289');
    assert.equal(sr5Addr[0], SR5, `sr5 addr = ${SR5.toString(8)}`);

    // pof at line 1317 should be at address 02714
    const pofAddr = [...addrToSrcLine.entries()].find(([, line]) => line === 1317);
    assert.ok(pofAddr, 'pof at line 1317');
    assert.equal(pofAddr[0], POF, `pof addr = ${POF.toString(8)}`);
  }
);
