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
- **A Network** is the game's skeleton. It fires Processors and sub-Networks in order, chooses with guards that read Records, and iterates with bounds. It computes nothing and writes nothing. Each value it moves between Processors goes through a Record.

The topology is a Petri net. Records are the places and Processors are the transitions. No value flows from one transition straight into another. An earlier draft had a fourth kind, the function, which took words and returned words. A Processor called it, so a value went from one rule to another as a call and a return, with no place in between. That broke the topology, and functions are gone. The only calls left are the word's own operators, such as `rcl`, `scr` and `popcount`.

The evaluator in `tools/runs.py` enforces these rules before anything runs. A call of anything but a word operator is an error. A Processor that fires a routine is an error. A Network with `let`, `set`, `emit` or `return` is an error, and so is a Network loop without a guarded exit. While the game runs, a Processor that reads or writes a Record it did not declare is an error.

## How the original's routines map

The original passes values between routines in AC and IO, and that is what had made functions look natural. Each of its three ways of sharing a rule now becomes Processors and places.

- **A subroutine** (`jda sqt`) is a Processor over the routine's own words. `jda` leaves the argument in the entry word `sqt`, and the routine leaves the root in `sq2`, so `square_root` reads `square_root_call.entry` and writes `square_root_call.root`. The scratch words `sq1` and `sq2` are fields of the same Record, because they are the routine's places in the original too.
- **A tunable executed with `xct`** (`the`, `hd2`, `hd3`, `hr1`, `hr2`, `tlf`) is a Processor of its own. What it takes from AC and IO and what it leaves there are fields of the `handoff` Record. A routine that executed one becomes a Network: a Processor sets the input, the tunable fires, and a Processor uses the output. An operator can still patch the rule and not only the number.
- **A macro** (`random`, `diff`) is a Processor too. `random` updates `random.number` in place. `diff` reads its acceleration from `handoff.acceleration` and moves one axis of one object, so it is two Processors, `inertia_x` and `inertia_y`. A loop that runs a macro moves up into the Network. The explosion's dot loop is the case in this slice.

`handoff` holds only values that the original carried in a register from one rule to the next. Each field names the register and the instruction in a comment. A value that a Processor computes and uses itself stays a local. A word that the original keeps in core between two rules is a Record field named for what it means, such as `explosion_cloud.particles` (`mxc`).

Splitting a routine at each macro or tunable leaves its skips in the Network. Each guard tests what the original's skip tests. `count i ma1, tc1` becomes `run count_down(slot)` followed by `if objects.counter[slot] >= 0:`.

## What the port showed

**The 1962 program is already shaped like RUNS.** The object table is a Record collection. Each calc routine is a Processor. The routine word in each slot names the rule that runs the object, which makes it a state. The main loop's jump through that word is a guarded dispatch on that state. The tunables that the original keeps as instructions to execute (`the`, `hd2`, `hr1`, and others) are the authors' own swap points.

**The Network holds gameplay, not plumbing.** The main loop decides who collides with whom and when. Object *i* is tested against every later colliding object and can explode both. Then *i*'s calc routine runs, in the same frame, on the changed state, before *i+1* is touched. The last slot is never tested and never counted. These are rules of the game. Moving the collision test into its own phase after all objects move, as an earlier conversion did, changes 294 of 300 test frames (`tools/check_frame.py` on a variant of `frame.runs`).

**Firing is sequential, and each write is seen at once.** A Network runs its Processors in declared order, and each one sees everything earlier ones wrote. That is how a Petri net fires, one transition at a time. Concurrency is a property a compiler may derive from the declared reads and writes. It is not part of the model, and assuming it would change Spacewar.

**The machine falls away.** Each PDP-1 device in the original maps to a RUNS form:

| In the original | In RUNS |
|---|---|
| Cursors kept in instruction address fields | The Network's slot index |
| `jsp` and `jda` calls, `xct` of a tunable, a macro | `run` a Processor or a sub-Network |
| Values in AC and IO | Locals inside a Processor; between Processors, a field of `handoff` |
| A routine's own scratch words (`sq1`, `mxc`) when they pass between Processors | Record fields |
| The routine word's address plus its sign bit | An enum, and a guard that compares it with `explosion` and `in_hyperspace` |
| A shift instruction built at run time and executed | A shift by a counted number of places |
| IO left over from the main loop in `in_hyperspace` | Nothing: the shifts push it all out (argued, then checked in place) |

**Exactness is about the game, and placement is about the machine.** The port keeps every word that carries meaning from one routine to another or from one frame to the next. That includes `objects_seen`, which is counted and never read, as a Record that no Processor reads. The graph shows that it is dead. A value that one Processor sets before it reads it and never hands on becomes a local, such as the dot's coordinates in `plot_particle`. Machine-only words such as `mas`, a cursor that is stepped and never read, drop out. To rebuild the exact binary, a compiler needs a second artifact, the PDP-1 binding (`tools/pdp1.py` is its first form). The binding places Records in core, spells enum values as words, and lays out the scratch. It never carries a rule.

## The draft language

The syntax is a working draft. These are the forms this slice needed:

- `record name[N]` with typed fields and initial values, and `stream` for ordered output (the display's points).
- `enum`, and `match` over an enum in a Network. The evaluator checks that every member has an arm.
- In bodies: `let`, `set` (which updates a local or a declared Record field), `if`, `elif`, `else`, `loop at most N:` with `break`, `continue`, and `return`, and `emit`.
- In Networks: `run`, `if`, `for i in a .. b` (bounded and ascending, and the bounds may depend on an outer index), `match`, `stop`, `unreachable`, and `requires:`.
- The Network loop, `loop at most N:`. Its body fires and chooses like any Network body, and it must hold an `if <guard>: break` among its own statements. The guard reads Records that the Processors in the body write. The loop runs its body, in order, until a guard breaks. Running past N passes is an error, as it is in a Processor. The explosion's dot loop is the form:

  ```
  loop at most 0400001:                                     # mz1
    run next_random
    run scatter_particle
    run next_random
    run plot_particle(slot)
    if explosion_cloud.particles >= 0:                      # count \mxc, mz1
      break
  ```
- `word` is the PDP-1's 18-bit ones' complement word. Add and subtract are the machine's. A word compares with 0 by its sign, and `==` compares all 18 bits.

Totality comes from the bound on each loop, not from forbidding `break`.

## Verified

Each check runs the RUNS source in the evaluator and SIMH running the oracle image on the same Records, and compares every field and every plotted point.

- `square_root`, the Processor over its own words: all 65,536 inputs match (`tools/check_square_root.py`, against RUNS-Spacewar's observed vectors).
- The Networks `explosion`, `torpedo`, `in_hyperspace`, `breakout`: 3,000 calls each, all match, 6.1 million points (`tools/check_calc_routines.py`).
- The frame Network from `ml0` to `mq3`, covering the restart countdown, the object loop, collisions, and every ported calc routine: 1,500 frames, all match, with 4,343 collisions that hit (`tools/check_frame.py`).
- The checks fail when the source is wrong. Each mutation through `tools/mutate.sh` was caught: skipping adjacent collision tests, testing objects that do not collide, skipping slot 0, an off-by-one in the time charge, a wrong torpedo explosion counter, and dropping the second `random` from the explosion's dot loop.

## Not yet ported

The spaceship calc routine, which covers gravity, thrust, the controls, torpedo launch, the jump into the compiled outline, and hyperspace entry. Also the outline compiler, the game control between games (scores, halts, and the test word), the Expensive Planetarium, the central star, and the sense switches. Then the compiler from RUNS plus the binding to the exact binary.
