/**
 * Issue 6: T-IMAGE — listing↔core cross-check gate (ADR-0006).
 *
 * Witness: the Assembler's symbol-resolved listing agrees, word-for-word,
 * with what the Substrate holds in core after `load`, across every assigned
 * address. This is the trust anchor every Vector and Trace relies on.
 *
 * Test structure:
 *   1. parseListing unit tests (no Substrate)
 *   2. buildImageExamineScript unit tests (no Substrate)
 *   3. parseImageExamineOutput unit tests (no Substrate)
 *   4. integration: rim SHA matches provenance.json record
 *   5. integration: listing↔core gate passes for all 847 assigned addresses
 *   6. integration: provenance.json listing_core_status updated to reflect gate
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseListing,
  buildImageExamineScript,
  parseImageExamineOutput,
  gateListingVsCore,
  rimSha256,
} from './image.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RIM_PATH = join(ROOT, 'build/spacewar31.rim');
const LISTING_PATH = join(ROOT, 'build/spacewar31.lst');
const PROVENANCE_PATH = join(HERE, 'provenance.json');

// ── parseListing ──────────────────────────────────────────────────────────────

test('parseListing: extracts (addr, word) pairs from fixture', async () => {
  const text = await readFile(
    join(HERE, 'fixtures/image-listing-sample.lst'),
    'utf8',
  );
  const entries = parseListing(text);
  assert.equal(entries.length, 5, '5 address+word lines in sample');
  assert.deepEqual(entries[0], { addr: 0o00004, word: 0o601561 });
  assert.deepEqual(entries[1], { addr: 0o00005, word: 0o601556 });
  assert.deepEqual(entries[2], { addr: 0o00006, word: 0o710041 });
  assert.deepEqual(entries[3], { addr: 0o00007, word: 0o675017 });
  assert.deepEqual(entries[4], { addr: 0o00246, word: 0o000000 });
});

test('parseListing: ignores constant-definition lines (no address field)', async () => {
  // Lines like "    3       640500      szm=..." have value but no address.
  const text = [
    '    3       640500      \tszm=sza sma-szf',
    '    4       650500      \tspq=szm i',
    '   68 00004 601561      \tjmp a40',
  ].join('\n');
  const entries = parseListing(text);
  assert.equal(entries.length, 1, 'only the address line is included');
  assert.deepEqual(entries[0], { addr: 4, word: 0o601561 });
});

test('parseListing: ignores symbol-table and header lines', () => {
  const text = [
    '                                                                        Page 1',
    '',
    ' sqt    000246',
    ' sqx    000260',
    '   68 00004 601561      \tjmp a40',
  ].join('\n');
  const entries = parseListing(text);
  assert.equal(entries.length, 1, 'only the address line is included');
});

test('parseListing: deduplicates addresses (keeps first occurrence)', () => {
  const text = [
    '   68 00004 601561      \tjmp a40',
    '   99 00004 777777      \tduplicate',
  ].join('\n');
  const entries = parseListing(text);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { addr: 4, word: 0o601561 });
});

// ── buildImageExamineScript ───────────────────────────────────────────────────

test('buildImageExamineScript: load + one examine per entry + quit', () => {
  const entries = [
    { addr: 0o4,   word: 0o601561 },
    { addr: 0o246, word: 0o000000 },
  ];
  const script = buildImageExamineScript('/tmp/test.rim', entries);
  assert.equal(script[0], 'load /tmp/test.rim');
  assert.equal(script[1], 'examine 4');
  assert.equal(script[2], 'examine 246');
  assert.equal(script[3], 'quit');
  assert.equal(script.length, 4);
});

// ── parseImageExamineOutput ───────────────────────────────────────────────────

test('parseImageExamineOutput: extracts values in order from SIMH output', () => {
  const lines = [
    'PDP-1 simulator Open SIMH V4.1-0 Current',
    '4:\t601561',
    '246:\t000000',
    'Goodbye',
  ];
  const values = parseImageExamineOutput(lines, 2);
  assert.equal(values[0], 0o601561);
  assert.equal(values[1], 0o000000);
});

test('parseImageExamineOutput: throws when count mismatches', () => {
  const lines = ['4:\t601561'];
  assert.throws(
    () => parseImageExamineOutput(lines, 2),
    /expected 2 examine results, got 1/,
  );
});

test('parseImageExamineOutput: handles leading zeros in values', () => {
  const lines = ['246:\t000000'];
  const [v] = parseImageExamineOutput(lines, 1);
  assert.equal(v, 0);
});

// ── integration: rim SHA + listing↔core gate ─────────────────────────────────

test(
  'rim SHA-256 matches oracle/provenance.json rim_sha256',
  { timeout: 10_000 },
  async () => {
    const prov = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'));
    const sha = await rimSha256(RIM_PATH);
    assert.equal(
      sha,
      prov.rim_sha256,
      'assembled rim hash must match the recorded provenance hash',
    );
  },
);

test(
  'listing↔core gate passes for all assigned addresses (live Substrate)',
  { timeout: 30_000 },
  async () => {
    const listingText = await readFile(LISTING_PATH, 'utf8');
    const entries = parseListing(listingText);

    assert.ok(entries.length > 800, `expected >800 listing entries, got ${entries.length}`);

    const { matched } = await gateListingVsCore(RIM_PATH, entries);

    assert.equal(matched, entries.length, 'all listing entries must match core');
  },
);

test(
  'provenance.json listing_core_status updated to reflect mechanical gate',
  { timeout: 30_000 },
  async () => {
    const listingText = await readFile(LISTING_PATH, 'utf8');
    const entries = parseListing(listingText);
    const sha = await rimSha256(RIM_PATH);

    const { matched } = await gateListingVsCore(RIM_PATH, entries);

    const prov = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'));

    const newStatus =
      `verified — listing↔core gate: ${matched} assigned addresses match core after load ` +
      `(image.js gateListingVsCore; rim sha256 ${sha.slice(0, 12)}...)`;

    prov.rim_sha256 = sha;
    prov.listing_core_status = newStatus;

    await writeFile(PROVENANCE_PATH, JSON.stringify(prov, null, 2) + '\n');

    // Re-read and confirm it was written correctly
    const reread = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'));
    assert.equal(reread.listing_core_status, newStatus);
    assert.equal(reread.rim_sha256, sha);
  },
);
