/**
 * T-SHIP substrate: SIMH scripts that drive Spacewar! 3.1 ship calc (ss1/ss2 + sq6 tail).
 *
 * Seam: jda ship entry (ss1 = 02310, ss2 = 02314), control word via jsp i \cwg.
 * The routine runs ss1/ss2 → sr0 → sc1 → gravity → sp5 → sq6 tail → sr5/st3.
 *
 * Object table layout (mtb = 03476, nob = 30 per slot):
 *   Slot 0 (mtb+0..29): spaceship 1 — ml1, mx1, my1, ma1, mb1 + ship vars
 *   Slot 1 (mtb+30..59): spaceship 2 — ml2, mx2, my2, ma2, mb2 + ship vars
 *
 * Key dual-slot variables (offset from ship slot base):
 *   0: calc routine pointer (dap srt = 0262713)
 *   1: mx (x-position)
 *   2: my (y-position)
 *   3: ma (explosion/torp length)
 *   4: mb (instruction count)
 *
 * Ship-specific shared variables (addresses in 023xx/032xx range):
 *   mth (02343)/mom (02327): angle / angular velocity
 *   mfu (03246): fuel
 *   mtr (03247): torps remaining
 *   mh1-mh4 (03250-03253): hyperspace state
 *   mco (03237): old control word
 *   cwg (03257): control word get pointer
 *   scw (03266): control word (received)
 *
 * Sense switches (set via SIMH `senseswitch` command):
 *   SSW1 = 1 (gyro/thruster), SSW2 = 2 (light/heavy star),
 *   SSW3 = 3 (single-shot/salvo), SSW6 = 6 (gravity on/off)
 */

import { runPdp1 } from './simh.js';

const HERE = (() => { try { return new URL('.', import.meta.url).pathname; } catch { return '/oracle'; }})();

// ─── Addresses ────────────────────────────────────────────────────────────────

export const RIM_PATH = `${HERE}/../build/spacewar31.rim`;

// Ship entry points
export const SS1 = 0o02310;   // first spaceship calc entry
export const SS2 = 0o02314;   // second spaceship calc entry

// Ship calc routine internal addresses
export const SR0    = 0o02320;  // control word read + angle update
export const SC1    = 0o02320;  // same as sr0
export const MTH    = 0o02343;  // angle accumulator
export const MOM    = 0o02327;  // angular velocity
export const BSG    = 0o02430;  // gravity "skip" (fuel-out path)
export const SQ6    = 0o02531;  // tail: ranct + thrust + torpedo + hyperspace
export const SR5    = 0o02667;  // hyperspace trigger / common exit
export const ST3    = 0o02713;  // hyperspace done
export const SRT    = 0o02713;  // return point (jmp .)
export const POF    = 0o02714;  // spaceship dragged into star
export const SR1    = 0o02615;  // free slot search
export const SR2    = 0o02625;  // torpedo setup
export const SQ9    = 0o02574;  // thrust exhaust end / torpedo check

// Ship variable addresses
export const ML1     = 0o01703;  // main loop pointer (object 0)
export const ML2     = 0o01734;  // main loop pointer (object 1)
export const MX1     = 0o01737;  // ship 1 x-position
export const MY1     = 0o01747;  // ship 1 y-position
export const MX2     = 0o01740;  // ship 2 x-position
export const MY2     = 0o01750;  // ship 2 y-position
export const MA1     = 0o01772;  // explosion/torp length (object 0)
export const MA2     = 0o01773;  // explosion/torp length (object 1)
export const MB1     = 0o02006;  // instruction count (object 0)
export const MB2     = 0o02010;  // instruction count (object 1)

// Shared ship variables
export const MFU_ADDR  = 0o03246;  // fuel
export const MTR_ADDR  = 0o03247;  // torps remaining
export const MH1_ADDR  = 0o03250;  // hyperspace state 1
export const MH2_ADDR  = 0o03251;  // hyperspace shots remaining
export const MH3_ADDR  = 0o03252;  // hyperspace timer
export const MH4_ADDR  = 0o03253;  // hyperspace accumulator
export const MCO_ADDR  = 0o03237;  // old control word
export const CWG_ADDR  = 0o03257;  // control word get pointer
export const SCW_ADDR  = 0o03266;  // control word (received)
export const BX_ADDR   = 0o03241;  // gravity x force
export const BY_ADDR   = 0o03242;  // gravity y force

// Object table
export const MTB     = 0o03476;  // object table origin
export const NOB     = 30;       // objects per slot
export const SHIP1_SLOT = MTB;   // slot 0 for spaceship 1
export const SHIP2_SLOT = MTB + NOB; // slot 1 for spaceship 2

// Main loop
export const ML0    = 0o01700;  // main loop entry
export const ML0_DELAY = 0o01700; // delay register start

// Star position cells (star table at 6077/ — the stars are displayed, gravity is at origin)
export const STR_ADDR = 0o00015;  // star capture radius = 1

// Tunable constants
export const TNO    = 0o006;  // torps + 1 (law i 41 → 40 torps)
export const TVL    = 0o007;  // torpedo velocity (sar 4s)
export const RLT    = 0o010;  // reload time (law i 20)
export const TLF    = 0o011;  // torpedo life (law i 140)
export const FOO    = 0o012;  // fuel supply
export const MAA    = 0o013;  // angular acceleration = 10
export const SAC    = 0o014;  // spaceship acceleration (sar 4s)
export const ME1    = 0o016;  // collision radius = 6000
export const ME2    = 0o017;  // collision radius / 2 = 3000

// ─── Sense switch helpers ─────────────────────────────────────────────────────

export const SSW1 = 1;
export const SSW2 = 2;
export const SSW3 = 3;
export const SSW4 = 4;
export const SSW5 = 5;
export const SSW6 = 6;

/**
 * Build a SIMH script that:
 * 1. Loads the Image
 * 2. Sets up object table with ship calc routines
 * 3. Sets ship positions, angles, fuel, torps, hyperspace state
 * 4. Sets control words via cwg pointer
 * 5. Sets sense switches
 * 6. Runs the main loop
 * 7. Examines key state
 * 8. Captures CPU history for T-METER coverage
 */
export function buildShipTraceScript(rimPath, opts = {}) {
  const {
    // Ship 1 state
    ship1x = 0o4000, ship1y = 0o4000,
    ship1Angle = 0, ship1AngVel = 0,
    // Ship 2 state
    ship2x = 0o14000, ship2y = 0o14000,
    ship2Angle = 0, ship2AngVel = 0,
    // Shared
    fuel = 0o757777,   // plenty of fuel
    torps = 0o40,      // 40 torps
    // Hyperspace (0 = not in hyperspace)
    hyperActive = 0, hyperShots = 8, hyperTimer = 0, hyperAccum = 0,
    // Control word: combined ship1+ship2 word stored at ctrlWordAddr
    ship1Ctrl = 0, ship2Ctrl = 0,
    // Sense switches (array of SSWn numbers)
    senseSwitches = [SSW6],  // gravity on by default
    // PRNG seed
    ranSeed = 0,
  } = opts;

  const lines = [`load ${rimPath}`];

  // ── Sense switches ─────────────────────────────────────────────────────
  for (const sw of senseSwitches) {
    lines.push(`senseswitch ${sw}`);
  }

  // ── PRNG seed ──────────────────────────────────────────────────────────
  lines.push(`deposit ${0o031.toString(8)} ${ranSeed.toString(8)}`);

  // ── Star capture radius ────────────────────────────────────────────────
  lines.push(`deposit ${STR_ADDR.toString(8)} 1`);

  // ── Ship 1: position, angle, velocity ──────────────────────────────────
  lines.push(`deposit ${SHIP1_SLOT.toString(8)} ${0o262713.toString(8)}`); // dap srt
  lines.push(`deposit ${MX1.toString(8)} ${ship1x.toString(8)}`);
  lines.push(`deposit ${MY1.toString(8)} ${ship1y.toString(8)}`);
  lines.push(`deposit ${MA1.toString(8)} 0`); // not exploding
  lines.push(`deposit ${MB1.toString(8)} 1`); // active

  // ── Ship 2: position, angle, velocity ──────────────────────────────────
  lines.push(`deposit ${SHIP2_SLOT.toString(8)} ${0o262713.toString(8)}`); // dap srt
  lines.push(`deposit ${MX2.toString(8)} ${ship2x.toString(8)}`);
  lines.push(`deposit ${MY2.toString(8)} ${ship2y.toString(8)}`);
  lines.push(`deposit ${MA2.toString(8)} 0`); // not exploding
  lines.push(`deposit ${MB2.toString(8)} 1`); // active

  // ── Angle / angular velocity (dual slots for both ships) ───────────────
  lines.push(`deposit ${MTH.toString(8)} ${ship1Angle.toString(8)}`);
  lines.push(`deposit ${MOM.toString(8)} ${ship1AngVel.toString(8)}`);
  lines.push(`deposit ${(MTH + 1).toString(8)} ${ship2Angle.toString(8)}`);
  lines.push(`deposit ${(MOM + 1).toString(8)} ${ship2AngVel.toString(8)}`);

  // ── Shared variables ───────────────────────────────────────────────────
  lines.push(`deposit ${MFU_ADDR.toString(8)} ${fuel.toString(8)}`);
  lines.push(`deposit ${MTR_ADDR.toString(8)} ${torps.toString(8)}`);
  lines.push(`deposit ${MH1_ADDR.toString(8)} ${hyperActive.toString(8)}`);
  lines.push(`deposit ${MH2_ADDR.toString(8)} ${hyperShots.toString(8)}`);
  lines.push(`deposit ${MH3_ADDR.toString(8)} ${hyperTimer.toString(8)}`);
  lines.push(`deposit ${MH4_ADDR.toString(8)} ${hyperAccum.toString(8)}`);

  // ── Control word setup ─────────────────────────────────────────────────
  // cwg (03257) should point to a cell containing the control word
  // The calc routines use jsp i \cwg to fetch it
  const ctrlWordAddr = 0o1000;
  const combinedCtrl = ship1Ctrl | ship2Ctrl;
  lines.push(`deposit ${ctrlWordAddr.toString(8)} ${combinedCtrl.toString(8)}`);
  lines.push(`deposit ${CWG_ADDR.toString(8)} ${ctrlWordAddr.toString(8)}`);

  // ── Run main loop (one frame) ──────────────────────────────────────────
  lines.push(`run ${ML0.toString(8)}`);

  // ── Examine key state ──────────────────────────────────────────────────
  // Positions
  lines.push(`examine ${MX1.toString(8)}`);
  lines.push(`examine ${MY1.toString(8)}`);
  lines.push(`examine ${MX2.toString(8)}`);
  lines.push(`examine ${MY2.toString(8)}`);
  // Angles
  lines.push(`examine ${MTH.toString(8)}`);
  lines.push(`examine ${(MTH + 1).toString(8)}`);
  lines.push(`examine ${MOM.toString(8)}`);
  lines.push(`examine ${(MOM + 1).toString(8)}`);
  // Fuel and torps
  lines.push(`examine ${MFU_ADDR.toString(8)}`);
  lines.push(`examine ${MTR_ADDR.toString(8)}`);
  // Hyperspace state
  lines.push(`examine ${MH1_ADDR.toString(8)}`);
  lines.push(`examine ${MH2_ADDR.toString(8)}`);
  lines.push(`examine ${MH3_ADDR.toString(8)}`);
  lines.push(`examine ${MH4_ADDR.toString(8)}`);
  // Object table (calc routines)
  lines.push(`examine ${SHIP1_SLOT.toString(8)}`);
  lines.push(`examine ${SHIP2_SLOT.toString(8)}`);
  // Control word pointer
  lines.push(`examine ${CWG_ADDR.toString(8)}`);
  // Gravity forces
  lines.push(`examine ${BX_ADDR.toString(8)}`);
  lines.push(`examine ${BY_ADDR.toString(8)}`);

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
export async function runTraceScript(rimPath, scriptLines, { timeout = 60_000 } = {}) {
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
      } else if (line.trim() === '' || line.startsWith('sim>')) {
        // End of history
      }
    }
  }

  return { state, pcHistory };
}

/**
 * Convenience: build and run a ship trace in one call.
 */
export async function traceShip(rimPath, opts = {}) {
  const script = buildShipTraceScript(rimPath, opts);
  return runTraceScript(rimPath, script);
}
