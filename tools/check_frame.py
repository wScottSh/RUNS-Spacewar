"""The frame Network of frame.runs against SIMH running the oracle image,
from the frame seam (ml0) to the heavens (mq3): the restart checks and the
whole object loop, collisions and calc routines included.

Each frame starts from one set of Records the game can hold. The ships'
slots never hold a flying spaceship (its calc routine is not ported yet),
so the restart delay counts down; it starts low enough not to reach 0.
Objects are bunched so that collisions happen. In SIMH the Records are
deposited where the PDP-1 binding places them, the image's word at mq3 is
replaced by a jump to the stub's halt, and the run enters at ml0. The
evaluator runs the frame Network until it would fire the heavens.

Usage: [N] (frames, default 1500)."""
from __future__ import annotations

import copy
import random
import sys

import pdp1
import runs
from pdp1cc.gate import corpus, simh
from pdp1cc.gate.simh import Inputs, STUB
from oracle_check import built_listing

RECORDS = ["objects", "ships", "random", "frame", "tunables"]
NEG = lambda v: v ^ runs.MASK
JMP = 0o600000


def member(name: str) -> runs.Member:
    return runs.Member("calc_routine", name)


def near(rng: random.Random, centre: int, spread: int) -> runs.W:
    return runs.word_of(max(-0o377777, min(0o377777, centre + rng.randrange(-spread, spread))))


def a_frame(m: runs.Machine, rng: random.Random) -> dict:
    st = copy.deepcopy({r: m.state[r] for r in RECORDS})
    o, sh = st["objects"], st["ships"]
    cx, cy = rng.randrange(-0o300000, 0o300000), rng.randrange(-0o300000, 0o300000)
    spread = rng.choice([0o4000, 0o20000, 0o100000, 0o400000])
    for s in range(0o30):
        o["routine"][s] = member(rng.choice(["explosion", "in_hyperspace", "breakout", "none"] if s < 2
                                            else ["none", "none", "torpedo", "torpedo", "explosion"]))
        o["x"][s], o["y"][s] = near(rng, cx, spread), near(rng, cy, spread)
        o["dx"][s], o["dy"][s] = runs.W(rng.randrange(1 << 18)), runs.W(rng.randrange(1 << 18))
        o["counter"][s] = runs.W(rng.choice([NEG(1), NEG(2), NEG(rng.randrange(1, 0o200)), 0, runs.MASK]))
        o["cycles"][s] = runs.W(rng.choice([0o20, 0o2000, 7, rng.randrange(0o4000)]))
    for s in range(2):
        for f in sh:
            sh[f][s] = runs.W(rng.randrange(1 << 18))
        sh["saved_routine"][s] = member(("first_spaceship", "second_spaceship")[s])
    st["random"]["number"] = runs.W(rng.randrange(1 << 18))
    st["frame"]["restart_delay"] = runs.W(NEG(rng.randrange(2, 0o377777)))
    st["frame"]["objects_seen"] = runs.W(rng.randrange(1 << 18))
    st["frame"]["spare_time"] = runs.W(rng.randrange(1 << 18))
    return st


def main() -> int:
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
    prog = runs.program(runs.source())
    b = pdp1.Binding(prog)
    display = corpus.display_words(built_listing())
    rng = random.Random(0o1444)
    m = runs.Machine(prog)
    cases = [a_frame(m, rng) for _ in range(frames)]
    places = list(b.places(RECORDS))
    halt = STUB + 3
    want = simh.run_jda(pdp1.SIMH, pdp1.ORACLE, b.sym["ml0"], [Inputs(0, 0, 0, 0) for _ in cases],
                        watch=[p[3] for p in places], op="jmp", display=display,
                        deposits={b.sym["mq3"]: JMP | halt},
                        each=[b.deposits(st, RECORDS) for st in cases])
    differ, fired, hits = 0, {}, [0]
    plain_run = m.run

    def counted_run(name, args=()):
        before = list(m.state["objects"]["routine"])
        plain_run(name, args)
        if name == "collision" and m.state["objects"]["routine"] != before:
            hits[0] += 1
    m.run = counted_run
    for k, (st, w) in enumerate(zip(cases, want)):
        m.state.update(copy.deepcopy(st))
        m.state["display"] = []
        m.fired = []
        m.stop_before = {"expensive_planetarium"}
        try:
            m.run("frame")
            raise runs.RunsError("the frame ended before the heavens")
        except runs.StopAt:
            pass
        simh_records = b.read({p[3]: v for p, v in zip(places, w.watched)}, RECORDS)
        get = lambda recs, rec, fld, s: recs[rec][fld] if s is None else recs[rec][fld][s]
        bad = [f"{rec}.{fld}{'' if s is None else f'[{s}]'} simh {b.encode(rec, fld, get(simh_records, rec, fld, s)):06o}"
               f" runs {b.encode(rec, fld, get(m.state, rec, fld, s)):06o}"
               for rec, fld, s, _ in places if get(simh_records, rec, fld, s) != get(m.state, rec, fld, s)]
        points = [pdp1.point(p) for p in w.plotted]
        if points != m.state["display"]:
            bad.append(f"plotted {len(points)} simh, {len(m.state['display'])} runs")
        if bad:
            differ += 1
            if differ <= 5:
                print(f"  frame {k}: " + "; ".join(bad)[:600])
        for name, _ in m.fired:
            fired[name] = fired.get(name, 0) + 1
    print(f"frame: {len(cases)} frames, {len(cases) - differ} match, {differ} differ; "
          f"{sum(len(w.plotted) for w in want)} points")
    print(f"  fired: {dict(sorted(fired.items()))}")
    print(f"  collisions that hit: {hits[0]}")
    return 1 if differ else 0


if __name__ == "__main__":
    sys.exit(main())
