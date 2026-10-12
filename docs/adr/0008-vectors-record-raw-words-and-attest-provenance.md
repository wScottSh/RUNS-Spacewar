# Vectors record raw machine words and attest their own provenance

Status: accepted

A Vector record asserts **raw 18-bit machine words**, never an interpreted value. For
`sqt` each record is three octal words:

```jsonl
{"in": "<input>", "ac": "<AC at halt>", "pc": "<halt-PC>"}
```

- `ac` is the asserted output — the AC word at halt, the value the *caller* receives
  under `jda` (the `mem[sqt]` copy is corroboration at calibration only, not a field).
- `pc` is the return-sanity witness (= `stub+2`).

The fixed-point reading of the answer ("binary point between bits 8 and 9") is
documented **once**, never stored as the assertion. A Realization must reproduce the
*bits*; storing a decimal would weld a Translator-class interpretation into the
contract.

Provenance lives **once per file**, not per record — a lean manifest carrying only what a
future reader needs to *reproduce or distrust* the set:

- routine name + entry PC (`sqt` @ `0246`);
- **Image identity** — a hash of the `.rim` plus the ADR-0006 listing↔core cross-check
  status, binding the Vectors to the specific assembled core that produced them;
- domain `0..0177777` (the ADR-0007 game-scoped bound);
- tool versions (`macro1`, `pdp1`/SIMH build).

The manifest is deliberately *small*. It does not carry a calibration case or a
convention-reveal result — that apparatus was armor for a derivation error the method does
not make (ADR-0009, amended). Provenance binds the set to a reproducible core and toolchain;
it does not re-litigate how a value was read, because the value is the raw observed word.

## Why

"Nothing asserted, everything checked" applies to the Vector file itself. Raw words
keep the contract at the bit level where reproduction is actually defined. The manifest
makes the set self-justifying and reproducible — bound to a specific core and toolchain,
scoped to the ADR-0007 game domain — so a future reader can re-derive it or distrust it on
evidence, never on faith. Per-record minimalism and per-file attestation are not in
tension: provenance lives once, the 65,536 records stay lean.

## Revisit trigger

If a Realization is ever defined against an interpreted (decimal/fixed-point) form
rather than the raw word, or if the per-file manifest proves insufficient to reproduce
a set (e.g. an undiscovered tool nondeterminism surfaces), tighten this and supersede.
