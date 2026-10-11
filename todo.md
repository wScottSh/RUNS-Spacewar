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
- [ ] Open: the boundary's inputs (control word, sense switches, power-on words 1sc, 2sc, gct)
- [ ] Open: runs-spec is untouched; it still says what the user called directionally right, wrong in details

## Round 3 (autonomous): compile multiply, divide, sincos from RUNS
- [x] multiply: RUNS mpy + imp Network, check_multiply vs SIMH, pdp1/multiply.toml, runsc networks/calls/byname/dword, MATCH, gate
- [x] divide: RUNS dvd + idv Network, division enum for the skip, check_divide vs SIMH, block/skips/io_param/cells in the binding, MATCH, gate
- [x] sincos: RUNS sin/cos Networks over mpy, check_sincos vs SIMH on all 2^18 words, exit-first loop layout + block_takes_entry, MATCH, gate
- [ ] Open: sincos saturation branch is unreachable for every input word; only the image gate covers it
