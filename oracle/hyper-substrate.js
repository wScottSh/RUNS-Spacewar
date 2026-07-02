/**
 * T-HYPER substrate: SIMH scripts that drive Spacewar! 3.1 hyperspace routines (hp1/hp3).
 *
 * Issue #22. Class E — Trace. Seam: `ml1` self-mod relay (lines 1298-1303 of sr5).
 * Hyperspace is not called directly; it is entered when sr5 (the hyperspace trigger)
 * modifies the object's calc routine pointer ml1 to point to hp1 (02170).
 *
 * Hyperspace flow:
 *   Entry (from T-SHIP sr5): sr5 saves live ml1 → \mh1, self-mods ml1 ← hp1 (1302-1303).
 *   In-flight (hp1): hp1 self-mods ml1 ← hp3 (1014-1015); ship spends ma1 frames invisible
 *     (hp2, jmp . 1045) then switches to hp3.
 *   Breakout (hp3): hp3 restores ml1 ← \mh1 (1052-1053) for safe breakout,
 *     or self-mods ml1 ← mex 400000 (1069-1070) for deadly re-entry.
 *
 * Object table layout (mtb = 03476, nob = 30 per slot):
 *   Slot 0 (mtb+0..29): spaceship 1 — ml1, mx1, my1, ma1, mb1 + ship vars
 *   Slot 1 (mtb+30..59): spaceship 2 — ml2, mx2, my2, ma2, mb2 + ship vars
 *
 * Key hyperspace variables (addresses in 032xx range):
 *   mh1 (03250): saved ml1 (restores calc routine on safe breakout)
 *   mh2 (03251): shots remaining (jumps allowed)
 *   mh3 (03252): jump timer (decremented each jump, drives breakout)
 *   mh4 (03253): accumulator for re-entry angle draw
 *
 * Hyperspace constants (from tunable table):
 *   hd2 (00024): law i 100 — time in hyperspace breakout
 *   hd3 (00025): law i 200 — time to recharge hyperfield generators
 *   hr1 (00026): scl 9s — scale on hyperspatial displacement
 *   hr2 (00027): scl 4s — scale on hyperspatially induced velocity
 *   hur (00030): 40000 — hyperspatial uncertainty
 *
 * Hyperspace routine entry points:
 *   hp1 (02170): in-flight (invisible) → breakout transition
 *   hp2 (02245): `jmp .` in-flight loop
 *   hp3 (02246): breakout routine
 *   hp4 (02233): angle-normalize loop label
 *   hp5 (02307): post-breakout (jmp .)
 *   hp6 (02304): post-breakout position restore
 *   hp7 (02260): draw/re-entry routine
 *
 * Sense switches (set via SIMH `senseswitch` command):
 *   SSW6 = 6 (gravity on/off)
 */

import { runPdp1 } from './simh.js';

const HERE = (() => { try { return new URL('.', import.meta.url).pathname; } catch { return '/oracle'; }})();

// ─── Addresses ────────────────────────────────────────────────────────────────

export const RIM_PATH = `${HERE}/../build/spacewar31.rim`;

// Hyperspace entry points
export const HP1   = 0o02170;  // in-flight → breakout transition
export const HP2   = 0o02245;  // in-flight loop (`jmp .`)
export const HP3   = 0o02246;  // breakout routine
export const HP4   = 0o02233;  // angle-normalize loop
export const HP5   = 0o02307;  // post-breakout (`jmp .`)
export const HP6   = 0o02304;  // post-breakout position restore
export const HP7   = 0o02260;  // draw/re-entry routine

// Hyperspace state variables
export const MH1_ADDR = 0o03250;  // saved ml1 (restores calc routine on safe breakout)
export const MH2_ADDR = 0o03251;  // shots remaining (jumps allowed)
export const MH3_ADDR = 0o03252;  // jump timer (drives breakout)
export const MH4_ADDR = 0o03253;  // accumulator for re-entry angle draw

// Hyperspace constants (tunable table)
export const HD2     = 0o00024;  // law i 100 — time in breakout
export const HD3     = 0o00025;  // law i 200 — recharge time
export const HR1     = 0o00026;  // scl 9s — scale displacement
export const HR2     = 0o00027;  // scl 4s — scale velocity
export const HUR     = 0o00030;  // 40000 — hyperspatial uncertainty

// Ship calc routine pointer
export const DAP_SRT = 0o262713; // `dap srt` — calc routine pointer

// Object table
export const MTB     = 0o03476;  // object table origin
export const NOB     = 30;       // objects per slot
export const SHIP1_SLOT = MTB;   // slot 0 for spaceship 1

// Main loop
export const ML0     = 0o01700;  // main loop entry
export const ML1     = 0o01703;  // main loop pointer (object 0)

// Ship position variables (object 0)
export const MX1     = 0o01737;  // ship 1 x-position
export const MY1     = 0o01747;  // ship 1 y-position
export const MA1     = 0o01772;  // explosion/torp length / hyperspace timer
export const MB1     = 0o02006;  // instruction count / active flag

// PRNG
export const RAN_ADDR = 0o031;   // ran (PRNG state) cell

// ─── Sense switch helpers ─────────────────────────────────────────────────────

export const SSW1 = 1;
export const SSW2 = 2;
export const SSW3 = 3;
export const SSW4 = 4;
export const SSW5 = 5;
export const SSW6 = 6;

/**
 * Build a SIMH script that sets up hyperspace state and runs the main loop.
 *
 * The script:
 * 1. Loads the Image
 * 2. Sets object table with hyperspace calc routine (ml1 → hp1)
 * 3. Sets hyperspace state variables (mh1-mh4, ma1)
 * 4. Sets ship position
 * 5. Sets PRNG seed
 * 6. Sets sense switches
 * 7. Runs the main loop
 * 8. Captures CPU history for T-METER coverage
 */
export function buildHyperTraceScript(rimPath, opts = {}) {
  const {
    // PRNG seed
    ranSeed = 0,
    // Hyperspace state
    hyperJumps = 8,         // \mh2 shots remaining
    hyperTimer = 200,       // \mh3 jump timer (from hd3 = law i 200)
    hyperAccum = 0,         // \mh4 accumulator
    savedCalc = DAP_SRT,    // \mh1 saved calc routine (dap srt)
    // In-flight timer
    inFlightFrames = 0,     // ma1 when entering hyperspace
    // Ship position
    shipX = 0o4000,
    shipY = 0o4000,
    // Sense switches
    senseSwitches = [SSW6],
  } = opts;

  const lines = [];
  const oct = n => n.toString(8);
  const deposit = (addr, val) => lines.push(`deposit ${oct(addr)} ${oct(val)}`);

  lines.push(`load ${rimPath}`);

  // ── Sense switches ─────────────────────────────────────────────────────
  for (const sw of senseSwitches) {
    lines.push(`senseswitch ${sw}`);
  }

  // ── PRNG seed ──────────────────────────────────────────────────────────
  deposit(RAN_ADDR, ranSeed);

  // ── Object 0: hyperspace calc routine ──────────────────────────────────
  deposit(SHIP1_SLOT, DAP_SRT);       // dap srt (standard entry)
  deposit(ML1, HP1);                  // ml1 → hp1 (hyperspace entry)
  deposit(MA1, inFlightFrames);       // in-flight frames remaining
  deposit(MB1, 1);                    // active

  // ── Ship position ──────────────────────────────────────────────────────
  deposit(MX1, shipX);
  deposit(MY1, shipY);

  // ── Hyperspace state ───────────────────────────────────────────────────
  deposit(MH1_ADDR, savedCalc);       // saved ml1
  deposit(MH2_ADDR, hyperJumps);      // shots remaining
  deposit(MH3_ADDR, hyperTimer);      // jump timer
  deposit(MH4_ADDR, hyperAccum);      // accumulator

  // ── Run main loop ──────────────────────────────────────────────────────
  lines.push(`run ${oct(ML0)}`);

  // ── CPU history for T-METER ────────────────────────────────────────────
  lines.push('show cpu history');
  lines.push('quit');

  return lines;
}

/**
 * Run a SIMH script and parse output into { state, pcHistory }.
 * `state` maps examined addresses → integer values.
 * `pcHistory` is the array of PC addresses from `show cpu history`.
 */
export async function runTraceScript(scriptLines, { timeout = 60_000 } = {}) {
  const { lines } = await runPdp1(scriptLines, { timeout });

  const state = {};
  const pcHistory = [];
  let inHistory = false;

  for (const line of lines) {
    // Parse "ADDR:\tWORD" examine output
    const em = line.match(/^([0-7]+):\s+([0-7]+)/);
    if (em) {
      state[parseInt(em[1], 8)] = parseInt(em[2], 8);
    }

    // Detect CPU history section
    if (/cpu\s+history/i.test(line)) {
      inHistory = true;
      continue;
    }

    // Parse PC values from history lines: "NNNNNN  ..."
    if (inHistory) {
      const hm = line.match(/^\s*([0-7]{6})\s/);
      if (hm) {
        pcHistory.push(parseInt(hm[1], 8));
      }
    }
  }

  return { state, pcHistory };
}
