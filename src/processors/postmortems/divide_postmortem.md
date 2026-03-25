# Postmortem: divide

## Discrepancies Found

### 1. No Body Existed (STRUCTURAL)

The existing processor had "Body: deferred to Phase 4." The DIGS version implements the actual body.

### 2. L349 Comment Is Wrong (DOCUMENTATION)

The PDP-1 source comment at L349 states:
```
/returns quot in ac, rem in io.
```

But the actual return sequence (L392-395) is:
```
L392: lac idv    # AC = remainder
L395: lio dvd    # IO = quotient
```

The return is **remainder in AC, quotient in IO** — the opposite of what the comment says. The existing processor documentation (L88-91) correctly flagged this: "the calling convention here may differ from the L349 comment — trace carefully."

In RUNS, both are named outputs so the register assignment is irrelevant.

### 3. Two Entry Points Unified

The PDP-1 has `dvd` (34-bit dividend) and `idv` (18-bit sign-extended to 34-bit). The RUNS processor provides `dividend_high` and `dividend_low` inputs. Callers needing the `idv` behavior should set `dividend_high` to the sign extension. This accurately models both entry points without duplication.

## Surprising Findings

1. **The overflow check isn't defensive**: L374-376 (`sub idv; sma; jmp dve`) jumps to the error path if `mag_dividend_high >= mag_divisor`. This means the quotient would overflow 18 bits. The Spacewar! source NEVER triggers this — gravity divisions are always structured so the dividend is smaller. There's no error handling; the `dve` label just skips to return with undefined values.

2. **`dis` is the divide-step counterpart of `mus`**: Just as `mus` does one step of magnitude multiplication, `dis` does one step of restoring division. The `add idv` at L378 is the final "correction add" that restoring division needs — if the last subtraction went negative, add the divisor back to get the correct remainder.

3. **Sign correction is more complex than multiply**: The divide needs TWO sign corrections: one for the quotient (based on both operand signs) and one for the remainder (matching dividend sign only). The PDP-1 does this through a convoluted rcr swap/XOR sequence (L382-394) that tracks both original signs through the IO register.

4. **`scr 9s; scr 8s` for sign extension in idv**: The idv entry (L354-355) sign-extends an 18-bit value to 34 bits by shifting the combined AC+IO register right 17 positions (9+8). This fills the high word with copies of the sign bit. Elegant use of the PDP-1's combined register shifting.

## Sub-Processor Dependencies

None. Leaf-level primitive (counterpart to multiply).

## Test Vectors

### Vector 1: Simple positive ÷ positive

```
Input:
  dividend_high = 0, dividend_low = 100, divisor = 10
  mag_dividend = 0 * 131072 + 100 = 100
  mag_quotient = 100 / 10 = 10
  mag_remainder = 100 - 10*10 = 0
  signs_differ = false, dividend_sign = false

Output: quotient = 10, remainder = 0
```

### Vector 2: Negative ÷ positive

```
Input:
  dividend_high = -1 (all 1s = sign extension), dividend_low = -100, divisor = 10
  mag_high = 1, mag_low = 100
  mag_dividend = 1 * 131072 + 100 = 131172
  mag_quotient = 131172 / 10 = 13117
  mag_remainder = 131172 - 13117*10 = 2
  signs_differ = true

Output: quotient = -13117, remainder = -2
```

### Vector 3: Full 34-bit dividend

```
Input:
  dividend_high = 4, dividend_low = 0, divisor = 2
  mag_dividend = 4 * 131072 + 0 = 524288
  mag_quotient = 524288 / 2 = 262144
  mag_remainder = 0

Output: quotient = 262144, remainder = 0
```

### Vector 4: idv-style (18-bit dividend, sign-extended)

```
# Simulating idv entry: dividend = -50, sign-extended
Input:
  dividend_high = -1, dividend_low = -50, divisor = 7
  mag_high = 1, mag_low = 50
  mag_dividend = 131072 + 50 = 131122
  mag_quotient = 131122 / 7 = 18731
  mag_remainder = 131122 - 18731*7 = 5
  dividend_sign = true, signs_differ = false (both positive after ext?)

  Actually: dividend_high = -1 → dividend_sign = true
  divisor = 7 → divisor_sign = false
  signs_differ = true

Output: quotient = -18731, remainder = -5
```
