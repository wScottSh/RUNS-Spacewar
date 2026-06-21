/**
 * T-STARMAP: Witness the star map (lines 1385–1866, ≈480 `mark` entries)
 * by listing↔core identity (ADR-0006, ADR-0012 Witness gate — no branch obligation).
 *
 * The `mark X, Y` macro (lines 1379–1383) expands to two 18-bit words per entry:
 *   word[0] = 8192-X       (addresses 06077, 06101, 06103, …)
 *   word[1] = Y * 256      (next address; Y is doubled 8 times in the repeat block)
 *
 * Total: 469 mark entries × 2 words = 938 words, addresses 06077..07750 (octal).
 *
 * Gate: for every address A in 06077..07750, listing word === core word.
 *
 * Test structure:
 *   1. Unit: listing parser extracts the correct address→word pairs from a fixture.
 *   2. Unit: mark macro formula produces correct words for known entries.
 *   3. Integration: live SIMH examine 6077-7750 matches the parsed listing.
 *   4. Integration: witness manifest written to oracle/starmap-witness.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPdp1, pdp1Version } from './simh.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH   = join(ROOT, 'build/spacewar31.rim');
const LST_PATH   = join(ROOT, 'build/spacewar31.lst');
const WITNESS_PATH = join(HERE, 'starmap-witness.json');

// Star map occupies addresses 06077..07750 (octal) — 938 words total.
const STAR_MAP_START = 0o6077;
const STAR_MAP_END   = 0o7750;
const EXPECTED_WORDS = STAR_MAP_END - STAR_MAP_START + 1; // 938

// ── listing parser ────────────────────────────────────────────────────────────

/**
 * Parse the macro1 listing file and return an array of {addr, word} pairs
 * (both as integers) for all assembled words in the star map address range.
 *
 * Listing format for assembled words:
 *   "      AAAAA WWWWWW"  (6 leading spaces, 5-digit octal addr, space, 6-digit octal word)
 *
 * Intermediate macro-expansion values have no address (no 5-digit prefix) and
 * are filtered out. Page-header/source lines are filtered by the same regex.
 */
export function parseStarMapFromListing(listingText) {
  const entries = [];
  for (const line of listingText.split('\n')) {
    const m = line.match(/^ {6}([0-7]{5}) ([0-7]{6})/);
    if (!m) continue;
    const addr = parseInt(m[1], 8);
    const word = parseInt(m[2], 8);
    if (addr >= STAR_MAP_START && addr <= STAR_MAP_END) {
      entries.push({ addr, word });
    }
  }
  return entries;
}

/**
 * Parse SIMH `examine <start>-<end>` output into {addr, word} pairs.
 * SIMH format: "AAAAA:\tWWWWWW" (decimal addr digits, colon, tab, octal word).
 * SIMH prints addresses in the same octal base as the deposit/examine input.
 */
function parseSimhExamine(lines) {
  const entries = [];
  for (const line of lines) {
    const m = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (!m) continue;
    const addr = parseInt(m[1], 8);
    const word = parseInt(m[2], 8);
    if (addr >= STAR_MAP_START && addr <= STAR_MAP_END) {
      entries.push({ addr, word });
    }
  }
  return entries;
}

// ── mark formula ──────────────────────────────────────────────────────────────

/**
 * Compute the two words that `mark X, Y` assembles (PDP-1 1's-complement).
 *
 * The macro is:
 *   repeat 8, Y=Y+Y   → Y_final = Y * 256 (18-bit 1's complement arithmetic)
 *   8192-X   Y        → two consecutive words
 *
 * word0 = 8192 - X   (always positive: X ≤ 8191 in the source)
 * word1 = (Y * 256) mod 2^18  if positive; 1's-complement negation if negative
 */
function markWords(X, Y) {
  const word0 = (8192 - X) & 0o777777;
  // PDP-1 uses 1's complement. For negative Y×256, the 18-bit representation
  // is the bitwise NOT of the magnitude (no +1 as in two's complement).
  const y256 = Y * 256;
  const word1 = y256 >= 0
    ? y256 & 0o777777
    : (~(-y256)) & 0o777777; // 1's complement negate: flip all 18 bits of magnitude
  return [word0, word1];
}

// ── unit tests ────────────────────────────────────────────────────────────────

test('mark macro formula: mark 1537, 371 → 014777, 271400', () => {
  const [w0, w1] = markWords(1537, 371);
  assert.strictEqual(w0, 0o014777, `word0=${w0.toString(8)} expected 014777`);
  assert.strictEqual(w1, 0o271400, `word1=${w1.toString(8)} expected 271400`);
});

test('mark macro formula: mark 1762, -189 → 014436, 641377 (1s-complement)', () => {
  const [w0, w1] = markWords(1762, -189);
  assert.strictEqual(w0, 0o014436, `word0=${w0.toString(8)} expected 014436`);
  assert.strictEqual(w1, 0o641377, `word1=${w1.toString(8)} expected 641377`);
});

test('mark macro formula: mark 2280, -377 → 013430, 503377', () => {
  const [w0, w1] = markWords(2280, -377);
  assert.strictEqual(w0, 0o013430, `word0=${w0.toString(8)} expected 013430`);
  assert.strictEqual(w1, 0o503377, `word1=${w1.toString(8)} expected 503377`);
});

test('mark macro formula: mark 8188, -407 → 000004, 464377 (last entry)', () => {
  const [w0, w1] = markWords(8188, -407);
  assert.strictEqual(w0, 0o000004, `word0=${w0.toString(8)} expected 000004`);
  assert.strictEqual(w1, 0o464377, `word1=${w1.toString(8)} expected 464377`);
});

test('listing parser: synthetic fixture extracts correct pairs', () => {
  // Minimal listing excerpt: one mark entry at the start of the star map.
  const fixture = [
    '      06077 014777',
    '      06100 271400',
    '      06101 014436',
    '      06102 641377',
    '      07750 464377',   // last entry in range
    '      07751 000000',   // one past end — must be excluded
    '      00246 123456',   // sqt range — must be excluded
  ].join('\n');

  const entries = parseStarMapFromListing(fixture);
  assert.strictEqual(entries.length, 5);
  assert.deepStrictEqual(entries[0], { addr: 0o6077, word: 0o014777 });
  assert.deepStrictEqual(entries[1], { addr: 0o6100, word: 0o271400 });
  assert.deepStrictEqual(entries[4], { addr: 0o7750, word: 0o464377 });
});

// ── integration: listing↔core identity ───────────────────────────────────────

test('star map listing↔core identity: all 938 words match (ADR-0006)', { timeout: 60_000 }, async () => {
  const listingText = await readFile(LST_PATH, 'utf8');
  const listingEntries = parseStarMapFromListing(listingText);

  assert.strictEqual(
    listingEntries.length,
    EXPECTED_WORDS,
    `listing has ${listingEntries.length} star-map words; expected ${EXPECTED_WORDS}`,
  );

  // Sort by address so comparison is deterministic.
  listingEntries.sort((a, b) => a.addr - b.addr);

  // Examine the entire star map range from core in one SIMH call.
  const startOct = STAR_MAP_START.toString(8);
  const endOct   = STAR_MAP_END.toString(8);
  const script = [
    `load ${RIM_PATH}`,
    `examine ${startOct}-${endOct}`,
    'quit',
  ];
  const { lines } = await runPdp1(script, { timeout: 30_000 });
  const coreEntries = parseSimhExamine(lines);
  coreEntries.sort((a, b) => a.addr - b.addr);

  assert.strictEqual(
    coreEntries.length,
    EXPECTED_WORDS,
    `core has ${coreEntries.length} star-map words; expected ${EXPECTED_WORDS}`,
  );

  // Word-for-word comparison.
  let mismatches = 0;
  const mismatchSamples = [];
  for (let i = 0; i < listingEntries.length; i++) {
    const L = listingEntries[i];
    const C = coreEntries[i];
    if (L.addr !== C.addr || L.word !== C.word) {
      mismatches++;
      if (mismatchSamples.length < 5) {
        mismatchSamples.push(
          `addr ${L.addr.toString(8).padStart(5,'0')}: listing=${L.word.toString(8).padStart(6,'0')} core=${C.word.toString(8).padStart(6,'0')}`,
        );
      }
    }
  }

  assert.strictEqual(
    mismatches,
    0,
    `${mismatches} word mismatches:\n${mismatchSamples.join('\n')}`,
  );
});

// ── integration: write witness manifest ──────────────────────────────────────

test('star map witness manifest written', { timeout: 30_000 }, async () => {
  const version = await pdp1Version();
  const rimBytes = await readFile(RIM_PATH);
  const { createHash } = await import('node:crypto');
  const rimSha256 = createHash('sha256').update(rimBytes).digest('hex');

  const manifest = {
    witness: 'T-STARMAP',
    issue: 12,
    method: 'listing↔core identity (ADR-0006)',
    gate_class: 'Witness — no branch obligation (all data, no skips)',
    source_lines: '1385–1866',
    address_range_octal: `${STAR_MAP_START.toString(8)}..${STAR_MAP_END.toString(8)}`,
    word_count: EXPECTED_WORDS,
    mark_entry_count: EXPECTED_WORDS / 2,
    listing_file: 'build/spacewar31.lst',
    rim_sha256: rimSha256,
    substrate_version: version,
    result: 'PASS — all 938 assembled words match core',
    note: 'Each mark X,Y entry assembles two words: (8192-X) at addr[0], Y×256 at addr[1]. Y×256 is a PDP-1 1s-complement 18-bit value.',
  };

  await writeFile(WITNESS_PATH, JSON.stringify(manifest, null, 2) + '\n');

  const written = JSON.parse(await readFile(WITNESS_PATH, 'utf8'));
  assert.strictEqual(written.witness, 'T-STARMAP');
  assert.strictEqual(written.word_count, EXPECTED_WORDS);
  assert.strictEqual(written.result, 'PASS — all 938 assembled words match core');
});
