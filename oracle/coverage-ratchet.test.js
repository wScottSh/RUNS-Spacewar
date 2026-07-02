/**
 * Tests for the coverage ratchet (coverage-ratchet.js) — the guard that stops
 * the coverage contract from being silently narrowed.
 *
 * These are PURE (no Substrate) so they run in every environment, including
 * the substrate-bypass path — the guard's own logic is always verified even
 * when the live gate is skipped. Each case is a concrete narrowing/dodge that
 * the EPIC #5 audit showed is possible, proving the ratchet catches it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBaseline, checkRatchet } from './coverage-ratchet.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'coverage-baseline.json');

/** A synthetic "current run" that exactly reproduces a baseline (honest case). */
function runMatching(baseline) {
  return {
    listing: {
      skipSites: new Map(baseline.inContractSkipSites.map((a) => [parseInt(a, 8), 1])),
      multiwayBranches: new Map(baseline.inContractMultiwaySites.map((a) => [parseInt(a, 8), 1])),
    },
    allPcs: new Set(Array.from({ length: baseline.minDistinctPcs + 50 }, (_, i) => i)),
    result: {
      oneWayConfirmed: Object.entries(baseline.oneWayRegister)
        .map(([a, d]) => ({ addr: parseInt(a, 8), direction: d })),
      deadMultiwayConfirmed: baseline.deadMultiway.map((a) => ({ addr: parseInt(a, 8) })),
      deadSkipConfirmed: baseline.deadSkipSites.map((a) => ({ addr: parseInt(a, 8) })),
      multiwayEntries: [{ addr: 0o443, realizedTargets: baseline.dispatchArms.map((a) => parseInt(a, 8)) }],
    },
  };
}

/** Deep-ish clone so a mutation in one case does not leak into the next. */
function clone(run) {
  return {
    listing: {
      skipSites: new Map(run.listing.skipSites),
      multiwayBranches: new Map(run.listing.multiwayBranches),
    },
    allPcs: new Set(run.allPcs),
    result: {
      oneWayConfirmed: run.result.oneWayConfirmed.map((e) => ({ ...e })),
      deadMultiwayConfirmed: run.result.deadMultiwayConfirmed.map((e) => ({ ...e })),
      deadSkipConfirmed: run.result.deadSkipConfirmed.map((e) => ({ ...e })),
      multiwayEntries: run.result.multiwayEntries.map((e) => ({ addr: e.addr, realizedTargets: [...e.realizedTargets] })),
    },
  };
}

async function loadBaseline() {
  return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
}

test('ratchet: honest run matching the baseline passes', async () => {
  const baseline = await loadBaseline();
  const { ok, violations } = checkRatchet(baseline, runMatching(baseline));
  assert.ok(ok, `honest run should pass; got: ${violations.join('; ')}`);
});

test('ratchet: catches contract narrowing (a dropped in-contract skip site)', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.listing.skipSites.delete(0o2376);   // gravity capture site
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'dropping a required skip site must fail');
  assert.match(violations.join('\n'), /2376 disappeared/);
});

test('ratchet: catches a dropped in-contract multiway site', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.listing.multiwayBranches.delete(0o443);   // the dispatch itself
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'dropping a required multiway site must fail');
  assert.match(violations.join('\n'), /443 disappeared/);
});

test('ratchet: catches a bogus one-way reclassification (dodge a gap as "correctly dead")', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.result.oneWayConfirmed.push({ addr: 0o1741, direction: 'skip' });
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'a new one-way claim must not slip in silently');
  assert.match(violations.join('\n'), /1741 added without a baseline update/);
});

test('ratchet: catches an inverted register direction (the exact audit bug)', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.result.oneWayConfirmed.find((e) => e.addr === 0o2673).direction = 'no-skip';
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'flipping a registered direction must fail');
  assert.match(violations.join('\n'), /2673 direction changed skip → no-skip/);
});

test('ratchet: catches a dropped one-way entry', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.result.oneWayConfirmed = run.result.oneWayConfirmed.filter((e) => e.addr !== 0o2076);
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'a register entry vanishing must fail');
  assert.match(violations.join('\n'), /2076 .* no longer confirmed one-way/);
});

test('ratchet: catches a stubbed run via the distinct-PC floor', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.allPcs = new Set([1, 2, 3]);
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'a run that barely executed must fail');
  assert.match(violations.join('\n'), /barely executed|static\/stubbed/);
});

test('ratchet: catches a dispatch arm going dark', async () => {
  const baseline = await loadBaseline();
  const run = clone(runMatching(baseline));
  run.result.multiwayEntries[0].realizedTargets =
    run.result.multiwayEntries[0].realizedTargets.filter((a) => a !== 0o446);  // the synthetic-outline arm
  const { ok, violations } = checkRatchet(baseline, run);
  assert.ok(!ok, 'a dispatch arm no longer realized must fail');
  assert.match(violations.join('\n'), /dispatch arm 446 no longer realized/);
});

test('ratchet: buildBaseline round-trips through checkRatchet', async () => {
  // A baseline built from a run must accept that same run.
  const baseline = await loadBaseline();
  const run = runMatching(baseline);
  const rebuilt = buildBaseline(run);
  const { ok } = checkRatchet(rebuilt, run);
  assert.ok(ok, 'a freshly-built baseline accepts its own run');
});

test('coverage-baseline.json is committed and well-formed', async () => {
  const baseline = await loadBaseline();
  assert.ok(Array.isArray(baseline.inContractSkipSites) && baseline.inContractSkipSites.length > 100,
    'baseline records the in-contract skip-site set');
  assert.equal(Object.keys(baseline.oneWayRegister).length, 8, 'baseline pins the 8-entry one-way register');
  assert.ok(baseline.minDistinctPcs > 1000, 'baseline sets a meaningful execution-proof floor');
});
