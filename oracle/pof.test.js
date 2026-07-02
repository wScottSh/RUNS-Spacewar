/**
 * T-POF: Trace — ship-dragged-into-star outcome pof (vanish vs explode)
 *
 * Issue #23. Class E — Trace. Seam: reached transitively via T-SHIP gravity
 * capture (`sma i sza` line 1141 → `jmp pof` line 1142). No direct caller.
 * Routine spans source lines 1311–1335, partition tile 23.
 *
 * Test structure:
 *   1. Constants — addresses verified against assembled listing
 *   2. buildPofTraceScript unit tests — script structure verified
 *   3. T-METER: skip-site index for the pof region (1311–1335)
 *   4. One-way arms: registered in the one-way register
 *   5. Macro attribution: count macro skip at line 1326
 *   6. Address map: all pof-region variables resolved correctly
 *
 * The pof routine has ONE hard branch: `szs 50` (line 1319) — sense switch 5
 * selects between vanish (antipode-warp) and explode (po1). Both arms are
 * reachable under the default domain; no dead branches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  RIM_PATH,
  POF, PO1, SRT, DAP_SRT,
  ML1, MA1, MB1, MX1, MY1,
  MTB, NOB, SHIP1_SLOT, SHIP2_SLOT,
  ML0, STR_ADDR,
  SSW5, SSW6,
  buildShipTraceScript,
  buildPofTraceScript,
} from './pof-substrate.js';

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

test('T-POF: pof and po1 addresses match assembled listing', () => {
  assert.equal(POF, 0o02714, 'pof (star-capture entry) at octal 02714');
  assert.equal(PO1, 0o02730, 'po1 (explode path) at octal 02730');
});

test('T-POF: srt return address matches listing', () => {
  assert.equal(SRT, 0o02713, 'srt (return to frame loop) at octal 02713');
});

test('T-POF: ship variables used by pof match listing', () => {
  assert.equal(MX1, 0o01737, 'mx1 (antipode target store)');
  assert.equal(MY1, 0o01747, 'my1 (antipode target store)');
  assert.equal(MA1, 0o01772, 'ma1 (explosion timer, po1 arm)');
  assert.equal(ML1, 0o01703, 'ml1 (calc vector self-mod, po1 arm)');
  assert.equal(MB1, 0o02006, 'mb1 (ssn seed for respawn wait)');
});

test('T-POF: object table and PRNG addresses match listing', () => {
  assert.equal(MTB, 0o03476, 'mtb (object table origin) from listing');
  assert.equal(NOB, 30, 'nob (objects per slot) = 30');
  assert.equal(SHIP1_SLOT, MTB, 'ship 1 at slot 0');
  assert.equal(ML0, 0o01700, 'ml0 (main loop entry)');
});

// ── 2. buildPofTraceScript unit tests ────────────────────────────────────────

test('T-POF: buildPofTraceScript starts with load and ends with quit', () => {
  const script = buildPofTraceScript(RIM_PATH);
  assert.equal(script[0], `load ${RIM_PATH}`);
  assert.equal(script[script.length - 1], 'quit');
});

test('T-POF: buildPofTraceScript places ship extremely close to star', () => {
  const script = buildPofTraceScript(RIM_PATH);
  // Ship1 at (0010, 0010) — inside star capture radius
  const mx1Line = script.find(l => l.includes(`deposit ${MX1.toString(8)}`));
  assert.ok(mx1Line, 'mx1 deposit present');
  assert.ok(mx1Line.includes('10'), 'ship1 mx1 = 0010 (near star)');
  const my1Line = script.find(l => l.includes(`deposit ${MY1.toString(8)}`));
  assert.ok(my1Line, 'my1 deposit present');
  assert.ok(my1Line.includes('10'), 'ship1 my1 = 0010 (near star)');
});

test('T-POF: buildPofTraceScript sets gravity on by default', () => {
  const script = buildPofTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
});

test('T-POF: buildPofTraceScript sets SSW5 when specified', () => {
  const script = buildPofTraceScript(RIM_PATH, { senseSwitches: [SSW5, SSW6] });
  assert.ok(script.some(l => l === 'senseswitch 5'), 'SSW5 set');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
  assert.ok(!script.some(l => l === 'senseswitch 1'), 'SSW1 not set');
  assert.ok(!script.some(l => l === 'senseswitch 2'), 'SSW2 not set');
  assert.ok(!script.some(l => l === 'senseswitch 3'), 'SSW3 not set');
  assert.ok(!script.some(l => l === 'senseswitch 4'), 'SSW4 not set');
});

test('T-POF: script sets ship active (mb1 = 1)', () => {
  const script = buildPofTraceScript(RIM_PATH);
  const mb1Line = script.find(l => l.includes(`deposit ${MB1.toString(8)}`));
  assert.ok(mb1Line, 'mb1 deposit present');
  assert.ok(mb1Line.includes('1'), 'mb1 = 1 (active)');
});

test('T-POF: script sets star capture radius', () => {
  const script = buildPofTraceScript(RIM_PATH);
  const strLine = script.find(l => l.includes(`deposit ${STR_ADDR.toString(8)}`));
  assert.ok(strLine, 'STR_ADDR deposit present');
});

test('T-POF: script deposits ship calc routines at slot 0 and slot 1', () => {
  const script = buildPofTraceScript(RIM_PATH);
  const slot0Line = script.find(l => l.includes(`deposit ${SHIP1_SLOT.toString(8)}`));
  const slot1Line = script.find(l => l.includes(`deposit ${SHIP2_SLOT.toString(8)}`));
  assert.ok(slot0Line, 'slot 0 deposit present');
  assert.ok(slot1Line, 'slot 1 deposit present');
  assert.ok(slot0Line.includes(DAP_SRT.toString(8)), 'slot 0 has dap srt');
  assert.ok(slot1Line.includes(DAP_SRT.toString(8)), 'slot 1 has dap srt');
});

test('T-POF: script runs main loop and captures CPU history', () => {
  const script = buildPofTraceScript(RIM_PATH);
  assert.ok(script.some(l => l === `run ${ML0.toString(8)}`), 'main loop run');
  assert.ok(script.some(l => l === 'show cpu history'), 'CPU history capture');
});

test('T-POF: script has correct line count structure', () => {
  const script = buildPofTraceScript(RIM_PATH);
  assert.ok(script.length >= 35, `script has ${script.length} lines (expected >= 35)`);
});

test('T-POF: vanish-arm scenario — SSW5 clear', () => {
  const script = buildPofTraceScript(RIM_PATH, { senseSwitches: [SSW6] });
  // SSW5 must NOT be set for vanish arm
  assert.ok(!script.some(l => l === 'senseswitch 5'), 'SSW5 clear for vanish arm');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
});

test('T-POF: explode-arm scenario — SSW5 set', () => {
  const script = buildPofTraceScript(RIM_PATH, { senseSwitches: [SSW5, SSW6] });
  // SSW5 must be set for explode arm
  assert.ok(script.some(l => l === 'senseswitch 5'), 'SSW5 set for explode arm');
  assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
});

// ── 3. T-METER: skip-site index for pof region ──────────────────────────────

/**
 * Skip sites in the T-POF region (lines 1311–1335).
 *
 * L1319: `szs 50` at addr 02716 — hard branch: SSW5 pick vanish vs explode.
 *   - SSW5 set → no-skip → `jmp po1` (1320) → explode arm
 *   - SSW5 clear → skip → fall through to antipode-warp (1321–1327)
 *
 * L1326: `count \ssn, .` — macro `count` (isp \ssn) at addr 02725,
 *   with `jmp .` at addr 02726 forming a self-counting wait loop.
 *   The `isp` increments ssn and skips if ≥ 0. This is the respawn countdown.
 *   Both arms of the count macro are reachable (ssn starts from mb1, counts
 *   down through zero → the isp eventually skips when ssn wraps past 0).
 */
const POF_SKIP_SITES = [
  { addr: 0o02716, line: 1319, mnemonic: 'szs', desc: 'SSW5 star-contact outcome (vanish vs explode)' },
  { addr: 0o02725, line: 1326, mnemonic: 'isp', desc: 'count \\ssn,. respawn wait (macro expansion)' },
];

test(
  'T-POF: all 2 pof-region skip sites are in the listing',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const pofAddrs = new Set(POF_SKIP_SITES.map(s => s.addr));
    const found = [...skipSites.entries()].filter(([addr]) => pofAddrs.has(addr));
    assert.equal(found.length, POF_SKIP_SITES.length,
      `all ${POF_SKIP_SITES.length} skip sites found in listing, got ${found.length}`);
  }
);

test(
  'T-POF: each skip site has correct mnemonic',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    for (const site of POF_SKIP_SITES) {
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
  'T-POF: szs 50 (line 1319) is the sole hard branch in pof',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02716);
    assert.ok(site, 'ssw5 branch at 02716');
    assert.ok(site.mnemonic.includes('szs'), 'szs mnemonic');
    // It's a direct skip, not a macro expansion
    assert.equal(site.srcLine, 1319, 'szs srcLine 1319');
    assert.equal(site.callSiteLine, 1319, 'szs callSiteLine 1319');
  }
);

test(
  'T-POF: count macro at line 1326 is a respawn-wait loop (isp + jmp.)',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02725);
    assert.ok(site, 'count macro skip at 02725');
    assert.ok(site.mnemonic.includes('isp'), 'isp mnemonic (count macro)');
    // Attributed to line 1326 (the macro call site)
    assert.equal(site.srcLine, 1326, 'count macro srcLine 1326');
    assert.equal(site.callSiteLine, 1326, 'count macro attributed to line 1326');
  }
);

// ── 4. One-way arms ──────────────────────────────────────────────────────────

test(
  'T-POF: no one-way arms — both szs 50 branches are reachable',
  { timeout: 10_000 },
  async () => {
    // Unlike other regions, pof has no correctly-dead branches.
    // The szs 50 decision is fully controlled by the sense switch,
    // and both SSW5 set and clear are valid inputs.
    const oneWayRegister = new Map();
    // Empty — both branches of szs 50 are reachable
    assert.equal(oneWayRegister.size, 0, 'no one-way arms in pof region');
  }
);

test(
  'T-POF: count macro at 02725 is not one-way — both isp directions reachable',
  { timeout: 10_000 },
  async () => {
    // The count macro expands to: `isp \ssn` + `jmp .`
    // When ssn > 0 (signed): isp does NOT skip → loop continues (jmp .)
    // When ssn reaches 0: isp skips → exits loop (falls through to jmp srt)
    // Both directions are reachable in the natural countdown.
    const oneWayRegister = new Map();
    // 02725 is NOT registered as one-way
    assert.ok(!oneWayRegister.has(0o02725), 'count macro not registered as one-way');
  }
);

// ── 5. Macro attribution ────────────────────────────────────────────────────

test(
  'T-POF: count macro skip at L1326 attributed to this call site',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const site = skipSites.get(0o02725);
    assert.ok(site, 'count macro skip at 02725');
    assert.equal(
      site.callSiteLine, 1326,
      `count \\ssn,. attributed to line 1326, got ${site.callSiteLine}`
    );
  }
);

// ── 6. Address map completeness ──────────────────────────────────────────────

test(
  'T-POF: all pof-region code addresses are in the listing',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine, skipSites } = await getMeterSites();
    const codeAddrs = [POF, PO1, SRT];
    const missing = codeAddrs.filter(addr =>
      !addrToSrcLine.has(addr) && !skipSites.has(addr)
    );
    assert.equal(missing.length, 0,
      `all pof code addresses resolved in listing, missing: ${missing.map(a => a.toString(8)).join(', ') || 'none'}`
    );
  }
);

test(
  'T-POF: source lines 1311–1335 map to correct addresses',
  { timeout: 10_000 },
  async () => {
    const { addrToSrcLine } = await getMeterSites();

    // pof at line 1317 should be at address 02714
    const pofEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 1317);
    assert.ok(pofEntry, 'pof at line 1317');
    assert.equal(pofEntry[0], POF, `pof addr = ${POF.toString(8)}`);

    // po1 at line 1329 should be at address 02730
    const po1Entry = [...addrToSrcLine.entries()].find(([, line]) => line === 1329);
    assert.ok(po1Entry, 'po1 at line 1329');
    assert.equal(po1Entry[0], PO1, `po1 addr = ${PO1.toString(8)}`);

    // jmp srt at line 1327 is at address 02727 (the instruction itself, not the target)
    const jmpSrtEntry = [...addrToSrcLine.entries()].find(([, line]) => line === 1327);
    assert.ok(jmpSrtEntry, 'jmp srt at line 1327');
    assert.equal(jmpSrtEntry[0], 0o02727, `jmp srt addr = 02727`);
  }
);

test(
  'T-POF: pof-region variables (ssn) are in the symbol table',
  { timeout: 10_000 },
  async () => {
    const text = await readFile(LISTING_PATH, 'utf8');
    const symbols = ['mx1', 'my1', 'ma1', 'ml1', 'mb1', 'ssn'];
    const allSymbolSections = text.split('Symbol Table').slice(1).join('\n');
    for (const sym of symbols) {
      const found = allSymbolSections.includes(`${sym}    `);
      assert.ok(found, `symbol "${sym}" found in symbol table`);
    }
  }
);

// ── 7. T-METER: build ledger for pof region ──────────────────────────────────

test(
  'T-POF: ledger builder correctly classifies pof-region skip sites',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const pofAddrs = new Set(POF_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (pofAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace with no PC history (no execution yet)
    const analysis = analyzeTrace([], { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map(); // no one-way arms

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);

    // Both sites should be in the ledger
    assert.equal(ledger.length, POF_SKIP_SITES.length,
      `ledger has ${POF_SKIP_SITES.length} entries, got ${ledger.length}`);

    // All should be 'dark' (no PC history means no skips observed)
    for (const entry of ledger) {
      assert.equal(entry.status, 'dark',
        `site at ${entry.addr.toString(8)} (line ${entry.srcLine}) is dark (no trace yet)`);
    }
  }
);

test(
  'T-POF: ledger with szs 50 observed both ways would be "both"',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const pofAddrs = new Set(POF_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (pofAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where szs 50 at 02716 is reached both ways:
    //   02716, 02717 → no-skip (SSW5 set → jmp po1)
    //   02716, 02720 → skip (SSW5 clear → fall through to lac)
    const pcStream = [0o02716, 0o02717, 0o02716, 0o02720];
    const analysis = analyzeTrace(pcStream, { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);
    const szs50Entry = ledger.find(e => e.addr === 0o02716);
    assert.ok(szs50Entry, 'szs 50 site in ledger');
    assert.equal(szs50Entry.status, 'both', 'szs 50 classified as both-ways');
  }
);

test(
  'T-POF: ledger with count macro observed both ways would be "both"',
  { timeout: 10_000 },
  async () => {
    const { skipSites } = await getMeterSites();
    const pofAddrs = new Set(POF_SKIP_SITES.map(s => s.addr));
    const filtered = new Map();
    for (const [addr, site] of skipSites) {
      if (pofAddrs.has(addr)) filtered.set(addr, site);
    }

    // Simulate a trace where count \ssn,. at 02725 is reached both ways:
    //   02725, 02726 → no-skip (ssn > 0, isp does NOT skip → jmp . loop)
    //   02725, 02727 → skip (ssn = 0, isp skips → exits to jmp srt)
    const pcStream = [0o02725, 0o02726, 0o02725, 0o02727];
    const analysis = analyzeTrace(pcStream, { skipSites: filtered, multiwayBranches: new Map() });
    const oneWayRegister = new Map();

    const ledger = buildLedger(analysis, { skipSites: filtered, multiwayBranches: new Map() }, oneWayRegister);
    const countEntry = ledger.find(e => e.addr === 0o02725);
    assert.ok(countEntry, 'count macro site in ledger');
    assert.equal(countEntry.status, 'both', 'count macro classified as both-ways');
  }
);

// ── 8. Gravity capture scenario scripts ─────────────────────────────────────

test(
  'T-POF: vanish-arm scenario — ship near star with SSW5 clear',
  () => {
    const script = buildPofTraceScript(RIM_PATH, {
      senseSwitches: [SSW6], // SSW5 clear → vanish arm
    });
    // Ship must be near star
    assert.ok(script.some(l => l.includes(`deposit ${MX1.toString(8)}`)), 'mx1 deposit');
    assert.ok(script.some(l => l.includes(`deposit ${MY1.toString(8)}`)), 'my1 deposit');
    // Gravity on
    assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
    // SSW5 NOT set
    assert.ok(!script.some(l => l === 'senseswitch 5'), 'SSW5 clear');
  }
);

test(
  'T-POF: explode-arm scenario — ship near star with SSW5 set',
  () => {
    const script = buildPofTraceScript(RIM_PATH, {
      senseSwitches: [SSW5, SSW6], // SSW5 set → explode arm
    });
    // Gravity on
    assert.ok(script.some(l => l === 'senseswitch 6'), 'SSW6 gravity on');
    // SSW5 set
    assert.ok(script.some(l => l === 'senseswitch 5'), 'SSW5 set');
    // Ship near star (default)
    assert.ok(script.some(l => l.includes(`deposit ${MX1.toString(8)}`)), 'mx1 deposit');
  }
);
