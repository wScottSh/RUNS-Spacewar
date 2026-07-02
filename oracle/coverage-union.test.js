/**
 * T-COVERAGE — the union/closure run (issue #27, ADR-0012).
 *
 * This is the run the ticket demands: every scenario's SIMH trace, one
 * closure pass through the meter, the gate green.  The per-region tickets
 * light branches; this file asserts the union:
 *
 *   1. Every in-contract decision observed both ways (skips) / every
 *      realized edge ≥ once (multiway).
 *   2. Every one-way / correctly-dead register entry (ADR-0007) confirmed
 *      resolving only its one way over the union — never the dead arm.
 *   3. No dark in-contract branch remains unclassified.
 *   4. The correctly-dead PC blocks (sbf, sr1 hlt, mst+1, sin/cos clamp)
 *      never execute anywhere in the union.
 *
 * The scenario set lives in coverage-union.js (buildUnionScenarios); it was
 * grown empirically against the gate's dark list until closure.  Everything
 * here runs live against the Substrate — no cached traces.
 *
 * The passing ledger is written to oracle/coverage-manifest.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseListingForMeter } from './meter.js';
import {
  CoverageGate,
  buildUnionOneWayRegister,
  buildDeadMultiwayRegister,
  buildDeadSkipSiteRegister,
} from './coverage-gate.js';
import {
  scanIohAddrs,
  buildUnionScenarios,
  filterContractListing,
} from './coverage-union.js';
import { PDP1, pdp1Version } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIM_PATH = join(HERE, '..', 'build', 'spacewar31.rim');
const LST_PATH = join(HERE, '..', 'build', 'spacewar31.lst');
const MANIFEST_PATH = join(HERE, 'coverage-manifest.json');

// The dispatch (7-way computed GOTO at 00443) must realize every arm:
// opr fall-through (444), oc1 (445), oc2 (446, lit by the synthetic outline),
// oc3 (447), oc4 (450), oc5 (451), oc6 (452), terminator (453).
const DISPATCH_ADDR = 0o443;
const DISPATCH_ARMS = [0o444, 0o445, 0o446, 0o447, 0o450, 0o451, 0o452, 0o453];

// Correctly-dead PC blocks (ADR-0007): never executed over the union.
const DEAD_PC_BLOCKS = [
  ['sbf sequence-break flush', [0o61, 0o62, 0o63, 0o64, 0o65]],
  ['loc-3 reset vector', [0o3]],
  ['sr1 no-free-slot hlt/jmp .-1', 'L1250-1251'],   // resolved from the listing
  ['mex mst+1 scr 3s', 'L983'],
  ['sin/cos saturation clamp', [0o134, 0o135, 0o136, 0o137, 0o140]],
];

test(
  'T-COVERAGE: union of all scenario traces — closure gate is green',
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(PDP1) || !existsSync(RIM_PATH) || !existsSync(LST_PATH)) {
      t.skip('SIMH binary or build artifacts not available');
      return;
    }

    // ── Build the gate over the in-contract listing ────────────────────────
    const listingText = await readFile(LST_PATH, 'utf8');
    const full = parseListingForMeter(listingText);
    const listing = filterContractListing(full);
    const gate = new CoverageGate(
      listing,
      buildUnionOneWayRegister(),
      buildDeadMultiwayRegister(),
      buildDeadSkipSiteRegister(),
    );

    // ── Run every scenario live, feeding each dump as its own stream ───────
    const iohAddrs = await scanIohAddrs(RIM_PATH);
    assert.ok(iohAddrs.length > 0, 'wait-class iot words found to patch');

    const scenarios = buildUnionScenarios(RIM_PATH, iohAddrs);
    const scenarioStats = {};
    const allPcs = new Set();
    for (const [name, run] of Object.entries(scenarios)) {
      const { streams } = await run();
      assert.ok(streams.length > 0, `${name}: produced at least one PC stream`);
      let pcs = 0;
      for (const s of streams) {
        gate.addTrace(s);
        pcs += s.length;
        for (const pc of s) allPcs.add(pc);
      }
      scenarioStats[name] = { streams: streams.length, pcs };
    }

    // ── The closure pass ────────────────────────────────────────────────────
    const result = gate.assertClosure();

    assert.equal(result.dark.length, 0,
      `no dark in-contract branch: ${result.dark.map((d) => d.addr.toString(8)).join(',') || 'none'}`);
    assert.equal(result.unclassified.length, 0,
      `no partial unregistered branch: ${result.unclassified.map((u) => u.addr.toString(8)).join(',') || 'none'}`);
    assert.ok(result.passed, `closure gate green\n${result.summary}`);

    // Every register entry confirmed one-way, exactly its registered direction.
    const register = buildUnionOneWayRegister();
    assert.equal(result.oneWayConfirmed.length, register.size,
      'every one-way register entry confirmed in the union');
    for (const [addr, direction] of register) {
      assert.ok(
        CoverageGate.isConfirmedOneWay(result, addr, direction),
        `one-way ${addr.toString(8)} confirmed as ${direction}`,
      );
    }

    // Both dead multiway template cells confirmed (registered AND unexecuted).
    assert.equal(result.deadMultiwayConfirmed.length, buildDeadMultiwayRegister().size,
      'ocm/ocn template cells confirmed dead');
    // The registered dead skip site (sin/cos clamp spi) confirmed.
    assert.equal(result.deadSkipConfirmed.length, buildDeadSkipSiteRegister().size,
      'dead-block skip sites confirmed');

    // ── Dispatch multiway: all 8 arms realized across the union ─────────────
    const dispatch = result.multiwayEntries.find((e) => e.addr === DISPATCH_ADDR);
    assert.ok(dispatch, 'outline-compiler dispatch entry present');
    for (const arm of DISPATCH_ARMS) {
      assert.ok(dispatch.realizedTargets.includes(arm),
        `dispatch arm ${arm.toString(8)} realized`);
    }

    // ── Correctly-dead PC blocks never execute ──────────────────────────────
    const addrsOfLine = (line) =>
      [...full.addrToSrcLine].filter(([, l]) => l === line).map(([a]) => a);
    const deadResults = [];
    for (const [name, spec] of DEAD_PC_BLOCKS) {
      const addrs = Array.isArray(spec)
        ? spec
        : spec.split('-').length === 2 && spec.startsWith('L')
          ? spec.replace('L', '').split('-').flatMap((l) => addrsOfLine(parseInt(l, 10)))
          : addrsOfLine(parseInt(spec.replace('L', ''), 10));
      assert.ok(addrs.length > 0, `${name}: block addresses resolved`);
      const executed = addrs.filter((a) => allPcs.has(a));
      assert.equal(executed.length, 0,
        `${name} never executed (hit: ${executed.map((a) => a.toString(8)).join(',') || 'none'})`);
      deadResults.push({ block: name, addrs: addrs.map((a) => a.toString(8)), executed: false });
    }

    // ── Write the ledger manifest ───────────────────────────────────────────
    const manifest = {
      ticket: 'T-COVERAGE (issue #27)',
      adr: ['ADR-0007', 'ADR-0012'],
      generated: new Date().toISOString(),
      substrate: await pdp1Version(),
      gate: 'PASS',
      summary: {
        skipSitesBothWays: result.bothWays.length,
        skipSitesOneWayConfirmed: result.oneWayConfirmed.length,
        skipSitesDeadBlockConfirmed: result.deadSkipConfirmed.length,
        multiwayRealized: result.multiwayEntries.filter((e) => e.realizedTargets.length > 0).length,
        multiwayTemplateCellsConfirmedDead: result.deadMultiwayConfirmed.length,
        dark: result.dark.length,
        unclassified: result.unclassified.length,
        inContractSkipSites: listing.skipSites.size,
        inContractMultiway: listing.multiwayBranches.size,
        distinctPcs: allPcs.size,
      },
      oneWayRegister: [...register].map(([addr, direction]) => ({
        addr: addr.toString(8), direction,
        confirmed: CoverageGate.isConfirmedOneWay(result, addr, direction),
      })),
      deadMultiway: result.deadMultiwayConfirmed.map((e) => ({
        addr: e.addr.toString(8), reason: e.reason,
      })),
      deadSkipSites: result.deadSkipConfirmed.map((e) => ({
        addr: e.addr.toString(8), reason: e.reason,
      })),
      deadPcBlocks: deadResults,
      dispatchArms: dispatch.realizedTargets.map((a) => a.toString(8)).sort(),
      scenarios: scenarioStats,
      notes: [
        'Wait-class iot words (ioh/dpy-i, top 6 bits 0o73) are patched to nop for headless SIMH; display words carry no branch obligation.',
        'Contract scope is the executable partition (source lines 63-1335); class-D data segments are witnessed by listing↔core identity (ADR-0006), not branch coverage.',
        'Latent one-ways found by this run, all observations not edits: pof spin-wait inert (mb always positive), gravity cube-guard dead (position domain bound), sin/cos clamp unreachable (exhaustive 2^18 sweep).',
      ],
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  },
);
