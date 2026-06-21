/**
 * Image gate: listing↔core cross-check (ADR-0006).
 *
 * Faithfulness witness: the Assembler's symbol-resolved listing agrees,
 * word-for-word, with what the Substrate holds in core after `load`, across
 * every assigned address in the memory map. This gate is the trust anchor
 * that all Vectors and Traces depend on — no captured answer is trusted until
 * the Image it was captured from is witnessed.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runPdp1 } from './simh.js';

/**
 * Parse a macro1 listing file and extract (address, word) pairs.
 *
 * A line carries an assigned address when it has the form:
 *   <lineno(d)> <addr(5o)> <word(6o)> [<source>]
 * Lines with a value but no address (constant/macro definitions) have the
 * 6-digit value immediately after the line number, so the 5+1+6 pattern
 * fails (the 6th value digit is not whitespace) and they are excluded.
 *
 * Returns [{addr, word}] where addr and word are integers.
 * Duplicated addresses are de-duplicated; the first occurrence wins.
 */
export function parseListing(text) {
  const entries = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    // Require: whitespace lineno whitespace addr(5 octal) whitespace word(6 octal)
    const m = line.match(/^\s+\d+\s+([0-7]{5})\s+([0-7]{6})\b/);
    if (!m) continue;
    const addr = parseInt(m[1], 8);
    const word = parseInt(m[2], 8);
    if (!seen.has(addr)) {
      entries.push({ addr, word });
      seen.add(addr);
    }
  }
  return entries;
}

/**
 * Build a SIMH batch script that loads the rim then examines each listed
 * address. No CPU execution — pure memory read.
 */
export function buildImageExamineScript(rimPath, entries) {
  const lines = [`load ${rimPath}`];
  for (const { addr } of entries) {
    lines.push(`examine ${addr.toString(8)}`);
  }
  lines.push('quit');
  return lines;
}

/**
 * Parse SIMH examine output lines into an array of integer values, one per
 * entry in the order the examines were issued. Lines matching
 * `<octalAddr>: <octalValue>` are memory examine results; banners and
 * whitespace are ignored.
 *
 * Throws if the count of parsed values does not equal `count`.
 */
export function parseImageExamineOutput(lines, count) {
  const values = [];
  for (const line of lines) {
    const m = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (m) values.push(parseInt(m[2], 8));
  }
  if (values.length !== count) {
    throw new Error(
      `image gate: expected ${count} examine results, got ${values.length}`,
    );
  }
  return values;
}

const oct = (v) => v.toString(8).padStart(6, '0');

/**
 * Listing↔core gate (ADR-0006).
 *
 * Loads the rim into SIMH and examines every address in `entries`, comparing
 * the core word against the listing word. Throws with the witnessing case on
 * the first mismatch (the same fail-fast discipline as the sqt gate).
 *
 * Returns { matched: N } on success (N = entries.length).
 */
export async function gateListingVsCore(rimPath, entries) {
  const script = buildImageExamineScript(rimPath, entries);
  const { lines } = await runPdp1(script, { timeout: 30_000 });
  const coreWords = parseImageExamineOutput(lines, entries.length);

  for (let i = 0; i < entries.length; i++) {
    const { addr, word: listingWord } = entries[i];
    const coreWord = coreWords[i];
    if (coreWord !== listingWord) {
      throw new Error(
        `image gate FAIL: addr=${addr.toString(8).padStart(5, '0')} ` +
          `listing=${oct(listingWord)} core=${oct(coreWord)}`,
      );
    }
  }
  return { matched: entries.length };
}

/**
 * SHA-256 of the rim file's bytes, lowercase hex.
 * Used to confirm the Image loaded by SIMH is bit-identical to the recorded
 * provenance hash (oracle/provenance.json rim_sha256).
 */
export async function rimSha256(rimPath) {
  const data = await readFile(rimPath);
  return createHash('sha256').update(data).digest('hex');
}
