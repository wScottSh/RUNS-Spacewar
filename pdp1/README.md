# The PDP-1 binding

`tools/runsc.py` compiles the RUNS text in `runs/` to the original Spacewar! 3.1 tape image. Each file here binds one unit of spacewar-c's `lift.toml`: it says how the PDP-1 carries the RUNS routines and fields of that unit. `runsc` emits spacewar-c's C dialect from the RUNS text and the binding, and spacewar-c's `pdp1cc` compiles that to the image. A unit with no binding here still comes from the lifted C.

## What a binding may say

A binding holds only choices that play cannot observe:

- **Tape order.** `[[place]]` entries in the order their words lie on the tape: a routine, or a list of Record fields.
- **Calling convention.** How a routine is entered and left: `JDA`, `JSP`, `BLOCK`, `XCT`, laid out in place, a skip return.
- **Storage.** Which register or word carries a value: an AC or IO local, a JDA entry word, a pool word, the address field of an instruction (a cursor), the word after a call (by name).
- **Layout of code.** Where a block of a routine's code lies when the original lays it out of order.
- **Names the lifted C still uses.** While a unit that refers to a name is still lifted C, the binding gives the C name. These go when the last such unit is ported.

## The vocabulary

A `[[place]]` with `fields` lays out those Record fields as data words, with their RUNS initial values. A `[[place]]` with `routine` compiles a Processor or a Network to one C function:

- `convention`: `JDA`, `JSP`, `XCT`, as spacewar-c's dialect spells it (`tools/pdp1cc/include/pdp1.h`). An `[[inline]]` entry takes the same keys and binds a macro: the routine is laid out at each run, as a `static inline` function of each unit that runs it, whichever binding binds it.
- `entry`: the field that is the JDA entry word, where the call leaves AC.
- `ac_param`: the field that arrives in AC, for a routine with no entry word (`XCT`).
- `byname`: the field that is the word after the call, executed each time it is read.
- `result`: the fields that hold the result when the routine returns: AC, then IO.
- `io_param`: the field that arrives in IO.
- `io`: locals and fields that live in IO. The rest live in AC or in a word of their own. A local set from a value already in IO is that value, with no move.
- `cells`: other fields that live in the routine's entry word.
- `skips`: a field and a member: the routine returns one word further when the field holds the member.
- `block`: the routine's body is a block that other routines of the unit jump into. The routine's own entry stores its entry word and jumps there too. A run of the routine as the last thing another routine of the unit does is that jump: the jumper stores the entry word, as jda would have.
- `block_takes_entry`: the block is entered with the entry word already in AC (`sin` loads it; `cos` jumps in past the load).
- `shifts = "xct"`: each shift of the routine is executed from a constant word (`xct (sar 3s`), as the `diff` macro runs the shift it is passed.
- `pool`: locals that live in a pool word (`\hpt`), not in AC.
- `loops = "exit first"`: each loop of the routine is laid out with its first exit falling through into the code after the loop, and the rest of its body after the routine's last return, jumping back to the top. When the loop's body ends with the statement that an `if` just before the loop runs, that statement is the loop's top, and the loop is entered there or one statement past it. It changes the order of the code, not what runs.

A Network bound as one routine runs its Processors inline, under its guards and loops. A `run` of another bound routine is a call: the sets of that routine's parameter fields just before the run are its arguments, and a parameter field that lives in a register is passed in it. A two-word result is read from the returned AC:IO pair. A one-word result is in AC when the call returns, so the statement right after the run takes it from there, as `xct hd2 / dac i ma1` does; when that statement does not read it, the call stands alone.

The keys that hold for a whole unit:

- `include`: lifted headers the generated C includes, for the names they declare (the cursors of `object_table.h`).
- `registers`: Records whose fields live in AC or IO, never in a word of their own (`handoff`). A field there is a local of the routine that uses it.
- `pool`: fields that live in a pool word (`\mxc`).
- `[cursors]`: a field to the cursor on the current object's slot. In a routine whose parameter is the slot the main loop's cursors point at, `objects.x[slot]` is `*x_slot`.
- `[homes]`: fields held in a shift instruction. `"table"`: a pointer in the address field of the `xct` that runs one shift of a table (`msh, xct .`); the table's entries are the counts the RUNS text sets the field to, in text order, and a `[[place]]` with `shifts` lays the table out. Setting the field to the next entry steps the pointer (`idx msh`), to the first sets it (`law mst / dap msh`). `"built"`: the shift instruction itself, built at run time from `popcount(w & m)` and run where it stands (`mi1`). The shift is the pair operator that takes the field as its count; the pair it shifts is one AC:IO local.
- `[spell.<enum>]`: the word each member is: a number, or a routine's address, with the sign bit when `sign` is set (the object does not collide).
- `[streams]`: the display instruction that plots a stream's points (`dpy`): x in AC, y in IO.

`runsc` lays code out by rules of its own, from the shape of the RUNS text, the same for every binding:

- A loop whose one exit is its last statement, `if c: break`, tests at the bottom and jumps back to the top while `c` fails (`count \mxc, mz1`).
- `set x = x + 1` followed by a test of `x` against 0 is one index-and-skip (`isp`).
- When an `if`'s else arm ends in an `if` whose arm ends with the statements of the first arm, those statements are laid out once, at the end of the inner arm, and the first arm jumps to them (`count i ma1, hp6`).
- `set a = -a` on an AC local followed by `set f = 0` on a place in IO is one instruction, `cma cli`.

A `[[place]]` may instead lay out words that the PDP-1 and its operator need and that no game rule reads. `runsc` knows each kind as the PDP-1 back end, the way it knows `jda`:

- `machine = "sequence break"`: words 0-2, where a sequence break saves AC, PC and IO (not punched), and word 3, a jump to the flush. `machine = "sequence break flush"`: the flush, which resumes the interrupted program. Play never raises a sequence break (spacewar-c's README: the frame check never runs these words).
- `jump`: a start address, a jump to the named routine. `start = true` makes it the tape's own start.
- `jsp_slot`: a JSP routine the operator may rewrite in place, laid out `at` an address. By default it jumps to `jump` and returns what that returns (`returns`: `ac` or `io`); `reserve` words of room follow it.

A field with no data word of its own (an entry word, a register) has no value on the tape, so its RUNS initial value must be 0; `runsc` refuses any other.

## Names the lifted C still uses

Lifted units call the ported routines by their C names. `runsc` names each C function after its RUNS routine, and the lifted names are the same: `square_root`, `multiply`, `integer_multiply`, `integer_divide`, `sine`, `cosine` and the twelve XCT tunables (`lift/spaceship.c`, `lift/main_loop.c`). A field's C name is `record_field`, unless the binding's `[names]` table gives the one the lifted units use (`tunables.collision_radius` is `collision_radius`). The routines a `jump` or `jsp_slot` names are the lifted main loop's. These names stop mattering when the last lifted unit that uses them is ported.

## What a binding may not say

No game logic. A binding has no expressions, no statements and no number that the game computes with. Every word of the image that the game's rules decide comes from the RUNS text. `tools/check_compiled.py` enforces this: it changes each number in each routine and field a binding compiles, and requires the image to change. A loop's bound is RUNS's own check; it compiles to nothing, and the tool lists it apart.

Where play observes the layout, the RUNS text states the layout, and the binding follows it (`INTENT.md`, "Exactness, glitches, and the machine").

## Checks for a ported unit

A unit counts as ported when all of these pass:

1. `uv run --project ../spacewar-c python tools/runsc.py` prints `MATCH`.
2. `uv run --project ../spacewar-c python tools/check_compiled.py` passes.
3. Each RUNS routine of the unit matches SIMH running the original, through the evaluator, over every input or a seeded random sample with the edge cases (`tools/check_*.py`).
4. The checks of earlier units still pass (`tools/check_all.sh`).
