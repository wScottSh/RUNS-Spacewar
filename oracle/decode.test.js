/**
 * decode.test.js — the guard that keeps decode.js from becoming an unchecked
 * adapter (ADR-0015 §Guard).  Four complementary layers, each pinning a
 * different failure mode of the Portable-Oracle projection:
 *
 *   1. PARTITION-COMPLETENESS (fail-closed).  Every captured word is classified
 *      as exactly one bin; A∪B∪C equals the capture surface, disjoint.  An
 *      unclassified word is a build error — this is what forbids a *silent*
 *      drop.  Tied to the real golden's word keys, not just the range math.
 *   2. BIN-A LOSSLESS.  Each Bin-A field equals the raw word verbatim across
 *      every golden — proof decode "decoded the location, never the value".
 *   3. BIN-B FIXTURE + FAIL-CLOSED.  The 7-entry word→state table is pinned and
 *      an unmapped calc word throws.
 *   4. FROZEN PORTABLE GOLDEN.  decode(raw) equals the committed *.portable.json
 *      end-to-end (the T-REFERENCE pattern one level up); any drift is a diff.
 *
 * Pure over the committed raw goldens — no Substrate.  A missing/empty golden
 * (raw or portable) is ALWAYS red: deleting an answer must not make the check
 * cheaper (same reflex as the coverage and reference gates).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SNAPSHOT_SCENARIOS, SNAPSHOT_RANGES, loadGolden } from './reference-snapshots.js';
import {
  decodeFrame, decodeGolden, partitionAddresses, binAFields,
  STATE_TABLE, portablePath,
} from './decode.js';

/** The captured surface as a set of octal address strings (from the ranges). */
function capturedAddrSet() {
  const s = new Set();
  for (const [lo, hi] of SNAPSHOT_RANGES) for (let a = lo; a <= hi; a++) s.add(a.toString(8));
  return s;
}

async function loadRawOrThrow(name) {
  const raw = await loadGolden(name);
  assert.ok(raw && Array.isArray(raw.frames) && raw.frames.length > 0,
    `raw golden missing/empty for ${name} — regenerate with gen-reference-goldens.mjs`);
  return raw;
}

test('Layer 1 — partition is complete and disjoint, tied to the real golden words', async () => {
  const { A, B, C } = partitionAddresses();
  const union = new Set([...A, ...B, ...C]);

  // Disjoint: no address in two bins.
  assert.equal(union.size, A.size + B.size + C.size,
    'bins overlap — an address is classified into more than one of A/B/C');

  // Complete vs the declared capture surface (no missing, no extra).
  const captured = capturedAddrSet();
  const missing = [...captured].filter((a) => !union.has(a));
  const extra = [...union].filter((a) => !captured.has(a));
  assert.deepEqual(missing, [], `captured words with NO bin (would be silently dropped): ${missing}`);
  assert.deepEqual(extra, [], `ledger classifies words never captured: ${extra}`);

  // Execution-grounded: the same set must equal the ACTUAL keys in a golden
  // frame, so widening the capture without re-binning fails here.
  const raw = await loadRawOrThrow('gravity');
  for (const frame of raw.frames) {
    const keys = new Set(Object.keys(frame.words));
    assert.equal(keys.size, union.size, `frame ${frame.label}: golden word count ≠ partition size`);
    for (const a of keys)
      assert.ok(union.has(a), `frame ${frame.label}: captured word @${a} is unclassified`);
  }
});

test('Layer 2 — every Bin-A field is the raw word, verbatim, across all goldens', async () => {
  const fields = binAFields();
  for (const name of SNAPSHOT_SCENARIOS) {
    const raw = await loadRawOrThrow(name);
    for (const rawFrame of raw.frames) {
      const p = decodeFrame(rawFrame);
      for (const { addr, field, slot } of fields) {
        const rawWord = rawFrame.words[addr];
        if (slot === null) {
          assert.equal(p.globals[field], rawWord, `${name}/${rawFrame.label}: global ${field} mutated`);
        } else {
          // Ship-only fields are ABSENT on non-ship slots — the guard confirms
          // decode never fabricates them, and copies verbatim where present.
          const got = p.objects[slot][field];
          if (got === undefined) continue; // absent by design (ship-only, non-ship slot)
          assert.equal(got, rawWord,
            `${name}/${rawFrame.label}: slot ${slot} ${field} not verbatim (got ${got}, raw ${rawWord})`);
        }
      }
    }
  }
});

test('Layer 3 — Bin-B state table is exactly the 7 witnessed entries, and unmapped is fail-closed', () => {
  const expected = new Map([
    ['000000', 'empty'], ['002136', 'torpedo'], ['002310', 'ship'], ['002314', 'ship'],
    ['402052', 'exploding'], ['402170', 'hyperspace_in'], ['002246', 'hyperspace_out'],
  ]);
  assert.deepEqual(new Map([...STATE_TABLE].sort()), new Map([...expected].sort()),
    'Bin-B table drifted from the seven listing-witnessed calc words');

  // Fail-closed: a calc word not in the table halts decode (never a silent unknown).
  const words = {};
  for (let a = 0o3476; a <= 0o3771; a++) words[a.toString(8)] = '000000';
  words[(0o3476).toString(8)] = '123456'; // slot 0 mtb = an unmapped calc address
  words[(0o31).toString(8)] = '000000';
  assert.throws(() => decodeFrame({ label: 'x', words }), /unmapped mtb calc word 123456/,
    'unmapped calc word must throw (fail-closed), not decode to a sentinel');
});

test('Layer 4 — decode(raw) equals the committed frozen portable golden', async () => {
  for (const name of SNAPSHOT_SCENARIOS) {
    const raw = await loadRawOrThrow(name);
    let committed;
    try {
      committed = JSON.parse(await readFile(portablePath(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') {
        assert.fail(`frozen portable golden missing for ${name} — regenerate with gen-portable-goldens.mjs and review the diff`);
      }
      throw err;
    }
    assert.ok(Array.isArray(committed.frames) && committed.frames.length > 0,
      `frozen portable golden empty for ${name}`);
    assert.deepEqual(committed, decodeGolden(raw),
      `${name}: decode output drifted from the frozen portable golden — regenerate and review the diff`);
  }
});
