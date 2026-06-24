/**
 * T-IOSTUB — cwr entry stub + sbf correctly-dead block (source lines 98–117).
 *
 * Two code items in this range:
 *
 *   cwr (loc 40): single-word per-frame dispatch stub entered via `jsp cwg`.
 *     Routes to mg1 (hardware control boxes) by default; the test-word path
 *     patches cwg to mg2 instead (T-CWG #15).  Reached every frame.
 *
 *   sbf (loc 61–65): sequence-break flush.  Entered only via the loc-3 reset
 *     vector (`3/ jmp sbf`).  Under pinned inputs the sequence-break system is
 *     never armed (no `esm` is issued), so loc 3 never fires and sbf is never
 *     entered — correctly dead (ADR-0007).
 *
 * The entire range 98–117 is branchless: no skip instructions appear in either
 * block.  T-METER therefore has no skip-both-ways obligation here; coverage is
 * confirmed by PC-reachability (cwr) and PC-absence (sbf).
 *
 * All values from build/spacewar31.lst.
 */

// ── cwr entry stub ─────────────────────────────────────────────────────────

/** Address of the cwr stub (org 40 octal). */
export const CWR_ADDR = 0o40;

/** Assembled word: `jmp mg1` (mg1 assembled at 0o1672). */
export const CWR_WORD = 0o601672;

// ── sbf sequence-break flush ───────────────────────────────────────────────

/**
 * Addresses of the five sbf instructions (loc 61–65 octal).
 *
 * sbf,  tyi        (61)  — read typewriter input
 *       lio 2      (62)  — load IO from loc 2
 *       lac 0      (63)  — load AC from loc 0
 *       lsm        (64)  — left-shift memory
 *       jmp i 1    (65)  — return via indirection through loc 1
 */
export const SBF_ADDRS = [0o61, 0o62, 0o63, 0o64, 0o65];

/** Assembled words for the sbf block, parallel to SBF_ADDRS. */
export const SBF_WORDS = [
  0o720004,  // tyi
  0o220002,  // lio 2
  0o200000,  // lac 0
  0o720054,  // lsm
  0o610001,  // jmp i 1
];

// ── loc 3 reset vector ─────────────────────────────────────────────────────

/** Address of the loc-3 reset vector (`3/ jmp sbf`). */
export const LOC3_ADDR = 0o3;

/** Assembled word: `jmp sbf` (sbf at 0o61). */
export const LOC3_WORD = 0o600061;

// ── SIMH trace helper ──────────────────────────────────────────────────────

/**
 * Build a SIMH script that runs the game for `steps` instructions from the
 * normal entry point (loc 4), captures CPU history, and quits.
 *
 * 5000 steps is enough to boot, compile outlines, and reach the first
 * per-frame cwr dispatch — confirmed empirically.
 */
export function buildIostubTraceScript(rimPath, steps = 5000) {
  return [
    `load ${rimPath}`,
    `set cpu history=${steps}`,
    `step ${steps}`,
    'show cpu history',
    'quit',
  ];
}
