/**
 * T-COVERAGE union scenario library (issue #27, ADR-0012).
 *
 * Drives the real game in SIMH across the pinned-input scenario set and
 * collects PC streams for the union/closure gate (coverage-gate.js).
 *
 * Mechanics established empirically against the Substrate:
 *   - SIMH pdp1 max history = 65536; `show cpu history` dumps the circular
 *     buffer; re-issuing `set cpu history=65536` clears it between segments.
 *   - The compiled outline code (nnn = 03772 on) and several source regions
 *     contain wait-class iot words (ioh 0730000, dpy-i 073xxxx).  Headless
 *     SIMH stops on them with "Infinite I/O wait".  The runner scans core
 *     after boot-compile and patches every wait-class iot word (top 6 bits
 *     0o73) to nop (0o760000).  Display words are not branch obligations, so
 *     the patch does not alter any decision site.
 *   - Sense switches: SS register bit for switch n is 0o100 >> n
 *     (probed: SS=0o40 lights szs 10 / switch 1, SS=0o1 lights szs 60).
 *   - Boot entry 4 (a40, control boxes / mg1) or 5 (a1, test word / mg2).
 *   - The frame loop passes ml0 (01444) once per frame; a breakpoint there
 *     is the per-frame seam for control-word (TW) scripting and deposits.
 *
 * Address map verified against build/spacewar31.lst symbol table.
 */
import { readFile } from 'node:fs/promises';
import { runPdp1, pdp1Version } from './simh.js';
import { parseListingForMeter } from './meter.js';
import {
  CoverageGate,
  buildUnionOneWayRegister,
  buildDeadMultiwayRegister,
  buildDeadSkipSiteRegister,
} from './coverage-gate.js';

// ─── Symbol addresses (from the assembled listing's symbol table) ─────────────

export const ADDR = {
  ML0: 0o1444,          // main-loop entry / per-frame seam
  HLT_A4: 0o1604,       // the score-readout hlt inside a4
  A4_RESUME: 0o1605,    // instruction after the hlt (lat)
  // object table columns (mtb = 03476, nob = 0o30)
  MTB: 0o3476,          // calc-routine column (slot 0 = ship 1)
  NX1: 0o3526,          // x column
  NY1: 0o3556,          // y column
  NA1: 0o3606,          // explosion/torp/reload count column
  NB1: 0o3636,          // instruction-count column
  NTH: 0o3750,          // angle (2 cells)
  NFU: 0o3752,          // fuel (2 cells)
  NTR: 0o3754,          // torps remaining (2 cells)
  NH2: 0o3764,          // hyperspace shots (2 cells)
  NH3: 0o3766,          // hyperspace recharge timer (2 cells)
  NH4: 0o3770,          // hyperspace uncertainty accumulator (2 cells)
  NNN: 0o3772,          // start of the compiled outline code
  // scalar cells
  NTD: 0o3254,          // restart delay
  SC1: 0o3255,          // player 1 score
  SC2: 0o3256,          // player 2 score
  GCT: 0o3260,          // game count (match play)
  DDD: 0o20,            // single/dual outline flag
  RAN: 0o31,            // PRNG state
  // vector routine entries (jda targets; from the M-ticket substrates)
  SIN: 0o74, COS: 0o66, MPY: 0o171, IMP: 0o156, IDV: 0o306, DVD: 0o315, SQT: 0o246,
};

// Sense-switch mask: switch n (1..6) lives at SS bit 0o100 >> n.
export const ssMask = (...switches) =>
  switches.reduce((m, n) => m | (0o100 >> n), 0);

// Control-word bits (mg2 test-word source; sr0/ss2 decoding at L1092-1110):
// ship 1 = top nibble, ship 2 = bottom nibble.
export const CTL = {
  S1_CCW: 0o400000, S1_CW: 0o200000, S1_THRUST: 0o100000, S1_FIRE: 0o040000,
  S2_CCW: 0o000010, S2_CW: 0o000004, S2_THRUST: 0o000002, S2_FIRE: 0o000001,
};

export const NOP_WORD = 0o760000;
export const HIST_MAX = 65536;

const oct = (n) => (n & 0o777777).toString(8);

// ─── Output parsing ───────────────────────────────────────────────────────────

/**
 * Split a SIMH session's output into PC streams, one per `show cpu history`
 * dump.  Each dump is a contiguous execution window; keeping the dumps as
 * separate streams lets the gate analyze them without fabricating a false
 * adjacent-PC pair across dump boundaries.
 *
 * A dump starts at its header line ("PC      OV AC ...") and its data lines
 * begin with a 6-octal-digit PC field.
 */
export function splitHistoryDumps(text) {
  const streams = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^PC\s+OV\s+AC/.test(line)) {
      current = [];
      streams.push(current);
      continue;
    }
    if (current) {
      const m = line.match(/^\s*([0-7]{6})\s/);
      if (m) current.push(parseInt(m[1], 8));
      else if (line.trim() && !/^\s*[0-7]{6}/.test(line)) current = null;
    }
  }
  return streams.filter((s) => s.length > 0);
}

/** Parse `EXAMINE lo-hi` output lines ("addr: word") into a Map. */
export function parseCoreDump(lines) {
  const core = new Map();
  for (const line of lines) {
    const m = line.match(/^([0-7]+):\s+([0-7]{6})/);
    if (m) core.set(parseInt(m[1], 8), parseInt(m[2], 8));
  }
  return core;
}

// ─── IOH patch list ───────────────────────────────────────────────────────────

/**
 * Boot once to ml0 (after a2 has compiled the outlines) and scan all of core
 * for wait-class iot words (top 6 bits 0o73: ioh, dpy-i, dispt-i expansions).
 * Returns their addresses.  The boot is deterministic, so the same addresses
 * hold in every subsequent session with the same boot inputs.
 */
export async function scanIohAddrs(rimPath, { entry = 4, ss = 0, tw = 0, deposits = [] } = {}) {
  const script = [
    `load ${rimPath}`,
    `D SS ${oct(ss)}`, `D CPU TW ${oct(tw)}`,
  ];
  for (const [addr, val] of deposits) script.push(`D ${oct(addr)} ${oct(val)}`);
  script.push('break 1444', `go ${entry.toString(8)}`, 'EXAMINE 0-7757', 'quit');
  const { lines } = await runPdp1(script, { timeout: 60_000 });
  const core = parseCoreDump(lines);
  const addrs = [];
  for (const [addr, word] of core) {
    if ((word >> 12) === 0o73) addrs.push(addr);
  }
  return addrs.sort((a, b) => a - b);
}

// ─── Frame-scripted scenario runner ───────────────────────────────────────────

/**
 * Run a boot + per-frame scripted scenario in one SIMH session.
 *
 * frames: array of frame actions, applied at successive ml0 breakpoints:
 *   { tw, ss, deposits: [[addr, val], ...], dump: bool, resumeHlt: bool }
 * The IOH patch list is re-deposited at every frame seam (a2 recompiles the
 * outline code after each game restart, restoring the wait-class words).
 *
 * Returns { streams, lines } — PC streams (one per history dump) + raw output.
 */
export async function runFrames(rimPath, {
  entry = 5,
  tw = 0,
  ss = 0,
  seed = 0,
  deposits = [],
  frames = [],
  iohAddrs = [],
  timeout = 300_000,
} = {}) {
  const script = [
    `set cpu history=${HIST_MAX}`,
    `load ${rimPath}`,
    `D SS ${oct(ss)}`,
    `D CPU TW ${oct(tw)}`,
    `D ${oct(ADDR.RAN)} ${oct(seed)}`,
  ];
  for (const [addr, val] of deposits) script.push(`D ${oct(addr)} ${oct(val)}`);
  script.push('break 1444');
  script.push(`go ${entry.toString(8)}`);
  // Boot history (a40/a1 → a/a6 → a2 compile → ml0) is its own dump.
  script.push('show cpu history');
  script.push(`set cpu history=${HIST_MAX}`);

  const patchLines = iohAddrs.map((a) => `D ${oct(a)} ${oct(NOP_WORD)}`);

  for (const frame of frames) {
    script.push(...patchLines);                    // idempotent; survives a2 recompiles
    if (frame.tw !== undefined) script.push(`D CPU TW ${oct(frame.tw)}`);
    if (frame.ss !== undefined) script.push(`D SS ${oct(frame.ss)}`);
    for (const [addr, val] of frame.deposits ?? []) script.push(`D ${oct(addr)} ${oct(val)}`);
    script.push('continue');
    if (frame.resumeHlt) {
      // The a4 score readout halts; SIMH returns control.  Resume after it.
      script.push(`D PC ${oct(ADDR.A4_RESUME)}`);
      if (frame.twAfterHlt !== undefined) script.push(`D CPU TW ${oct(frame.twAfterHlt)}`);
      script.push('continue');
    }
    if (frame.dump) {
      script.push('show cpu history');
      script.push(`set cpu history=${HIST_MAX}`);
    }
  }
  script.push('show cpu history');
  script.push('quit');

  const { stdout } = await runPdp1(script, { timeout });
  return { streams: splitHistoryDumps(stdout), lines: stdout.split('\n') };
}

/** Shorthand: n identical frames. */
export const rep = (n, frame = {}) => Array.from({ length: n }, () => ({ ...frame }));

// ─── Vector scenario (M-region branches via jda calls) ────────────────────────

/**
 * Drive the pure-math islands (sin/cos/mpy/imp/idv/dvd/sqt) through a stub in
 * free core, capturing history.  Inputs are chosen to resolve every skip site
 * in each routine both ways (quadrant reduction, sign handling, overflow).
 */
export async function runVectorScenario(rimPath) {
  // Free high core, same cells the M-ticket substrates use (07676-07721).
  const IN1 = 0o7676, IN2 = 0o7677, STUB = 0o7700;
  const HLT = 0o760400;
  const LAC = (cell) => 0o200000 | cell;
  const JDA = (entry) => 0o170000 | entry;
  const script = [
    `set cpu history=${HIST_MAX}`,
    `load ${rimPath}`,
  ];
  // 1-arg convention (sin/cos/sqt): lac IN1 / jda X / hlt.
  // 2-arg convention (mpy/imp/idv/dvd): lac IN1 / jda X / lac IN2 / hlt / hlt —
  // the routine xct's the "lac IN2" word to fetch its second operand, and
  // idv/dvd return to +1 (overflow) or +2 (normal).
  const call = (entry, a, b = null) => {
    script.push(`D ${oct(IN1)} ${oct(a)}`);
    script.push(`D ${oct(STUB)} ${oct(LAC(IN1))}`);
    script.push(`D ${oct(STUB + 1)} ${oct(JDA(entry))}`);
    if (b === null) {
      script.push(`D ${oct(STUB + 2)} ${oct(HLT)}`);
    } else {
      script.push(`D ${oct(IN2)} ${oct(b)}`);
      script.push(`D ${oct(STUB + 2)} ${oct(LAC(IN2))}`);
      script.push(`D ${oct(STUB + 3)} ${oct(HLT)}`);
      script.push(`D ${oct(STUB + 4)} ${oct(HLT)}`);
    }
    script.push(`run ${oct(STUB)}`);
  };

  // sin/cos: positive, negative, >2π (normalize loop), quadrant spread,
  // plus a band around ±π/2 (0o62210) where the Horner polynomial overshoots
  // |1.0| and the saturation-clamp arm (L232-238) fires.
  const angles = [0, 0o1000, 0o62210, 0o76540, 0o200000, 0o226630,
                  0o460000, 0o700000, 0o311041, 0o622102, 0o144420];
  for (let a = 0o62100; a <= 0o62320; a += 1) angles.push(a);              // +π/2 band
  for (let a = 0o226520; a <= 0o226740; a += 1) angles.push(a);            // 3π/2 band
  let sinceDump = 0;
  const dump = () => {
    script.push('show cpu history', `set cpu history=${HIST_MAX}`);
    sinceDump = 0;
  };
  for (const angle of angles) {
    call(ADDR.SIN, angle);
    call(ADDR.COS, angle);
    // ~2.5k instructions per sin/cos pair; dump well before the 65536-entry
    // circular buffer wraps and evicts earlier calls
    if (++sinceDump >= 8) dump();
  }
  // mpy/imp: sign pairs + zero
  for (const [a, b] of [
    [0o1234, 0o2345], [0o1234, 0o775432], [0o776543, 0o2345], [0o776543, 0o775432],
    [0, 0o5555], [0o377777, 0o377777],
  ]) {
    call(ADDR.MPY, a, b);
    call(ADDR.IMP, a, b);
  }
  // idv/dvd: sign pairs, exact zero remainder, divide-by-zero / overflow (dve arm)
  for (const [a, b] of [
    [0o10000, 0o123], [0o10000, 0o777654], [0o767777, 0o123], [0o767777, 0o777654],
    [0o10000, 0],                       // dve overflow / ÷0
    [0o123, 0o40000], [0o444444, 0o333333],
  ]) {
    call(ADDR.IDV, a, b);
    call(ADDR.DVD, a, b);
  }
  // sqt: zero, perfect square, non-square, max
  for (const v of [0, 4, 0o1234, 0o177777, 0o100000]) {
    call(ADDR.SQT, v);
  }
  script.push('show cpu history');
  script.push('quit');
  const { stdout } = await runPdp1(script, { timeout: 120_000 });
  return { streams: splitHistoryDumps(stdout), lines: stdout.split('\n') };
}

// ─── Synthetic outline compile (T-OC dark dispatch arm: code 2) ───────────────

/**
 * Compile a synthetic outline containing direction code 2 through the real
 * compiler entry (`law <target> / jda oc / <outline addr> / hlt`) — the real
 * outlines ot1/ot2 use codes {0,1,3,4,5,6,7} only, leaving the code-2
 * dispatch edge (oco → oc2) dark.  EPIC #5: "author a synthetic outline for
 * any dark arm."
 */
export async function runOcSyntheticScenario(rimPath) {
  const OUTLINE = 0o7600;      // synthetic outline words (free high core)
  const TARGET = 0o7400;       // compile target (free high core)
  const STUB = 0o7700;
  const script = [
    `set cpu history=${HIST_MAX}`,
    `load ${rimPath}`,
    // outline: codes 2,2,5,2,2,5 then terminator
    `D ${oct(OUTLINE)} 225225`,
    `D ${oct(OUTLINE + 1)} 700000`,
    // stub: law TARGET / jda oc / <outline addr> / hlt
    `D ${oct(STUB)} ${oct(0o700000 | TARGET)}`,
    `D ${oct(STUB + 1)} ${oct(0o170000 | 0o412)}`,
    `D ${oct(STUB + 2)} ${oct(OUTLINE)}`,
    `D ${oct(STUB + 3)} 760400`,
    `run ${oct(STUB)}`,
    'show cpu history',
    'quit',
  ];
  const { stdout } = await runPdp1(script, { timeout: 60_000 });
  return { streams: splitHistoryDumps(stdout), lines: stdout.split('\n') };
}

// ─── The union scenario set ───────────────────────────────────────────────────

/** Ones' complement negative of n as an 18-bit deposit word. */
export const NEG1 = (n) => (0o777777 - n) & 0o777777;

/**
 * The full pinned-input scenario set whose trace union satisfies the closure
 * gate.  Each scenario is deterministic (fixed seed, scripted per-frame
 * inputs/deposits) and returns { streams } — PC streams for CoverageGate.
 *
 * The set was grown empirically against the gate's dark list until closure:
 * every entry names the arms it exists to light.
 */
export function buildUnionScenarios(rimPath, iohAddrs) {
  const M = ADDR;
  return {
    // boot via loc 4 (a40 → a6 → a2; mg1 control-box source) + idle frames:
    // boot path, outline compile (both real outlines), display loops, gravity-on idle
    boot4: () => runFrames(rimPath, {
      entry: 4, tw: 0, ss: 0, iohAddrs,
      frames: rep(3, { dump: true }),
    }),

    // loc-5 boot (a1 → a; mg2 test-word source), ddd=+0 single-outline arm,
    // SSW6 on (gravity-off / star-display-off arms).  Own IOH scan: the
    // single-outline boot compiles different generated code.
    boot5single: async () => {
      const ioh5 = await scanIohAddrs(rimPath, { entry: 5, ss: ssMask(6), deposits: [[M.DDD, 0]] });
      return runFrames(rimPath, {
        entry: 5, tw: 0, ss: ssMask(6), iohAddrs: ioh5,
        deposits: [[M.DDD, 0]],
        frames: rep(3, { dump: true }),
      });
    },

    // rotation both directions, thrust, torpedo launch/reload/expiry→mex,
    // torps-exhausted arms, angle-normalize boundaries, last-object slot,
    // game-over by torpedo exhaustion, restart
    gameplay: () => runFrames(rimPath, {
      entry: 5, tw: 0, ss: 0, iohAddrs,
      frames: [
        {}, {},
        { tw: CTL.S1_CCW | CTL.S2_CCW }, {},
        { tw: CTL.S1_CW | CTL.S2_CW }, {},
        { tw: CTL.S1_THRUST | CTL.S2_THRUST }, {}, {}, { dump: true },
        { deposits: [[M.NTR, NEG1(2)], [M.NTR + 1, NEG1(2)]], tw: CTL.S1_FIRE | CTL.S2_FIRE },
        { tw: 0 },
        { deposits: [[M.NA1 + 2, NEG1(2)], [M.NA1 + 3, NEG1(2)]] },   // torp fuses → tcr → mex
        {}, {}, {}, { dump: true },
        { deposits: [[M.NA1, NEG1(1)], [M.NA1 + 1, NEG1(1)]], tw: CTL.S1_FIRE | CTL.S2_FIRE },
        { tw: 0 },
        { deposits: [[M.NA1 + 2, NEG1(2)], [M.NA1 + 3, NEG1(2)], [M.NA1, NEG1(1)], [M.NA1 + 1, NEG1(1)]] },
        { deposits: [[M.NTR, 0], [M.NTR + 1, NEG1(5)]] },             // ship1-only torps-out arm
        { deposits: [[M.NTH, 0o311100]] },                            // mth past +2π
        { deposits: [[M.NTH, 0o500000]] },                            // mth negative
        { deposits: [[M.MTB + 0o27, 0o2136], [M.NX1 + 0o27, 0o100000], [0o3605 + 0o27, 0o100000],
                     [M.NA1 + 0o27, NEG1(10)], [M.NB1 + 0o27, 0o10]] }, // last slot active
        {}, { dump: true },
        { tw: CTL.S1_FIRE | CTL.S2_FIRE },                            // exhausted vs launch
        { tw: 0o1400 },
        { deposits: [[M.NTR + 1, 0]] },                               // both exhausted → game over
        {}, { dump: true },
        { deposits: [[M.NTD, NEG1(2)]] },
        {}, {},
        { dump: true },
        {}, { dump: true },
      ],
    }),

    // ship2 dies alone (gravity capture, SSW5 explode): ml0-tail ship2 arm,
    // mixed score flags, match-count expiry with unequal scores → a4 hlt readout
    mixedDeath: () => runFrames(rimPath, {
      entry: 5, tw: 0, ss: ssMask(5), iohAddrs,
      frames: [
        {},
        { deposits: [[M.NX1 + 1, 0o1000], [M.NY1 + 1, 0o1000]] },
        {}, {}, {}, { dump: true },
        { deposits: [[M.NTD, NEG1(2)], [M.GCT, NEG1(1)], [M.SC1, 3], [M.SC2, 1]] },
        {}, { resumeHlt: true, dump: true },
        {}, { dump: true },
      ],
    }),

    ocSynth: () => runOcSyntheticScenario(rimPath),

    // near-miss then hit; explosion; dead-dead scoring; hlt readout both TW
    // arms; second round for the score-equal match-extension arm
    collision: () => runFrames(rimPath, {
      entry: 5, tw: 0o40, ss: 0, iohAddrs,
      frames: [
        {},
        { deposits: [[M.NX1 + 1, 0o205000], [M.NY1 + 1, 0o205000]] },   // near miss
        { deposits: [[M.NX1 + 1, 0o201000], [M.NY1 + 1, 0o201000]], dump: true }, // hit
        {}, {}, {}, {}, { dump: true },
        { deposits: [[M.NTD, NEG1(2)], [M.GCT, NEG1(2)], [M.SC1, 2], [M.SC2, 1]] },
        {}, { resumeHlt: true, twAfterHlt: 0o40, dump: true },
        {},
        { deposits: [[M.NX1 + 1, 0o201000], [M.NY1 + 1, 0o201000]] },
        {}, {}, {}, {},
        { deposits: [[M.NTD, NEG1(2)], [M.GCT, NEG1(1)], [M.SC1, 2], [M.SC2, 2]] },
        {}, { resumeHlt: true, twAfterHlt: 0, dump: true },
        {}, { dump: true },
      ],
    }),

    // hyperspace: hold both-rotate; accelerated timers every 3rd frame keep
    // the counting arms; first breakouts take the safe arm; from frame 12 the
    // seeded mh4 (0o337776 + hur → max positive) makes the next draw explode
    hyper: () => runFrames(rimPath, {
      entry: 5, tw: CTL.S1_CCW | CTL.S1_CW, ss: 0, iohAddrs,
      frames: Array.from({ length: 42 }, (_, i) => ({
        deposits: [
          ...(i % 3 === 0 ? [[M.NA1, NEG1(2)], [M.NH3, NEG1(2)]] : []),
          ...(i >= 12 ? [[M.NH4, 0o337776]] : []),
        ],
        dump: (i + 1) % 10 === 0,
      })),
    }),

    // second seed: diversifies the hp4 angle-normalize draws
    hyper2: () => runFrames(rimPath, {
      entry: 5, tw: CTL.S1_CCW | CTL.S1_CW, ss: 0, seed: 0o123456, iohAddrs,
      frames: Array.from({ length: 36 }, (_, i) => ({
        deposits: i % 3 === 0 ? [[M.NA1, NEG1(2)], [M.NH3, NEG1(2)]] : [],
        dump: (i + 1) % 12 === 0,
      })),
    }),

    // gravity: far shortcut arm, near division path, capture → pof vanish
    gravity: () => runFrames(rimPath, {
      entry: 5, tw: 0, ss: 0, iohAddrs,
      frames: [
        {},
        { deposits: [[M.NX1, 0o4000], [M.NY1, 0o4000]] },
        { deposits: [[M.NX1, 0o1000], [M.NY1, 0o1000]], dump: true },
        {}, { dump: true },
      ],
    }),

    // capture → pof explode (SSW5), light star (SSW2), gyro rotation (SSW1)
    gravityExplode: () => runFrames(rimPath, {
      entry: 5, tw: CTL.S1_CCW, ss: ssMask(1, 2, 5), iohAddrs,
      frames: [
        {},
        { deposits: [[M.NX1, 0o4000], [M.NY1, 0o4000]] },
        { deposits: [[M.NX1, 0o1000], [M.NY1, 0o1000]], dump: true },
        {}, {}, { dump: true },
      ],
    }),

    // thrust with fuel nearly out: fuel isp/sad/spi arms
    fuelout: () => runFrames(rimPath, {
      entry: 5, tw: CTL.S1_THRUST | CTL.S2_THRUST, ss: 0, iohAddrs,
      frames: [
        { deposits: [[M.NFU, NEG1(3)], [M.NFU + 1, NEG1(3)]] },
        {}, {}, {}, { dump: true },
      ],
    }),

    vectors: () => runVectorScenario(rimPath),
    backdisp: () => runBackdispScenario(rimPath, { iohAddrs }),

    // loc-4 boot with match-length TW bits: a6 nonzero arm → gct = -12,
    // then a collision game-over drives the match-count no-skip arm
    boot4match: () => runFrames(rimPath, {
      entry: 4, tw: 0o1400, ss: 0, iohAddrs,
      frames: [
        {},
        { deposits: [[M.NX1 + 1, 0o201000], [M.NY1 + 1, 0o201000]] },
        {}, {}, {}, {},
        { deposits: [[M.NTD, NEG1(2)]] },
        {}, {}, { dump: true },
        {}, { dump: true },
      ],
    }),
  };
}

/**
 * Contract scope for the closure gate: the executable partition segments of
 * EPIC #5 (source lines 63-1335).  Class-D data segments (T-CONST, T-OUTLINE,
 * T-STARMAP) are witnessed by listing↔core identity, not branch coverage —
 * data words there that happen to decode as skip instructions (65 in the star
 * map) are not decisions.
 */
export function filterContractListing(full) {
  const inContract = (line) => line >= 63 && line <= 1335;
  return {
    skipSites: new Map([...full.skipSites].filter(([, s]) => inContract(s.srcLine))),
    multiwayBranches: new Map([...full.multiwayBranches].filter(([, s]) => inContract(s.srcLine))),
    addrToSrcLine: full.addrToSrcLine,
  };
}

// ─── The outline-compiler dispatch (7-way computed GOTO at 00443) ─────────────
// Every realized arm must appear across the union: opr fall-through (444),
// oc1 (445), oc2 (446, lit only by the synthetic outline), oc3 (447),
// oc4 (450), oc5 (451), oc6 (452), terminator (453).
export const DISPATCH_ADDR = 0o443;
export const DISPATCH_ARMS = [0o444, 0o445, 0o446, 0o447, 0o450, 0o451, 0o452, 0o453];

// Correctly-dead PC blocks (ADR-0007): must never execute anywhere in the
// union.  Numeric entries are absolute addresses; `L<n>` / `L<a>-<b>` entries
// are resolved to addresses from the listing at check time.
export const DEAD_PC_BLOCKS = [
  ['sbf sequence-break flush', [0o61, 0o62, 0o63, 0o64, 0o65]],
  ['loc-3 reset vector', [0o3]],
  ['sr1 no-free-slot hlt/jmp .-1', 'L1250-1251'],
  ['mex mst+1 scr 3s', 'L983'],
  ['sin/cos saturation clamp', [0o134, 0o135, 0o136, 0o137, 0o140]],
];

/** Resolve a DEAD_PC_BLOCKS spec (address list or `L…`) to absolute addresses. */
export function resolveDeadBlock(spec, full) {
  if (Array.isArray(spec)) return spec;
  const addrsOfLine = (line) =>
    [...full.addrToSrcLine].filter(([, l]) => l === line).map(([a]) => a);
  const body = spec.replace('L', '');
  const lines = body.includes('-')
    ? body.split('-').map((n) => parseInt(n, 10))
    : [parseInt(body, 10)];
  return lines.flatMap((l) => addrsOfLine(l));
}

/**
 * Run the entire pinned-input scenario union LIVE against the Substrate and
 * close the gate.  This is the single code path shared by the hardened gate
 * test and the baseline generator — there is no second, divergent runner.
 *
 * Returns everything the gate/ratchet need to make assertions:
 *   { result, listing, full, allPcs, scenarioStats, iohCount, substrate }
 *
 * `result` is the CoverageGate.assertClosure() ledger; `allPcs` is the set of
 * every PC observed across the union (the execution-proof surface — a static
 * reimplementation produces ~0 of these).
 */
export async function runUnionClosure(rimPath, lstPath) {
  const listingText = await readFile(lstPath, 'utf8');
  const full = parseListingForMeter(listingText);
  const listing = filterContractListing(full);

  const gate = new CoverageGate(
    listing,
    buildUnionOneWayRegister(),
    buildDeadMultiwayRegister(),
    buildDeadSkipSiteRegister(),
  );

  const iohAddrs = await scanIohAddrs(rimPath);
  if (iohAddrs.length === 0) {
    throw new Error('IOH scan found no wait-class iot words — boot/compile did not run');
  }

  const scenarios = buildUnionScenarios(rimPath, iohAddrs);
  const scenarioStats = {};
  const allPcs = new Set();
  for (const [name, run] of Object.entries(scenarios)) {
    const { streams } = await run();
    if (streams.length === 0) throw new Error(`scenario ${name} produced no PC stream`);
    let pcs = 0;
    for (const s of streams) {
      gate.addTrace(s);
      pcs += s.length;
      for (const pc of s) allPcs.add(pc);
    }
    scenarioStats[name] = { streams: streams.length, pcs };
  }

  const result = gate.assertClosure();
  const substrate = await pdp1Version();
  return { result, listing, full, allPcs, scenarioStats, iohCount: iohAddrs.length, substrate };
}

// ─── Direct-entry background-display passes (from the merged T-BACKDISP set) ──

/**
 * Targeted bck passes for the rare EP arms (window wrap, busy flag), entered
 * directly at bck (01130) with seeded gate cells — the recipe of the merged
 * T-BACKDISP trace, kept as part of the union.
 */
export async function runBackdispScenario(rimPath, { iohAddrs = [] } = {}) {
  // A full EP frame walks all four brightness-group tables (~480 stars) —
  // the dim groups 3/4 only complete their first full circle (the flp
  // came-round-from-start arm) with a budget well past 10k steps.
  const PASS_STEPS = 25000;
  const passes = [
    { fpr: 0, ss: 0 },                       // baseline folding pass
    { fpr: 0, ss: ssMask(4) },               // SSW4 set: background suppressed
    { fpr: 0, ss: 0 },                       // second pass: bcc reseeded odd
    { fpr: 0, ss: 0, bkc: 0o777776 },        // bkc -2: window-advance arm
    { fpr: 0o7777, ss: 0 },                  // fpr near wrap: spa arm
    { fpr: 0o10000, ss: 0 },
    // fpr sweep across the WHOLE star map (transformed x spans 0-0o17777,
    // with the densest stars near the top) so each of the four dislis
    // expansions (window slots) sees stars on both sides of every compare
    ...[0o400, 0o1000, 0o2000, 0o3000, 0o4340, 0o5000, 0o6000, 0o7000, 0o7400,
        0o10000, 0o12000, 0o14000, 0o16000, 0o17000]
      .map((fpr) => ({ fpr, ss: 0, bkc: 0o777776, bcc: 0 })),
    // fine sweep over the dense top of the map + the 0o20000 sky-wrap
    ...Array.from({ length: 16 }, (_, i) => ({ fpr: 0o17400 + i * 0o40, ss: 0, bkc: 0o777776, bcc: 0 })),
  ];
  const script = [
    `load ${rimPath}`,
    `set cpu history=${HIST_MAX}`,
    // nop the wait-class iot words: a spinning ioh would otherwise consume
    // the whole step budget at the first star display
    ...iohAddrs.map((a) => `D ${oct(a)} ${oct(NOP_WORD)}`),
  ];
  for (const { fpr, ss, bcc, bkc } of passes) {
    script.push(`D 1443 ${oct(fpr)}`, `D SS ${oct(ss)}`);
    if (bcc !== undefined) script.push(`D 1441 ${oct(bcc)}`);
    if (bkc !== undefined) script.push(`D 1442 ${oct(bkc)}`);
    script.push('D AC 1134', 'D PC 1130', `step ${PASS_STEPS}`);
    // dump per pass — the union of all passes exceeds the history buffer
    script.push('show cpu history', `set cpu history=${HIST_MAX}`);
  }
  // Dedicated FRESH-state passes: each reloads the image (roving pointers
  // back to their table starts) and runs one EP frame.  A group's flp
  // came-round-from-start arm (sad fpo equal) fires only on a frame that
  // starts at the table head AND displays nothing — i.e. the window holds no
  // star of that group — so sweep fpr over fresh boots until each group hits
  // an empty window.
  // The came-round arm fires when the window [fpr-2000, fpr] covers exactly a
  // table's TAIL (lowest-x stars) without wrapping in its head: for group 4
  // (x spans 4..17777, descending in the table) that is fpr ≈ 0o2004.
  for (const fpr of [0, 0o1000, 0o2000, 0o2004, 0o2010, 0o2040, 0o2100, 0o2200,
                     0o3400, 0o5200, 0o6600, 0o11000,
                     0o13400, 0o15000, 0o16200, 0o17000, 0o17600]) {
    script.push(
      `load ${rimPath}`,
      ...iohAddrs.map((a) => `D ${oct(a)} ${oct(NOP_WORD)}`),
      `D 1443 ${oct(fpr)}`, 'D SS 0', 'D 1441 0',
      'D AC 1134', 'D PC 1130', 'step 20000',
      'show cpu history', `set cpu history=${HIST_MAX}`,
    );
  }
  script.push('quit');
  const { stdout } = await runPdp1(script, { timeout: 240_000 });
  return { streams: splitHistoryDumps(stdout), lines: stdout.split('\n') };
}
