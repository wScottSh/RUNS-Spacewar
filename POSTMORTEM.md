# Postmortem: Spacewar! 3.1 → RUNS Conversion

*22 March 2026*

---

## What This Document Is

This is the postmortem for the first-ever RUNS game source conversion — Spacewar! 3.1 (1962) to RUNS format. It follows the classic game development postmortem structure (what went right, what went wrong, what surprised us) but with a specific lens: **what did we learn about RUNS itself by trying to use it?**

The RUNS spec existed before we started. The AEMS spec existed. The MAPS notation existed. The conversion bible existed. We had everything documented. And yet, converting an actual game surfaced insights that no amount of specification writing could have predicted. Those insights are the real product of this conversion — more valuable than the 51 source files.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Total files produced | 51 |
| PDP-1 source lines mapped | 1,870 |
| Processors written | 24 (6 math, 11 entity, 7 system) |
| Records defined | 12 |
| Networks defined | 2 |
| AEMS events | 7 (3 entities, 4 manifestations) |
| Design decisions forced by the conversion | 8 major |
| Known discrepancies with original | 6, all intentional |
| Working phases | 8, executed sequentially |
| Lines of specification read before starting | ~5,000 across 4 protocol specs |

---

## What Went Right

### 1. The conversion bible was genuinely load-bearing

The `CONVERSION_BIBLE.md` and its four supporting documents (`01_source_concordance`, `02_record_definitions`, `03_aems_layer`, `04_conversion_phases`) were not bureaucratic overhead. They were the map. Every time we hit a decision point — "should this be an AEMS property or a RUNS constant?" — the answer was already written down in `03_aems_layer.md`. Every time we needed to know which source lines corresponded to which Processor, `01_source_concordance.md` had the answer.

**Lesson**: Scholarly analysis before implementation is not a luxury. For a conversion project (any format → any format), the concordance document alone pays for itself ten times over. If we'd started writing Processors without the concordance, we would have missed edge cases, duplicated logic, and had no way to verify completeness.

### 2. The AEMS/RUNS boundary held perfectly

The boundary rule — "if changing a value changes how the game plays, it's RUNS; if it changes what the thing looks like, it's AEMS" — was tested repeatedly and never broke. Ship outlines? AEMS (visual identity). Fuel capacity? RUNS (game logic). Torpedo speed? RUNS. Explosion particle rendering? RUNS data → runtime visual. The chess-knight test from `aems-conventions/entity-abstraction.md` was genuinely predictive.

Spacewar has the thinnest possible AEMS layer (3 entities, 4 manifestations), and that is the correct answer. A mechanics-first game should have a thin entity layer. The fact that AEMS accommodates this without feeling forced — no dummy properties, no awkward mappings — validates the four-layer hierarchy.

### 3. The expression language designed itself under pressure

We didn't have a complete expression language when we started writing Processors. We had a rough sketch. By the time we'd written `gravity.runs` — with its `sqrt`, widening multiply, conditional star capture, and sense-switch branching — the expression language had been forced into existence by concrete need.

Five open design questions were resolved not by abstract debate but by asking: "what does this Processor need to express?" The answers were:
- No widening math operators (Processor calls instead)
- Shift+mask for bit extraction (universal, not domain-specific)
- Saturating error semantics (games keep running)
- 32-bit signed integers, wrapping (matches WASM, GLSL)
- Formal grammar deferred (write prose first, formalize later)

**Lesson**: Design under pressure produces better results than design in isolation. The expression language would have been worse if we'd designed it before writing any Processors, because we would have guessed wrong about what it needed to express.

### 4. The phased approach prevented scope creep

Eight phases, each with explicit acceptance criteria, each consuming specific source line ranges. We never had to wonder "are we done?" — the acceptance criteria table answered that. We never had to wonder "what's next?" — the phase dependency graph answered that.

The phases also served as natural pause points for design decisions. Phase 4 forced the expression language. Phase 6 forced the Network topology. Each decision was made at the moment of maximum information, not before.

### 5. Records as the unit of state made everything clean

Every piece of game state lives in a Record. Every Record has typed fields. Every Processor declares its inputs and outputs as Records. This meant we could verify wiring correctness by inspection — does `gravity.runs` consume fields that `object.runs` actually declares? Yes? Wired correctly.

The inbound/outbound boundary concept (4 Records in, 3 Records out) was particularly clean. It made the runtime contract obvious: "give me these 4 things each frame, read these 3 things after." No hidden channels, no global state, no side effects.

---

## What Went Wrong

### 1. The star catalog count was wrong in the bible

The conversion bible says 478 stars. Parsing the actual source produces 469. This is a small error (9 stars), but it illustrates a dangerous pattern: **the conversion documents were written before the source was fully machine-parsed.** The bible's star count came from a manual estimate. The parser's count came from actually processing every `mark` instruction.

**Lesson**: Never trust derived numbers from analysis documents. Always verify against the source. The parser is authoritative, not the bible. This is obvious in retrospect but easy to miss when the bible's authority feels absolute.

### 2. No runtime exists to validate the source

We wrote 51 files of game logic and cannot run any of it. The verification report defines test vectors and traces, but they're predictions, not observations. The first runtime will almost certainly reveal bugs in the source — field name mismatches, expression language ambiguities, off-by-one errors in lifecycle transitions.

This is the fundamental limitation of a source-first approach: you're writing code for a compiler that doesn't exist yet. You can check consistency and completeness, but you can't check correctness in the execution sense.

**Lesson**: Build the simplest possible runtime in parallel with the source conversion. Even a REPL that can evaluate single expression bodies against test data would have caught errors we can't see statically. We chose not to do this (the user wanted the source complete first), and it was the right choice for proving RUNS's expressive power, but it will cost us in Phase 9 (runtime).

### 3. The Network format is not yet in the spec

We invented the Network topology during Phase 6. The concepts — ordered phases, dispatch blocks, guarded arcs, slot-order iteration — are sound, but they're in our source files and design documents, not in the RUNS spec itself. The spec describes Networks at arm's length ("guarded arcs," "hierarchical bundling") without specifying the exact syntax.

This means our `game_tick.runs` uses a format that no other RUNS project has validated. It could be wrong. Not conceptually wrong — the phase model is universal — but syntactically under-specified.

**Lesson**: The spec needs a formal Network grammar. This should be written before the second RUNS game, not after.

### 4. Some Processor bodies are pseudocode, not executable

The expression language is documented but not formalized. Some Processor bodies use patterns (like `for each entity in objects`) that aren't defined in the grammar. The boundary between "expression language" and "Processor-level control flow" is fuzzy.

For Phase 4-5 Processors, this was acceptable — the algorithms are clear enough that any reasonable compiler could interpret them. But it will cause problems when two independent runtime implementations disagree on edge cases.

**Lesson**: Formalize the expression language grammar before anyone ships a runtime. The prose descriptions are a crutch that will create incompatibility if two teams read them differently.

### 5. The runtime contract was an afterthought

We wrote 50 files of game logic before writing `runtime_contract.md`. The contract should have been the first document written — "here is the boundary between game and runtime, here is what each side provides." Instead, it was extracted backward from the finished source.

The result is fine (the contract is complete and clear), but the process was backwards. Runtime concerns were discovered ad hoc during Processor writing ("oh, this is a rendering thing, not game logic") rather than established by principle beforehand.

**Lesson**: Write the runtime contract first, even before the type system. The contract defines the boundary; everything else fills in one side or the other.

---

## What Surprised Us

### 1. The PDP-1 source is cleaner than expected

Spacewar! 3.1 is 1,870 lines of PDP-1 assembly from 1962. We expected spaghetti. What we found was a well-structured program: clearly separated macros, labeled routines, a consistent object table, and a main loop that maps remarkably cleanly to a modern ECS tick. The original programmers (Russell, Graetz, Wiitanen, Samson, Saunders) were disciplined.

The collision detection uses a diamond-shaped hitbox (Manhattan distance), not circular — a deliberate optimization for the PDP-1's lack of a multiply instruction. The gravity routine computes genuine inverse-square acceleration using integer `sqrt` and `divide`. The hyperspace risk escalation is an elegantly simple probability ramp. These are not hacks — they are engineering decisions that hold up sixty years later.

### 2. The game has almost no entities

Applying the AEMS four-test rubric produced only 3 Entities and 4 Manifestations. That's it. The entire game. Spacewar's richness lives entirely in its mechanics (gravity, momentum, thrust) and its state machine (hyperspace risk/reward). This validated the "thin entity layer" pattern from `aems-conventions/entity-abstraction.md` — some games are deep because of their physics, not their objects.

This has implications for the AEMS spec: the entity layer should never be the measure of a game's complexity. A game with 3 entities can be deeper than one with 3,000.

### 3. The biggest design decisions were about what NOT to include

The conversion's hardest moments were exclusions:
- No widening operators in the expression language (use Processor calls)
- No formal grammar yet (prose first, formalize later)
- Explosions are NOT entities (they're state transitions)
- Match lifecycle is NOT a Network (it's a runtime concern)
- The star catalog is NOT AEMS (it's cosmetic backdrop data)
- `hlt` on full table becomes silent drop, not a crash

Each of these was a "no" that simplified the system. The temptation was always to add — another operator, another Entity type, another Network phase. The discipline was in refusing.

### 4. Slot-order determinism is more important than it looks

The original game processes entity slots 0 through 23 in order. Ship 1 (slot 0) always updates before Ship 2 (slot 1). This means a torpedo fired by Ship 1 exists in the world before Ship 2's update runs. This is observable behavior — and it implies that RUNS Networks must specify iteration order, not leave it to the runtime.

This is the kind of detail that doesn't appear in any spec or design document. It only emerges when you trace the original source's main loop instruction by instruction and ask: "does this order matter?" The answer, for any game with simultaneous entity interaction, is always yes.

### 5. The boundary between game logic and rendering is not where you'd expect

We assumed rendering was the last step. In the original PDP-1 code, rendering is intimately woven through the main loop — each entity is drawn immediately after being computed (L906-908). Collision detection happens *within* the same loop iteration as rendering (L868-904). The background stars are drawn *after* the last entity but *before* the busy-wait (L938-939).

Separating game logic from rendering required understanding why the original interleaved them (PDP-1 CRT needed writes within specific timing windows) and then proving the separation was semantically equivalent (it is, because the rendering has no side effects on game state).

**Lesson for RUNS**: The `produces:` boundary is more fundamental than it appears. It's not just "here are the outputs." It's the claim that game logic is a pure function from (state + inputs) → (state + outputs), with no side effects. This purity is the foundation of deterministic replication, client-server safety, and everything else RUNS promises. Spacewar proves the claim holds for at least one real game.

---

## Recommendations for the Next Conversion

If someone converts a second game to RUNS (DOOM, Asteroids, Tetris, whatever):

1. **Write the runtime contract first.** Before types, before Records, before anything. Define the boundary.
2. **Parse the source mechanically.** Don't count by hand. Write a parser. Trust the parser.
3. **Apply the AEMS four-test rubric early.** Know what your entities are before you start writing Processors. The rubric works.
4. **Design under pressure.** Don't finalize the expression language before you need it. Let the first few Processors force the design.
5. **Specify iteration order.** If the game iterates entities, the order matters. Document it. Enforce it.
6. **Build a REPL in parallel.** Even a trivial one that can evaluate `2 + 3` in the expression language. The feedback loop is worth more than the effort.
7. **Write the concordance.** Line-by-line source analysis is not optional. It's the map.

---

## What This Conversion Proved About RUNS

The conversion was a proof of concept. It succeeded — Spacewar's complete game logic is expressible as RUNS source. But it also revealed where RUNS is under-specified:

| Proved | Needs Work |
|--------|-----------|
| Records-and-Processors model works for real game logic | Network syntax needs formal grammar |
| Expression language can express gravity, collision, trigonometry | Expression language needs formal grammar |
| Inbound/outbound boundary cleanly separates game from runtime | Runtime contract should be a spec-level document, not per-game |
| AEMS boundary rule produces correct classifications | Four-test rubric should be machine-checkable |
| Phased conversion with acceptance criteria is repeatable | Need a second game to validate repeatability |
| Deterministic execution order is specifiable | Need runtime implementation to verify determinism |

The most important thing this conversion proved is subtle: **RUNS source files are readable.** You can open `gravity.runs`, read the algorithm, understand the physics, and know what the game does — without running it, without a debugger, without even a compiler. The source IS the documentation. That's the promise of plain-text game logic, and Spacewar proves it holds.

---

*The first game ever shared between computers, restored to a shareable format. Whatever happens next, this source exists.*
