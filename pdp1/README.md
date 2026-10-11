# The PDP-1 binding

`tools/runsc.py` compiles the RUNS text in `runs/` to the original Spacewar! 3.1 tape image. Each file here binds one unit of spacewar-c's `lift.toml`: it says how the PDP-1 carries the RUNS routines and fields of that unit. `runsc` emits spacewar-c's C dialect from the RUNS text and the binding, and spacewar-c's `pdp1cc` compiles that to the image. A unit with no binding here still comes from the lifted C.

## What a binding may say

A binding holds only choices that play cannot observe:

- **Tape order.** `[[place]]` entries in the order their words lie on the tape: a routine, or a list of Record fields.
- **Calling convention.** How a routine is entered and left: `JDA`, `JSP`, `BLOCK`, `XCT`, laid out in place, a skip return.
- **Storage.** Which register or word carries a value: an AC or IO local, a JDA entry word, a pool word, the address field of an instruction (a cursor).
- **Layout of code.** Where a block of a routine's code lies when the original lays it out of order.
- **Names the lifted C still uses.** While a unit that refers to a name is still lifted C, the binding gives the C name. These go when the last such unit is ported.

## What a binding may not say

No game logic. A binding has no expressions, no statements and no number that the game computes with. Every word of the image that the game's rules decide comes from the RUNS text. `tools/check_compiled.py` enforces this: it changes each number in each routine and field a binding compiles, and requires the image to change. A loop's bound is RUNS's own check; it compiles to nothing, and the tool lists it apart.

Where play observes the layout, the RUNS text states the layout, and the binding follows it (`INTENT.md`, "Exactness, glitches, and the machine").

## Checks for a ported unit

A unit counts as ported when all of these pass:

1. `uv run --project ../spacewar-c python tools/runsc.py` prints `MATCH`.
2. `uv run --project ../spacewar-c python tools/check_compiled.py` passes.
3. Each RUNS routine of the unit matches SIMH running the original, through the evaluator, over every input or a seeded random sample with the edge cases (`tools/check_*.py`).
4. The checks of earlier units still pass (`tools/check_all.sh`).
