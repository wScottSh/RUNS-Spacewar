# RUNS: the intent, as the Spacewar port found it

This is a working note from a verbatim port of Spacewar! 3.1 to RUNS. The RUNS documents point in the right direction but are wrong in many details, so this note reasons from what RUNS is for and checks each claim against the running original. It records what the port and the design discussion have settled so far.

## What RUNS is for

RUNS exists so that a game's rules outlive the machine they were written for. The source is a text that anyone can read, run, and change, and that any future runtime can rebuild into the same game.

Five requirements follow from that purpose:

1. **The game is ported exactly, warts and all.** Every sequence of inputs from power-on must give the same game. That includes every glitch play can reach, because a glitch is part of the game. A re-release of Super Mario 64 without the backwards long jump would not be Super Mario 64. A port never changes the game to fit RUNS. Where RUNS cannot yet say what the game does, RUNS grows.
2. **The text is the game.** It is deterministic and total, so every faithful runtime produces the same game. Nothing about the game may live only in a binary.
3. **Every rule can be swapped.** A rule is replaceable only if its whole contract is visible. A Processor's contract is the Records it reads and writes, and nothing else. A hidden channel, such as a register left set, a shared scratch word, or a patched instruction, would break every swap. That is why all data flows through Records.
4. **The structure is visible.** The order and the conditions under which rules fire are rules too. The Network writes them where anyone can see them and change them.
5. **Variation is native.** A house rule is an edit to one Processor or one Network line, not a fork of a program.

## The three parts

- **A Record** is anything the game remembers. Examples are the object table, the random number, the frame's time budget, and the tunables. There is no separate category for global data. A Record holds one value or a fixed-size collection.
- **A Processor** is one rule. It declares the Records it reads and the Records it writes. Inside its body it may compute freely, including updating those Records in place. Purity holds at the boundary: what the Processor does is a function of what it declares.
- **A Network** is the game's skeleton. It fires Processors and sub-Networks in order, chooses with guards, and iterates with bounds. It writes nothing. A guard is any expression over Records that writes nothing, arithmetic included, in the Records' own types. Each value the Network moves between Processors goes through a Record.

The topology is a Petri net. Records are the places and Processors are the transitions. No value flows from one transition straight into another. An earlier draft had a fourth kind, the function, which took words and returned words. A Processor called it, so a value went from one rule to another as a call and a return, with no place in between. That broke the topology, and functions are gone. The only calls left are the word's own operators, such as `rcl`, `scr` and `popcount`. Call syntax for writers, if it comes, belongs to tools that write RUNS, not to RUNS.

A Network can state a contract the way a Processor does, with `reads:` and `writes:`. The Records it declares cross its boundary. Every other Record its Processors touch is its own. A top Network, one that nothing fires, is a whole game, and it must state its contract: that contract is the game's boundary with presentation.

The evaluator in `tools/runs.py` enforces these rules before anything runs. A call of anything but a word operator is an error. A Processor that fires a routine is an error. A Network with `let`, `set`, `emit` or `return` is an error, and so is a Network loop without a guarded exit. A Network whose Processors write a stream, or touch a Record that Processors outside it touch, must declare it. While the game runs, a Processor that reads or writes a Record it did not declare is an error.

## Gameplay and presentation

Games outlive their hardware only if the boundary between the game and its presentation is thin. Presentation is the screen, the sound, the controls, the pacing, and the machine underneath. It can be rebuilt for each platform. The game cannot.

What decides which side a piece of code is on is what its effects reach, not what it was written for. Code is presentation only if nothing in the game can observe its effects. The game touches the machine in only four ways:

1. **A value comes in**: the controls, a clock, the network, the contents of core at power-on. It is a Record the boundary declares.
2. **A value goes out**: a point to plot, a sound to play. It is a Record or stream the boundary declares.
3. **The machine computes something the rules then read.** The PDP-1 wraps a sum around, a video chip latches a collision, a draw routine works out where a sword is. That computation is a rule of the game, and it moves inside the game. Ocarina of Time's `Player_PostLimbDrawGameplay` (`src/code/z_player_lib.c:1657` in the decomp) computes Link's body part positions and his sword's collider quads from the draw matrices, so part of its drawing is gameplay.
4. **Timing**: how long a frame takes, which thread ran first. Where the game's state depends on it, it becomes a rule (Spacewar's `cycles` estimates are one: they set how long an explosion lasts) or a value that comes in.

Only the third could widen the boundary, and it is always resolved by moving the computation into the game. So the boundary grows in data, such as a longer list of points, but never in kinds of thing.

Spacewar shows the split in its own code (read in spacewar-c's lift):

- The central star is presentation, but it draws two random numbers each frame (`lift/heavens.c:35`, `:73`) from the generator that also decides hyperspace jumps and whether a ship survives breaking out (`lift/objects.c:117`, `:126`, `:167`). Sense switch 6, which turns the star off, changes hyperspace. The star's two draws are a game rule; the line it draws from them is presentation.
- The explosion's dots draw two random numbers each (`lift/objects.c:55-56`). The draws are a game rule; the dots are presentation, and they leave through the `display` stream.
- The exhaust flame draws a random number of dots, and each dot burns a unit of fuel (`lift/spaceship.c:232`, `:243`). The count and the fuel are the game; the dots are presentation.
- The ship outlines and the Expensive Planetarium are presentation. The planetarium draws no random numbers (`lift/heavens.c`), and a torpedo's launch point is computed before the outline is drawn (`lift/spaceship.c:198-201`).
- The spare-time loop is pacing. `begin_frame` sets the frame's budget, `charge_time` and `spare_time` alone use it, and nothing in the game reads it after (`runs/frame.runs-prim`; inferred from the ported slice, not yet from the whole game).

The port is still verbatim: presentation code stays where the original runs it, in the order it runs. The split says which of its effects the game must keep.

## Exactness, glitches, and the machine

A glitch is one of three kinds, by what it reads.

1. **A logic glitch** is the game's own logic, such as the backwards long jump. A verbatim port keeps it with no extra work. Spacewar has one: the previous control word is never stored, so with sense switch 3 on the fire button always counts as newly pressed (`lift/spaceship.c`, the torpedo code). The port will keep it.
2. **A layout glitch** reads past an array, through a stale pointer, or one kind of object as another: DOOM's `spechit` overflow, Ocarina of Time's stale reference manipulation. In those states the rule is whatever lies next in memory, so the layout is part of the game. Where play reads the layout, the RUNS text states it.
3. **A machine glitch** runs data as code, or jumps into the middle of a routine: arbitrary code execution. On that path the rule is that the machine runs those bytes. Exactness means the original machine's instruction semantics are part of the game, used only where play reaches them, and the original code bytes are part of the game's data.

These share one piece: a description of the original machine. It already supplies RUNS's types (the PDP-1's 18-bit ones' complement word). Where play reads the layout, it supplies the layout. Where play runs into machine behavior, it supplies the instruction semantics. The rest of the game is RUNS.

The binding to a target machine holds only the choices play cannot observe. Where the game states a layout, the binding follows it.

A halt or a hang the original reaches is a rule, not an error. Spacewar halts when a ship fires and the object table is full (`lift/spaceship.c`, the `hlt` loop after the search for a free slot). A loop bound or a `requires` that fails in the evaluator means the port is wrong, never that the game may do anything.

Which Records need a layout stated, and where play runs into the machine, is a fact about play, not a guess. `tools/reach_oracle.py` measures it.

## Where play reaches the machine in Spacewar

`tools/reach_oracle.py` runs the oracle image in SIMH through spacewar-c's seventeen scripted matches (real play from the start address, every sense switch setting, the full object table), 9,649 stops and 59 million instructions. It names every data access by the Record field or label it lands in, and lists each site where play depends on the PDP-1 rather than on a stated rule. It checks itself: its copy of core matches SIMH's at the end of every scenario, and its model of every add, subtract, shift and rotate (5.97 million of them) matches the AC SIMH shows after each. The full report is `docs/reach-oracle.txt`.

| What it finds | Where | What it means for the port |
|---|---|---|
| One instruction reads several places | 31 sites. The outline compiler and the compiled outlines; the planetarium's star display; `clear mtb, nnn-1`; `mot`. | The first two are presentation. `clear` zeroes every table in one loop over contiguous core, and play sees only the zeros. `mot, lac .` (source line 865) reads `not+slot` for every colliding object, so for torpedoes it reads past the 2-word outline array into `nco`, `nh1` .. `nh4` and the compiled outline code. The value goes to `sp5`, which only the spaceship calc routine uses, and slots 0 and 1 set it right before (`lift/main_loop.c:307`). Inferred: play never observes it. The spaceship port's checks will confirm or refute it. |
| Reads of core the tape never loaded | `1sc`, `2sc`, `gct`, `moc`, `mas` | The scores and the game count start from whatever core held at power-on. The scores are cleared only after a match's scores are shown (source lines 784-785), and the first match's tie test (`lac 1sc; sas 2sc`, lines 768-769) and game count (`lac gct`, line 764) read them. So their starting values come in at the boundary. `moc` (`frame.objects_seen`) and `mas` are counted and never read. |
| Code the program writes, then runs | the compiled outlines (684 words); `mi1` | Outlines are presentation. `mi1` is the explosion's `scl`, built from a random number; the port states it as a rule (`popcount`) and the checks match it. |
| Code read as data | `mot`'s reads into the compiled outlines | The same `mot` read as above. |
| Jumps to unnamed places | none, other than returns from a call | |
| Halts | `sr1+6` (line 1250), the full object table | A rule, ported with the spaceship. |
| The word's machine behavior | 730 sites | All of it is the `word` type's semantics, which RUNS already states. Positions wrap around the screen in the inertia (`diff`, lines 1000-1003, 1178-1186), hyperspace jumps (1022-1025) and the explosion's dots (973-975), and the collision test's distance wraps (`mx2, sub .`, line 871, 23,520 times): the screen is a torus because the word wraps. The random generator wraps by design. Shifts of negative numbers round toward zero, and some tests see minus zero. A compiler for another machine must give the `word` these semantics. |

So far no layout read that play observes has turned up. The power-on words are the one place Spacewar's play reaches the machine outside the `word` type.

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

**The machine falls away where play does not reach it.** Each PDP-1 device in the original maps to a RUNS form:

| In the original | In RUNS |
|---|---|
| Cursors kept in instruction address fields | The Network's slot index |
| `jsp` and `jda` calls, `xct` of a tunable, a macro | `run` a Processor or a sub-Network |
| Values in AC and IO | Locals inside a Processor; between Processors, a field of `handoff` |
| A routine's own scratch words (`sq1`, `mxc`) when they pass between Processors | Record fields |
| The routine word's address plus its sign bit | An enum, and a guard that compares it with `explosion` and `in_hyperspace` |
| A shift instruction built at run time and executed | A shift by a counted number of places |
| IO left over from the main loop in `in_hyperspace` | Nothing: the shifts push it all out (argued, then checked in place) |

The cursors are layout the program uses but play never observes; `tools/reach_oracle.py` counts 54 of them.

**Exactness is about the game, and placement is about the machine.** The port keeps every word that carries meaning from one routine to another or from one frame to the next. That includes `objects_seen`, which is counted and never read, as a Record that no Processor reads. The graph shows that it is dead. A value that one Processor sets before it reads it and never hands on becomes a local, such as the dot's coordinates in `plot_particle`. Machine-only words such as `mas`, a cursor that is stepped and never read, drop out. To rebuild the exact binary, a compiler needs a second artifact, the PDP-1 binding (`tools/pdp1.py` is its first form). The binding places Records in core, spells enum values as words, and lays out the scratch. It holds only what play cannot observe.

## The draft language

The syntax is a working draft. These are the forms this slice needed:

- `record name[N]` with typed fields and initial values, and `stream` for ordered output (the display's points).
- `enum`, and `match` over an enum in a Network. The evaluator checks that every member has an arm.
- In bodies: `let`, `set` (which updates a local or a declared Record field), `if`, `elif`, `else`, `loop at most N:` with `break`, `continue`, and `return`, and `emit`.
- In Networks: `run`, `if`, `for i in a .. b` (bounded and ascending, and the bounds may depend on an outer index), `match`, `stop`, `unreachable`, `requires:`, and the contract, `reads:` and `writes:`. A guard is any expression that writes nothing; `breakout`'s `if (random.number | 0400000) + ships.uncertainty[slot] >= 0:` is one.
- The Network loop, `loop at most N:`. Its body fires and chooses like any Network body, and it must hold an `if <guard>: break` among its own statements. The guard reads Records that the Processors in the body write. The loop runs its body, in order, until a guard breaks. Running past N passes means the port is wrong, as it does in a Processor. The explosion's dot loop is the form:

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

## Decisions that other games force

A swarm stress-tested this draft against Super Mario Bros., DOOM, Ocarina of Time, Journey and an Unreal Engine game (the analysts worked from memory of those games; their claims are not checked). Where it stands:

| Question | Where it stands |
|---|---|
| What comes into the game | The top Network's contract declares it. |
| Arithmetic in guards | Allowed; a guard writes nothing. |
| Call syntax | Not in RUNS; tools may offer it. |
| Layout | Stated in the text where play reads it; the binding holds the rest. |
| Crashes and hangs the original reaches | Rules. |
| Objects made and freed at run time, and references to them | The game's own allocator is ported. A stale reference does what the stated layout says. |
| Recursion | A stack Record and a bounded Network loop; a stack that overflows is layout. |
| Floating point | Types of the original machine, as `word` is. Library math is code, ported as Processors. |
| Assets | AEMS, a separate protocol. |
| Versions | Each version is its own game. |
| Code with no source | Ported from its machine code. |
| Running data as code | The original machine's instruction semantics, where play reaches it. |

## Verified

Each check runs the RUNS source in the evaluator and SIMH running the oracle image on the same Records, and compares every field and every plotted point.

- `square_root`, the Processor over its own words: all 65,536 inputs match (`tools/check_square_root.py`, against RUNS-Spacewar's observed vectors).
- The Networks `explosion`, `torpedo`, `in_hyperspace`, `breakout`: 3,000 calls each, all match, 6.1 million points (`tools/check_calc_routines.py`).
- The frame Network from `ml0` to `mq3`, covering the restart countdown, the object loop, collisions, and every ported calc routine: 1,500 frames, all match, with 4,343 collisions that hit (`tools/check_frame.py`).
- The checks fail when the source is wrong. Each mutation through `tools/mutate.sh` was caught: skipping adjacent collision tests, testing objects that do not collide, skipping slot 0, an off-by-one in the time charge, a wrong torpedo explosion counter, and dropping the second `random` from the explosion's dot loop.
- The frame's contract is checked: without `writes: display` the source does not load.
- `tools/reach_oracle.py` checks its own copy of core and its model of the word's arithmetic against SIMH, as above.

## Not yet ported

The spaceship calc routine, which covers gravity, thrust, the controls, torpedo launch, the jump into the compiled outline, hyperspace entry, and the halt on a full object table. Also the outline compiler and the Expensive Planetarium (presentation), the central star (presentation, with two game-rule random draws), the game control between games (scores, the game count, halts, and the test word), and the sense switches. With them come the boundary's inputs: the control word, the sense switches, and the words the game reads from core at power-on. Then the compiler from RUNS plus the binding to the exact binary.
