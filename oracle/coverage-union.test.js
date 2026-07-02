/**
 * T-COVERAGE — the hardened union/closure gate (issue #27, ADR-0007/0012).
 *
 * This is the Oracle's merge gate and it is built to be un-fakeable. It closes
 * the failure mode the EPIC #5 audit surfaced — trace tickets going "green"
 * without ever driving the machine — with three properties that a static /
 * hollow reimplementation cannot satisfy:
 *
 *   FAIL-CLOSED. If the Substrate (SIMH pdp1 + build artifacts) is absent, the
 *     gate FAILS — it does not skip. A green suite that never ran SIMH is
 *     exactly the bug; here it is impossible. The only escape is a conscious,
 *     named env opt-out (ORACLE_ALLOW_NO_SUBSTRATE=1) that CI never sets.
 *
 *   EXECUTION-GROUNDED. Acceptance is measured from real PC streams captured
 *     from live SIMH runs of the whole pinned-input scenario union — not from
 *     assertions about script-builder output. The distinct-PC floor makes a
 *     stubbed run fail loudly.
 *
 *   RATCHETED. The coverage contract (coverage-baseline.json) cannot be
 *     silently narrowed to make green cheaper: the in-contract decision set may
 *     not shrink, and the one-way / correctly-dead registers must match the
 *     baseline exactly. Any change is a reviewable baseline diff — the point
 *     where a hidden gap becomes visible.
 *
 * The scenario set lives in coverage-union.js (buildUnionScenarios) and runs
 * through the single shared runUnionClosure() path — the same one the baseline
 * generator uses, so there is no second, divergent runner to drift.
 *
 * The passing ledger is written to oracle/coverage-manifest.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runUnionClosure,
  resolveDeadBlock,
  DISPATCH_ADDR,
  DISPATCH_ARMS,
  DEAD_PC_BLOCKS,
} from './coverage-union.js';
import { CoverageGate, buildUnionOneWayRegister } from './coverage-gate.js';
import { checkRatchet } from './coverage-ratchet.js';
import { PDP1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIM_PATH = join(HERE, '..', 'build', 'spacewar31.rim');
const LST_PATH = join(HERE, '..', 'build', 'spacewar31.lst');
const MANIFEST_PATH = join(HERE, 'coverage-manifest.json');
const BASELINE_PATH = join(HERE, 'coverage-baseline.json');

/** Substrate present iff the SIMH binary AND both build artifacts exist. */
function substrateStatus() {
  const missing = [];
  if (!existsSync(PDP1)) missing.push(`SIMH pdp1 (${PDP1})`);
  if (!existsSync(RIM_PATH)) missing.push('build/spacewar31.rim');
  if (!existsSync(LST_PATH)) missing.push('build/spacewar31.lst');
  return { present: missing.length === 0, missing };
}

// ── The gate ──────────────────────────────────────────────────────────────────

test(
  'T-COVERAGE: hardened union/closure gate (fail-closed, execution-grounded, ratcheted)',
  { timeout: 600_000 },
  async (t) => {
    // FAIL-CLOSED: no substrate ⇒ the Oracle cannot be verified ⇒ red.
    // The only way out is a conscious, named opt-out that CI must never set.
    const { present, missing } = substrateStatus();
    if (!present) {
      if (process.env.ORACLE_ALLOW_NO_SUBSTRATE === '1') {
        t.skip(`Substrate absent (${missing.join(', ')}); bypassed via ORACLE_ALLOW_NO_SUBSTRATE=1`);
        return;
      }
      assert.fail(
        `Oracle coverage gate cannot run: ${missing.join(', ')} missing.\n` +
        `The Oracle is a SIMH-executed characterization; a green suite that never ran the ` +
        `Substrate is meaningless. Build the image (assemble) and the pdp1 binary, then re-run.\n` +
        `To bypass for pure-unit iteration ONLY, set ORACLE_ALLOW_NO_SUBSTRATE=1 (never in CI).`,
      );
    }

    // Run the entire union LIVE — the single shared code path.
    const run = await runUnionClosure(RIM_PATH, LST_PATH);
    const { result, full, allPcs, scenarioStats, iohCount, substrate } = run;

    // Execution-proof: this must be a real SIMH run, not a stub.
    assert.match(substrate, /simulator/i, 'Substrate reports a real SIMH banner');
    assert.ok(iohCount > 0, 'boot/compile ran (wait-class iot words were found to patch)');
    assert.ok(allPcs.size > 1000,
      `union observed ${allPcs.size} distinct PCs — a static run would produce ~0`);

    // ── 1. Closure is green ────────────────────────────────────────────────
    assert.equal(result.dark.length, 0,
      `no dark in-contract branch: ${result.dark.map((d) => d.addr.toString(8)).join(',') || 'none'}`);
    assert.equal(result.unclassified.length, 0,
      `no partial unregistered branch: ${result.unclassified.map((u) => u.addr.toString(8)).join(',') || 'none'}`);
    assert.ok(result.passed, `closure gate green\n${result.summary}`);

    // Every one-way register entry confirmed, exactly its registered direction.
    const register = buildUnionOneWayRegister();
    assert.equal(result.oneWayConfirmed.length, register.size,
      'every one-way register entry confirmed in the union');
    for (const [addr, direction] of register) {
      assert.ok(CoverageGate.isConfirmedOneWay(result, addr, direction),
        `one-way ${addr.toString(8)} confirmed as ${direction}`);
    }

    // ── 2. Dispatch multiway realizes all 8 arms ───────────────────────────
    const dispatch = result.multiwayEntries.find((e) => e.addr === DISPATCH_ADDR);
    assert.ok(dispatch, 'outline-compiler dispatch entry present');
    for (const arm of DISPATCH_ARMS) {
      assert.ok(dispatch.realizedTargets.includes(arm),
        `dispatch arm ${arm.toString(8)} realized`);
    }

    // ── 3. Correctly-dead PC blocks never execute ──────────────────────────
    const deadResults = [];
    for (const [name, spec] of DEAD_PC_BLOCKS) {
      const addrs = resolveDeadBlock(spec, full);
      assert.ok(addrs.length > 0, `${name}: block addresses resolved`);
      const executed = addrs.filter((a) => allPcs.has(a));
      assert.equal(executed.length, 0,
        `${name} never executed (hit: ${executed.map((a) => a.toString(8)).join(',') || 'none'})`);
      deadResults.push({ block: name, addrs: addrs.map((a) => a.toString(8)), executed: false });
    }

    // ── 4. Ratchet: the contract must not have eroded ──────────────────────
    assert.ok(existsSync(BASELINE_PATH),
      'coverage-baseline.json present (regenerate with gen-coverage-baseline.mjs)');
    const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
    const ratchet = checkRatchet(baseline, run);
    assert.ok(ratchet.ok,
      `coverage ratchet violated — the contract eroded:\n  ${ratchet.violations.join('\n  ')}\n` +
      `If this change is intentional, regenerate coverage-baseline.json and review the diff.`);

    // ── Write the live ledger manifest ─────────────────────────────────────
    const manifest = {
      ticket: 'T-COVERAGE (issue #27)',
      adr: ['ADR-0007', 'ADR-0012'],
      generated: new Date().toISOString(),
      substrate,
      gate: 'PASS',
      hardening: {
        failClosed: true,
        ratcheted: true,
        minDistinctPcs: baseline.minDistinctPcs,
        iohWordsPatched: iohCount,
      },
      summary: {
        skipSitesBothWays: result.bothWays.length,
        skipSitesOneWayConfirmed: result.oneWayConfirmed.length,
        skipSitesDeadBlockConfirmed: result.deadSkipConfirmed.length,
        multiwayRealized: result.multiwayEntries.filter((e) => e.realizedTargets.length > 0).length,
        multiwayTemplateCellsConfirmedDead: result.deadMultiwayConfirmed.length,
        dark: result.dark.length,
        unclassified: result.unclassified.length,
        inContractSkipSites: run.listing.skipSites.size,
        inContractMultiway: run.listing.multiwayBranches.size,
        distinctPcs: allPcs.size,
      },
      oneWayRegister: [...register].map(([addr, direction]) => ({
        addr: addr.toString(8), direction,
        confirmed: CoverageGate.isConfirmedOneWay(result, addr, direction),
      })),
      deadMultiway: result.deadMultiwayConfirmed.map((e) => ({ addr: e.addr.toString(8), reason: e.reason })),
      deadSkipSites: result.deadSkipConfirmed.map((e) => ({ addr: e.addr.toString(8), reason: e.reason })),
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
