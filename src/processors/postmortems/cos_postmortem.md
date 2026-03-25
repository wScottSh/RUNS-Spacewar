# Postmortem: cos

## Discrepancies Found

### 1. No Body Existed (STRUCTURAL)

The existing processor had documentation only — "Body: deferred to Phase 4 (expression language design)." There was no pseudo-code to compare against, only the algorithm description documented in the header comments. The DIGS version implements the actual body.

### 2. π/2 Constant Verification

The existing documentation states `pi_half = 62210₈ = 25736₁₀`. Verified:

```
6×8⁴ + 2×8³ + 2×8² + 1×8¹ + 0×8⁰
= 6×4096 + 2×512 + 2×64 + 1×8 + 0
= 24576 + 1024 + 128 + 8
= 25736₁₀ ✓
```

In angle units (binary point right of bit 3), this represents approximately π/2:
- Full circle = 2π = 2 × 25736 × 2 = 102944₁₀ = 311040₈ ≈ 2π
- Check: 102944 / (2^15) × 8 = 102944 / 32768 × 8 ≈ 25.1... 
- Actually, with binary point right of bit 3: value = 25736 / 2^(18-3-1) = 25736 / 16384 ≈ 1.5707... ≈ π/2 ✓

### 3. Secondary Output (.sin) Reliability Concern

The PDP-1 cos entry point stores the shifted angle in the `sin` memory location (L204), which is then OVERWRITTEN during polynomial evaluation (L219, L228). The return sequence at L240 loads `lac cos`, which was used as scratch (L221, L224, L226, L230). 

The values left in the `sin` and `cos` memory locations after the subroutine are polynomial intermediates, not guaranteed to be sin and cos of the shifted angle. Only the value in AC (the primary result) is reliable.

In RUNS, the `spacewar:sin` processor's outputs are formal and reliable (both `.sin` and `.cos`), so this PDP-1 limitation is abstracted away.

## Surprising Findings

1. **cos is pure syntactic sugar**: The entire cos routine is 6 instructions (L200-205). It adds π/2, stores the result at sin's entry point, and jumps into sin's normalization. No new computation.

2. **The jmp .+4 skips sin's entry sequence**: L205 jumps to L209 (`lac sin`), bypassing sin's `dap csx` (L208) — because cos already saved the return address at L201. Both entry points share the single return address storage at `csx`.

3. **The `mult` macro calling convention is unusual**: `jda mpy` stores the first factor and `lac Z` (in the return position) loads the second factor. The multiply subroutine uses `xct` on the return address to execute the `lac Z` instruction. This is a clever trick to pass two arguments with minimal overhead.

## Sub-Processor Dependencies

- **spacewar:sin**: The sole dependency. cos is a thin wrapper.

## Test Vectors

### Vector 1: cos(0) = sin(π/2) = 1.0

```
Input:
  angle = 0

Expected:
  shifted_angle = 0 + 25736 = 25736
  result = spacewar:sin(25736)
  cos = result.sin ≈ 377777₈ (max positive = 1.0 in fixed-point)
```

### Vector 2: cos(π/2) = sin(π) = 0.0

```
Input:
  angle = 25736 (π/2)

Expected:
  shifted_angle = 25736 + 25736 = 51472 (π)
  result = spacewar:sin(51472)
  cos = result.sin ≈ 0
```

### Vector 3: cos(π) = sin(3π/2) = -1.0

```
Input:
  angle = 51472 (π)

Expected:
  shifted_angle = 51472 + 25736 = 77208 (3π/2)
  result = spacewar:sin(77208)
  cos = result.sin ≈ 400000₈ (max negative ≈ -1.0)
```
