# RUNS: the intent, as the Spacewar port found it

This is a working note from the first slice of a verbatim port of Spacewar! 3.1 to RUNS. The RUNS documents point in the right direction but are wrong in many details, so this note reasons from what RUNS is for and checks each claim against the running original.

## What RUNS is for

RUNS exists so that a game's rules outlive the machine they were written for. The source is a text that anyone can read, run, and change, and that any future runtime can rebuild into the same game.

Four requirements follow from that purpose:

1. **The text is the game.** It is deterministic and total, so every faithful runtime produces the same game. Nothing about the game may live only in a binary.
2. **Every rule can be swapped.** A rule is replaceable only if its whole contract is visible. A Processor's contract is the Records it reads and writes, and nothing else. A hidden channel, such as a register left set, a shared scratch word, or a patched instruction, would break every swap. That is why all data flows through Records.
3. **The structure is visible.** The order and the conditions under which rules fire are rules too. The Network writes them where anyone can see them and change them.
4. **Variation is native.** A house rule is an edit to one Processor or one Network line, not a fork of a program.

## The three parts

- **A Record** is anything the game remembers. Examples are the object table, the random number, the frame's time budget, and the tunables. There is no separate category for global data. A Record holds one value or a fixed-size collection.
- **A Processor** is one rule. It declares the Records it reads and the Records it writes. Inside its body it may compute freely, including updating those Records in place. Purity holds at the boundary: what the Processor does is a function of what it declares.
- **A Network** is the game's skeleton. It fires Processors and sub-Networks in order, chooses with guards that read Records, and iterates over bounded ranges. It computes nothing and writes nothing. Each value it moves between Processors goes through a Record.

A fourth kind came out of the port. **A function** touches no Record. It takes words and returns words. The arithmetic routines, the random number step, inertia, and the original's patchable tunables are functions. A Processor calls them, and they are swappable like anything else.

The evaluator in `tools/runs.py` enforces these rules. A function that touches a Record is an error. A Processor that reads or writes a Record it did not declare is an error. A Network that writes anything is an error.

## What the port showed

**The 1962 program is already shaped like RUNS.** The object table is a Record collection. Each calc routine is a Processor. The routine word in each slot names the rule that runs the object, which makes it a state. The main loop's jump through that word is a guarded dispatch on that state. The tunables that the original keeps as instructions to execute (`the`, `hd2`, `hr1`, and others) are the authors' own swap points.

**The Network holds gameplay, not plumbing.** The main loop decides who collides with whom and when. Object *i* is tested against every later colliding object and can explode both. Then *i*'s calc routine runs, in the same frame, on the changed state, before *i+1* is touched. The last slot is never tested and never counted. These are rules of the game. Moving the collision test into its own phase after all objects move, as an earlier conversion did, changes 294 of 300 test frames (`tools/check_frame.py` on a variant of `frame.runs`).

**Firing is sequential, and each write is seen at once.** A Network runs its Processors in declared order, and each one sees everything earlier ones wrote. That is how a Petri net fires, one transition at a time. Concurrency is a property a compiler may derive from the declared reads and writes. It is not part of the model, and assuming it would change Spacewar.

**The machine falls away.** Each PDP-1 device in the original maps to a RUNS form:

| In the original | In RUNS |
|---|---|
| Cursors kept in instruction address fields | The Network's slot index |
| `jsp` and `jda` calls | `run` a Processor, call a function |
| Values in AC and IO | Function arguments and results, and locals |
| The routine word's address plus its sign bit | An enum, and a `collides` function |
| A shift instruction built at run time and executed | A shift by a counted number of places |
| IO left over from the main loop in `in_hyperspace` | Nothing: the shifts push it all out (argued, then checked in place) |

**Exactness is about the game, and placement is about the machine.** The port keeps every word that carries meaning from one routine to another or from one frame to the next. That includes `objects_seen`, which is counted and never read, as a Record that no Processor reads. The graph shows that it is dead. Scratch words that a routine sets before it reads them, such as `sq1`, `sq2`, `mt1`, and `particles`, become locals. Machine-only words such as `mas`, a cursor that is stepped and never read, drop out. To rebuild the exact binary, a compiler needs a second artifact, the PDP-1 binding (`tools/pdp1.py` is its first form). The binding places Records in core, spells enum values as words, and lays out the scratch. It never carries a rule.

## The draft language

The syntax is a working draft. These are the forms this slice needed:

- `record name[N]` with typed fields and initial values, and `stream` for ordered output (the display's points).
- `enum`, and `match` over an enum in a Network. The evaluator checks that every member has an arm.
- In bodies: `let`, `set` (which updates a local or a declared Record field), `if`, `elif`, `else`, `loop at most N:` with `break`, `continue`, and `return`, and `emit`.
- In Networks: `run`, `if`, `for i in a .. b` (bounded and ascending, and the bounds may depend on an outer index), `match`, `stop`, and `unreachable`.
- `word` is the PDP-1's 18-bit ones' complement word. Add and subtract are the machine's. A word compares with 0 by its sign, and `==` compares all 18 bits.

Totality comes from the bound on each loop, not from forbidding `break`.

## Verified

Each check runs the RUNS source in the evaluator and SIMH running the oracle image on the same Records, and compares every field and every plotted point.

- `square_root`: all 65,536 inputs match (`tools/check_square_root.py`, against RUNS-Spacewar's observed vectors).
- `explosion`, `torpedo`, `in_hyperspace`, `breakout`: 3,000 calls each, all match, 6.1 million points (`tools/check_calc_routines.py`).
- The frame Network from `ml0` to `mq3`, covering the restart countdown, the object loop, collisions, and every ported calc routine: 1,500 frames, all match, with 4,343 collisions that hit (`tools/check_frame.py`).
- The checks fail when the source is wrong. Each mutation through `tools/mutate.sh` was caught: skipping adjacent collision tests, testing objects that do not collide, skipping slot 0, an off-by-one in the time charge, and a wrong torpedo explosion counter.

## Not yet ported

The spaceship calc routine, which covers gravity, thrust, the controls, torpedo launch, the jump into the compiled outline, and hyperspace entry. Also the outline compiler, the game control between games (scores, halts, and the test word), the Expensive Planetarium, the central star, and the sense switches. Then the compiler from RUNS plus the binding to the exact binary.
