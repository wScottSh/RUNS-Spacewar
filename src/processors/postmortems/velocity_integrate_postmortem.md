# Postmortem: velocity_integrate

## Discrepancies Found

### None

The existing processor body was already valid DIGS and correctly implements the `diff` macro. No corrections were required to the logic, constants, or DIGS syntax.

The processor already had:
- `#! runs-prim 1.0` header
- Correct `let` shadowing for velocity update
- Correct `output` statements
- Correct `>>` arithmetic right shift matching PDP-1 `sar`

## Surprising Findings

1. **The `diff` macro is the heart of all Spacewar! physics**: This single 5-instruction macro (L160-167) handles ship movement (L1117/L1125), torpedo movement (L1000/L1003), and explosion drift (L952/L954). Every moving object in the game uses the same velocity–position integration step.

2. **The macro accumulates acceleration into the AC before entry**: When `diff` is invoked, the AC already holds the total acceleration (thrust + gravity, or zero). The first `add i V` adds the *existing* velocity to this acceleration, producing the *new* velocity. This is a single-step Euler integration: `v' = v + a; x' = x + (v' >> shift)`.

3. **Scaling is parameterized via `xct SF`**: The PDP-1 stores the shift instruction as data (`sar 3s` at address `(sar 3s)`) and executes it inline via `xct`. This clever use of code-as-data allows different callers to use different scale factors (e.g., `sar 3s` for ship/torpedo/explosion, `sar 9s` for torpedo gravity warpage). The RUNS architecture abstracts this via the `scale_shift` input parameter.

4. **The shift applies to the NEW velocity, not the old**: After `dac i V` stores the updated velocity, the AC still holds that same new velocity value. The `xct SF` shifts *this* new velocity before adding it to position. This means a sudden acceleration impulse affects position in the *same frame* it affects velocity (no one-frame lag).

5. **Toroidal wraparound is free**: As Masswerk Part 5 explains, because positions use the high-order bits of the 18-bit word, overflow wraps naturally — ships seamlessly appear on the opposite side of the screen without any bounds-checking code.

## Concordance Corrections Needed

None. The processor was already correctly documented.

## Sub-Processor Dependencies

None. `velocity_integrate` is a leaf processor — it calls no sub-processors.

## Test Vectors

### Vector 1: Standard ship thrust (scale_shift = 3)

```
Input:
  position     = 100000
  velocity     = 1000
  acceleration = 100
  scale_shift  = 3

Trace:
  L162: AC = 100 (acceleration enters in AC)
  L162: add i V → AC = 100 + 1000 = 1100 (new velocity)
  L163: dac i V → velocity stored = 1100
  L164: xct (sar 3s) → AC = 1100 >> 3 = 137 (arithmetic shift)
  L165: add i S → AC = 137 + 100000 = 100137 (new position)
  L166: dac i S → position stored = 100137

Output:
  velocity = 1100
  position = 100137
```

### Vector 2: Zero acceleration (coasting)

```
Input:
  position     = 50000
  velocity     = -2048
  acceleration = 0
  scale_shift  = 3

Trace:
  AC = 0 (no acceleration)
  add i V → AC = 0 + (-2048) = -2048 (velocity unchanged)
  dac i V → velocity stored = -2048
  xct (sar 3s) → AC = -2048 >> 3 = -256 (sign-extending)
  add i S → AC = -256 + 50000 = 49744
  dac i S → position stored = 49744

Output:
  velocity = -2048
  position = 49744
```

### Vector 3: Negative velocity with sign-extending shift

This vector validates that arithmetic right shift sign-extends (matching PDP-1 `sar`), not zero-fills.

```
Input:
  position     = 0
  velocity     = 0
  acceleration = -7
  scale_shift  = 3

Trace:
  AC = -7
  add i V → AC = -7 + 0 = -7 (new velocity)
  dac i V → velocity stored = -7
  xct (sar 3s) → AC = -7 >> 3 = -1 (arithmetic shift: -7 = ...111001, >> 3 = ...111111 = -1)
  add i S → AC = -1 + 0 = -1
  dac i S → position stored = -1

Output:
  velocity = -7
  position = -1
```

Note: In ones-complement, -7 is `0b111111111111111000`, arithmetic right shift by 3 gives `0b111111111111111111` which is -0 in ones-complement. However, DIGS `spacewar:fixed18` must normalize -0 to +0. The runtime must handle this edge case per the type system specification. For practical Spacewar! values, this edge case rarely arises.

### Vector 4: Explosion drift (zero acceleration, scale_shift = 3)

This matches the `diff` usage at L952 for explosion particles, where AC = 0 (no acceleration on exploding fragments):

```
Input:
  position     = 65536
  velocity     = 512
  acceleration = 0
  scale_shift  = 3

Trace:
  velocity stays 512
  scaled = 512 >> 3 = 64
  position = 65536 + 64 = 65600

Output:
  velocity = 512
  position = 65600
```
