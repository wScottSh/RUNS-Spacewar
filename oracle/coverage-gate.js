/**
 * T-COVERAGE — closure gate for the Spacewar! 3.1 Oracle (ADR-0012).
 *
 * The union/closure gate: asserts that the union of every scenario's trace
 * satisfies decision coverage over the entire Ground Truth, and that every
 * entry in the one-way / correctly-dead register (ADR-0007) resolves only
 * its one way.
 *
 * This is the gate that turns per-region tickets into "100% coverage, all green."
 *
 * Usage:
 *   const gate = new CoverageGate(listing, oneWayRegister);
 *   gate.addTrace(pcStream1);
 *   gate.addTrace(pcStream2);
 *   const report = gate.assertClosure();
 *   // report: { passed, summary, ledger }
 */

import {
  parseListingForMeter,
  analyzeTrace,
  buildLedger,
} from './meter.js';

// ─── One-way / correctly-dead register (ADR-0007) ─────────────────────────────

/**
 * The provably one-way / correctly-dead register.
 *
 * Maps instruction addresses to the direction they always resolve:
 *   'skip'  — the skip arm is always taken (the fall-through is dead)
 *   'no-skip' — the no-skip arm is always taken (the skip is dead)
 *
 * Source-grounded entries from EPIC #5 and per-region tickets:
 *   - sbf (112-116): sequence-break flush — correctly dead, out-of-contract
 *     Not registered as a skip site (no skip instruction), but confirmed
 *     by the meter when the listing is loaded.
 *   - sr1 no-free-slot (1250-1251, addr 02610): hlt/jmp.-1 — correctly dead
 *     Not a skip site; registered via skip site at 02616 (sza i free-slot search).
 *   - mex ms1 sma (L962, addr 02076): one-way skip — mxc always negative
 *   - T-SHIP sr1 free-slot (1247, addr 02616): always finds free slot at default
 *   - SSW3 single-shot (1236, addr 02601): inert because mco never stored
 *   - mh2 shots-exhausted (1292, addr 02673): explodes before shots run out
 *   - mh2 shots-exhausted (1056, addr 02255): explodes before mh2 reaches zero
 *   - mco-dependent arms (1296): mco never stored, always resolves same way
 */
export function buildUnionOneWayRegister() {
  const register = new Map();

  // mex: ms1 sma at 02076 (L962) — one-way: skip only
  // mxc is always negative; sub (140 makes it more negative; sma on negative
  // always skips → idx msh never reached → scr 3s arm is dead.
  register.set(0o02076, 'skip');

  // T-SHIP: free-slot search at 02616 (L1247) — one-way: skip only
  // At default constants (rlt/tlf/tno), a free slot is always found.
  register.set(0o02616, 'skip');

  // T-SHIP: SSW3 single-shot at 02601 (L1236) — one-way: no-skip
  // mco is never stored in 3.1, so szs i 30 never fires (always salvo).
  register.set(0o02601, 'no-skip');

  // T-SHIP: mh2 shots-exhausted at 02673 (L1292) — one-way: no-skip
  // The 8th jump explodes via \mh4 overflow before \mh2 reaches zero.
  register.set(0o02673, 'no-skip');

  // T-HYPER: mh2 shots-exhausted at 02255 (L1056) — one-way: skip
  // count i \mh2: mh2 stays positive; isp always skips → jmp hp7 never taken.
  register.set(0o02255, 'skip');

  return register;
}

// ─── CoverageGate class ───────────────────────────────────────────────────────

export class CoverageGate {
  /**
   * @param {object} listing — result of parseListingForMeter
   * @param {Map<string, string>} oneWayRegister — address → 'skip' | 'no-skip'
   */
  constructor(listing, oneWayRegister) {
    this.listing = listing;
    this.oneWayRegister = oneWayRegister;
    this._pcStreams = [];  // array of PC arrays, accumulated via addTrace
  }

  /**
   * Add a PC stream (trace) to the union.
   * @param {number[]} pcs — array of integer PC values in execution order
   */
  addTrace(pcs) {
    this._pcStreams.push(pcs);
  }

  /**
   * Run the closure analysis: merge all traces, analyze, build ledger,
   * and assert all gate conditions.
   *
   * Returns:
   *   {
   *     passed: boolean,
   *     summary: string,
   *     ledger: Array<{addr, srcLine, mnemonic, status, ...}>,
   *     dark: Array<{addr, srcLine, mnemonic, callSiteLine}>,
   *     bothWays: Array<{addr, srcLine, mnemonic}>,
   *     oneWayConfirmed: Array<{addr, srcLine, direction}>,
   *     unclassified: Array<{addr, srcLine, status}>
   *   }
   */
  assertClosure() {
    // Merge all PC streams into one.
    const unionPcs = this._pcStreams.flat();

    // Analyze the union trace.
    const analysis = analyzeTrace(unionPcs, this.listing);

    // Build the ledger.
    const ledger = buildLedger(analysis, this.listing, this.oneWayRegister);

    // Classify entries.
    const dark = [];
    const bothWays = [];
    const oneWayConfirmed = [];
    const unclassified = [];  // skip-only, no-skip-only, or unknown
    const multiwayEntries = [];

    for (const entry of ledger) {
      if (entry.type === 'multiway') {
        multiwayEntries.push(entry);
        if (entry.realizedTargets.length === 0) {
          dark.push({
            addr: entry.addr,
            srcLine: entry.srcLine,
            mnemonic: 'jmp.',
          });
        }
        continue;
      }

      switch (entry.status) {
        case 'both':
          bothWays.push({
            addr: entry.addr,
            srcLine: entry.srcLine,
            mnemonic: entry.mnemonic,
          });
          break;
        case 'one-way':
          const direction = this.oneWayRegister.get(entry.addr);
          oneWayConfirmed.push({
            addr: entry.addr,
            srcLine: entry.srcLine,
            direction: direction || 'unknown',
          });
          break;
        case 'dark':
          dark.push({
            addr: entry.addr,
            srcLine: entry.srcLine,
            mnemonic: entry.mnemonic,
            callSiteLine: entry.callSiteLine,
          });
          break;
        default:
          // skip-only or no-skip-only without one-way registration
          unclassified.push(entry);
          break;
      }
    }

    // Determine pass/fail.
    const passed = dark.length === 0 && unclassified.length === 0;

    // Build summary.
    const summary = [
      `Coverage gate: ${passed ? 'PASS' : 'FAIL'}`,
      `  Skip sites — both ways: ${bothWays.length}`,
      `  Skip sites — one-way confirmed: ${oneWayConfirmed.length}`,
      `  Multiway branches — realized: ${multiwayEntries.filter(e => e.realizedTargets.length > 0).length}`,
      `  Multiway branches — dark: ${multiwayEntries.filter(e => e.realizedTargets.length === 0).length}`,
      `  Dark (unclassified): ${dark.length}`,
      `  Unclassified (partial, unregistered): ${unclassified.length}`,
    ].join('\n');

    return {
      passed,
      summary,
      ledger,
      dark,
      bothWays,
      oneWayConfirmed,
      unclassified,
      multiwayEntries,
    };
  }

  /**
   * Assert that a specific one-way register entry is confirmed one-way
   * in the closure result.
   *
   * @param {number} addr — instruction address
   * @param {string} expectedDirection — 'skip' | 'no-skip'
   * @returns {boolean} true if confirmed
   */
  static isConfirmedOneWay(closureResult, addr, expectedDirection) {
    const confirmed = closureResult.oneWayConfirmed.find(
      (e) => e.addr === addr
    );
    return (
      !!confirmed && confirmed.direction === expectedDirection
    );
  }

  /**
   * Assert that a specific address is covered both ways.
   *
   * @param {number} addr — instruction address
   * @returns {boolean} true if both-ways covered
   */
  static isBothWays(closureResult, addr) {
    return closureResult.bothWays.some((e) => e.addr === addr);
  }

  /**
   * Assert that a specific address is dark (never reached).
   *
   * @param {number} addr — instruction address
   * @returns {boolean} true if dark
   */
  static isDark(closureResult, addr) {
    return closureResult.dark.some((e) => e.addr === addr);
  }

  /**
   * Get all skip site addresses from the listing.
   * @returns {number[]}
   */
  getSkipSiteAddrs() {
    return [...this.listing.skipSites.keys()];
  }

  /**
   * Get all multiway branch addresses from the listing.
   * @returns {number[]}
   */
  getMultiwayAddrs() {
    return [...this.listing.multiwayBranches.keys()];
  }

  /**
   * Get the total number of in-contract skip sites.
   * @returns {number}
   */
  getSkipSiteCount() {
    return this.listing.skipSites.size;
  }

  /**
   * Get the total number of multiway branches.
   * @returns {number}
   */
  getMultiwayCount() {
    return this.listing.multiwayBranches.size;
  }

  /**
   * Get the one-way register size.
   * @returns {number}
   */
  getOneWayRegisterSize() {
    return this.oneWayRegister.size;
  }

  /**
   * Get the total union trace length.
   * @returns {number}
   */
  getUnionTraceLength() {
    return this._pcStreams.reduce((sum, pcs) => sum + pcs.length, 0);
  }
}

// ─── Convenience: build gate from listing text ────────────────────────────────

/**
 * Build a CoverageGate from raw listing text.
 *
 * @param {string} listingText — raw macro1 listing text
 * @returns {CoverageGate}
 */
export function buildCoverageGate(listingText) {
  const listing = parseListingForMeter(listingText);
  const oneWayRegister = buildUnionOneWayRegister();
  return new CoverageGate(listing, oneWayRegister);
}

// ─── Utility: merge multiple PC streams ───────────────────────────────────────

/**
 * Merge multiple PC streams into one union stream, preserving order.
 *
 * @param {number[][]} pcStreams — array of PC arrays
 * @returns {number[]} merged stream
 */
export function mergePcStreams(pcStreams) {
  return pcStreams.flat();
}
