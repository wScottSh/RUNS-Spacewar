/**
 * T-POF substrate: SIMH scripts that drive Spacewar! 3.1 star-capture outcome `pof`.
 *
 * Seam: reached transitively via T-SHIP gravity capture — inline gravity at
 * `sma i sza` (line 1141) → `jmp pof` (line 1142). No direct caller.
 *
 * The `pof` routine (lines 1311–1335, partition tile 23) handles ships dragged
 * into the star with two outcome arms gated by SSW5:
 *   SSW5 clear → vanish (antipode-warp, respawn countdown)
 *   SSW5 set   → explode (po1 self-mod → mex next frame)
 *
 * Hard branch: `szs 50` at 02716 (line 1319) — the only decision in the routine.
 *
 * Re-exports ship-substrate helpers since pof is reached through T-SHIP's
 * gravity capture path (same setup: object table, ship near star, gravity on).
 */

import {
  RIM_PATH,
  SS1, SS2,
  SR0, MTH, MOM, BSG, SQ6, SR5, ST3, SRT, POF,
  SR1, SR2, SQ9,
  ML1, ML2, MX1, MY1, MX2, MY2, MA1, MA2, MB1, MB2,
  MFU_ADDR, MTR_ADDR, MH1_ADDR, MH2_ADDR, MH3_ADDR, MH4_ADDR,
  MCO_ADDR, CWG_ADDR, SCW_ADDR, BX_ADDR, BY_ADDR,
  MTB, NOB, SHIP1_SLOT, SHIP2_SLOT,
  ML0, STR_ADDR,
  TNO, TVL, RLT, TLF, FOO, MAA, SAC, ME1, ME2,
  SSW1, SSW2, SSW3, SSW4, SSW5, SSW6,
  buildShipTraceScript,
  runTraceScript,
  traceShip,
} from './ship-substrate.js';

export {
  RIM_PATH,
  SS1, SS2,
  SR0, MTH, MOM, BSG, SQ6, SR5, ST3, SRT, POF,
  SR1, SR2, SQ9,
  ML1, ML2, MX1, MY1, MX2, MY2, MA1, MA2, MB1, MB2,
  MFU_ADDR, MTR_ADDR, MH1_ADDR, MH2_ADDR, MH3_ADDR, MH4_ADDR,
  MCO_ADDR, CWG_ADDR, SCW_ADDR, BX_ADDR, BY_ADDR,
  MTB, NOB, SHIP1_SLOT, SHIP2_SLOT,
  ML0, STR_ADDR,
  TNO, TVL, RLT, TLF, FOO, MAA, SAC, ME1, ME2,
  SSW1, SSW2, SSW3, SSW4, SSW5, SSW6,
  buildShipTraceScript,
  runTraceScript,
  traceShip,
};

// ─── Addresses ────────────────────────────────────────────────────────────────

export const PO1    = 0o02730;  // explode path: self-mod calc vector to mex

// ─── Pof region helpers ───────────────────────────────────────────────────────

/**
 * Build a SIMH trace script that places ship 1 into gravity star-capture
 * so execution flows through `jmp pof` (line 1142).
 *
 * This is a thin wrapper around buildShipTraceScript with defaults that
 * guarantee gravity capture (ship extremely close to star, gravity on).
 */
export function buildPofTraceScript(rimPath, opts = {}) {
  return buildShipTraceScript(rimPath, {
    // Ship extremely close to star at origin — guarantees gravity capture
    ship1x: opts.ship1x ?? 0o0010,
    ship1y: opts.ship1y ?? 0o0010,
    // Ship 2 far away — no interference
    ship2x: opts.ship2x ?? 0o14000,
    ship2y: opts.ship2y ?? 0o14000,
    // Gravity on
    senseSwitches: opts.senseSwitches ?? [SSW6],
    // No control input needed — gravity capture is autonomous
    ship1Ctrl: opts.ship1Ctrl ?? 0,
    ship2Ctrl: opts.ship2Ctrl ?? 0,
    // Plenty of fuel
    fuel: opts.fuel ?? 0o757777,
    // PRNG seed
    ranSeed: opts.ranSeed ?? 0,
    // Ship must be active (mb1 = 1)
    ...opts,
  });
}
