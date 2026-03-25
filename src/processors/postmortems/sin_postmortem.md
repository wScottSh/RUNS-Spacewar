# Postmortem: sin

## cos/sin Redundancy Assessment

**cos and sin are NOT redundant. They are correct and complementary.**

In the PDP-1, the sin/cos subroutine has **two entry points sharing one body**:
- `sin` (L207): entry point for sine. Computes sin(θ).
- `cos` (L200): adds π/2 to argument, stores at sin's address, jumps into sin's normalization. Effectively computes sin(θ + π/2) = cos(θ).

In RUNS, this is correctly modeled as two processors:
- `spacewar:sin` — the full polynomial computation
- `spacewar:cos` — thin wrapper: `sin(angle + pi_half)`

The `cos` processor calls `sin` as a sub-processor (via `spacewar:sin(shifted_angle)`). This mirrors the PDP-1's fall-through architecture. There is no redundancy — `cos` has no polynomial code of its own.

**No action needed.** The current split is faithful to the PDP-1 architecture.

## Discrepancies Found

### 1. No Body Existed (STRUCTURAL)

The existing processor had detailed algorithmic documentation but the body was "deferred to Phase 4 (expression language design)." The DIGS version implements the actual body.

### 2. Coefficient Sign Interpretation (NEEDS VERIFICATION)

The polynomial coefficients are stored as raw PDP-1 18-bit ones-complement words. Some are negative in ones-complement:

| Coefficient | Octal | Decimal (raw) | Ones-complement value |
|------------|-------|---------------|----------------------|
| c0 | 242763₈ | 83,443 | +83,443 (positive, bit 17 = 0) |
| c1 | 756103₈ | 252,995 | Bit 17 = 1 → negative: -(262143 - 252995) = **-9,148** |
| c2 | 121312₈ | 41,674 | +41,674 |
| c3 | 532511₈ | 177,481 | Bit 17 = 1 → negative: -(262143 - 177481) = **-84,662** |
| c4 | 144417₈ | 51,471 | +51,471 |

The `mpy` subroutine handles sign explicitly (L276-277 complement negative factors, L287-290 correct product sign). So in DIGS, these coefficients MUST be stored as their ones-complement signed values, not raw unsigned.

**The DIGS body currently stores them as raw decimal.** This needs verification: the `spacewar:multiply` processor must handle sign the same way as `mpy`, or the coefficients need to be stored as their signed values (-9148 for c1, -84662 for c3).

### 3. Quadrant Normalization Simplification

The PDP-1's quadrant reduction (L210-215, L243-254) uses a complex cascade of add/sub/cma/jmp with 6+ branches. The DIGS version uses a clean 4-branch conditional (Q1/Q2/Q3/Q4) that's mathematically equivalent but structurally different from the PDP-1's control flow.

This is acceptable — the quadrant normalization is an algorithm choice, not a bit-exact hardware behavior. The final polynomial and sign correction produce the same result for the same first-quadrant angle.

### 4. cos Output Semantics

In the PDP-1, the `cos` memory location is used as scratch during the polynomial (L221: x² stored there, L230: final result stored there). After return, callers can access this via `lac cos` (L240). It's NOT the mathematical cosine — it's the last polynomial intermediate before sign correction.

The DIGS version outputs `cos = poly_scaled` to match this behavior. Callers who need real cosine must use `spacewar:cos`.

## Surprising Findings

1. **The polynomial is degree 7 in a, NOT degree 4**: The existing docs say "4th-degree Chebyshev." But the actual polynomial is: `P(a) = a * (c4 + c3*a² + c2*a⁴ + c1*a⁶)` which expands to `c4*a + c3*a³ + c2*a⁵ + c1*a⁷`. This is a **7th-degree odd polynomial** in a, evaluated using **3 multiplies by a²** (Horner's on the even-power variable u=a²), plus one final multiply by a. The "4th degree" refers to the degree in u, not in a.

2. **a = x * c0 is a pre-scaling**: The first coefficient isn't added — it's **multiplied** into the variable. This maps the first-quadrant angle [0, π/2) into the range where the Chebyshev coefficients are optimized.

3. **The `scl 3s` at L229 is a COMBINED rotate**: `scl` rotates the combined AC+IO register left. This shifts the 36-bit product left 3 bits, effectively scaling the result by 8. This compensates for the binary point differences between the angle representation (bp@3) and the result representation (bp@0).

4. **The XOR sign check (L231) catches polynomial overflow**: The polynomial approximation can slightly exceed 1.0 at quadrant boundaries. The XOR with the original value detects when the result's sign doesn't match expectations and clamps to ±377777₈.

## Sub-Processor Dependencies

- **spacewar:multiply** (5 calls): Used for all polynomial multiplications.

## Test Vectors

### Vector 1: sin(0) = 0

```
Input: angle = 0
Quadrant: Q1 (0 < π/2), x = 0, negate = false
x_scaled = 0 << 2 = 0
a = multiply(0, c0).high = 0
All polynomial terms → 0
sin = 0
```

### Vector 2: sin(π/2) ≈ 1.0

```
Input: angle = 25736 (= π/2 = 62210₈)
Quadrant: Q1 (barely < π/2? or Q2 boundary)
Expected: sin ≈ 377777₈ = 131071 (max positive)
```

### Vector 3: sin(π) = 0

```
Input: angle = 51472 (= π = 144420₈)
Quadrant: Q3 boundary → x ≈ 0, negate = true
Expected: sin = -0 ≈ 0
```
