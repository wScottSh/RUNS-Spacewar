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
 *   - sbf (112-116): sequence-break flush — correctly dead, out-of-contract.
 *     Not registered (no skip instruction in the block); confirmed dead by
 *     asserting its PCs are absent from the union trace.
 *   - sr1 no-free-slot hlt/jmp .-1 (1250-1251): correctly dead — also not a
 *     skip site; confirmed by PC absence.  (The sza i free-slot search at
 *     02616 / L1247 is NOT one-way: every torpedo launch resolves it both
 *     ways — skip over the occupied ship slots, no-skip into the free slot.)
 *   - mex ms1 sma (L962, addr 02076): one-way skip — \mxc is always negative,
 *     so the idx msh / scr 3s arm (mst+1) is dead.
 *   - SSW3 single-shot (1236, addr 02601): one-way no-skip — szs i 30 skips
 *     only when SSW3 is set, and the pinned domain never sets it (and mco is
 *     never stored, so the mode is inert either way).
 *   - sr5 shots guard (1292, addr 02673): one-way SKIP — `lac i \mh2 / sza i`
 *     skips while mh2 ≠ 0; mh2 starts at -10 (xct mhs) and the ship explodes
 *     with certainty (\mh4 += hur = 40000 per jump) before it counts to zero.
 *   - hp3 shots count (1056, addr 02255): one-way NO-SKIP — `count i \mh2`
 *     (isp) increments the negative mh2 toward zero and never reaches it for
 *     the same reason; the skip → dzm arm is dead.
 *   - mco-dependent arm (ior i mco, 1296): not a skip instruction — no
 *     register entry; inertness is a data fact witnessed by T-CONST.
 */
export function buildUnionOneWayRegister() {
  const register = new Map();

  // mex: ms1 sma at 02076 (L962) — one-way: skip only
  // mxc is always negative; sub (140 makes it more negative; sma on negative
  // always skips → idx msh never reached → scr 3s arm is dead.
  register.set(0o02076, 'skip');

  // T-SHIP: SSW3 single-shot at 02601 (L1236) — one-way: no-skip
  // szs i 30 skips only with SSW3 set; the pinned domain keeps it clear
  // (and mco is never stored in 3.1, so single-shot mode is inert anyway).
  register.set(0o02601, 'no-skip');

  // T-SHIP: sr5 hyperspace shots guard at 02673 (L1292) — one-way: skip
  // lac i \mh2 / sza i skips while mh2 is nonzero; mh2 never reaches zero
  // (the ship explodes first), so the jmp st3 fall-through arm is dead.
  register.set(0o02673, 'skip');

  // T-HYPER: hp3 shots count at 02255 (L1056) — one-way: no-skip
  // count i \mh2 (isp) increments mh2 (negative, from xct mhs = law i 10)
  // toward zero; the explosion certainty (\mh4 overflow) arrives first, so
  // the skip → dzm i \mh2 arm is dead.
  register.set(0o02255, 'no-skip');

  // T-SHIP: sr1 slot-search limit at 02621 (L1249, index macro sas) —
  // one-way: no-skip.  The sas skips only when the search pointer passes the
  // end of the object table without finding a free slot — the arm that guards
  // the no-free-slot hlt (L1250-1251).  At default tno/rlt/tlf a free slot is
  // always found first (this is the EPIC's "sr1 no-free-slot" register entry;
  // the sza i at 02616 resolves both ways on every launch and is NOT one-way).
  register.set(0o02621, 'no-skip');

  // T-POF: vanish spin-wait at 02725 (L1326, count \ssn) — one-way: skip.
  // \ssn is loaded from the ship's mb cell, which only ever receives positive
  // constants (2000 at a2/hp3, 7 at hp1, 3 at sr5), so the isp result is
  // always ≥ 0 and the wait-loop never loops — the delay is inert in 3.1.
  register.set(0o02725, 'skip');

  // T-SHIP: gravity distance-cube guard at 02411 (L1152 sza) — one-way: skip.
  // AC there is (root(t1) >> 9) × t1 >> 17 with t1 = (x>>11)² + (y>>11)²;
  // positions are 18-bit, so t1 ≤ 2×63² = 7938 and the scaled cube can never
  // reach 2^17 — AC is always zero and the jmp bsg guard arm is dead code
  // over the whole position domain.
  register.set(0o02411, 'skip');

  // T-SINCOS: saturation-clamp sign test at 00132 (L232 sma) — one-way:
  // no-skip.  The Horner polynomial never overshoots |1.0|, so the result
  // sign never differs from the argument sign.  Exhaustively verified on the
  // Substrate: a breakpoint on the clamp path (00134) never fired across all
  // 2^18 angle inputs through the sin entry (cos joins the identical tail).
  register.set(0o00132, 'no-skip');

  return register;
}

/**
 * Skip sites that are themselves inside correctly-dead code (never reached
 * over the game-scoped domain, ADR-0007).  Analogous to the one-way register
 * but for whole dead blocks: the gate confirms each stays dark AND that its
 * PC never executes.
 */
export function buildDeadSkipSiteRegister() {
  return new Map([
    // sin/cos clamp-path spi (L236): inside the saturation-clamp block that
    // the exhaustive 2^18-angle sweep proved unreachable (see 00132 above).
    [0o00136, 'sin/cos saturation-clamp block — exhaustively unreachable'],
  ]);
}

/**
 * Multiway (`jmp .`) sites that are compile-time jump-word templates, not
 * runtime branches: the outline compiler dap-patches them and PLANTS their
 * words into the generated code (plinst ocm / plinst ocn); the cells
 * themselves are never executed.  Registered so the closure gate can confirm
 * them dead (their PCs must never appear in the union) instead of failing.
 */
export function buildDeadMultiwayRegister() {
  return new Map([
    [0o555, 'ocm — jump-word template planted into generated outline code'],
    [0o556, 'ocn — dap-patched jump-word template planted into generated code'],
  ]);
}

// ─── CoverageGate class ───────────────────────────────────────────────────────

export class CoverageGate {
  /**
   * @param {object} listing — result of parseListingForMeter
   * @param {Map<string, string>} oneWayRegister — address → 'skip' | 'no-skip'
   * @param {Map<number, string>} [deadMultiwayRegister] — jmp.-template cells
   *   (never executed at runtime); confirmed dead rather than failed-dark.
   * @param {Map<number, string>} [deadSkipSiteRegister] — skip sites inside
   *   correctly-dead blocks (ADR-0007); confirmed dead rather than failed-dark.
   */
  constructor(listing, oneWayRegister, deadMultiwayRegister = new Map(),
              deadSkipSiteRegister = new Map()) {
    this.listing = listing;
    this.oneWayRegister = oneWayRegister;
    this.deadMultiwayRegister = deadMultiwayRegister;
    this.deadSkipSiteRegister = deadSkipSiteRegister;
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
    // Merge all PC streams into one, separated by -1 sentinels so that the
    // boundary between two independently captured traces is never analyzed
    // as an adjacent-PC pair (a false pair could spuriously resolve a skip).
    const unionPcs = [];
    for (const stream of this._pcStreams) {
      if (unionPcs.length > 0) unionPcs.push(-1);
      for (const pc of stream) unionPcs.push(pc);
    }

    // Analyze the union trace.
    const analysis = analyzeTrace(unionPcs, this.listing);

    // Build the ledger.
    const ledger = buildLedger(analysis, this.listing, this.oneWayRegister);

    // Classify entries.
    const dark = [];
    const bothWays = [];
    const oneWayConfirmed = [];
    const deadMultiwayConfirmed = [];
    const deadSkipConfirmed = [];
    const unclassified = [];  // skip-only, no-skip-only, or unknown
    const multiwayEntries = [];

    // Registered template cells must never actually execute.
    const executedPcs = new Set();
    for (const pc of unionPcs) if (pc >= 0) executedPcs.add(pc);

    for (const entry of ledger) {
      if (entry.type === 'multiway') {
        multiwayEntries.push(entry);
        if (entry.realizedTargets.length === 0) {
          const reason = this.deadMultiwayRegister.get(entry.addr);
          if (reason !== undefined && !executedPcs.has(entry.addr)) {
            deadMultiwayConfirmed.push({
              addr: entry.addr,
              srcLine: entry.srcLine,
              reason,
            });
          } else {
            dark.push({
              addr: entry.addr,
              srcLine: entry.srcLine,
              mnemonic: 'jmp.',
            });
          }
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
        case 'one-way': {
          const direction = this.oneWayRegister.get(entry.addr);
          oneWayConfirmed.push({
            addr: entry.addr,
            srcLine: entry.srcLine,
            direction: direction || 'unknown',
          });
          break;
        }
        case 'dark': {
          const deadReason = this.deadSkipSiteRegister.get(entry.addr);
          if (deadReason !== undefined && !executedPcs.has(entry.addr)) {
            deadSkipConfirmed.push({
              addr: entry.addr,
              srcLine: entry.srcLine,
              mnemonic: entry.mnemonic,
              reason: deadReason,
            });
          } else {
            dark.push({
              addr: entry.addr,
              srcLine: entry.srcLine,
              mnemonic: entry.mnemonic,
              callSiteLine: entry.callSiteLine,
            });
          }
          break;
        }
        default:
          // skip-only or no-skip-only without one-way registration
          unclassified.push(entry);
          break;
      }
    }

    // Determine pass/fail.
    const passed = dark.length === 0 && unclassified.length === 0;

    // Build summary.
    const realizedMultiway = multiwayEntries.filter(e => e.realizedTargets.length > 0).length;
    const darkMultiway = multiwayEntries.length - realizedMultiway;
    const summary = [
      `Coverage gate: ${passed ? 'PASS' : 'FAIL'}`,
      `  Skip sites — both ways: ${bothWays.length}`,
      `  Skip sites — one-way confirmed: ${oneWayConfirmed.length}`,
      `  Multiway branches — realized: ${realizedMultiway}`,
      `  Multiway branches — confirmed dead (template cells): ${deadMultiwayConfirmed.length}`,
      `  Multiway branches — dark: ${darkMultiway - deadMultiwayConfirmed.length}`,
      `  Skip sites — confirmed dead blocks: ${deadSkipConfirmed.length}`,
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
      deadMultiwayConfirmed,
      deadSkipConfirmed,
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
  return new CoverageGate(listing, oneWayRegister, buildDeadMultiwayRegister(),
                          buildDeadSkipSiteRegister());
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
