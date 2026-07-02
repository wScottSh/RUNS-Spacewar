/**
 * T-TCR substrate: SIMH scripts that drive Spacewar! 3.1 torpedo calc (tcr).
 *
 * Issue #24. Class E — Trace. Seam: `ml1` self-mod relay (sr2, lines 1255–1288 of T-SHIP).
 * `tcr` is the per-frame calc routine for a live torpedo. It is entered from the main
 * loop's object dispatch (ml1 → tcr), not called directly.
 *
 * Object table layout (mtb = 03476, nob = 30 per slot):
 *   Slot 0 (mtb+0..29): spaceship 1 — ml1, mx1, my1, ma1, mb1 + ship vars
 *   Slot 1 (mtb+30..59): spaceship 2 — ml2, mx2, my2, ma2, mb2 + ship vars
 *   Slot 2+ (mtb+60..): torpedoes / other colliding objects
 *
 * Each object slot has:
 *   offset 0: calc routine pointer (dap srt = 0262713)
 *   offset 1: mx (x-position)
 *   offset 2: my (y-position)
 *   offset 3: na (explosion/torp life counter) — modified by isp in tcr
 *   offset 4: mb (instruction count / active flag)
 *
 * Pointer variables (main loop workspace, self-modified per object):
 *   ml1 (01703): points to current object's calc routine pointer
 *   mx1 (01737): points to current object's mx
 *   my1 (01747): points to current object's my
 *   ma1 (01772): points to current object's na (life counter)
 *   mb1 (02006): points to current object's mb (instr count)
 *
 * tcr routine (lines 985–1006, addr 02136–02167):
 *   1. dap trc  — save return address
 *   2. count i ma1, tc1  — isp i ma1; jmp tc1  (fuse expiry test)
 *      - not expired (isp skips, ma1 was negative → now ≥ 0): fall through
 *      - expired (isp no-skip, ma1 still ≤ 0 after increment): jmp tc1
 *   3. Self-convert to mex: ml1 ← mex 400000, ma ← 2, jmp trc
 *   4. tc1 move path: position + warpage + dispt
 *
 * Sense switches (set via SIMH `senseswitch` command):
 *   SSW6 = 6 (gravity on/off)
 */

import { runPdp1 } from './simh.js';

const HERE = (() => { try { return new URL('.', import.meta.url).pathname; } catch { return '/oracle'; }})();

// ─── Addresses ────────────────────────────────────────────────────────────────

export const RIM_PATH = `${HERE}/../build/spacewar31.rim`;

// Torpedo calc routine entry points (lines 985–1006)
export const TCR       = 0o02136;  // torpedo calc entry (dap trc)
export const TC1       = 0o02146;  // torpedo move path (lac i mx1)
export const TRC       = 0o02167;  // return point (jmp .)

// Explosion (target when fuse expires)
export const MEX       = 0o02052;  // explosion routine entry
export const MXR       = 0o02133;  // explosion return (jmp .)
export const MST       = 0o02134;  // explosion size constants (scr 1s, scr 3s)

// Object table
export const MTB       = 0o03476;  // object table origin
export const NOB       = 0o30;     // slot increment (30 octal = 24 decimal)
export const TORP_SLOT = 0o03556;  // slot 2 base: mtb + 2*030 = 03556

// Pointer variables (main loop workspace — self-modified per object)
export const ML1       = 0o01703;  // calc routine pointer (object 0)
export const ML2       = 0o01734;  // calc routine pointer (object 1, collision target)
export const MX1       = 0o01737;  // x-position pointer
export const MY1       = 0o01747;  // y-position pointer
export const MA1       = 0o01772;  // na pointer (life counter)
export const MB1       = 0o02006;  // mb pointer (instruction count)

// Ship calc routines
export const DAP_SRT   = 0o262713; // `dap srt` — calc routine pointer

// Main loop
export const ML0       = 0o01700;  // main loop entry

// PRNG
export const RAN_ADDR  = 0o031;    // ran (PRNG state) cell

// Tunable constants
export const TLF       = 0o011;    // torpedo life (law i 140) at addr 11
export const RLT       = 0o010;    // reload time (law i 20) at addr 10
export const ME1       = 0o016;    // collision radius = 6000
export const ME2       = 0o017;    // collision radius / 2 = 3000

// ─── Sense switch helpers ─────────────────────────────────────────────────────

export const SSW1 = 1;
export const SSW2 = 2;
export const SSW3 = 3;
export const SSW4 = 4;
export const SSW5 = 5;
export const SSW6 = 6;

/**
 * Compute the object slot base address for a given slot number.
 * Slot N base = mtb + N * nob (where nob = 030 octal = 24 decimal).
 */
export function slotBase(n) {
  return MTB + n * 0o30;
}

/**
 * Compute the na (life counter) address for object slot N.
 * na slots are in a separate array starting at mtb + 0110 octal.
 * na[N] = mtb + 0110 + N * 030 octal.
 */
export function naAddr(n) {
  return MTB + 0o110 + n * 0o30;
}

/**
 * Compute the ml (calc routine pointer) address for object slot N.
 * ml slots are in the mtb array.
 * ml[N] = mtb + N * 030 octal.
 */
export function mlAddr(n) {
  return MTB + n * 0o30;
}

/**
 * Build a SIMH script that:
 * 1. Loads the Image
 * 2. Sets up object table with a torpedo at slot 2
 * 3. Sets ship state (so torpedo doesn't collide with ships)
 * 4. Runs the main loop
 * 5. Examines key state
 * 6. Captures CPU history for T-METER coverage
 *
 * The torpedo is placed far from ships and stars so it doesn't collide
 * or get affected by gravity during the trace.
 */
export function buildTcrTraceScript(rimPath, opts = {}) {
  const {
    // Torpedo state (slot 2)
    torpX = 0o10000,    // x-position (far from ships and origin)
    torpY = 0o10000,    // y-position (far from ships and origin)
    torpLife = 140,     // na2 life counter value (isp increments each frame)
    // Ship 1 state — keep ships far from torpedo
    ship1x = 0o4000,
    ship1y = 0o4000,
    // Ship 2 state
    ship2x = 0o14000,
    ship2y = 0o14000,
    // Sense switches
    senseSwitches = [SSW6], // gravity on
    // PRNG seed
    ranSeed = 0,
    // Number of main loop frames to run (0 = one full pass through all objects)
    frames = 1,
  } = opts;

  const lines = [];
  const oct = n => n.toString(8);
  const deposit = (addr, val) => lines.push(`deposit ${oct(addr)} ${oct(val)}`);
  const examine = addr => lines.push(`examine ${oct(addr)}`);

  lines.push(`load ${rimPath}`);

  // ── Sense switches ─────────────────────────────────────────────────────
  for (const sw of senseSwitches) {
    lines.push(`senseswitch ${sw}`);
  }

  // ── PRNG seed ──────────────────────────────────────────────────────────
  deposit(RAN_ADDR, ranSeed);

  // ── Ship 1 (slot 0): active, calc routine ──────────────────────────────
  deposit(slotBase(0), DAP_SRT);    // calc routine pointer = dap srt
  deposit(MX1, ship1x);             // x-position
  deposit(MY1, ship1y);             // y-position
  deposit(MA1, 0);                  // not exploding (na1 = 0)
  deposit(MB1, 1);                  // active

  // ── Ship 2 (slot 1): active, calc routine ──────────────────────────────
  deposit(slotBase(1), DAP_SRT);    // calc routine pointer = dap srt
  deposit(slotBase(1) + 1, ship2x); // mx2 (offset 1 from slot base)
  deposit(slotBase(1) + 2, ship2y); // my2 (offset 2 from slot base)
  deposit(slotBase(1) + 3, 0);      // na2 = 0 (not exploding)
  deposit(slotBase(1) + 4, 1);      // mb2 = 1 (active)

  // ── Torpedo (slot 2): calc routine = tcr, with life counter ────────────
  deposit(mlAddr(2), TCR);          // ml2 = tcr (torpedo calc routine)
  deposit(mlAddr(2) + 1, torpX);    // torpedo x-position
  deposit(mlAddr(2) + 2, torpY);    // torpedo y-position
  deposit(naAddr(2), torpLife);     // na2 = life counter
  deposit(slotBase(2) + 4, 1);      // mb2 = 1 (active)

  // ── Run main loop for specified frames ─────────────────────────────────
  for (let f = 0; f < frames; f++) {
    lines.push(`run ${oct(ML0)}`);
  }

  // ── Examine key state ──────────────────────────────────────────────────
  // Torpedo state
  examine(mlAddr(2));               // calc routine (should be tcr or mex)
  examine(naAddr(2));               // life counter (changed by isp)
  examine(slotBase(2) + 1);         // x-position
  examine(slotBase(2) + 2);         // y-position
  // Pointer variables (reflect last object processed)
  examine(MA1);                     // ma1 pointer (points to last object's na)
  // Object table calc routines
  examine(slotBase(0));             // slot 0 calc routine
  examine(slotBase(1));             // slot 1 calc routine
  examine(slotBase(2));             // slot 2 calc routine

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

/**
 * Convenience: build and run a torpedo calc trace in one call.
 */
export async function traceTcr(rimPath, opts = {}) {
  const script = buildTcrTraceScript(rimPath, opts);
  return runTraceScript(script, opts);
}
