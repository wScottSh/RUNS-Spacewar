/**
 * T-OUTLINE: Witness ship outlines ot1/ot2 by listing↔core identity (ADR-0006).
 *
 * Source lines 1338–1355 (spacewar3.1_complete.txt). The 8-word direction-code
 * tables are also the input fixture for T-OC (the outline compiler).
 *
 * Acceptance criteria:
 *   1. ot1 and ot2 assembled words match the listing byte-for-byte (ADR-0006)
 *   2. Recorded as a Witness gate (no branch obligation)
 *   3. Confirmed available as the fixture input for T-OC
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1 } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');

// ── listing constants ─────────────────────────────────────────────────────────
// Source lines 1338–1345 (listing 02735–02744), spacewar3.1_complete.txt.
// Cross-referenced against build/spacewar31.lst symbol table: ot1 = 002735.

export const OT1_ADDR = 0o2735;
export const OT1_WORDS = [
  0o111131,  // line 1338
  0o111111,  // line 1339
  0o111111,  // line 1340
  0o111163,  // line 1341
  0o311111,  // line 1342
  0o146111,  // line 1343
  0o111114,  // line 1344
  0o700000,  // line 1345 — terminator (code 7)
];

// Source lines 1348–1355 (listing 02752–02761), spacewar3.1_complete.txt.
// Cross-referenced against build/spacewar31.lst symbol table: ot2 = 002752.

export const OT2_ADDR = 0o2752;
export const OT2_WORDS = [
  0o013113,  // line 1348
  0o113111,  // line 1349
  0o116313,  // line 1350
  0o131111,  // line 1351
  0o161151,  // line 1352
  0o111633,  // line 1353
  0o365114,  // line 1354
  0o700000,  // line 1355 — terminator (code 7)
];

// ── helpers ──────────────────────────────────────────────────────────────────

const WORD_MAX = (1 << 18) - 1;  // PDP-1 words are 18 bits wide

/** Format an integer as a zero-padded 6-digit octal string (one PDP-1 word). */
const oct6 = (n) => n.toString(8).padStart(6, '0');

/**
 * Load the RIM file in SIMH and examine each address in the list.
 * Returns a Map of integer-address → integer-word.
 */
async function examineCore(addresses) {
  const lines = [`load ${RIM_PATH}`];
  for (const addr of addresses) {
    lines.push(`examine ${addr.toString(8)}`);
  }
  lines.push('quit');
  const { lines: out } = await runPdp1(lines);
  const core = new Map();
  for (const line of out) {
    const m = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (m) core.set(parseInt(m[1], 8), parseInt(m[2], 8));
  }
  return core;
}

/** Assert every word of a listing table lies in the 18-bit range. */
function assertWordsFit18Bits(name, words) {
  for (let i = 0; i < words.length; i++) {
    assert.ok(
      words[i] >= 0 && words[i] <= WORD_MAX,
      `${name}[${i}] = ${oct6(words[i])} out of range`
    );
  }
}

/**
 * Assert each listing word equals the value loaded into core at addr+i.
 * `core` is the Map returned by examineCore.
 */
function assertListingMatchesCore(name, addr, words, core) {
  for (let i = 0; i < words.length; i++) {
    const a = addr + i;
    const actual = core.get(a);
    assert.equal(
      actual,
      words[i],
      `${name}[${i}] at ${oct6(a)}: expected ${oct6(words[i])} ` +
      `got ${actual != null ? oct6(actual) : 'absent'}`
    );
  }
}

// ── unit tests (listing validation, no Substrate) ────────────────────────────

test('ot1 listing has exactly 8 words', () => {
  assert.equal(OT1_WORDS.length, 8);
});

test('ot2 listing has exactly 8 words', () => {
  assert.equal(OT2_WORDS.length, 8);
});

test('ot1 terminates with code 7 (700000)', () => {
  assert.equal(OT1_WORDS[OT1_WORDS.length - 1], 0o700000);
});

test('ot2 terminates with code 7 (700000)', () => {
  assert.equal(OT2_WORDS[OT2_WORDS.length - 1], 0o700000);
});

test('all ot1 words fit in 18 bits', () => {
  assertWordsFit18Bits('ot1', OT1_WORDS);
});

test('all ot2 words fit in 18 bits', () => {
  assertWordsFit18Bits('ot2', OT2_WORDS);
});

test('ot1 assembled address matches listing symbol table (002735)', () => {
  assert.equal(OT1_ADDR, 0o2735);
});

test('ot2 assembled address matches listing symbol table (002752)', () => {
  assert.equal(OT2_ADDR, 0o2752);
});

// ── integration: listing ↔ core identity (ADR-0006) ──────────────────────────

test('ot1 listing words match core memory after load (ADR-0006 witness)', async () => {
  const core = await examineCore(OT1_WORDS.map((_, i) => OT1_ADDR + i));
  assertListingMatchesCore('ot1', OT1_ADDR, OT1_WORDS, core);
});

test('ot2 listing words match core memory after load (ADR-0006 witness)', async () => {
  const core = await examineCore(OT2_WORDS.map((_, i) => OT2_ADDR + i));
  assertListingMatchesCore('ot2', OT2_ADDR, OT2_WORDS, core);
});

// ── fixture: T-OC input ───────────────────────────────────────────────────────

test('ot1/ot2 fixture written for T-OC input (oracle/fixtures/ot-fixture.json)', async () => {
  const fixture = {
    witness: 'listing-core-identity',
    adr: 'ADR-0006',
    source_lines: '1338-1355',
    ot1: {
      addr_octal: oct6(OT1_ADDR),
      words_octal: OT1_WORDS.map((w) => oct6(w)),
    },
    ot2: {
      addr_octal: oct6(OT2_ADDR),
      words_octal: OT2_WORDS.map((w) => oct6(w)),
    },
  };
  const path = join(HERE, 'fixtures/ot-fixture.json');
  await writeFile(path, JSON.stringify(fixture, null, 2) + '\n');
  const readback = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(readback.ot1.addr_octal, '002735', 'ot1 address');
  assert.equal(readback.ot2.addr_octal, '002752', 'ot2 address');
  assert.deepEqual(readback.ot1.words_octal, ['111131','111111','111111','111163','311111','146111','111114','700000']);
  assert.deepEqual(readback.ot2.words_octal, ['013113','113111','116313','131111','161151','111633','365114','700000']);
});
