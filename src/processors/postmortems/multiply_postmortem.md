# Postmortem: multiply

## Discrepancies Found

### 1. No Body Existed (STRUCTURAL)

The existing processor had thorough algorithm documentation but "Body: deferred to Phase 4." The DIGS version implements the actual body.

### 2. imp Variant Not Modeled

The PDP-1 has two entry points: `mpy` (returns high word) and `imp` (returns low word). The existing processor spec declared both `high` and `low` outputs, which covers both entry points in a single processor. However, the existing documentation (L78) incorrectly stated "This is the variant used by the sin/cos `mult` macro (L195-198)" for the `imp` entry — the `mult` macro actually calls `mpy`, not `imp`. The sin/cos subroutine uses the HIGH word throughout.

## Surprising Findings

1. **DIGS `int` makes this clean**: The PDP-1 needs 21 `mus` (multiply step) instructions to build the product one bit at a time. In DIGS, the arbitrary-precision `int` type allows a single `mag_a * mag_b` that never overflows, then shift-and-mask to extract the words.

2. **The 34-bit product is 17+17 magnitude bits**: The PDP-1 has 18-bit words, but bit 17 is the sign bit. The magnitude is 17 bits, so the product is 17×17 = 34 significant bits, split across AC (high) and IO (low).

3. **Ones-complement negation of the 34-bit product**: The sign correction (L291-298) must complement BOTH the high and low words independently. In ones-complement, this means `~high` and `~low`, which is `-high` and `-low` in DIGS (since DIGS uses the unary `-` operator for complement on fixed-point types).

4. **The rcr 9s swap trick**: The PDP-1 swaps AC and IO by rotating the combined 36-bit register right by 18 positions (two `rcr 9s` = rotate combined right 18). This moves AC→IO and IO→AC. The BBN routine uses this four times during sign correction to complement each word independently.

## Sub-Processor Dependencies

None. This is a leaf-level primitive.

## Test Vectors

### Vector 1: Positive × Positive

```
Input: a = 1024, b = 1024
mag_a = 1024, mag_b = 1024
product = 1048576
high = 1048576 >> 17 = 8
low = 1048576 & 131071 = 0
signs_differ = false
Output: high = 8, low = 0
```

### Vector 2: Positive × Negative

```
Input: a = 1024, b = -512
mag_a = 1024, mag_b = 512
product = 524288
high = 524288 >> 17 = 4
low = 524288 & 131071 = 0
signs_differ = true
Output: high = -4, low = -0 (= 0 in ones-complement)
```

### Vector 3: Max positive × Max positive

```
Input: a = 131071 (377777₈), b = 131071
product = 131071² = 17179607041
high = 17179607041 >> 17 = 131070
low = 17179607041 & 131071 = 131071
Output: high = 131070, low = 131071
```

### Vector 4: Zero × anything

```
Input: a = 0, b = 83443
product = 0
Output: high = 0, low = 0
```
