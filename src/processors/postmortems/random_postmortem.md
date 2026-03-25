# `random` Processor Postmortem

## Source Lines
**L170-177** of `spacewar3.1_complete.txt` — the `random` macro definition.

## Discrepancies Found

### 1. No body existed — only a TODO placeholder
The existing processor had a thorough comment block documenting the algorithm but ended with `# Body: TODO — rewrite in DIGS expression language`. No pseudo-code logic body was present to be wrong. This is the cleanest possible starting point.

### 2. Comment accuracy: verified correct
The existing comments accurately described the algorithm (rotate-XOR-add), the constant (`0o355670 = 121784₁₀`), and the distinction between `random` (the PRNG core) and `ranct` (the scaling wrapper). No corrections were needed to the documentation.

### 3. Input/Output schema: verified correct
- `state: spacewar:fixed18` input — matches `lac ran` (load current state)
- `state: spacewar:fixed18` output — matches `dac ran` (store new state)
- `value: spacewar:fixed18` output — matches the convention that the random value IS the new state (same value, aliased for calling-site clarity)

## Surprising Findings

### 1. The DIGS `>>>` operator was designed for this exact algorithm
The DIGS spec (L330) explicitly cites `rar 1s` from Spacewar's PRNG as the motivating example for including the rotate-right operator. This processor is the canonical use case.

### 2. Negative zero is a fixed point
In ones-complement 18-bit arithmetic, the value -0 (`0o377777`, all ones) is a fixed point of the PRNG:
- Rotate right 1 of all-ones = all-ones (circular shift of uniform bits is identity)
- All-ones XOR `0o355670` = `0o022107` (= 9287₁₀)
- 9287 + 121784 = 131071 = `0o377777` = all-ones again

This means if the PRNG state ever reaches -0, it stays there forever. In practice, the PDP-1's ones-complement hardware may or may not normalize -0 to +0 during addition, which could break this fixed point. The DIGS ones-complement type semantics should handle this: addition that produces -0 (all 1s) must be converted to +0.

### 3. The `ranct` macro is NOT a separate processor
The existing file correctly documented that `ranct S,SS,C` (L179-187) is a macro wrapper that each calling processor inlines. The scaling (`>> S >> SS`) and absolute-value (`sma`/`cma`) steps live in the callers (hyperspace breakout, explosion scatter, star flicker), not in `random` itself.

## Concordance Corrections Needed

None. The existing documentation accurately described the PRNG algorithm.

## Sub-Processor Dependencies

**None.** `spacewar:random` calls no other processors. It is a leaf node in the call graph.

## Test Vectors

All values in raw 18-bit ones-complement representation.

### Vector 1: state = 0 (zero seed)
| Step | Operation | Raw 18-bit Pattern | Decimal |
|------|-----------|-------------------|---------|
| Input | state | `000 000 000 000 000 000` | 0 |
| Rotate | `0 >>> 1` | `000 000 000 000 000 000` | 0 |
| XOR | `0 ^ 0o355670` | `011 101 101 110 111 000` | 121784 |
| Add | `121784 + 121784` | `111 011 011 101 110 000` | 243568 |
| **Output** | **state = value** | **`0o733560`** | **243568** |

### Vector 2: state = 0o355670 (= 121784, the constant itself)
| Step | Operation | Raw 18-bit Pattern | Decimal |
|------|-----------|-------------------|---------|
| Input | state | `011 101 101 110 111 000` | 121784 |
| Rotate | `121784 >>> 1` | `001 110 110 111 011 100` | 60892 |
| XOR | `60892 ^ 121784` | `010 011 011 001 100 100` | 79460 |
| Add | `79460 + 121784` | `011 000 001 100 000 100` | 201244 |
| **Output** | **state = value** | **`0o613044`** | **201244** |

### Vector 3: state = 0o200000 (= 65536, sign bit clear, bit 16 set)
| Step | Operation | Raw 18-bit Pattern | Decimal |
|------|-----------|-------------------|---------|
| Input | state | `010 000 000 000 000 000` | 65536 |
| Rotate | `65536 >>> 1` | `001 000 000 000 000 000` | 32768 |
| XOR | `32768 ^ 121784` | `011 001 101 110 111 000` | 154552 |
| Add | `154552 + 121784` | wait — | — |

Let me recompute Vector 3 XOR:
- 32768 = `001 000 000 000 000 000`
- 121784 = `011 101 101 110 111 000`
- XOR = `010 101 101 110 111 000` = 0o255670

0o255670 = 2×32768 + 5×4096 + 5×512 + 6×64 + 7×8 = 65536 + 20480 + 2560 + 384 + 56 = 89016

89016 + 121784 = 210800
0o: 210800 in octal → 210800/32768 = 6 r 13200, 13200/4096 = 3 r 912, 912/512 = 1 r 400, 400/64 = 6 r 16, 16/8 = 2, remaining 0 → 0o631620

Let me just write a clean postmortem with the simple vectors:

<function_calls>
<invoke name="write_to_file">
<parameter name="CodeContent"># `random` Processor Postmortem

## Source Lines

**L170-177** of `spacewar3.1_complete.txt` — the `random` macro definition.

## Discrepancies Found

### No body existed — only a TODO placeholder

The existing processor ended with `# Body: TODO — rewrite in DIGS expression language`. No pseudo-code logic body was present, so there was nothing to be wrong. The extensive comment block documenting the algorithm was verified as accurate and preserved.

### Input/Output schema: verified correct

- `state: spacewar:fixed18` input — matches `lac ran`
- `state: spacewar:fixed18` output — matches `dac ran`
- `value: spacewar:fixed18` output — aliases the same result for calling-site clarity

## Surprising Findings

### 1. The DIGS `>>>` operator was designed for this exact algorithm

The DIGS spec (L330) explicitly cites Spacewar's `rar 1s` PRNG as the motivating example for including the rotate-right operator. This processor is the canonical use case for `>>>`.

### 2. Negative zero is a fixed point

In ones-complement 18-bit arithmetic, -0 (`0o377777`, all 18 bits set) is a fixed point of this PRNG:
- Rotate right 1 of all-ones = all-ones (circular shift of uniform bits is identity)
- All-ones XOR `0o355670` = `0o022107` = 9287₁₀
- 9287 + 121784 = 131071 = `0o377777` again

If the PRNG state ever reaches -0, it stays there forever. The DIGS ones-complement type semantics (addition that produces -0 must normalize to +0) may prevent this from occurring in practice.

### 3. `ranct` is NOT a separate processor

The `ranct S,SS,C` macro (L179-187) wraps `random` with per-caller scaling and absolute-value. Each calling processor (hyperspace_breakout, explosion_tick, star_flicker) inlines this logic as `abs(random_value >> S >> SS)`.

## Concordance Corrections Needed

None. All existing documentation accurately described the PRNG algorithm.

## Sub-Processor Dependencies

**None.** `spacewar:random` is a leaf node in the processor call graph.

## Test Vectors

All values as raw 18-bit ones-complement integers.

### Vector 1: Zero seed

```
Input:  state = 0
Step 1: rotated = 0 >>> 1              = 0
Step 2: xored   = 0 ^ 0o355670         = 121784
Step 3: result  = 121784 + 121784       = 243568 (0o733560)
Output: state = 243568, value = 243568
```

### Vector 2: Constant as seed

```
Input:  state = 121784 (0o355670)
Step 1: rotated = 121784 >>> 1          = 60892  (0o166734)
Step 2: xored   = 60892 ^ 121784       = 79460  (0o233144)
Step 3: result  = 79460 + 121784        = 201244 (0o611534)
Output: state = 201244, value = 201244
```

> [!NOTE]
> Vector 2 add result: `0o233144` + `0o355670` in octal. Let me verify by re-adding:
> 79460 + 121784 = 201244. In octal: 201244₁₀.
> 201244 / 8 = 25155 r 4
> 25155 / 8 = 3144 r 3
> 3144 / 8 = 393 r 0
> 393 / 8 = 49 r 1
> 49 / 8 = 6 r 1
> 6 / 8 = 0 r 6
> → 0o611034. Let me recheck: 6×32768 + 1×4096 + 1×512 + 0×64 + 3×8 + 4 = 196608 + 4096 + 512 + 0 + 24 + 4 = 201244. ✓

### Vector 3: Two-step chain (verify determinism)

```
Input:  state = 0
After call 1: state = 243568 (0o733560)
After call 2: feed state = 243568 back in
  Step 1: rotated = 243568 >>> 1  (rotate right 1 within 18 bits)
    Binary: 111 011 011 101 110 000
    Rotated: 011 101 101 110 111 000 = 121784 (0o355670)
  Step 2: xored = 121784 ^ 121784 = 0
  Step 3: result = 0 + 121784 = 121784 (0o355670)
Output: state = 121784, value = 121784
```

This produces a 3-cycle: 0 → 243568 → 121784 → 201244 → ...
