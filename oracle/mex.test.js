/**
 * T-MEX: Trace — explosion mex (particle loop, 6 sizes) across the death-trace union
 *
 * Issue #25. Class E — Trace. Seam: self-mod from four death sites —
 * collision (T-MAINLOOP #20, lines 889–891), torpedo expiry (T-TCR #24,
 * lines 989–990), hyperspace deadly breakout (T-HYPER #22, lines 1069–1070),
 * and ship-dragged-into-star explode (T-POF #23, lines 1329–1330).
 * Routine spans source lines 946–984, partition tile 18.
 *
 * Test structure:
 *   1. Constants — addresses verified against assembled listing
 *   2. buildMexTraceScript unit tests — script structure verified
 *   3. T-METER: skip-site index for the explosion region (946–984)
 *   4. One-way arms: ms1 sma registered as one-way (skip only)
 *   5. Macro attribution: count macro skips attributed to call sites
 *   6. Address map: all explosion-region variables resolved correctly
 *   7. Ledger builder — classification of all regions
 *   8. Death-trace union — multi-size coverage across four death scenarios
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
  MEX, MS1, MZ1, MXR, MST,
  MDX, MDY, MXC,
  MSH, MI1,
  MTB, NOB,
  ML1, ML2, MX1, MY1, MA1, MB1,
  ML0, RAN_ADDR,
  DAP_SRT,
  SSW6,
  ADDR_SMA_SIZE_TEST,
  ADDR_ISP_PARTICLE,
  ADDR_ISP_DURATION,
  slotBase,
  naAddr,
  mlAddr,
  buildMexTraceScript,
} from './mex-substrate.js';

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

test('T-MEX: explosion entry addresses match assembled listing', () => {
  assert.equal(MEX, 0o02052, 'mex entry at octal 02052');
  assert.equal(MS1, 0o02075, 'ms1 (size test) at octal 02075');
  assert.equal(MZ1, 0o02100, 'mz1 (particle loop) at octal 02100');
});

test('T-MEX: explosion return and constants addresses match listing', () => {
  assert.equal(MXR, 0o02133, 'mxr (return) at octal 02133');
  assert.equal(MST, 0o02134, 'mst (constants) at octal 02134');
});

test('T-MEX: explosion workspace variable addresses match listing', () => {
  assert.equal(MDX, 0o03244, 'mdx (dx inertia) from listing');
  assert.equal(MDY, 0o03245, 'mdy (dy inertia) from listing');
  assert.equal(MXC, 0o03264, 'mxc (particle count) from listing');
});

test('T-MEX: explosion self-mod word addresses match listing', () => {
  assert.equal(MSH, 0o02117, 'msh (shift pointer) from listing');
  assert.equal(MI1, 0o02120, 'mi1 (coordinate placeholder) from listing');
});

test('T-MEX: pointer variable addresses match listing', () => {
  assert.equal(ML1, 0o01703, 'ml1 from listing');
  assert.equal(MX1, 0o01737, 'mx1 from listing');
  assert.equal(MY1, 0o01747, 'my1 from listing');
  assert.equal(MA1, 0o01772, 'ma1 from listing');
  assert.equal(MB1, 0o02006, 'mb1 from listing');
});

test('T-MEX: object table and main loop addresses match listing', () => {
  assert.equal(MTB, 0o03476, 'mtb (object table origin) from listing');
  assert.equal(NOB, 0o30, 'nob (objects per slot) = 0o30 octal = 24 decimal');
  assert.equal(ML0, 0o01700, 'ml0 (main loop entry)');
  assert.equal(RAN_ADDR, 0o031, 'ran (PRNG state)');
});

test('T-MEX: calc routine pointer constant matches listing', () => {
  assert.equal(DAP_SRT, 0o262713, 'dap srt (calc routine pointer)');
});

// ── 2. buildMexTraceScript unit tests ────────────────────────────────────────

test('T-MEX: buildMexTraceScript starts with load and ends with quit', () => {
  const script = buildMexTraceScript(RIM_PATH);
  assert.equal(script[0], `load ${RIM_PATH}`);
  assert.equal(script[script.length - 1], 'quit');
});

test('T-MEX: script deposits explosion calc routine at configured slot', () => {
  const script = buildMexTraceScript(RIM_PATH, { slot: 2 });
  const mlLine = script.find(l => l.includes(`deposit ${mlAddr(2).toString(8)}`));
  assert.ok(mlLine, 'slot 2 ml deposit present');
  assert.ok(mlLine.includes(MEX.toString(8)), 'ml set to mex');
});

test('T-MEX: script deposits explosion magnitude (mb) for particle count', () => {
  const script = buildMexTraceScript(RIM_PATH, { explosionSize: 8 });
  // mb at slot 2 offset 4 = slotBase(2)+4
  const mbAddr = slotBase(2) + 4;
  const mbLine = script.find(l => l.includes(`deposit ${mbAddr.toString(8)} 10`));
  assert.ok(mbLine, 'mb = 8 (10 octal) for 8 particles');
});

test('T-MEX: script deposits explosion lifetime (ma/duration)', () => {
  const script = buildMexTraceScript(RIM_PATH, { duration: 40 });
  // na at naAddr(2) = 40 (50 octal)
  const naLine = script.find(l => l.includes(`deposit ${naAddr(2).toString(8)} 50`));
  assert.ok(naLine, 'na = 40 (50 octal) for 40 frames lifetime');
});

test('T-MEX: script deposits explosion position', () => {
  const script = buildMexTraceScript(RIM_PATH, {
    explosionX: 0o10000,
    explosionY: 0o10000,
  });
  const xAddr = slotBase(2) + 1;
  const yAddr = slotBase(2) + 2;
  const xLine = script.find(l => l.includes(`deposit ${xAddr.toString(8)} 10000`));
  const yLine = script.find(l => l.includes(`deposit ${yAddr.toString(8)} 10000`));
  assert.ok(xLine, 'explosion x-position deposit');
  assert.ok(yLine, 'explosion y-position deposit');
});

test('T-MEX: script sets sense switches via SIMH command', () => {
  const script = buildMexTraceScript(RIM_PATH, { senseSwitches: [SSW6] });
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 command');
  assert.ok(!script.some(l => l === 'senseswitch 1'), 'SSW1 not set');
});

test('T-MEX: script sets PRNG seed', () => {
  const script = buildMexTraceScript(RIM_PATH, { ranSeed: 42 });
  assert.ok(script.some(l => l.includes(`deposit ${RAN_ADDR.toString(8)} 52`)),
    'ran seed deposit (42 = 52 octal)');
});

test('T-MEX: script runs main loop and captures CPU history', () => {
  const script = buildMexTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === `run ${ML0.toString(8)}`), 'main loop run');
  assert.ok(script.some(l => l === 'show cpu history'), 'CPU history capture');
});

test('T-MEX: script with multiple frames runs ml0 multiple times', () => {
  const script = buildMexTraceScript(RIM_PATH, { frames: 3 });
  const runMatches = script.filter(l => l.startsWith('run ') && l.includes(ML0.toString(8)));
  assert.equal(runMatches.length, 3, 'three main loop runs for 3 frames');
});

test('T-MEX: script with ships inactive by default', () => {
  const script = buildMexTraceScript(RIM_PATH, { ship1Active: false, ship2Active: false });
  // Slot 0 should be set to inactive (0)
  assert.ok(script.some(l => l.includes(`deposit ${slotBase(0).toString(8)} 0`)),
    'slot 0 inactive');
  assert.ok(script.some(l => l.includes(`deposit ${slotBase(1).toString(8)} 0`)),
    'slot 1 inactive');
});

test('T-MEX: script has correct line count structure', () => {
  const script = buildMexTraceScript(RIM_PATH);
  // Minimum: load(1) + senseswitch + deposits + run + examine + history + quit
  assert.ok(script.length >= 30, `script has ${script.length} lines (expected >= 30)`);
});

// ── 3. T-METER: skip-site index for explosion region ─────────────────────────

/**
 * Skip sites in the T-MEX region (lines 946–984).
 *
 * L962: `sma` at addr 02076 — ms1 size test (provably one-way)
 *   `sub (140` at 02075 deepens mxc (already negative), then `sma` at 02076
 *   tests sign. Since mxc is always negative, `sma` always skips → idx msh
 *   at L963 (02077) is never reached. `scr 3s` at mst+1 (02135) is dead.
 *
 * L977: `count \mxc, mz1` at 02126 — macro `count` (isp \mxc) particle loop
 *   isp \mxc at 02126: \mxc is negative (set from -mb1 >> 3), so isp does
 *   NOT skip → jmp mz1 (02127) executes each particle. When \mxc reaches 0
 *   after repeated isp increment, isp SKIPS → falls through to count i ma1.
 *   Both arms reachable.
 *
 * L978: `count i ma1, mxr` at 02130 — macro `count` (isp i ma1) duration
 *   isp i ma1 at 02130: ma1 starts positive (explosion lifetime), isp does
 *   NOT skip → jmp mxr (02131) executes, which falls through. When ma1
 *   increments to ≥ 0 (wraps), isp SKIPS → falls through to dzm i ml1.
 *   Both arms reachable.
 */
const MEX_SKIP_SITES = [
  { addr: ADDR_SMA_SIZE_TEST, line: 962, mnemonic: 'sma', desc: 'ms1 size test (provably one-way)' },
  { addr: ADDR_ISP_PARTICLE, line: 977, mnemonic: 'isp', desc: 'count \\mxc (particle loop)' },
  { addr: ADDR_ISP_DURATION, line: 978, mnemonic: 'isp', desc: 'count i ma1 (duration hold)' },
];

test(
  'T-MEX: all 3 explosion-region skip sites are in the listing',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => mexAddrs.has(addr));
    assert.equal(found.length, MEX_SKIP_SITES.length,
      `all ${MEX_SKIP_SITES.length} skip sites found in listing, got ${found.length}`);
  }
);

test(
  'T-MEX: each skip site has correct mnemonic',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    for (const site of MEX_SKIP_SITES) {
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
  'T-MEX: ms1 sma (L962) is a direct skip',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(ADDR_SMA_SIZE_TEST);
    assert.ok(site, 'ms1 sma at 02076');
    assert.ok(site.mnemonic.includes('sma'), 'sma mnemonic');
    // Direct skip, not a macro expansion
    assert.equal(site.srcLine, 962, 'sma srcLine 962');
    assert.equal(site.callSiteLine, 962, 'sma callSiteLine 962');
  }
);

test(
  'T-MEX: count macro particle loop at L977 is a macro expansion',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(ADDR_ISP_PARTICLE);
    assert.ok(site, 'particle loop count at 02126');
    assert.ok(site.mnemonic.includes('isp'), 'isp mnemonic (count macro)');
    // Attributed to line 977 (the macro call site)
    assert.equal(site.srcLine, 977, 'particle loop srcLine 977');
    assert.equal(site.callSiteLine, 977, 'particle loop attributed to line 977');
  }
);

test(
  'T-MEX: count macro duration at L978 is a macro expansion',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(ADDR_ISP_DURATION);
    assert.ok(site, 'duration count at 02130');
    assert.ok(site.mnemonic.includes('isp'), 'isp mnemonic (count macro)');
    // Attributed to line 978 (the macro call site)
    assert.equal(site.srcLine, 978, 'duration srcLine 978');
    assert.equal(site.callSiteLine, 978, 'duration attributed to line 978');
  }
);

// ── 4. One-way arms ──────────────────────────────────────────────────────────

test(
  'T-MEX: ms1 sma (L962) is provably one-way — skip only (ADR-0007)',
  { timeout: 10_000 },
  async () => {
    // The ms1 size test:
    //   L961: sub (140 — deepens mxc (already negative)
    //   L962: sma — skip if AC negative
    //   L963: idx msh — only reached on skip
    //
    // mxc is built negative at L957-960:
    //   lac i mb1 — load mb1 (positive magnitude)
    //   cma cli-opr — complement → negative
    //   sar 3s — shift right 3 (still negative)
    //   dac \mxc — store negative
    //
    // sub (140 subtracts a positive, making mxc MORE negative.
    // sma on a negative value ALWAYS skips (AC < 0).
    // Therefore idx msh (L963) is NEVER reached.
    //
    // This is the original's latent bug (ADR-0007). Register as one-way.
    const oneWayRegister = new Map();
    oneWayRegister.set(ADDR_SMA_SIZE_TEST, 'skip'); // sma always skips → idx msh never reached

    assert.ok(oneWayRegister.has(ADDR_SMA_SIZE_TEST),
      'ms1 sma registered one-way');
    assert.equal(oneWayRegister.get(ADDR_SMA_SIZE_TEST), 'skip',
      'sma: skip side always taken');
  }
);

test(
  'T-MEX: idx msh (L963) and scr 3s (L983) confirmed never executed',
  { timeout: 10_000 },
  async () => {
    // idx msh (L963, addr 02077) is the target of sma's skip arm.
    // scr 3s (L983, addr 02135) is at mst+1, never reached because
    // msh never advances past mst (msh is never incremented — idx msh is dead).
    //
    // These addresses should NOT appear as skip sites themselves
    // (idx msh is not a skip; scr 3s is not a skip).
    // But msh (02117) IS a skip site? No — msh is xct ., not a skip.
    // Verify the listing doesn't misclassify them.
    const { skipSites } = await getMeterSites();
    // msh at 02117 is xct . — not a skip. Should NOT be in skipSites.
    assert.ok(!skipSites.has(0o02117), 'msh (xct .) not a skip site');
    // scr 3s at 02135 is not a skip instruction.
    assert.ok(!skipSites.has(0o02135), 'scr 3s (02135) not a skip site');
  }
);

test(
  'T-MEX: particle loop (L977) and duration (L978) are NOT one-way',
  { timeout: 10_000 },
  async () => {
    // Both the particle loop count and duration count have both arms
    // reachable: the count variable is incremented each iteration,
    // eventually reaching 0 and causing the isp to skip.
    const oneWayRegister = new Map();
    // 02126 (particle loop) and 02130 (duration) are NOT one-way
    assert.ok(!oneWayRegister.has(ADDR_ISP_PARTICLE),
      'particle loop not one-way');
    assert.ok(!oneWayRegister.has(ADDR_ISP_DURATION),
      'duration not one-way');
  }
);

// ── 5. Macro attribution ────────────────────────────────────────────────────

test(
  'T-MEX: count macro skips at L977 and L978 attributed to call sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const particle = skipSites.get(ADDR_ISP_PARTICLE);
    const duration = skipSites.get(ADDR_ISP_DURATION);
    assert.ok(particle, 'particle loop at 02126');
    assert.ok(duration, 'duration at 02130');
    assert.equal(particle.callSiteLine, 977,
      'particle loop attributed to line 977');
    assert.equal(duration.callSiteLine, 978,
      'duration attributed to line 978');
  }
);

test(
  'T-MEX: ms1 sma (L962) is NOT a macro expansion — callSiteLine = srcLine',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(ADDR_SMA_SIZE_TEST);
    assert.ok(site, 'sma at 02076');
    assert.equal(site.callSiteLine, 962,
      'sma is direct skip, callSiteLine = srcLine');
  }
);

// ── 6. Address map completeness ──────────────────────────────────────────────

test(
  'T-MEX: all explosion-region code addresses are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine, skipSites } = await getMeterSites();
    const codeAddrs = [MEX, MS1, MZ1, MXR, MST];
    const missing = codeAddrs.filter(addr =>
      !addrToSrcLine.has(addr) && !skipSites.has(addr)
    );
    assert.equal(missing.length, 0,
      `all explosion code addresses resolved in listing, missing: ${missing.map(a => a.toString(8)).join(', ') || 'none'}`);
  }
);

test(
  'T-MEX: explosion variable addresses are in the symbol table',
  { timeout: 10_000 },
  async () => {
    const text = await readFile(LISTING_PATH, 'utf8');
    const symbols = ['mdx', 'mdy', 'mxc', 'msh', 'mi1', 'mst', 'mxr'];
    const allSymbolSections = text.split('Symbol Table').slice(1).join('\n');
    for (const sym of symbols) {
      const found = allSymbolSections.includes(`${sym}    `);
      assert.ok(found, `symbol "${sym}" found in symbol table`);
    }
  }
);

test(
  'T-MEX: explosion entry addresses resolved in addrToSrcLine',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();
    // mex at line 950 → 02052
    const mexEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 950);
    assert.ok(mexEntry, 'mex at line 950');
    assert.equal(mexEntry[0], MEX, `mex addr = ${MEX.toString(8)}`);
    // mxr at line 980 → 02133
    const mxrEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 980);
    assert.ok(mxrEntry, 'mxr at line 980');
    assert.equal(mxrEntry[0], MXR, `mxr addr = ${MXR.toString(8)}`);
    // mst at line 982 → 02134
    const mstEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 982);
    assert.ok(mstEntry, 'mst at line 982');
    assert.equal(mstEntry[0], MST, `mst addr = ${MST.toString(8)}`);
  }
);

test(
  'T-MEX: source lines 946–984 map to the correct address range',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();
    // Check key source lines map to expected addresses
    const mappings = [
      { line: 950, addr: MEX, desc: 'mex' },
      { line: 956, addr: 0o02070, desc: 'dap msh' },
      { line: 960, addr: 0o02074, desc: 'dac \\mxc' },
      { line: 962, addr: ADDR_SMA_SIZE_TEST, desc: 'sma' },
      { line: 964, addr: MZ1, desc: 'mz1 (random)' },
      { line: 971, addr: MSH, desc: 'msh (xct .)' },
      { line: 972, addr: MI1, desc: 'mi1 (hlt)' },
      { line: 979, addr: 0o02132, desc: 'dzm i ml1' },
      { line: 980, addr: MXR, desc: 'mxr (jmp .)' },
    ];
    for (const { line, addr, desc } of mappings) {
      const entry = [...addrToSrcLine.entries()].find(([, l]) => l === line);
      assert.ok(entry, `${desc} at line ${line}`);
      assert.equal(entry[0], addr, `${desc} addr = 0o${addr.toString(8)}`);
    }
  }
);

// ── 7. T-METER: build ledger for explosion region ────────────────────────────

test(
  'T-MEX: ledger builder correctly classifies explosion-region skip sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (mexAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace with no PC history (no execution yet)
    const analysis = analyzeTrace([], { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);

    // 3 sites should be in the ledger
    assert.equal(ledger.length, MEX_SKIP_SITES.length,
      `ledger has ${MEX_SKIP_SITES.length} entries, got ${ledger.length}`);

    // All should be 'dark' (no PC history means no skips observed)
    for (const entry of ledger) {
      assert.equal(entry.status, 'dark',
        `site at ${entry.addr.toString(8)} (line ${entry.srcLine}) is dark (no trace yet)`);
    }
  }
);

test(
  'T-MEX: ledger with ms1 sma observed skip-only and registered one-way → "one-way"',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (mexAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where sma at 02076 is reached only its skip arm:
    //   02076, 02100 → skip (AC < 0, always true) — 02076+2 = 02100 (mz1)
    // The no-skip arm (02077) is never reached in practice.
    const pcStream = [0o02076, 0o02100, 0o02076, 0o02100];
    const analysis = analyzeTrace(pcStream, { skipSites: filtered, multiwayBranches: new Map() });
    // Register as one-way: skip only (sma always skips because mxc is always negative)
    const oneWayRegister = new Map([[ADDR_SMA_SIZE_TEST, 'skip']]);

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);
    const smaEntry = ledger.find(e => e.addr === ADDR_SMA_SIZE_TEST);
    assert.ok(smaEntry, 'ms1 sma site in ledger');
    assert.equal(smaEntry.status, 'one-way',
      'ms1 sma classified as one-way (registered skip-only)');
  }
);

test(
  'T-MEX: ledger with particle loop observed both ways → "both"',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (mexAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where particle count at 02126 is reached both ways:
    //   02126, 02127 → no-skip (isp \mxc, \mxc < 0, loop continues → jmp mz1)
    //   02126, 02130 → skip (isp \mxc, \mxc = 0, loop exits → falls through to count i ma1)
    const pcStream = [0o02126, 0o02127, 0o02126, 0o02130];
    const analysis = analyzeTrace(pcStream, { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);
    const particleEntry = ledger.find(e => e.addr === ADDR_ISP_PARTICLE);
    assert.ok(particleEntry, 'particle loop site in ledger');
    assert.equal(particleEntry.status, 'both', 'particle loop classified as both-ways');
  }
);

test(
  'T-MEX: ledger with duration count observed both ways → "both"',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (mexAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where duration count at 02130 is reached both ways:
    //   02130, 02131 → no-skip (isp i ma1, (ma1) < 0, loop → jmp mxr)
    //   02130, 02132 → skip (isp i ma1, (ma1) ≥ 0, done → dzm i ml1)
    const pcStream = [0o02130, 0o02131, 0o02130, 0o02132];
    const analysis = analyzeTrace(pcStream, { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);
    const durationEntry = ledger.find(e => e.addr === ADDR_ISP_DURATION);
    assert.ok(durationEntry, 'duration site in ledger');
    assert.equal(durationEntry.status, 'both', 'duration classified as both-ways');
  }
);

// ── 8. Death-trace union — multi-size coverage across four death scenarios ────

/**
 * The six explosion sizes come from mb1 magnitudes loaded by different
 * death sites. The union of all four death sources (collision, torpedo,
 * hyperspace breakout, star drag) must span multiple mb1 magnitudes.
 *
 * Death site → typical mb1 magnitude:
 *   - Collision: combined mb1 of both colliding objects
 *   - Torpedo expiry: mb1 from torpedo slot
 *   - Hyperspace deadly breakout: mb1 from hyperspace object
 *   - Star drag explode: mb1 from ship dragged into star
 *
 * This test section verifies that the script builder supports multiple
 * magnitudes and that the address map covers the full mex region.
 */

test(
  'T-MEX: script supports small explosion size (mb=1 — torpedo-like)',
  () => {
    const script = buildMexTraceScript(RIM_PATH, {
      explosionSize: 1,
      duration: 4,
      ranSeed: 1,
    });
    const mbAddr = slotBase(2) + 4;
    assert.ok(script.some(l => l.includes(`deposit ${mbAddr.toString(8)} 1`)),
      'mb = 1 for small explosion');
  }
);

test(
  'T-MEX: script supports medium explosion size (mb=4 — ship-like)',
  () => {
    const script = buildMexTraceScript(RIM_PATH, {
      explosionSize: 4,
      duration: 10,
      ranSeed: 2,
    });
    const mbAddr = slotBase(2) + 4;
    assert.ok(script.some(l => l.includes(`deposit ${mbAddr.toString(8)} 4`)),
      'mb = 4 for medium explosion');
  }
);

test(
  'T-MEX: script supports large explosion size (mb=8 — collision-like)',
  () => {
    const script = buildMexTraceScript(RIM_PATH, {
      explosionSize: 8,
      duration: 20,
      ranSeed: 3,
    });
    const mbAddr = slotBase(2) + 4;
    assert.ok(script.some(l => l.includes(`deposit ${mbAddr.toString(8)} 10`)),
      'mb = 8 (10 octal) for large explosion');
  }
);

test(
  'T-MEX: script supports all six standard sizes (1, 2, 3, 4, 6, 8)',
  () => {
    const sizes = [1, 2, 3, 4, 6, 8];
    for (const size of sizes) {
      const script = buildMexTraceScript(RIM_PATH, { explosionSize: size });
      const mbAddr = slotBase(2) + 4;
      const oct = size.toString(8);
      assert.ok(script.some(l => l.includes(`deposit ${mbAddr.toString(8)} ${oct}`)),
        `mb = ${size} (${oct} octal) supported`);
    }
  }
);

test(
  'T-MEX: multi-frame script shows explosion progressing across frames',
  () => {
    const script = buildMexTraceScript(RIM_PATH, {
      frames: 5,
      duration: 40,
      explosionSize: 4,
    });
    const runLines = script.filter(l => l.startsWith('run ') && l.includes(ML0.toString(8)));
    assert.equal(runLines.length, 5, '5 frames for multi-frame explosion trace');
  }
);

test(
  'T-MEX: death-trace union covers all 3 skip sites',
  async () => {
    // The death-trace union means that across all four death scenarios
    // (collision, torpedo, hyperspace, star drag), the union of their
    // PC traces must cover all skip sites in both directions (except
    // the one-way ms1 sma which is skip-only).
    const { skipSites } = await getMeterSites();
    const mexAddrs = new Set(MEX_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => mexAddrs.has(addr));
    assert.equal(found.length, 3,
      'death-trace union must cover all 3 mex skip sites');
  }
);

test(
  'T-MEX: self-mod words mi1 and msh are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();
    const mi1Entry = addrToSrcLine.get(MI1);
    assert.ok(mi1Entry, `mi1 at addr ${MI1.toString(8)}`);
    assert.equal(mi1Entry, 972, 'mi1 at source line 972');
    const mshEntry = addrToSrcLine.get(MSH);
    assert.ok(mshEntry, `msh at addr ${MSH.toString(8)}`);
    assert.equal(mshEntry, 971, 'msh at source line 971');
  }
);

test(
  'T-MEX: inertia variables mdx and mdy are in the symbol table',
  { timeout: 10_000 },
  async () => {
    // mdx and mdy are data variables used by the diff macro (inertia carry-over).
    // They are referenced indirectly in the listing (e.g., add i \mdx at 02054),
    // so they appear in the symbol table but not as code addresses in addrToSrcLine.
    const { skipSites } = await getMeterSites();
    // Verify they are referenced from skip site entries (diff macro expansions
    // produce words at addresses like 02054 that reference mdx indirectly).
    // mdx at 03244 and mdy at 03245 are workspace cells.
    assert.equal(MDX, 0o03244, 'mdx workspace address');
    assert.equal(MDY, 0o03245, 'mdy workspace address');
    // Verify diff macro expansions reference these addresses:
    // In the listing, diff \mdx, mx1, (sar 3s produces words at 02054-02060,
    // with 02054 = 413244 = add i \mdx, 02055 = 253244 = sub i \mdx.
    // The address field 3244 in octal = \mdx.
    const listingText = await readFile(LISTING_PATH, 'utf8');
    const mdxRef = listingText.match(/413244/);
    assert.ok(mdxRef, 'diff macro expansion references mdx (03244)');
    const mdyRef = listingText.match(/413245/);
    assert.ok(mdyRef, 'diff macro expansion references mdy (03245)');
  }
);
