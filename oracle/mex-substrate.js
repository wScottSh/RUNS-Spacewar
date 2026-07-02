/**
 * T-MEX substrate: SIMH scripts that drive Spacewar! 3.1 explosion mex.
 *
 * Issue #25. Class E — Trace. Seam: self-mod from four death sites —
 * collision (T-MAINLOOP #20, lines 889–891), torpedo expiry (T-TCR #24,
 * lines 989–990), hyperspace deadly breakout (T-HYPER #22, lines 1069–1070),
 * and ship-dragged-into-star explode (T-POF #23, lines 1329–1330).
 *
 * Routine spans source lines 946–984, partition tile 18.
 *
 * Object table layout (mtb = 03476, nob = 30 per slot):
 *   Slot 0 (mtb+0..29): spaceship 1 — ml1, mx1, my1, ma1, mb1 + ship vars
 *   Slot 1 (mtb+30..59): spaceship 2 — ml2, mx2, my2, ma2, mb2 + ship vars
 *   Slot 2+ (mtb+60..): torpedoes / explosions / other objects
 *
 * Each object slot has:
 *   offset 0: calc routine pointer (dap srt = 0262713)
 *   offset 1: mx (x-position)
 *   offset 2: my (y-position)
 *   offset 3: na (explosion/torp life counter) — modified by isp
 *   offset 4: mb (instruction count / active flag)
 *
 * Pointer variables (main loop workspace, self-modified per object):
 *   ml1 (01703): points to current object's calc routine pointer
 *   mx1 (01737): points to current object's mx
 *   my1 (01747): points to current object's my
 *   ma1 (01772): points to current object's na (life counter)
 *   mb1 (02006): points to current object's mb (instr count)
 *
 * mex routine (lines 946–984, addr 02052–02135):
 *   1. diff \mdx, mx1, (sar 3s  — carry over inertia (L952)
 *   2. diff \mdy, my1, (sar 3s  — carry over inertia (L954)
 *   3. law mst / dap msh        — set up shift pointer (L955-956)
 *   4. lac i mb1 / cma / sar 3s / dac \mxc  — particle count from mb1 (L957-960)
 *   5. ms1: sub (140 / sma / idx msh  — size test, provably one-way (L961-963)
 *   6. Particle loop mz1..count \mxc: random + self-mod mi1 + dpy-i (L964-977)
 *   7. count i ma1, mxr        — duration hold (L978)
 *   8. dzm i ml1               — clear calc vector, object dies (L979)
 *
 * Self-modification:
 *   mi1 (972, assembled hlt) is overwritten each particle by dac mi1 (967)
 *   msh (971, xct .) is set by dap msh (956) to point to mst (982)
 *     — every explosion uses scr 1s (982), scr 3s (983) is dead (ADR-0007)
 *
 * 6 explosion sizes come from the magnitude mb1 each death site loads.
 *
 * Sense switches (set via SIMH senseswitch command):
 *   SSW6 = 6 (gravity on/off)
 */

import { runPdp1 } from './simh.js';

const HERE = (() => { try { return new URL('.', import.meta.url).pathname; } catch { return '/oracle'; }})();

// ─── Addresses ────────────────────────────────────────────────────────────────

export const RIM_PATH = `${HERE}/../build/spacewar31.rim`;

// Explosion routine entry points (lines 946–984)
export const MEX      = 0o02052;  // explosion entry (dap mxr)
export const MS1      = 0o02075;  // size test start (sub (140)
export const MZ1      = 0o02100;  // particle loop start (random expansion)
export const MXR      = 0o02133;  // explosion return (jmp .)
export const MST      = 0o02134;  // explosion size constants (scr 1s, scr 3s)

// Variable addresses (workspace)
export const MDX      = 0o03244;  // dx delta (inertia carry-over)
export const MDY      = 0o03245;  // dy delta (inertia carry-over)
export const MXC      = 0o03264;  // particle count (negative, magnitude from mb1)

// Explosion self-mod words
export const MSH      = 0o02117;  // shift pointer (xct ., set by dap msh)
export const MI1      = 0o02120;  // particle coordinate placeholder (hlt, overwritten)

// Object table
export const MTB      = 0o03476;  // object table origin
export const NOB      = 0o30;     // slot increment (30 octal = 24 decimal)

// Pointer variables (main loop workspace — self-modified per object)
export const ML1      = 0o01703;  // calc routine pointer (object 0)
export const ML2      = 0o01734;  // calc routine pointer (object 1)
export const MX1      = 0o01737;  // x-position pointer
export const MY1      = 0o01747;  // y-position pointer
export const MA1      = 0o01772;  // na pointer (life counter)
export const MB1      = 0o02006;  // mb pointer (instruction count / magnitude)

// Ship calc routines
export const DAP_SRT  = 0o262713; // `dap srt` — calc routine pointer

// Main loop
export const ML0      = 0o01700;  // main loop entry

// PRNG
export const RAN_ADDR = 0o031;    // ran (PRNG state) cell

// ─── Skip site addresses ─────────────────────────────────────────────────────

// L962: sma at 02076 — ms1 size test (provably one-way, always skips)
export const ADDR_SMA_SIZE_TEST  = 0o02076;

// L977: count macro expansion (isp \mxc) at 02126 — particle loop iteration
export const ADDR_ISP_PARTICLE   = 0o02126;

// L978: count macro expansion (isp i ma1) at 02130 — duration hold
export const ADDR_ISP_DURATION   = 0o02130;

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
 * ml[N] = mtb + N * 030 octal.
 */
export function mlAddr(n) {
  return MTB + n * 0o30;
}

/**
 * Build a SIMH script that sets up an explosion at a given object slot.
 *
 * The explosion object has:
 *   - calc routine = mex (self-modified into place by death site)
 *   - mb = particle count magnitude (negative of \mxc, controls explosion size)
 *   - ma = duration counter (controls how long explosion lives)
 *   - position set (particles drawn relative to this position)
 *
 * Other objects (ships, torpedoes) are kept inactive so they don't
 * interfere with the explosion trace.
 *
 * @param {string} rimPath - path to the .rim image
 * @param {Object} opts - configuration
 * @param {number} opts.slot - object slot for the explosion (default: 2)
 * @param {number} opts.explosionSize - mb magnitude controlling particle count (default: 8)
 * @param {number} opts.duration - ma value for explosion lifetime (default: 40)
 * @param {number[]} opts.senseSwitches - sense switches to set (default: [SSW6])
 * @param {number} opts.ranSeed - PRNG seed (default: 0)
 * @param {number} opts.frames - number of main loop frames to run (default: 1)
 * @param {number} opts.explosionX - x-position (default: 0o10000)
 * @param {number} opts.explosionY - y-position (default: 0o10000)
 * @returns {string[]} SIMH script lines
 */
export function buildMexTraceScript(rimPath, opts = {}) {
  const {
    slot = 2,
    explosionSize = 8,     // mb value — magnitude of particle count (1-8 for 6 sizes)
    duration = 40,         // ma value — explosion lifetime in frames
    senseSwitches = [SSW6],
    ranSeed = 0,
    frames = 1,
    explosionX = 0o10000,
    explosionY = 0o10000,
    // Other object state — keep inactive to avoid interference
    ship1Active = false,
    ship2Active = false,
    otherSlotActive = false,
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

  // ── Ship 1 (slot 0): active/inactive as configured ─────────────────────
  if (ship1Active) {
    deposit(slotBase(0), DAP_SRT);    // calc routine pointer = dap srt
    deposit(MX1, 0o4000);             // x-position
    deposit(MY1, 0o4000);             // y-position
    deposit(MA1, 0);                  // not exploding
    deposit(MB1, 1);                  // active
  } else {
    deposit(slotBase(0), 0);          // inactive
    deposit(MB1, 0);
  }

  // ── Ship 2 (slot 1): active/inactive as configured ─────────────────────
  if (ship2Active) {
    deposit(slotBase(1), DAP_SRT);    // calc routine pointer = dap srt
    deposit(slotBase(1) + 1, 0o14000);// mx2
    deposit(slotBase(1) + 2, 0o14000);// my2
    deposit(slotBase(1) + 3, 0);      // na2 = 0
    deposit(slotBase(1) + 4, 1);      // mb2 = 1 (active)
  } else {
    deposit(slotBase(1), 0);          // inactive
    deposit(slotBase(1) + 4, 0);
  }

  // ── Other slot (slot 3): inactive by default ───────────────────────────
  if (otherSlotActive) {
    deposit(slotBase(3), DAP_SRT);
    deposit(slotBase(3) + 1, 0o6000);
    deposit(slotBase(3) + 2, 0o6000);
    deposit(slotBase(3) + 3, 0);
    deposit(slotBase(3) + 4, 1);
  } else {
    deposit(slotBase(3), 0);
    deposit(slotBase(3) + 4, 0);
  }

  // ── Explosion (configured slot): calc routine = mex ────────────────────
  const slotBaseAddr = slotBase(slot);
  deposit(slotBaseAddr, MEX);          // ml = mex (explosion calc routine)
  deposit(slotBaseAddr + 1, explosionX); // explosion x-position
  deposit(slotBaseAddr + 2, explosionY); // explosion y-position
  deposit(naAddr(slot), duration);     // na = lifetime (frames)
  deposit(slotBaseAddr + 4, explosionSize); // mb = particle count magnitude
  // Inertia carry-over variables (mdx, mdy) — small values for clean trace
  deposit(MDX, 0);
  deposit(MDY, 0);

  // ── Run main loop for specified frames ─────────────────────────────────
  for (let f = 0; f < frames; f++) {
    lines.push(`run ${oct(ML0)}`);
  }

  // ── Examine key state ──────────────────────────────────────────────────
  // Explosion state
  examine(slotBaseAddr);               // calc routine (should be mex or cleared)
  examine(naAddr(slot));               // life counter (changed by isp)
  examine(slotBaseAddr + 1);           // x-position
  examine(slotBaseAddr + 2);           // y-position
  examine(slotBaseAddr + 4);           // mb (magnitude)
  // Workspace
  examine(MDX);                        // dx inertia
  examine(MDY);                        // dy inertia
  examine(MXC);                        // particle count
  examine(MI1);                        // self-modified coordinate (particle data)
  examine(MSH);                        // shift pointer (should point to mst)
  // Pointer variables (reflect last object processed)
  examine(MA1);                        // ma1 pointer

  // ── CPU history for T-METER ────────────────────────────────────────────
  lines.push('show cpu history');
  lines.push('quit');

  return lines;
}

/**
 * Convenience: build and run an explosion trace in one call.
 */
export async function traceMex(rimPath, opts = {}) {
  const script = buildMexTraceScript(rimPath, opts);
  return runTraceScript(script, opts);
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
