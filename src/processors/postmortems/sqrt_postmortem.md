# sqrt Postmortem

## Discrepancies Found

### 1. Iteration Count: "23 fixed steps" → 18 iterations

The existing processor header stated "Iterative algorithm with 23 fixed steps." This was **incorrect**.

**Old processor (wrong):**
> Iterative algorithm with 23 fixed steps.

**PDP-1 source (L311):**
```
law i 23
```

**Resolution:** In PDP-1 MACRO assembly, numeric literals are **octal by default**. So `23₈ = 19₁₀`. The `law i 23` instruction loads -19₁₀ into the accumulator. Per Masswerk's annotation (line 683): *"load 23 (number of digits to produce + 1)"* — meaning 19 - 1 = **18 result digits**. This matches Masswerk's pseudocode exactly: `for (i = 0; i < 18; i++)`.

The previous agent read the octal literal `23` as decimal 23 and wrote "23 fixed steps."

### 2. Source Line Range: L304-343 (correct, but refined)

The existing processor listed "Source: L304-343" which is correct for the entire subroutine. More precisely:
- L304-307: Comments (header, calling convention, precision)
- L309-315: Entry and initialization
- L317-320: Loop control (isp/jmp/lac/jmp return)
- L322-340: Loop body (the actual algorithm)
- L342-343: Private storage (sq1 counter, sq2 result)

### 3. Algorithm description was pseudo-code, not DIGS

The existing body said "Body: deferred to Phase 4 (expression language design)." The body has now been implemented in valid DIGS.

### 4. sma+sza-skip Combined Instruction (L334)

The PDP-1 instruction `sma+sza-skip` at L334 skips the next instruction if AC ≤ 0 (i.e., AC < 0 OR AC == 0). The preceding `sub sqt` computes `divisor - remainder`. So the skip condition is `divisor ≤ remainder` (divisor fits).

When the skip is taken (divisor ≤ remainder), the subsequent instructions (L336-338) compute the absolute value of (divisor - remainder) for the new remainder:
- L336: `spa` — skip `cma` if already positive (exact fit: remainder = divisor)
- L337: `cma` — negate (ones-complement) if negative: |divisor - remainder| = remainder - divisor

Both paths produce `remainder - divisor` (since divisor ≤ remainder guarantees this is non-negative). This is correctly expressed in DIGS as `t - d`.

## Surprising Findings

### 1. Elegant Binary Square Root

The binary digit-by-digit square root is dramatically simpler than its decimal counterpart. Masswerk explains: "Amazingly, there is no need for guesses and backtracking with binary numbers: Since q is either 1 or 0, the divisor will either fit into the remainder or not." The entire algorithm uses only shifts, additions, subtractions, and comparisons — no multiplication or division.

### 2. The rcl 2s Dual-Function

The `rcl 2s` instruction (L326) serves two purposes simultaneously:
1. Shifts the remainder left by 2 (making room for new bits)
2. Shifts 2 bits from IO (the input) into the bottom of AC (the remainder)

This combined 36-bit rotation is the most elegant instruction in the routine. In DIGS, this is decomposed into explicit bit extraction: `(remainder << 2) | ((num >> 16) & 3)`.

### 3. Remainder Preservation on Zero Shortcut

When `sza i` (L327) detects that the combined remainder+new_bits is zero, the jump to `sq3` (L328) occurs BEFORE `dac sqt` (L329). This means the PDP-1 `sqt` memory location retains its old value. In the DIGS expression, this is modeled by `if t == 0 then remainder` (preserving the previous remainder binding).

### 4. The "Number of Digits + 1" Pattern

Masswerk annotates the loop count as "number of digits to produce + 1." The `isp` instruction's semantics (increment, skip if result > 0) means the counter transitions from -19 through 0, with the body executing for each non-positive value after increment. The "+1" accounts for the -0 → +1 transition in ones-complement that triggers the skip. This is a standard PDP-1 loop pattern documented across Masswerk's analysis.

## Concordance Corrections Needed

1. **No corrections identified.** The sqrt processor was previously just a stub ("Body: deferred to Phase 4"). No other documentation in the repo contains specific claims about the sqrt algorithm that would need correction.

## Sub-Processor Dependencies

- **None.** The sqrt algorithm uses only arithmetic operations available directly in DIGS (shifts, additions, subtractions, comparisons). It does not call any sub-processors.

## Test Vectors

### Test 1: sqrt(0) = 0
- **Input:** value = 0
- **Expected:** root = 0
- **Rationale:** All `t` values are 0 on every iteration (no bits in input). Result stays 0 throughout. Confirmed by existing processor header: "Input = 0: ... Result: 0. Correct."

### Test 2: sqrt(4) = 1024 (= 2 × 512)
- **Input:** value = 4 (0o000004)
- **Expected:** root = 1024 (0o002000)
- **Hand trace:** Input bit at position 15. First non-zero `t` at iteration 7 where pair (bits 14,15) = 01. Result set to 1 at iteration 7, then shifted left 10 more times (iterations 8-17). Final: 1 × 2^10 = 1024.
- **Verification:** √4 = 2, scaled by 512 → 1024. ✓

### Test 3: sqrt(1) = 512 (= 1 × 512)
- **Input:** value = 1 (0o000001)
- **Expected:** root = 512 (0o001000)
- **Hand trace:** Input bit at position 17 (LSB). First non-zero `t` at iteration 8 (pair covers bits 16,17 = 01). Result = 1 at iteration 8, shifted left 9 more times (iterations 9-17). Final: 1 × 2^9 = 512.
- **Verification:** √1 = 1, scaled by 512 → 512. ✓

### Test 4: sqrt(65535) (maximum valid input)
- **Input:** value = 65535 = 0o177777 (all 17 data bits set)
- **Expected:** root ≈ √65535 × 512 ≈ 255.999 × 512 ≈ 130,815
- **Rationale:** The input is dense (all bits set), exercising every branch. The result should be close to 255 × 512 = 130,560 (exact √65535 ≈ 255.9980).
- **Note:** Exact value requires running the algorithm; this is an approximate bound for automated test verification.

### Test 5: sqrt(16) = 2048 (= 4 × 512)
- **Input:** value = 16 = 0o000020
- **Expected:** root = 2048 (0o004000)
- **Verification:** √16 = 4, scaled by 512 → 2048. ✓
