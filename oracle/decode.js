/**
 * decode.js — build the Portable Oracle from a frozen raw golden.
 *
 *   decodeFrame(rawFrame) → portableFrame
 *
 * This module IS the per-field ledger (ADR-0015).  Each captured word forces
 * its bin as the code reaches it:
 *
 *   A  raw word carried VERBATIM, relabeled address→field ("decode the
 *      location, never the value" — the ADR-0008 reconcile).  No interpretation,
 *      no binary point, no decimal: the raw 18-bit pattern *is* the fixed18
 *      value, losslessly portable.
 *   B  the ONE semantic decode: mtb calc-address → object_state enum, keyed on
 *      the exact 18-bit word, fail-closed on an unmapped value.
 *   C  drop, with a written white-box "never feeds the dynamics" argument.
 *      A wrong drop is a deliberate supersede (ADR-0012), never silent.
 *
 * Read-set/inclusion analysis is inclusion-only (ADR-0014): it recovered
 * nco + nh1-4 as KEEPs the first-draft ledger was about to drop.
 *
 * The address→bin partition below is the SINGLE source of truth for both the
 * decode and its guard tests (decode.test.js): they cannot diverge.
 */
import { readFile } from 'node:fs/promises';
import { REFERENCE_DIR, goldenPath } from './reference-snapshots.js';
import { join } from 'node:path';

const NOB = 0o30; // 24 — total colliding objects (source :663)

/** octal-string address key, matching the golden's word map (no leading zero). */
const addr = (n) => n.toString(8);

/**
 * The object-table ledger.  `slots` = 24 (all colliding objects) or 2 (ships
 * only).  A 2-wide column has NO source cell for slots 2-23, so those fields are
 * ABSENT (never fabricated as 0); absent = the Oracle makes no claim (ungraded).
 */
export const OBJECT_COLUMNS = [
  { sym: 'mtb', base: 0o3476, slots: 24, bin: 'B', field: 'state' },
  { sym: 'nx1', base: 0o3526, slots: 24, bin: 'A', field: 'position_x' },
  { sym: 'ny1', base: 0o3556, slots: 24, bin: 'A', field: 'position_y' },
  { sym: 'na1', base: 0o3606, slots: 24, bin: 'A', field: 'lifetime' },
  { sym: 'nb1', base: 0o3636, slots: 24, bin: 'C',
    drop: 'mtc instruction-count budget (:677) — pure timing; ADR-0014\'s own Moore-1956 hidden-state example' },
  { sym: 'ndx', base: 0o3666, slots: 24, bin: 'A', field: 'velocity_x' },
  { sym: 'ndy', base: 0o3716, slots: 24, bin: 'A', field: 'velocity_y' },
  { sym: 'nom', base: 0o3746, slots: 2,  bin: 'A', field: 'angular_velocity' }, // :686, no draft-Record field (finding #1)
  { sym: 'nth', base: 0o3750, slots: 2,  bin: 'A', field: 'angle' },            // :689
  { sym: 'nfu', base: 0o3752, slots: 2,  bin: 'A', field: 'fuel' },             // :692
  { sym: 'ntr', base: 0o3754, slots: 2,  bin: 'A', field: 'torpedoes' },        // :695
  { sym: 'not', base: 0o3756, slots: 2,  bin: 'C',
    drop: 'outline pointer (:698) — display; PROVISIONAL pending a collision-test read' },
  { sym: 'nco', base: 0o3760, slots: 2,  bin: 'A', field: 'old_control_word' }, // KEEP: edge-detects torpedo (:1234) + hyperspace (:1296)
  // nh1-4 recovered KEEPs — hyperspace state, NOT heading sin/cos.  Roles below
  // are inferred from usage; EPIC #5 confirms the exact semantics/names.
  { sym: 'nh1', base: 0o3762, slots: 2,  bin: 'A', field: 'hyperspace_saved_calc' },   // mh1 saved calc ptr :1300/:1052
  { sym: 'nh2', base: 0o3764, slots: 2,  bin: 'A', field: 'hyperspace_active' },        // mh2 gates entry :1291
  { sym: 'nh3', base: 0o3766, slots: 2,  bin: 'A', field: 'hyperspace_button_timer' },  // mh3 hyperbutton counter :1289
  { sym: 'nh4', base: 0o3770, slots: 2,  bin: 'A', field: 'hyperspace_counter' },       // mh4 accumulator :1061-1066
];

/** Global (non-per-object) game state. */
export const GLOBALS = [
  { sym: 'ran', addr: 0o31, bin: 'A', field: 'ran' }, // evolving PRNG state — RNG-divergence tripwire (D3)
];

/** Bin-C drops outside the object table. */
export const NON_OBJECT_DROPS = [
  { sym: 'ddd', lo: 0o20, hi: 0o20,
    drop: 'single/dual outline flag (:.20) — display-only (D4)' },
  { sym: 'scratch', lo: 0o3236, hi: 0o3266,
    drop: 'calc-loop working registers (dac \\mdx etc.) — not game state; at the frame seam they hold only the last-processed object\'s transient values. Per-word confirm none carries cross-frame state; promote any that does to globals like ran.' },
];

/**
 * Bin-B: exact 18-bit stored word → object_state.  Every value present in the
 * 11 frozen goldens; all seven identified from build/spacewar31.lst.  Keyed on
 * the EXACT word (never a masked base): the sign/self-mod bit 400000 is not a
 * uniform phase marker, so masking would smuggle in an unwitnessed reading.
 */
export const STATE_TABLE = new Map([
  ['000000', 'empty'],
  ['002136', 'torpedo'],       // tcr
  ['002310', 'ship'],          // ss1
  ['002314', 'ship'],          // ss2
  ['402052', 'exploding'],     // mex|400000  (:889)
  ['402170', 'hyperspace_in'], // hp1|400000  — direction PROVISIONAL (EPIC #5)
  ['002246', 'hyperspace_out'],// hp3         — direction PROVISIONAL (EPIC #5)
]);

/** mtb word → state, fail-closed: an unmapped calc address halts decode (Q4). */
function decodeState(word, slot) {
  const s = STATE_TABLE.get(word);
  if (s === undefined) {
    throw new Error(
      `decode: unmapped mtb calc word ${word} at slot ${slot} — Bin-B table hole (fail-closed)`);
  }
  return s;
}

function readWord(words, a, sym, slot) {
  const w = words[addr(a)];
  if (w === undefined) {
    throw new Error(`decode: missing captured word @${addr(a)} (${sym} slot ${slot})`);
  }
  return w;
}

/** decodeFrame(rawFrame) → { label, objects:[24], globals } */
export function decodeFrame(rawFrame) {
  const { label, words } = rawFrame;

  const objects = [];
  for (let slot = 0; slot < NOB; slot++) {
    const obj = {};
    for (const col of OBJECT_COLUMNS) {
      if (slot >= col.slots) continue; // ship-only column, non-ship slot → field ABSENT
      const w = readWord(words, col.base + slot, col.sym, slot);
      if (col.bin === 'C') continue;   // dropped (white-box argument on the column)
      obj[col.field] = col.bin === 'B' ? decodeState(w, slot) : w; // B=enum, A=raw word verbatim
    }
    objects.push(obj);
  }

  const globals = {};
  for (const g of GLOBALS) globals[g.field] = readWord(words, g.addr, g.sym, 0);

  return { label, objects, globals };
}

/** Decode every frame of a loaded golden. */
export function decodeGolden(golden) {
  return {
    scenario: golden.scenario,
    instrument: 'portable frame — address-free game state decoded from the raw golden ' +
      '(ADR-0015): Bin-A raw words verbatim, Bin-B state enum, Bin-C dropped.',
    frames: golden.frames.map(decodeFrame),
  };
}

/**
 * The address→bin partition, derived from the ledger above — the SINGLE source
 * of truth the guard reuses (decode.test.js) so decode and its check cannot
 * diverge.  Returns { A, B, C } as sets of octal address strings.  The guard
 * asserts A∪B∪C equals the captured surface EXACTLY and the three are disjoint:
 * an unclassified captured word is then a build error (fail-closed), which is
 * what mechanically forbids a *silent* drop.
 */
export function partitionAddresses() {
  const bins = { A: new Set(), B: new Set(), C: new Set() };
  const add = (bin, a) => bins[bin].add(addr(a));
  for (const g of GLOBALS) add(g.bin, g.addr);
  for (const d of NON_OBJECT_DROPS) for (let a = d.lo; a <= d.hi; a++) add('C', a);
  for (const col of OBJECT_COLUMNS)
    for (let s = 0; s < col.slots; s++) add(col.bin, col.base + s);
  return bins;
}

/** Every Bin-A (addr, field, slot) pair — used by the lossless round-trip guard. */
export function binAFields() {
  const out = [];
  for (const g of GLOBALS) if (g.bin === 'A') out.push({ addr: addr(g.addr), field: g.field, slot: null });
  for (const col of OBJECT_COLUMNS)
    if (col.bin === 'A')
      for (let s = 0; s < col.slots; s++)
        out.push({ addr: addr(col.base + s), field: col.field, slot: s });
  return out;
}

export const portablePath = (name) => join(REFERENCE_DIR, `${name}.portable.json`);

export async function decodeGoldenFile(name) {
  return decodeGolden(JSON.parse(await readFile(goldenPath(name), 'utf8')));
}

// CLI: `node oracle/decode.js gravity` — emit the portable frame(s).
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('decode.js')) {
  const name = process.argv[2] || 'gravity';
  decodeGoldenFile(name).then((p) => {
    process.stdout.write(JSON.stringify(p, null, 1) + '\n');
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
