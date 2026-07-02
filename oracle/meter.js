/**
 * T-METER — coverage meter for Spacewar! 3.1 PDP-1 Oracle (ADR-0012).
 *
 * Maps a SIMH PC stream → source branch decisions (skip sites, multiway edges,
 * macro-expansion sites) and emits a per-decision coverage ledger.
 *
 * All functions are pure over their inputs (no Substrate calls). The caller is
 * responsible for running SIMH and supplying the listing text and PC stream.
 */

// ─── PDP-1 opcode constants ──────────────────────────────────────────────────

// Opcode field = top 5 bits of 18-bit word: word >> 13
const OP_ISP      = 19;  // 0o23 — isp: increment and skip if ≥ 0
const OP_SAD      = 20;  // 0o24 — sad: skip if AC ≠ M[Y]
const OP_SAS      = 21;  // 0o25 — sas: skip if AC = M[Y]
const OP_OPR_SKIP = 26;  // 0o32 — OPR-class skips (sma/spa/sza/spi/szs/szf)
const OP_JMP      = 24;  // 0o30 — jmp (for jmp . detection)

// OPR skip-condition bits mask (word & OPR_SKIP_MASK); if any bit is set, the
// OPR instruction is a skip instruction.  Covers SZF (bits 0-2), SZS (bits
// 3-5), SZA (bit 6), SPA (bit 7), SMA (bit 8), SPI (bit 9).
const OPR_SKIP_MASK = 0o3777;

// ─── Runtime-generated address range ────────────────────────────────────────

// The outline compiler (oc, T-OC) emits ~1100 words of executable code into
// locations 03773-05245 (octal) at runtime.  PCs in this range are
// runtime-generated and must not be mis-attributed to source lines.
export const RUNTIME_GEN_LOW  = 0o3773;  // 2043 decimal
export const RUNTIME_GEN_HIGH = 0o5245;  // 2725 decimal

// ─── Instruction word utilities ──────────────────────────────────────────────

/**
 * True if the 18-bit PDP-1 instruction word is a skip instruction.
 * Covers: isp, sad, sas, and all OPR-class skip mnemonics
 * (sma, spa, sza, spi, szs N, szf N, szm, spq, and compounds).
 */
export function isSkipWord(word) {
  const op = word >> 13;
  if (op === OP_ISP || op === OP_SAD || op === OP_SAS) return true;
  if (op === OP_OPR_SKIP && (word & OPR_SKIP_MASK) !== 0) return true;
  return false;
}

/**
 * Decode a human-readable mnemonic from a skip instruction word.
 * Used for macro-expansion lines that carry no source text.
 */
export function skipMnemonicFromWord(word) {
  const op = word >> 13;
  const ind = (word >> 12) & 1 ? ' i' : '';
  if (op === OP_ISP) return `isp${ind}`;
  if (op === OP_SAD) return `sad${ind}`;
  if (op === OP_SAS) return `sas${ind}`;
  // OPR-class skip: build mnemonic from condition bits.
  const cond = word & OPR_SKIP_MASK;
  const parts = [];
  if (cond & 0o2000) parts.push('spi');
  if (cond & 0o0400) parts.push('sma');
  if (cond & 0o0200) parts.push('spa');
  if (cond & 0o0100) parts.push('sza');
  const szs = (cond >> 3) & 7;
  if (szs) parts.push(`szs ${szs.toString(8)}`);
  const szf = cond & 7;
  if (szf) parts.push(`szf ${szf}`);
  const iPrefix = (word >> 12) & 1 ? 'i ' : '';
  return iPrefix + (parts.length ? parts.join('+') : 'opr-skip');
}

/**
 * True if the instruction word at address `addr` is a `jmp .`
 * (self-referential direct jump).  This is the PDP-1 idiom for a computed
 * multiway transfer: a preceding `dap` modifies the address field before
 * execution, making the target dynamic.
 */
export function isJmpDot(word, addr) {
  // Direct jmp (bit 5 indirect = 0) whose target field equals the instruction's
  // own 12-bit address.
  return (word >> 13) === OP_JMP &&
         ((word >> 12) & 1) === 0 &&
         (word & 0o7777) === (addr & 0o7777);
}

// ─── Listing parser ──────────────────────────────────────────────────────────

/**
 * Parse a macro1 listing file and return the site index used by analyzeTrace.
 *
 * The listing has fixed columns (0-indexed character positions):
 *   0-4:  source line number (decimal, right-aligned) — blank for expansion lines
 *   5:    separator space
 *   6-10: octal address (5 digits) — blank for macro call-site and directive lines
 *   11:   separator space
 *   12-17: octal word (6 digits) — blank for macro call-site lines
 *   18+:  source text (label, mnemonic, operands, comment)
 *
 * Three line varieties:
 *   (A) srcLine + addr + word  → regular assembled instruction
 *   (B) srcLine, no addr       → macro call site or directive; starts call-site tracking
 *   (C) no srcLine, addr + word → macro expansion instruction; attributed to call site
 *
 * Macro-expansion skips (variety C) are attributed to the most recent call-site
 * srcLine (variety B), naturally pointing to the expanding routine rather than
 * the class-Z `define` block.
 *
 * Returns:
 *   skipSites       Map<addr, {srcLine, mnemonic, callSiteLine}>
 *   multiwayBranches Map<addr, {srcLine}>
 *   addrToSrcLine   Map<addr, srcLine>
 */
export function parseListingForMeter(text) {
  const skipSites        = new Map();
  const multiwayBranches = new Map();
  const addrToSrcLine    = new Map();

  // Most recent macro call-site line number; null when outside an expansion.
  let callSiteLine = null;

  for (const raw of text.split('\n')) {
    // Pad short lines to avoid substring-out-of-bounds.
    const line = raw.length < 18 ? raw.padEnd(18) : raw;

    const srcField  = line.substring(0, 5);
    const addrField = line.substring(6, 11);
    const wordField = line.substring(12, 18);

    // Non-blank digit in position 0-4 → srcLine present.
    const hasSrcLine = /^\s{0,4}\d/.test(srcField);
    const hasAddr    = /^[0-7]{5}$/.test(addrField);
    const hasWord    = /^[0-7]{6}$/.test(wordField);

    const srcLine = hasSrcLine ? parseInt(srcField.trim(), 10)  : null;
    let addr    = hasAddr    ? parseInt(addrField, 8)          : null;
    let word    = hasWord    ? parseInt(wordField, 8)          : null;

    if (hasSrcLine && hasAddr && hasWord) {
      // (A) Regular assembled instruction — OR a macro expansion line that
      // reuses the regular format (some macros do this). When srcLine matches
      // the current callSiteLine, it is such an expansion, and we keep
      // callSiteLine so subsequent expansion lines stay attributed to the call
      // site; a genuine instruction instead closes any open call site.
      // Since srcLine === callSiteLine in the expansion case, both cases record
      // identical (srcLine, callSiteLine) values — only the reset differs.
      const isMacroExpansion = callSiteLine !== null && srcLine === callSiteLine;
      if (!isMacroExpansion) {
        callSiteLine = null;
      }
      addrToSrcLine.set(addr, srcLine);
      const srcText  = line.length > 18 ? line.substring(18) : '';
      const mnemonic = _extractSkipMnemonic(srcText);
      if (mnemonic) {
        skipSites.set(addr, { srcLine, mnemonic, callSiteLine: srcLine });
      }
      if (isJmpDot(word, addr)) {
        multiwayBranches.set(addr, { srcLine });
      }
    } else if (hasSrcLine && !hasAddr) {
      // (B) A macro call site/directive, OR a macro expansion line with
      // addr/word at alternate positions (tab-separated expansion format):
      // after the tab comes srcLine + space + addr (5 octal) + space +
      // word (6 octal). It is an attributed expansion only when that alternate
      // srcLine matches the current call site; otherwise it opens a call site.
      const afterTab = line.split('\t')[1];
      const altM = afterTab ? afterTab.trim().match(/^(\d+)\s(\d{5})\s(\d{6})/) : null;

      if (altM && callSiteLine !== null && parseInt(altM[1], 10) === callSiteLine) {
        // Macro expansion attributed to the current call site.
        addr = parseInt(altM[2], 8);
        word = parseInt(altM[3], 8);
        addrToSrcLine.set(addr, callSiteLine);
        if (isSkipWord(word)) {
          skipSites.set(addr, {
            srcLine:      callSiteLine,
            mnemonic:     skipMnemonicFromWord(word),
            callSiteLine,
          });
        }
        if (isJmpDot(word, addr)) {
          multiwayBranches.set(addr, { srcLine: callSiteLine });
        }
      } else {
        // Regular macro call site or directive.
        callSiteLine = srcLine;
      }
    } else if (!hasSrcLine && hasAddr && hasWord) {
      // (C) Macro expansion instruction: attributed to the current call site.
      if (callSiteLine !== null) {
        addrToSrcLine.set(addr, callSiteLine);
        if (isSkipWord(word)) {
          skipSites.set(addr, {
            srcLine:      callSiteLine,
            mnemonic:     skipMnemonicFromWord(word),
            callSiteLine,
          });
        }
        if (isJmpDot(word, addr)) {
          multiwayBranches.set(addr, { srcLine: callSiteLine });
        }
      }
    }
    // Blank lines and page headers: no hasSrcLine, no hasAddr → ignored.
  }

  return { skipSites, multiwayBranches, addrToSrcLine };
}

/**
 * Extract the first PDP-1 skip mnemonic from a listing source-text field.
 * Strips labels (text before the first comma, tab, or leading whitespace)
 * and comments (after `/`).
 * Returns the mnemonic token, or null if no skip mnemonic is present.
 */
function _extractSkipMnemonic(srcText) {
  // Remove label: everything before the first tab or comma.
  let afterLabel = srcText.replace(/^[^\t,]*[\t,]/, '');
  // If no tab/comma found, strip leading whitespace.
  if (afterLabel === srcText) {
    afterLabel = srcText.replace(/^\s+/, '');
  }
  // Remove comment.
  const code = afterLabel.replace(/\/.*$/, '').trim();
  // Match any skip mnemonic keyword.
  const m = code.match(/\b(sma|spa|sza|spi|spq|szm|isp|sad|sas|szs|szf)\b/);
  return m ? m[1] : null;
}

// ─── SIMH trace parser ────────────────────────────────────────────────────────

/**
 * Parse a SIMH `show cpu history` text output into an array of PC values.
 *
 * SIMH PDP-1 history format:
 *   PC      OV  EA      AC      IO
 *   000255  0   000304  000000  000000
 *
 * The PC column is the first 6-octal-digit field on each data line.
 * Header lines and blanks are ignored.
 */
export function parseSimhHistory(text) {
  const pcs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([0-7]{6})\s/);
    if (m) pcs.push(parseInt(m[1], 8));
  }
  return pcs;
}

// ─── Coverage analysis ────────────────────────────────────────────────────────

/**
 * Analyze a PC stream (array of integer addresses, in execution order) against
 * a listing site index from parseListingForMeter.
 *
 * For skip sites: if the next PC in the stream is current+1, the skip was NOT
 * taken; if it is current+2, the skip WAS taken.
 *
 * For multiway branches (jmp .): the next PC is a realized transfer target.
 *
 * PCs in [RUNTIME_GEN_LOW, RUNTIME_GEN_HIGH] are flagged as runtime-generated.
 *
 * Returns:
 *   skipCoverage    Map<addr, {site, skipped: boolean, notSkipped: boolean}>
 *   multiwayTargets Map<addr, {site, targets: Set<number>}>
 *   runtimeGenPcs   Set<number>
 */
export function analyzeTrace(pcStream, listing) {
  const { skipSites, multiwayBranches } = listing;
  const skipCoverage    = new Map();
  const multiwayTargets = new Map();
  const runtimeGenPcs   = new Set();

  for (let i = 0; i < pcStream.length; i++) {
    const pc = pcStream[i];

    // Flag runtime-generated PCs.
    if (pc >= RUNTIME_GEN_LOW && pc <= RUNTIME_GEN_HIGH) {
      runtimeGenPcs.add(pc);
    }

    if (i + 1 >= pcStream.length) continue;
    const nextPc = pcStream[i + 1];

    // Skip site coverage.
    if (skipSites.has(pc)) {
      let cov = skipCoverage.get(pc);
      if (!cov) {
        cov = { site: skipSites.get(pc), skipped: false, notSkipped: false };
        skipCoverage.set(pc, cov);
      }
      if (nextPc === pc + 2) cov.skipped    = true;
      if (nextPc === pc + 1) cov.notSkipped = true;
    }

    // Multiway branch targets.
    if (multiwayBranches.has(pc)) {
      let cov = multiwayTargets.get(pc);
      if (!cov) {
        cov = { site: multiwayBranches.get(pc), targets: new Set() };
        multiwayTargets.set(pc, cov);
      }
      cov.targets.add(nextPc);
    }
  }

  return { skipCoverage, multiwayTargets, runtimeGenPcs };
}

// ─── Ledger builder ───────────────────────────────────────────────────────────

/**
 * Build the per-decision coverage ledger from a trace analysis result.
 *
 * Ledger entry statuses for skip sites:
 *   'both'        — skip and no-skip both observed
 *   'skip-only'   — only skip direction observed, not registered as one-way
 *   'no-skip-only' — only no-skip direction observed, not registered as one-way
 *   'one-way'     — only one direction observed AND registered in oneWayRegister
 *   'dark'        — site never reached in the trace
 *
 * Multiway branch entries have `type: 'multiway'` and `realizedTargets` array.
 *
 * Parameters:
 *   analysis        — result of analyzeTrace
 *   listing         — result of parseListingForMeter
 *   oneWayRegister  — Map<addr, 'skip'|'no-skip'>: branches known to be one-way
 *
 * Returns an array of ledger entries (order: skip sites by insertion, then
 * multiway branches by insertion).
 */
export function buildLedger(analysis, listing, oneWayRegister = new Map()) {
  const { skipCoverage, multiwayTargets } = analysis;
  const { skipSites, multiwayBranches }   = listing;
  const entries = [];

  // Skip site entries (include every site from the listing, even dark ones).
  for (const [addr, site] of skipSites) {
    const cov        = skipCoverage.get(addr);
    const registered = oneWayRegister.get(addr);

    let status;
    if (!cov) {
      status = 'dark';
    } else if (cov.skipped && cov.notSkipped) {
      status = 'both';
    } else if (cov.skipped) {
      status = registered === 'skip' ? 'one-way' : 'skip-only';
    } else if (cov.notSkipped) {
      status = registered === 'no-skip' ? 'one-way' : 'no-skip-only';
    } else {
      status = 'dark';
    }

    entries.push({
      addr,
      srcLine:      site.srcLine,
      mnemonic:     site.mnemonic,
      callSiteLine: site.callSiteLine,
      status,
    });
  }

  // Multiway branch entries (realized targets from the trace).
  for (const [addr, cov] of multiwayTargets) {
    entries.push({
      addr,
      srcLine:         cov.site.srcLine,
      mnemonic:        'jmp.',
      type:            'multiway',
      realizedTargets: [...cov.targets],
    });
  }

  // Dark multiway branches (in listing but never reached in trace).
  for (const [addr, site] of multiwayBranches) {
    if (!multiwayTargets.has(addr)) {
      entries.push({
        addr,
        srcLine:         site.srcLine,
        mnemonic:        'jmp.',
        type:            'multiway',
        realizedTargets: [],
      });
    }
  }

  return entries;
}
