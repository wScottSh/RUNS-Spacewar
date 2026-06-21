/**
 * Gate validator for the perfect-square oracle set.
 * Verifies exact-root property: each n² input yields exactly n in 9.9 fixed-point.
 */

/**
 * Validate that every record satisfies:
 *   ac === n × 512  (9.9 fixed-point: integer root in upper 9 bits)
 *   pc === haltPc   (stub+3 per SIMH fetch-before-execute)
 *
 * Throws with the witnessing case on first failure.
 * records: array of {n, nsq, ac, pc}
 */
export function gatePerfectSquares(records, haltPc = 0o7704) {
  for (const r of records) {
    const expectedAc = r.n * 512;
    if (r.ac !== expectedAc) {
      throw new Error(
        `gate FAIL: n=${r.n} n²=${r.nsq} ` +
        `expected AC=${expectedAc.toString(8).padStart(6, '0')} ` +
        `got ${r.ac.toString(8).padStart(6, '0')}`
      );
    }
    if (r.pc !== haltPc) {
      throw new Error(
        `gate FAIL: n=${r.n} n²=${r.nsq} ` +
        `expected PC=${haltPc.toString(8)} got ${r.pc.toString(8)}`
      );
    }
  }
}
