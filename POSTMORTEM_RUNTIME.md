# Postmortem: PICO-8 Runtime — The First RUNS Compilation

*22 March 2026*

---

## What This Document Is

This is the companion to `POSTMORTEM.md`, written after the same conversion's first runtime implementation. That document was written before any runtime existed. This document was written after Spacewar! 3.1 ran on PICO-8 hardware for the first time — hand-compiled from the RUNS source by an AI reading `.runs` files and emitting Lua.

The original postmortem predicted: *"The first runtime will almost certainly reveal bugs in the source."* It was right, but in a way we didn't expect. The bugs weren't in the RUNS source. They were in the translation — in the gap between what the source *specified* and what the compiler (me) *understood*. That gap is the subject of this document.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Target platform | PICO-8 0.2.7 (Education Edition) |
| Cartridge size | ~820 lines of Lua |
| Star catalog packed into `__gfx__` | 469 stars, 1880 bytes |
| Time from first `.runs` file read to `RUN` | One conversation session |
| Bugs on first run | 3 categories (rotation, gravity, outlines) |
| Root causes identified | 4 |
| Expression language specification produced | 844 lines, resolving all 5 open questions |

---

## What Went Right

### 1. The RUNS source was genuinely sufficient to produce a working game

This was the central question: does the RUNS source contain enough information to build a game without access to the original PDP-1 assembly?

Yes. Every Processor had clearly declared inputs, outputs, and documented logic. The Network topology in `game_tick.runs` defined the exact execution order. The Record schemas in `object.runs` specified every field of every entity. The constants in `game_constants.runs` provided every magic number with its derivation.

I never needed to consult the PDP-1 source. The RUNS files were the complete specification. This is the strongest possible validation of the source-first approach from the original postmortem.

### 2. The conversion documents served as compiler documentation

The original postmortem said the conversion bible was "load-bearing." From the runtime side, it was even more valuable than that. `04_conversion_phases.md` — Phase 4 specifically — contained edge cases, shift counts, binary-point conventions, and PDP-1 arithmetic subtleties that would have been invisible from the Processor headers alone.

The gravity Processor's `sqrt` input is documented as "binary point right of bit 17, output binary point between bits 8 and 9." Without that annotation in the conversion bible, I would have used a naive `sqrt()` and gotten zero gravity across the entire playfield. The conversion bible was the compiler writer's manual.

### 3. The game ran on the first attempt

Despite four bugs, the game loaded and executed in PICO-8 on the very first `RUN` command. Ships appeared. The star pulsed at center. Torpedoes fired. Hyperspace functioned. Collisions detected. Scores counted. The game loop was correct. The entity dispatch was correct. The spawn system, the collision diamond, the reload timers, the fuel system, the sense switches — all worked.

This validates the Processor decomposition. When each Processor does one thing with explicit inputs and outputs, translation errors stay local. A wrong direction vector in `draw_outline` doesn't break gravity. A wrong shift in `sqrt` doesn't break collision detection. Errors are contained by the architecture.

### 4. The adapted compilation model emerged naturally

When I substituted PICO-8's `sqrt()` for `spacewar:sqrt`, or `rnd()` for `spacewar:random`, I was making exactly the engineering decisions a real RUNS compiler would make. These substitutions weren't cheating — they were the adapted compilation mode that eventually became formalized in the expression language specification.

The PICO-8 implementation plan already documented 7 known deviations (D1–D7). This deviation table is now a formal concept in the expression language spec: a machine-readable manifest declaring where and why a runtime departs from strict evaluation. The concept didn't exist before the runtime forced it into existence.

---

## What Went Wrong

### 1. Four bugs — all in the translation, not the source

The three categories of bugs (rotation, gravity, outlines) traced to four specific root causes:

| Bug | Root Cause | Where the Information Was |
|-----|-----------|--------------------------|
| Outline garbled | Direction code 4: I wrote `cos−sin` instead of `sin−cos`. Code 5: I wrote `+cos` instead of `−cos`. | `outline_format.md` had the correct vectors. I misread the table. |
| Gravity zero everywhere | `r_scaled = sqrt(rsq) >> 7` gave zero for all playfield positions. The PDP-1's `sqt` operates on 36-bit AC:IO input; the `>> 9` cancels the implicit `× 2^9` from the 36-bit sqrt. | `sqrt.runs` documents the binary point convention. `04_conversion_phases.md` Phase 2 describes it. I failed to internalize the 36-bit sqrt behavior. |
| Rotation snapping | Angle normalization used `while a > π: a -= 2π` (full-circle wrap) instead of `if a > π: a -= π` (half-circle correction). | `rotation_update.runs` specifies the exact conditional. I "improved" it to be mathematically correct and broke fidelity. |

Every bug was a translation error. The RUNS source was correct. The information needed to avoid each bug was present in the source files or conversion documents. The compiler (me) failed to read precisely.

**Lesson**: This is the strongest possible argument for a formal expression language. A machine parser doesn't misread direction vector tables. A machine evaluator doesn't "improve" angle normalization. The four bugs I introduced are exactly the class of errors that a formal compiler eliminates by construction.

### 2. The 36-bit sqrt was the hardest single translation problem

The PDP-1's `jda sqt` instruction stores the accumulator at the `sqt` address and jumps to `sqt+1`. The sqrt routine interprets the combined AC:IO register pair as a 36-bit input. When AC contains `rsq` and IO contains 0, the effective input is `rsq × 2^18`. The result is `sqrt(rsq) × 2^9`.

This behavior is documented in `sqrt.runs` (line 69: "sqrt(N) is returned scaled by 2^9 = 512") and in `04_conversion_phases.md` Phase 2 ("Output: binary point between bits 8 and 9"). But the implication — that the subsequent `>> 9` in gravity.runs is *cancelling* the sqrt's scaling, not *applying* additional scaling — required understanding the PDP-1's register conventions at a level deeper than the RUNS source explicitly states.

**Lesson**: The expression language body of `spacewar:sqrt` must contain the actual 23-iteration algorithm, not just the Processor header and documentation comments. When the body is present, a compiler evaluates it mechanically and gets the right binary-point behavior automatically. The body IS the specification — you don't need to understand *why* the algorithm scales by 2^9, you just need to execute it.

This is the insight that produced §7.1 (The Strict Evaluation Rule) of the expression language specification.

### 3. Outline data exceeded PICO-8's integer range

The ship outlines are stored as 18-bit octal words. `700000₈` (the terminator) = 229,376 in decimal. PICO-8's number type is 16:16 fixed-point with an integer range of ±32,767. The terminator overflows.

My first approach — a runtime `oct2codes()` function that divides by 8 in a loop — would have silently produced wrong results for any word exceeding 32,767 (which includes `311111₈` = 103,497 and `146111₈` = 52,361 and several others).

The fix was to pre-decode all outline words into arrays of 3-bit direction codes offline, avoiding large integers entirely. This is a legitimate compiler optimization: the RUNS source stores outlines as octal words, but a compiler targeting a 16-bit platform would decode them at compile time.

**Lesson**: The adapted compilation model isn't just about substituting functions — it includes data representation. A RUNS compiler needs a data transformation pass, not just a code emission pass.

---

## What Surprised Us

### 1. The expression language specification wrote itself — from the runtime side

The original postmortem noted: *"The expression language designed itself under pressure"* during source conversion. The same thing happened again, from the opposite direction, during runtime implementation.

The original conversion surfaced what the language needs to *express* (shift operators, widening multiply, conditional branching). The runtime implementation surfaced what the language needs to *guarantee* (bit-exact evaluation, deterministic cross-platform behavior, strict vs. adapted compilation modes).

The two forces — expressiveness from the source side, guarantees from the runtime side — converged on the same specification. Every design decision in the expression language spec can be traced to a concrete problem encountered during either source conversion or runtime implementation.

This is the strongest argument for building the source and the runtime in close succession, even if the runtime is naive. The spec emerges from the pinch point between the two.

### 2. The RUNS source was MORE faithful to the original than my hand-translation

I introduced four bugs. The RUNS source has zero known bugs (against the PDP-1 behavior). The source conversion was more accurate than the runtime compilation, despite the source conversion being the harder intellectual task (reverse-engineering PDP-1 assembly) and the runtime compilation being the "easier" task (translating documented logic into Lua).

This is counterintuitive until you realize: the source conversion operated under extreme attention to fidelity. Every source line was traced. Every edge case was documented. The conversion bible enforced scholarly rigor.

The runtime compilation operated under implementation pressure — "make it run." The temptation to "improve" things (better angle normalization! simpler sqrt!) introduced every bug. The RUNS source's explicit, low-level specificity was a feature, not a limitation. When it said `if angle > pi: angle -= pi`, that was the correct behavior, even though `while angle > pi: angle -= 2*pi` seems more mathematically principled.

**Lesson**: RUNS source should be translated literally, not interpreted. The expression language body is scripture, not commentary. This is why the strict evaluation rule exists.

### 3. The game actually plays like Spacewar

This shouldn't have been surprising, but it was. After fixing the four bugs, the PICO-8 cartridge feels like Spacewar. Ships orbit the star. Gravity slingshots work. Torpedoes lead ahead. Hyperspace is genuinely risky. The collision diamond creates near-misses that feel fair.

A game from 1962, reverse-engineered from PDP-1 assembly into a declarative source format, hand-compiled by an AI into Lua for a fantasy console, plays correctly on the first session with four fixable bugs. The chain of fidelity held: PDP-1 → RUNS source → PICO-8 Lua → gameplay.

This is the proof of concept that the original postmortem called for. The source format preserves gameplay. Not approximately — actually.

### 4. Building the runtime forced the expression language into existence

The original postmortem listed "expression language needs formal grammar" in the "Needs Work" column. The runtime implementation didn't just confirm this need — it produced the specification.

The moment I used PICO-8's `sqrt()` and gravity broke, the question became concrete: *under what conditions is a compiler allowed to substitute a native function for a Processor body?* The answer required defining strict evaluation (the body IS the computation), adapted evaluation (documented deviation), and the determinism contract (the type system determines which mode applies).

None of this was in the existing spec. All of it was forced into existence by a single bug in a single runtime. The expression language specification — all 844 lines of it — is the direct consequence of `sqrt(2048)` returning `45` instead of `23168`.

### 5. The "aha moment" — the .p8 file IS the binary

The user's realization during this session deserves documentation: when we built the PICO-8 cartridge, we weren't "porting" Spacewar. We were **compiling** it. The `.runs` source is the artifact that endures. The `.p8` file is the compiled binary for one specific platform. A future RUNS-to-N64 compiler would read the same source and produce a `.z64`. A RUNS-to-WASM compiler would produce a `.wasm`.

The PICO-8 cartridge is proof that RUNS source compiles. The bugs are proof that hand-compilation is error-prone. The expression language specification is the tool that makes machine-compilation possible. These three artifacts — cartridge, bug list, spec — form a complete argument for automated RUNS compilation.

---

## What the Original Postmortem Predicted Correctly

| Prediction | Outcome |
|-----------|---------|
| "The first runtime will almost certainly reveal bugs" | ✅ Four bugs found and fixed |
| "Even a REPL that can evaluate single expression bodies would have caught errors" | ✅ The sqrt scaling error would have been caught by a test vector evaluator |
| "Expression language needs formal grammar" | ✅ Produced during the runtime session (844 lines) |
| "Need runtime implementation to verify determinism" | ✅ The strict/adapted distinction emerged from runtime reality |
| "The source IS the documentation" | ✅ Every Processor was translatable from source alone |

## What the Original Postmortem Did Not Predict

| Unpredicted Outcome | Why It Matters |
|--------------------|---------------|
| The compiler being the error source, not the source | Argues for machine compilation over hand-translation |
| The determinism contract being type-driven | `float` vs `fixed16` choice = the determinism decision |
| Data representation transformation as a compiler concern | Outline words exceeding target integer range |
| The temptation to "improve" original logic | Literal translation is correct; interpretation introduces bugs |
| The sqrt binary-point convention as the hardest problem | Algorithm documentation ≠ understanding; the body must be executable |

---

## Updated Recommendations

The original postmortem's seven recommendations all stand. We add three from the runtime experience:

8. **Translate literally.** When the RUNS source says `if angle > pi: angle -= pi`, emit exactly that. Do not improve, optimize, or reinterpret. Fidelity is correctness.

9. **Write test vectors before the runtime.** For every math Processor, define input/output pairs from the original platform's known behavior. `sqrt(2048) → 23168` would have caught the gravity bug before the game ever ran.

10. **Build the expression language body as the source of truth.** A Processor header with documentation comments is not sufficient for machine compilation. The body — the actual algorithm in `runs-prim` syntax — is the artifact that makes automated, correct compilation possible. Any Processor without a body is a promise without proof.

---

## What This Runtime Proved About RUNS

| Proved | Still Needs Work |
|--------|-----------------|
| RUNS source compiles to real hardware | Need automated compiler (hand-compilation is error-prone) |
| Adapted compilation is a legitimate strategy | Need formal deviation manifest format |
| The expression language spec resolves real bugs | Need reference parser and evaluator |
| The strict evaluation rule prevents the sqrt class of errors | Need test vectors for all math Processors |
| The source preserves gameplay across platforms | Need a second platform to prove portability |
| Data transformation is a compiler concern | Need spec guidance on outline/catalog encoding |

The most important thing this runtime proved is practical: **RUNS source can produce a playable game on constrained hardware.** PICO-8 has 8,192 tokens, 128×128 resolution, 16:16 fixed-point math, and no floating point. The entire Spacewar game logic — gravity, torpedoes, hyperspace, collision, scoring, starfield — fits within these constraints when compiled from RUNS source with documented adaptations.

The second most important thing is methodological: **the bugs were informative.** Every translation error pointed to a specific gap in the specification. Those gaps are now filled. The expression language specification exists because the runtime demanded it.

---

*The first game ever shared between computers, compiled to a fantasy console from a declarative source format, played with bugs and all. The source endures. The binaries multiply.*
