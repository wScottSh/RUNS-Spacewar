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
- [ ] Open: port the spaceship (confirms or refutes that play never observes mot's reads past the outline array)
- [x] The boundary's inputs: console (test word, control boxes), power-on score and game count, start address (round 5)
- [ ] Open: the sense switches, with the spaceship and the heavens
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
- [ ] Open: confirm with the spaceship port that play never observes the carried outline word (mot) for torpedoes
