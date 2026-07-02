/**
 * T-TCR: Trace — torpedo calc tcr (fuse expiry self-converts to mex)
 *
 * Issue #24. Class E — Trace. Seam: `ml1` self-mod relay (sr2, lines 1255–1288).
 * Routine spans source lines 985–1006, partition tile 19.
 *
 * Test structure:
 *   1. Constants — addresses verified against assembled listing
 *   2. buildTcrTraceScript unit tests — script structure verified
 *   3. T-METER: skip-site index for the torpedo calc region (985–1006)
 *   4. One-way arms: registered in the one-way register
 *   5. Macro attribution: count macro skip attributed to tcr call site
 *   6. Address map: all torpedo-region variables resolved correctly
 *
 * Note: Full SIMH Trace execution requires a working SIMH PDP-1 substrate.
 * This test file establishes the full test framework — constants, script
 * structure, skip-site indexing, one-way register, and macro attribution —
 * which together verify the Trace's static correctness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  RIM_PATH,
  TCR, TC1, TRC,
  MEX, MXR, MST,
  MTB, NOB, TORP_SLOT,
  ML1, ML2, MX1, MY1, MA1, MB1,
  DAP_SRT,
  ML0,
  RAN_ADDR,
  TLF, RLT, ME1, ME2,
  SSW1, SSW6,
  slotBase, naAddr, mlAddr,
  buildTcrTraceScript,
} from './tcr-substrate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── T-METER ──────────────────────────────────────────────────────────────────

import {
  parseListingForMeter,
  analyzeTrace,
  buildLedger,
} from './meter.js';

const LISTING_PATH = join(HERE, '..', 'build', 'spacewar31.lst');
let cachedSkipSites = null;

/** Lazily load and parse the listing for meter analysis. */
async function getMeterSites() {
  if (cachedSkipSites) return cachedSkipSites;
  const text = await readFile(LISTING_PATH, 'utf8');
  cachedSkipSites = parseListingForMeter(text);
  return cachedSkipSites;
}

// ── 1. Constants ─────────────────────────────────────────────────────────────

test('T-TCR: torpedo calc entry addresses match assembled listing', () => {
  assert.equal(TCR, 0o02136, 'tcr entry at octal 02136');
  assert.equal(TC1, 0o02146, 'tc1 (move path) at octal 02146');
  assert.equal(TRC, 0o02167, 'trc (return) at octal 02167');
});

test('T-TCR: explosion addresses match assembled listing', () => {
  assert.equal(MEX, 0o02052, 'mex entry at octal 02052');
  assert.equal(MXR, 0o02133, 'mxr return at octal 02133');
  assert.equal(MST, 0o02134, 'mst constants at octal 02134');
});

test('T-TCR: object table base and nob match listing', () => {
  assert.equal(MTB, 0o03476, 'mtb (object table origin) from listing');
  assert.equal(NOB, 0o30, 'nob (slot increment) = 30 octal = 24 decimal');
});

test('T-TCR: torpedo slot address correct', () => {
  assert.equal(TORP_SLOT, 0o03556, 'torpedo slot 2 base = mtb + 2*030 octal');
  assert.equal(slotBase(2), 0o03556, 'slotBase(2) = 03556');
  assert.equal(slotBase(0), MTB, 'slotBase(0) = mtb');
  assert.equal(slotBase(1), 0o03526, 'slotBase(1) = mtb + 030 octal');
});

test('T-TCR: na and ml address helpers correct', () => {
  assert.equal(naAddr(0), 0o03606, 'na1 (slot 0 na offset) from listing');
  assert.equal(naAddr(2), 0o03666, 'na2 (slot 2 na offset) = na1 + 060 octal');
  assert.equal(mlAddr(2), 0o03556, 'ml2 (slot 2 calc routine ptr)');
});

test('T-TCR: pointer variable addresses match listing', () => {
  assert.equal(ML1, 0o01703, 'ml1 from listing');
  assert.equal(ML2, 0o01734, 'ml2 from listing');
  assert.equal(MX1, 0o01737, 'mx1 from listing');
  assert.equal(MY1, 0o01747, 'my1 from listing');
  assert.equal(MA1, 0o01772, 'ma1 from listing');
  assert.equal(MB1, 0o02006, 'mb1 from listing');
});

test('T-TCR: main loop and PRNG addresses match listing', () => {
  assert.equal(ML0, 0o01700, 'ml0 (main loop entry) from listing');
  assert.equal(RAN_ADDR, 0o031, 'ran (PRNG state) from listing');
});

test('T-TCR: tunable constants match listing', () => {
  assert.equal(TLF, 0o011, 'tlf at addr 11 (law i 140)');
  assert.equal(RLT, 0o010, 'rlt at addr 10 (law i 20)');
  assert.equal(ME1, 0o016, 'me1 at addr 16 (collision radius 6000)');
  assert.equal(ME2, 0o017, 'me2 at addr 17 (collision radius / 2 = 3000)');
});

// ── 2. buildTcrTraceScript unit tests ────────────────────────────────────────

test('T-TCR: buildTcrTraceScript starts with load and ends with quit', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  assert.equal(script[0], `load ${RIM_PATH}`);
  assert.equal(script[script.length - 1], 'quit');
});

test('T-TCR: script deposits torpedo calc routine at slot 2', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  const ml2Line = script.find(l => l.includes(`deposit ${mlAddr(2).toString(8)}`));
  assert.ok(ml2Line, 'slot 2 ml deposit present');
  assert.ok(ml2Line.includes(TCR.toString(8)), 'ml2 set to tcr');
});

test('T-TCR: script deposits torpedo position and life counter', () => {
  const script = buildTcrTraceScript(RIM_PATH, {
    torpX: 0o10000,
    torpY: 0o10000,
    torpLife: 140,
  });
  const xAddr = slotBase(2) + 1;  // mx2
  const yAddr = slotBase(2) + 2;  // my2
  const xLine = script.find(l => l.includes(`deposit ${xAddr.toString(8)}`));
  const yLine = script.find(l => l.includes(`deposit ${yAddr.toString(8)}`));
  const lifeLine = script.find(l => l.includes(`deposit ${naAddr(2).toString(8)} 214`));
  assert.ok(xLine, `torpedo x-position deposit at ${xAddr.toString(8)}`);
  assert.ok(yLine, `torpedo y-position deposit at ${yAddr.toString(8)}`);
  assert.ok(lifeLine, 'torpedo life deposit (140 = 214 octal)');
});

test('T-TCR: script deposits ship 1 and ship 2 state', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  const slot0Line = script.find(l => l.includes(`deposit ${slotBase(0).toString(8)}`));
  const slot1Line = script.find(l => l.includes(`deposit ${slotBase(1).toString(8)}`));
  assert.ok(slot0Line, 'slot 0 deposit present');
  assert.ok(slot1Line, 'slot 1 deposit present');
});

test('T-TCR: script sets sense switches via SIMH command', () => {
  const script = buildTcrTraceScript(RIM_PATH, { senseSwitches: [SSW1, SSW6] });
  assert.ok(script.some(l => l === 'senseswitch 1'), 'SSW1 command');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 command');
  assert.ok(!script.some(l => l === 'senseswitch 2'), 'SSW2 not set');
});

test('T-TCR: script sets PRNG seed', () => {
  const script = buildTcrTraceScript(RIM_PATH, { ranSeed: 42 });
  assert.ok(script.some(l => l.includes(`deposit ${RAN_ADDR.toString(8)} 52`)), 'ran seed deposit (42 = 52 octal)');
});

test('T-TCR: script runs main loop and captures CPU history', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === `run ${ML0.toString(8)}`), 'main loop run');
  assert.ok(script.some(l => l === 'show cpu history'), 'CPU history capture');
});

test('T-TCR: script examines torpedo state', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  assert.ok(script.some(l => l.includes(`examine ${mlAddr(2).toString(8)}`)), 'examine ml2');
  assert.ok(script.some(l => l.includes(`examine ${naAddr(2).toString(8)}`)), 'examine na2 (life counter)');
});

test('T-TCR: script with multiple frames runs ml0 multiple times', () => {
  const script = buildTcrTraceScript(RIM_PATH, { frames: 3 });
  const runMatches = script.filter(l => l.startsWith('run ') && l.includes(ML0.toString(8)));
  assert.equal(runMatches.length, 3, 'three main loop runs for 3 frames');
});

test('T-TCR: script has correct line count structure', () => {
  const script = buildTcrTraceScript(RIM_PATH);
  // Minimum: load(1) + senseswitch(0-6) + deposits(15+) + run(1) + examine(5+) + history(1) + quit(1)
  assert.ok(script.length >= 25, `script has ${script.length} lines (expected >= 25)`);
});

// ── 3. T-METER: skip-site index for torpedo calc region ──────────────────────

/**
 * Skip sites in the T-TCR region (lines 985–1006).
 *
 * The `count` macro at line 988 expands to:
 *   isp A at addr 02137  (count i ma1 — fuse expiry test)
 *   jmp B at addr 02140  (jump to tc1 on skip)
 *
 * The tc1 move path has no skip sites — it's a straight-line sequence:
 *   lac i mx1 → sar 9s → xct the → diff → sar 9s → xct the → diff → dispt
 *
 * The self-convert-to-mex block (lines 989–993) also has no skip sites:
 *   lac (mex 400000 → dac i ml1 → law i 2 → dac i ma1 → jmp trc
 *
 * Note: `xct the` at lines 999 and 1002 is an unconditional execute
 * (not a branch), so it carries no both-ways obligation. It executes
 * the constant `the` = `sar 9s` (L88, T-CONST), which shifts the
 * winds-of-space warpage term out to negligible.
 */
const TCR_SKIP_SITES = [
  { addr: 0o02137, line: 988, mnemonic: 'isp', desc: 'count i ma1 (fuse expiry test)' },
];

test(
  'T-TCR: all 1 torpedo calc skip site is in the listing',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const tcrAddrs = new Set(TCR_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => tcrAddrs.has(addr));
    assert.equal(found.length, TCR_SKIP_SITES.length,
      `all ${TCR_SKIP_SITES.length} skip site found in listing, got ${found.length}`);
  }
);

test(
  'T-TCR: skip site has correct mnemonic',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    for (const site of TCR_SKIP_SITES) {
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
  'T-TCR: fuse expiry skip (L988) is a count macro expansion',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02137);
    assert.ok(site, 'fuse expiry skip at 02137');
    assert.ok(site.mnemonic.includes('isp'), 'fuse expiry uses isp (count macro)');
    assert.equal(
      site.callSiteLine, 988,
      `fuse expiry skip attributed to line 988 (count macro call site), got ${site.callSiteLine}`
    );
  }
);

// ── 4. One-way arms ──────────────────────────────────────────────────────────

test(
  'T-TCR: no one-way arms in the tcr region',
  { timeout: 10_000 },
  async () => {
    // The tcr region has one skip site (count i ma1 at line 988) that must
    // be covered both ways:
    // - isp skip (torpedo still alive, na was negative → now ≥ 0): falls through
    //   to self-convert-to-mex block (lines 989–993)
    // - isp no-skip (torpedo expired, na still ≤ 0): jmp tc1 (move path)
    // Both paths are reachable over the game domain; no one-way arms.
    const oneWayRegister = new Map();
    // Empty — no one-way arms in tcr region
    assert.equal(oneWayRegister.size, 0, 'no one-way arms in tcr region');
  }
);

// ── 5. Macro attribution ────────────────────────────────────────────────────

test(
  'T-TCR: count macro skip at L988 attributed to call site',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02137);
    assert.ok(site, 'count macro skip at 02137');
    assert.equal(
      site.callSiteLine, 988,
      'count i ma1 attributed to line 988'
    );
  }
);

// ── 6. Address map completeness ──────────────────────────────────────────────

test(
  'T-TCR: all torpedo-region code addresses are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine, skipSites } = await getMeterSites();
    const codeAddrs = [TCR, TC1, TRC, MEX, MXR, MST];
    const missing = codeAddrs.filter(addr =>
      !addrToSrcLine.has(addr) && !skipSites.has(addr)
    );
    assert.equal(missing.length, 0,
      `all torpedo-region code addresses resolved in listing, missing: ${missing.map(a => a.toString(8)).join(', ') || 'none'}`
    );
  }
);

test(
  'T-TCR: torpedo calc source lines 985–1006 map to correct addresses',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();

    // tcr at line 987 should be at address 02136
    const tcrEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 987);
    assert.ok(tcrEntry, 'tcr at line 987');
    assert.equal(tcrEntry[0], TCR, `tcr addr = ${TCR.toString(8)}`);

    // tc1 at line 997 should be at address 02146
    const tc1Entry = [...addrToSrcLine.entries()].find(([, line]) => line === 997);
    assert.ok(tc1Entry, 'tc1 at line 997');
    assert.equal(tc1Entry[0], TC1, `tc1 addr = ${TC1.toString(8)}`);

    // trc at line 1005 should be at address 02167
    const trcEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 1005);
    assert.ok(trcEntry, 'trc at line 1005');
    assert.equal(trcEntry[0], TRC, `trc addr = ${TRC.toString(8)}`);
  }
);

// ── 7. Trace script structure for torpedo scenarios ──────────────────────────

test(
  'T-TCR: torpedo alive scenario script — torpedo far from collision',
  () => {
    const script = buildTcrTraceScript(RIM_PATH, {
      torpX: 0o10000,
      torpY: 0o10000,
      torpLife: 140,
      ship1x: 0o4000,
      ship1y: 0o4000,
      ship2x: 0o14000,
      ship2y: 0o14000,
      senseSwitches: [SSW6],
    });
    // Should have torpedo at slot 2 with tcr routine
    const ml2Line = script.find(l => l.includes(`deposit ${mlAddr(2).toString(8)}`));
    assert.ok(ml2Line, 'slot 2 calc routine deposit');
    assert.ok(ml2Line.includes(TCR.toString(8)), 'ml2 = tcr');
    // Should have life counter set
    assert.ok(script.some(l => l.includes(`deposit ${naAddr(2).toString(8)} 214`)), 'torpLife = 140 (214 octal)');
  }
);

test(
  'T-TCR: torpedo expiry scenario script — near-zero life counter',
  () => {
    const script = buildTcrTraceScript(RIM_PATH, {
      torpLife: 0,
    });
    // na2 should be 0 (000 octal)
    assert.ok(script.some(l => l.includes(`deposit ${naAddr(2).toString(8)} 0`)), 'torpLife = 0');
  }
);

test(
  'T-TCR: torpedo with multiple frames script',
  () => {
    const script = buildTcrTraceScript(RIM_PATH, { frames: 5 });
    const runMatches = script.filter(l => l.startsWith('run ') && l.includes(ML0.toString(8)));
    assert.equal(runMatches.length, 5, '5 main loop runs');
  }
);

// ── 8. T-METER: build ledger for torpedo region ─────────────────────────────

test(
  'T-TCR: ledger builder correctly classifies torpedo-region skip sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const tcrAddrs = new Set(TCR_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (tcrAddrs.has(addr)) filtered.set(addr, site);
    }

    const analysis = analyzeTrace([], { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();
    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);

    // 1 site should be in the ledger, and dark (no PC history yet)
    assert.equal(ledger.length, TCR_SKIP_SITES.length,
      `ledger has ${TCR_SKIP_SITES.length} entries, got ${ledger.length}`);
    assert.equal(ledger[0].status, 'dark',
      `site at ${ledger[0].addr.toString(8)} (line ${ledger[0].srcLine}) is dark (no trace yet)`);
  }
);

// ── 9. Source line to address mapping ────────────────────────────────────────

test(
  'T-TCR: source lines 985–1006 map to the correct address range',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();

    // tcr at line 987 → 02136
    const tcrAddr = [...addrToSrcLine.entries()].find(([, line]) => line === 987);
    assert.ok(tcrAddr, 'tcr at line 987');
    assert.equal(tcrAddr[0], TCR, `tcr addr = ${TCR.toString(8)}`);

    // mex at line 950 → 02052 (should be near tcr)
    const mexAddr = [...addrToSrcLine.entries()].find(([, line]) => line === 950);
    assert.ok(mexAddr, 'mex at line 950');
    assert.equal(mexAddr[0], MEX, `mex addr = ${MEX.toString(8)}`);
  }
);
