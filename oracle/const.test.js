/**
 * T-CONST: Witness the tunable constants tno…ran (source lines 70–97)
 * by listing↔core byte identity (ADR-0006, ADR-0012 class D — Witness).
 *
 * No branches are exercised here. xct-reached instruction-constants (tno,
 * tvl, rlt, tlf, sac, the, mhs, hd1, hd2, hd3, hr1, hr2) are witnessed as
 * words only; their effect is exercised in the routines that xct them.
 *
 * Closes issue #10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1 } from './simh.js';
import { CONSTANTS } from './const-witness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM = join(ROOT, 'build/spacewar31.rim');

/** Parse "addr:\tword" lines from SIMH examine output into addr→word Map. */
function parseCoreWords(lines) {
  const core = new Map();
  for (const line of lines) {
    const m = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (m) core.set(parseInt(m[1], 8), parseInt(m[2], 8));
  }
  return core;
}

test('T-CONST: constant table covers exactly tno…ran (20 cells, addrs 6–31 octal)', () => {
  assert.equal(CONSTANTS.length, 20, '20 constant cells from tno (addr 6) to ran (addr 31)');
  assert.equal(CONSTANTS[0].name, 'tno', 'first cell is tno');
  assert.equal(CONSTANTS[0].addr, 0o006, 'tno at octal address 6');
  assert.equal(CONSTANTS[19].name, 'ran', 'last cell is ran');
  assert.equal(CONSTANTS[19].addr, 0o031, 'ran at octal address 31');
});

test('T-CONST: xct-instruction cells are flagged and data cells are not', () => {
  // The cells whose word is an instruction reached via `xct` in a consuming
  // routine — each xct-only, never read as a data operand (build/spacewar31.lst).
  const XCT_REACHED = ['tno', 'tvl', 'rlt', 'tlf', 'sac', 'the', 'mhs', 'hd1', 'hd2', 'hd3', 'hr1', 'hr2'];
  // The remaining cells are plain data values, carrying no xct flag.
  const DATA_CELLS = ['foo', 'maa', 'str', 'me1', 'me2', 'ddd', 'hur', 'ran'];

  const flagged = CONSTANTS.filter((c) => c.xct).map((c) => c.name);
  assert.deepEqual([...flagged].sort(), [...XCT_REACHED].sort(), 'xct cells match the listing');

  for (const name of DATA_CELLS) {
    assert.ok(!CONSTANTS.find((c) => c.name === name)?.xct, `${name} is data, not xct`);
  }
});

test('T-CONST: each constant cell — listing word matches core (ADR-0006)', async (t) => {
  const { lines } = await runPdp1([
    `load ${RIM}`,
    'examine 6-31',
    'quit',
  ]);
  const core = parseCoreWords(lines);

  for (const c of CONSTANTS) {
    const label = `${c.name} @ octal ${c.addr.toString(8).padStart(2, '0')}${c.xct ? ' [xct]' : ''}`;
    await t.test(label, () => {
      const got = core.get(c.addr);
      assert.notEqual(got, undefined, `${c.name}: address ${c.addr.toString(8)} not in core examine output`);
      assert.strictEqual(
        got,
        c.word,
        `${c.name} listing=${c.word.toString(8).padStart(6, '0')} core=${got?.toString(8).padStart(6, '0')}`
      );
    });
  }
});
