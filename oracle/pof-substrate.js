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

// Re-export the full ship-substrate surface — pof is reached through T-SHIP's
// gravity capture path, so callers need the same object-table, ship, and
// sense-switch symbols. buildPofTraceScript (below) layers pof-specific defaults
// on top.
export * from './ship-substrate.js';

// Pulled into local scope for buildPofTraceScript's defaults.
import { buildShipTraceScript, SSW6 } from './ship-substrate.js';

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
    // Ship 1 extremely close to the star at origin — guarantees gravity capture
    ship1x: 0o0010,
    ship1y: 0o0010,
    // Ship 2 far away — no interference
    ship2x: 0o14000,
    ship2y: 0o14000,
    // Gravity on
    senseSwitches: [SSW6],
    // No control input — gravity capture is autonomous
    ship1Ctrl: 0,
    ship2Ctrl: 0,
    // Plenty of fuel
    fuel: 0o757777,
    // PRNG seed
    ranSeed: 0,
    // Caller overrides win (also passes through opts handled only by
    // buildShipTraceScript, e.g. ship1Angle, torps).
    ...opts,
  });
}
