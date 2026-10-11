# todo

## Round 1 (figure-it-out): port a slice, derive the intent
- [x] Slice ported and graded against SIMH (square_root, four calc routines, frame Network)
- [x] Functions removed; topology pure Petri (option a)
- [x] INTENT.md, docs/decisions.tsv

## Round 2 (feature): the reach tool, and the files brought up to what is settled
- [x] Data shape first: a Step per executed instruction (pc, AC, IO, effective address, op); places named by bound Record field, else listing variable or label
- [x] tools/reach_oracle.py over spacewar-c's 17 scripted matches; self-checks: copy of core vs SIMH, word arithmetic model vs SIMH's AC
- [x] Report saved: docs/reach-oracle.txt
- [x] Network contracts (reads:/writes:); top Network must declare its boundary; frame declares writes: display; mutation caught
- [x] pdp1.py: bind explosion_cloud.particles, square_root_call; note instruction-held fields; binding holds only what play cannot observe
- [x] RUNS sources annotated for the presentation split and power-on words
- [x] INTENT.md rewritten to what is settled; decisions.tsv rows
- [x] All checks re-run green
- skip: architect/arena for the tool: its shape follows SIMH's history format and the existing frame driver; nothing to choose between
- skip: a planted-defect test of the tool: every kind it reports except far jumps has a true positive in real play, and both self-checks compare against SIMH
- [ ] Open: a field-level classifier for gameplay vs presentation (by consequence) once more of the game is ported
- [x] Port the spaceship; play never observes mot's reads past the outline array (round 6)
- [x] The boundary's inputs: console (test word, control boxes), power-on score and game count, start address (round 5)
- [x] The sense switches the spaceship reads (round 6); switch 4 waits for the heavens
- [ ] Open: runs-spec is untouched; it still says what the user called directionally right, wrong in details

## Round 3 (autonomous): compile multiply, divide, sincos from RUNS
- [x] multiply: RUNS mpy + imp Network, check_multiply vs SIMH, pdp1/multiply.toml, runsc networks/calls/byname/dword, MATCH, gate
- [x] divide: RUNS dvd + idv Network, division enum for the skip, check_divide vs SIMH, block/skips/io_param/cells in the binding, MATCH, gate
- [x] sincos: RUNS sin/cos Networks over mpy, check_sincos vs SIMH on all 2^18 words, exit-first loop layout + block_takes_entry, MATCH, gate
- [ ] Open: sincos saturation branch is unreachable for every input word; only the image gate covers it

## Round 4 (autonomous): compile tunables and objects from RUNS
- [x] tunables: all twelve xct tunables as Processors, the numbers as tunables fields; check_tunables vs SIMH; pdp1/tunables.toml with the machine's words (sequence break, start vectors, control word slot); XCT + ac_param, [names], MINUS_ZERO in runsc; MATCH, gate
- [x] objects: explosion, torpedo, in_hyperspace, breakout compiled from RUNS; RUNS reshaped where the original carries a register (diff's position, the dots' IO, hyperspace's IO, the jump's swap, a cla per diff); runsc: cursors, inline macros, pending AC results, Network guards/loops, bottom-tested loops, shared tail, shift homes, dpy, enum spelling; MATCH, gate

## Round 5 (autonomous): compile the main loop and game control from RUNS
- [x] RUNS: start Networks, frame, object_loop, between_games/ask/show_scores/new_match/new_game, control_word; score/console/controls/lights/scoreboard/outline_call/outline_space
- [x] Language: fields with no initial value come in (top Networks declare them); `wait`; several top Networks are one game
- [x] check_game.py vs SIMH: 3000 seeded cases, 17 scripted matches (51000 stops), control word; 14 mutations caught
- [x] pdp1/main_loop.toml + runsc rules (table, walk, cursors' homes, carry, stray, blocks, repeat, jumping guards, enum sign/zero tests, xor sharing, devices, flags, hlt+wait, clearing loop, dispatch); MATCH; gate 263/263
- [x] Confirmed with the spaceship port: play never observes the carried outline word (mot) for torpedoes (check_frame poison)

## Round 6 (autonomous): compile the spaceship from RUNS
- [x] RUNS: spaceship.runs (first/second_spaceship, spaceship, accelerate, after_outline, launch_torpedo), spaceship.runs-prim; records spaceship, pen, launch; console sense switches; handoff fields
- [x] Language: enums may share a member name (resolved by type); evaluator fix: a field's name is not a Record mention
- [x] check_spaceship vs SIMH: 3000 calls through the compiled outline (tools/outline.py stand-in); 17 mutations (14 caught, 1 after one-free-slot tables, 2 equivalent)
- [x] check_frame with flying ships: 1500 frames; poison mode for the mot verdict, with its control
- [x] pdp1/spaceship.toml + runsc rules (exit, back/pulse externs, carried homed jump, slot-field cursors and search, sense/flag guards, shared Network tail, pool-word dispatch); MATCH; gate 357/357
- [x] The outline compiler and outlines (presentation): ported in round 7; tools/outline.py deleted

## Round 7 (autonomous): port the outline compiler, the outlines and the core layout
- [x] Design: instructions as values of the machine description's type insn in a Record (outline_code), run by `jump` with the PDP-1's rules; compiler as a Network cut at the original's labels. Alternatives weighed: one Processor (cannot call ocs; its order is not the original's), raw words (would put macro1's pool addresses in the text)
- [x] Evaluator: type insn, instruction constructors, jump with contract and bound, initial values a slot, slots past a collection are errors, Network loop exit that runs things first
- [x] RUNS: outlines.runs, outlines.runs-prim; outlines, outline_code, outline_compiler Records; pen.saved_x/y; outline_space and the outline enum gone; frame contract without pen
- [x] Bindings: core_layout.toml, outlines.toml, outline_compiler.toml; [[code]] draw_outline; [into]; MATCH; check_compiled 423/423
- [x] check_outline_compiler vs SIMH (9 outlines, 6 ddd settings); 10 compiler mutations caught; check_spaceship/check_frame through the ported code; `moved` relocation; 5 machine-rule mutations caught
- [x] reach_oracle re-run: same findings, code space named outline_code
- [ ] Open: the heavens and the star catalog
- [ ] Open: runsc's layout rules grow per unit (jump table, rotated loop); an independent review should judge whether each is general

## Round 8 (autonomous): port the heavens and the star catalog; every unit from RUNS
Playbook (autonomous run), verbatim:
- [ ] 1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).
- skip: 2. Pick the wake mechanism (loop skill): no external event to watch; every check runs in the foreground
- [ ] 3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, discards changes that didn't help.
- [ ] 4. Mid-run discoveries are yours.
- [ ] 5. Checkpoint every iteration via the show-me-your-work skill.
- [ ] 6. Stop when the predicate is met.

Predicate: runsc MATCH 8744e9c9 with all 13 build/lift/*.c generated, none symlinked, and build/lift holding only generated files; check_compiled passes; check_heavens (central_star, expensive_planetarium vs SIMH, wrap paths, mutations) passes; check_frame runs whole frames; check_all.sh passes.

- [ ] RUNS: central_star, star_line, star_slope, draw_star; expensive_planetarium, show_magnitude, move_window; star_catalog Record; sense switch 4
- [ ] Evaluator check vs SIMH (check_heavens.py): seeded + edge cases + scan-wrap paths; mutations caught
- [ ] check_frame through the heavens (whole frames)
- [ ] Bindings pdp1/heavens.toml, pdp1/star_catalog.toml + runsc rules; MATCH; check_compiled
- [ ] Remove bridges to lifted C ([names] for lifted callers, [[extern]], lifted includes); build/lift fully generated
- [ ] deslop; docs (INTENT, pdp1/README, todo); decisions.tsv
