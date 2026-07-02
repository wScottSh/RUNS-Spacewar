/**
 * T-START Trace Harness — boot dispatch, game (re)init, scoring.
 *
 * Drives SIMH pdp1 through the boot/reinit/scoring flow of Spacewar! 3.1.
 *
 * The harness builds a SIMH script incrementally and executes it in a SINGLE
 * SIMH session, so all memory deposits persist across breakpoints.
 *
 * Usage:
 *   const harness = new TraceHarness(rimPath);
 *   harness.boot({ entryPoint: 4, senseSwitches: 0, testWord: 0, seed: 256 });
 *   harness.inject({ addr: 0o3476, val: 0 });
 *   harness.runTo(01604);       // add breakpoint at hlt
 *   harness.runTo(01621);       // add breakpoint at a2
 *   const results = await harness.execute();
 *   // results[{pc:..., ac:..., m03476:..., ...}] per breakpoint
 *
 * Full game flow (boot → game-over → scoring → hlt → continue → reinit):
 *   const results = await TraceHarness.fullGameFlow(rimPath, {
 *     entryPoint: 4, seed: 256, testWord: 0o1000,   // bit 12 = show scores
 *   });
 */
import { runPdp1 } from './simh.js';

// ── Key addresses in the assembled listing ────────────────────────────────────

const ML0     = 0o01444;   // main-loop entry (after boot init)
const A40     = 0o01561;   // control-boxes entry (loc 4 → jmp a40)
const A1      = 0o01556;   // test-word entry (loc 5 → jmp a1)
const A6      = 0o01613;   // match-length setup
const A2      = 0o01620;   // game initialisation (clear tables → compile → ml0)
const MDN     = 0o01534;   // restart-delay countdown
const A       = 0o01564;   // scoring entry (game-count check)
const A5      = 0o01576;   // show-scores check (bit 12 of test word)
const A4      = 0o01602;   // score readout (lac \1sc → lio \2sc → hlt)
const HLT     = 0o01604;   // the hlt instruction itself
const A2_POST = 0o01627;   // first instruction after clear macro in a2 (law ss1)

// Object-table absolute addresses
const ADDR_MTB      = 0o03476;
const ADDR_NTR      = 0o03514;   // ntr offset 60 from mtb (60 octal = 48 decimal)
const ADDR_NTR1     = 0o03515;
const ADDR_1SC      = 0o03255;
const ADDR_2SC      = 0o03256;
const ADDR_GCT      = 0o03260;
const ADDR_NTD      = 0o03254;
const ADDR_RAN      = 0o00031;
const ADDR_DDD      = 0o00020;

// HLT instruction word (PDP-1 halt = 0o760400); replace with jmp . at HLT
const HLT_WORD  = 0o760400;
const JMP_DOT   = 0o601604;           // jmp . (self-loop) at address HLT
const CLA_WORD  = 0o040200;           // cla (clear AC) — safe I/O patch

// I/O instructions in ml1 execution path (patched to cla to avoid SIMH I/O errors)
const IO_IOT11  = 0o01674;            // iot 11 in mg1 (called from a40 flow via cwr)
const IO_DPY0   = 0o00572;            // dpy-4000 in blp (star display)
const IO_DPY1   = 0o00714;            // dpy-4000 in bpt (massive star display)
const IO_DPY2   = 0o02125;            // dpy-i 300 in mex (explosion particle display)
const IO_DPY3   = 0o02527;            // dpy-4000 in sq6 (ship tail display)

export {
  ML0, A40, A1, A6, A2, MDN, A, A5, A4, HLT, A2_POST,
  ADDR_MTB, ADDR_NTR, ADDR_NTR1, ADDR_1SC, ADDR_2SC,
  ADDR_GCT, ADDR_NTD, ADDR_RAN, ADDR_DDD,
  HLT_WORD, JMP_DOT, CLA_WORD,
  IO_IOT11, IO_DPY0, IO_DPY1, IO_DPY2, IO_DPY3,
};

// ── TraceHarness ──────────────────────────────────────────────────────────────

export class TraceHarness {
  /** @param {string} rimPath */
  constructor(rimPath) {
    this.rimPath = rimPath;
    this._steps = [];     // array of {type, ...}
    this._lastResults = null;
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  /**
   * Queue a boot step.  `entryPoint` is 4 (loc 4 → jmp a40) or 5 (loc 5 → jmp a1).
   */
  boot({
    entryPoint = 4,
    senseSwitches = 0,
    testWord = 0,
    seed = 0,
    autoRunTo = ML0,  // automatically add runTo after boot
  } = {}) {
    this._steps.push({
      type: 'boot',
      entryPoint,
      senseSwitches,
      testWord,
      seed,
    });
    if (autoRunTo !== null) {
      this._steps.push({ type: 'runTo', target: autoRunTo });
    }
    return this;
  }

  // ── inject ────────────────────────────────────────────────────────────────
  /**
   * Queue a memory deposit for the next run segment.
   *
   * @param {Array<{addr: number|string, val: number}>|Object<string, number>} items
   */
  inject(items) {
    this._steps.push({ type: 'inject', items: Array.isArray(items) ? items : [items] });
    return this;
  }

  // ── runTo ─────────────────────────────────────────────────────────────────
  /**
   * Queue a "run until PC hits target" step.  After reaching the target,
   * the harness captures PC, AC, and key memory cells.
   */
  runTo(target, { maxFrames = 500 } = {}) {
    this._steps.push({ type: 'runTo', target, maxFrames });
    return this;
  }

  // ── examine ───────────────────────────────────────────────────────────────
  /**
   * Queue an arbitrary examine command (e.g. to check additional addresses).
   */
  examine(addr) {
    this._steps.push({ type: 'examine', addr });
    return this;
  }

  // ── execute ───────────────────────────────────────────────────────────────
  /**
   * Build and run the complete SIMH script.  Returns an array of results,
   * one per `runTo` step, in order.
   */
  async execute() {
    const script = this._buildScript();
    const { lines } = await runPdp1(script, { timeout: 120_000 });
    this._lastResults = this._parseResults(lines);
    return this._lastResults;
  }

  // ── patchIo ─────────────────────────────────────────────────────────────
  /**
    * Patch I/O instructions in ml1 execution path to `cla` (0o040200).
    *
    * SIMH's pdp1 does not handle IOT/DPY instructions without device
    * configuration.  Patching them to `cla` lets the game flow complete
    * without triggering SIMH device errors.
    */
  patchIo() {
    this._steps.push({
      type: 'inject',
      items: [
        { addr: IO_IOT11, val: CLA_WORD },
        { addr: IO_DPY0,  val: CLA_WORD },
        { addr: IO_DPY1,  val: CLA_WORD },
        { addr: IO_DPY2,  val: CLA_WORD },
        { addr: IO_DPY3,  val: CLA_WORD },
      ],
    });
    return this;
  }

  // ── setGameOverState ────────────────────────────────────────────────────
  /**
    * Clear ship object-table slots and set torpedo counts to 0, forcing
    * ml0 to jump to mdn (scoring) instead of ml1.
    */
  setGameOverState() {
    this._steps.push({
      type: 'inject',
      items: [
        { addr: ADDR_MTB,      val: 0 },       // ship 1 slot = inactive
        { addr: ADDR_MTB + 1,  val: 0 },       // ship 2 slot = inactive
        { addr: ADDR_NTR,      val: 0 },       // ship 1 torps = 0
        { addr: ADDR_NTR1,     val: 0 },       // ship 2 torps = 0
      ],
    });
    return this;
  }

  // ── resumeFromHlt (one-shot: replaces hlt with jmp . then continues) ──────
  /**
    * For the "hlt at a4 → continue" scenario, this is a convenience wrapper
    * that: (1) loads the image, (2) deposits game-over state, (3) patches I/O,
    * (4) sets hlt→jmp to next instruction, (5) runs to the next target.
    */
  static async resumeFromHlt(rimPath, target, injections = [], { maxFrames = 100, testWord = 0 } = {}) {
    const harness = new TraceHarness(rimPath);
    // Replace hlt with jmp to next instruction (a4+2)
    harness._steps.push({
      type: 'inject',
      items: [{ addr: HLT, val: 0o601606 }],  // jmp a4+2 (the `lat` after hlt)
    });
    // Then run
    for (const inj of injections) harness.inject(inj);
    harness.runTo(target, { maxFrames });
    return harness.execute();
  }

  // ── fullGameFlow (static convenience) ───────────────────────────────────
  /**
    * Execute the complete game flow: boot → game-over → scoring → hlt →
    * resume → reinit → back to ml0.
    *
    * Returns the full array of per-breakpoint results.
    */
  static async fullGameFlow(rimPath, {
    entryPoint = 4,
    seed = 256,
    senseSwitches = 0,
    testWord = 0,
    maxFrames = 2000,
  } = {}) {
    const harness = new TraceHarness(rimPath);

    // 1. Boot to ml0
    harness.boot({ entryPoint, seed, senseSwitches, testWord, autoRunTo: null });

    // 2. Patch I/O instructions so ml1 can execute
    harness.patchIo();

    // 3. Set game-over state (clear ships + torps)
    harness.setGameOverState();

    // 4. Run to scoring entry (a)
    harness.runTo(A, { maxFrames });

    // 5. Run to hlt (a4)
    harness.runTo(HLT, { maxFrames });

    // 6. Replace hlt with jmp to next instruction → continue to reinit
    harness._steps.push({
      type: 'inject',
      items: [{ addr: HLT, val: 0o601606 }],  // jmp a4+2 (lat at 01606)
    });
    harness.runTo(A2, { maxFrames });

    return harness.execute();
  }

  // ── internal ──────────────────────────────────────────────────────────────

  // ── internal ──────────────────────────────────────────────────────────────

  _buildScript() {
    const lines = [];
    let entryPoint = null;

    for (const step of this._steps) {
      switch (step.type) {
        case 'boot': {
          lines.push(`load ${this.rimPath}`);
          lines.push(`D ss ${step.senseSwitches.toString(8)}`);
          lines.push(`D CPU TW ${step.testWord.toString(8)}`);
          lines.push(`D ${ADDR_RAN.toString(8)} ${step.seed.toString(8)}`);
          lines.push(`BREAK ${ML0.toString(8)}`);
          entryPoint = step.entryPoint;
          break;
        }
        case 'inject': {
          for (const { addr, val } of step.items) {
            if (typeof addr === 'string') {
              lines.push(`D ${addr} ${val.toString(8)}`);
            } else {
              lines.push(`D ${addr.toString(8)} ${val.toString(8)}`);
            }
          }
          break;
        }
        case 'runTo': {
          lines.push(`BREAK ${step.target.toString(8)}`);
          if (entryPoint !== null) {
            lines.push(`GO ${entryPoint.toString(8)}`);
            entryPoint = null; // only GO once at the start
          } else {
            lines.push('CONTINUE');
          }
          lines.push(`EXAMINE PC`);
          lines.push(`EXAMINE AC`);
          // Key memory cells
          for (const a of [
            ADDR_MTB, ADDR_MTB + 1,
            ADDR_NTR, ADDR_NTR1,
            ADDR_NTD, ADDR_1SC, ADDR_2SC, ADDR_GCT,
          ]) {
            lines.push(`EXAMINE ${a.toString(8)}`);
          }
          break;
        }
        case 'examine': {
          lines.push(`EXAMINE ${step.addr.toString(8)}`);
          break;
        }
      }
    }

    lines.push('QUIT');
    return lines;
  }

  _parseResults(lines) {
    const results = [];
    let currentResult = null;

    for (const line of lines) {
      // PC line
      const pcM = line.match(/^PC:\s+([0-7]+)/);
      if (pcM) {
        if (currentResult === null) currentResult = {};
        currentResult.pc = parseInt(pcM[1], 8);
        continue;
      }

      // AC line
      const acM = line.match(/^AC:\s+([0-7]+)/);
      if (acM) {
        if (currentResult === null) currentResult = {};
        currentResult.ac = parseInt(acM[1], 8);
        continue;
      }

      // Memory examine (addr: value)
      const memM = line.match(/^([0-7]+):\s+([0-7]+)/);
      if (memM && !/^(PC|AC):/.test(line)) {
        if (currentResult === null) currentResult = {};
        const addr = parseInt(memM[1], 8);
        const val = parseInt(memM[2], 8);
        currentResult['m' + addr.toString(8).padStart(6, '0')] = val;
      }

      // "Breakpoint" lines or "Goodbye" signal end of a result
      if (/^Breakpoint,|Goodbye/.test(line)) {
        if (currentResult !== null) {
          results.push(currentResult);
          currentResult = null;
        }
      }
    }

    return results;
  }
}
