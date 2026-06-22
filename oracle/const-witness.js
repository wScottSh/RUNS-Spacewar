/**
 * Expected constant cell table for T-CONST witness (source lines 70–97).
 *
 * Each entry is one cell from the tunable-constants block (tno…ran).
 * addr and word are JS integers (use .toString(8) for octal display).
 *
 * xct=true: the cell holds an instruction executed via `xct` in consuming
 * routines (tno, tvl, rlt, tlf, sac, the, mhs, hd1, hd2, hd3, hr1, hr2 — each
 * reached only via xct, never read as a data operand). Their effect is
 * exercised by the Traces that xct them, not here. Witnessed as words only.
 *
 * Values are taken verbatim from the macro1 listing (build/spacewar31.lst).
 * Listing format: <line> <addr_octal> <word_octal> <source text>
 */
export const CONSTANTS = [
  // name   addr      word       xct    listing note
  { name: 'tno', addr: 0o006, word: 0o710041, xct: true,  note: 'law i 41  — number of torps + 1' },
  { name: 'tvl', addr: 0o007, word: 0o675017, xct: true,  note: 'sar 4s    — torpedo velocity' },
  { name: 'rlt', addr: 0o010, word: 0o710020, xct: true,  note: 'law i 20  — torpedo reload time' },
  { name: 'tlf', addr: 0o011, word: 0o710140, xct: true,  note: 'law i 140 — torpedo life' },
  { name: 'foo', addr: 0o012, word: 0o757777, xct: false, note: '-20000    — fuel supply' },
  { name: 'maa', addr: 0o013, word: 0o000010, xct: false, note: '10        — spaceship angular acceleration' },
  { name: 'sac', addr: 0o014, word: 0o675017, xct: true,  note: 'sar 4s    — spaceship acceleration' },
  { name: 'str', addr: 0o015, word: 0o000001, xct: false, note: '1         — star capture radius' },
  { name: 'me1', addr: 0o016, word: 0o006000, xct: false, note: '6000      — collision radius' },
  { name: 'me2', addr: 0o017, word: 0o003000, xct: false, note: '3000      — collision radius / 2' },
  { name: 'ddd', addr: 0o020, word: 0o777777, xct: false, note: '-0        — 0 / space for ddt (777777)' },
  { name: 'the', addr: 0o021, word: 0o675777, xct: true,  note: 'sar 9s    — torpedo space warpage (null under default)' },
  { name: 'mhs', addr: 0o022, word: 0o710010, xct: true,  note: 'law i 10  — number of hyperspace shots' },
  { name: 'hd1', addr: 0o023, word: 0o710040, xct: true,  note: 'law i 40  — time in hyperspace before breakout' },
  { name: 'hd2', addr: 0o024, word: 0o710100, xct: true,  note: 'law i 100 — time in hyperspace breakout' },
  { name: 'hd3', addr: 0o025, word: 0o710200, xct: true,  note: 'law i 200 — time to recharge hyperfield generators' },
  { name: 'hr1', addr: 0o026, word: 0o667777, xct: true,  note: 'scl 9s    — scale on hyperspatial displacement' },
  { name: 'hr2', addr: 0o027, word: 0o667017, xct: true,  note: 'scl 4s    — scale on hyperspatially induced velocity' },
  { name: 'hur', addr: 0o030, word: 0o040000, xct: false, note: '40000     — hyperspatial uncertainty' },
  { name: 'ran', addr: 0o031, word: 0o000000, xct: false, note: '0         — PRNG seed (initial value)' },
];
