"""The PDP-1 binding of the Records: where each field lives in core and how
a value is spelled as a word. It is what a RUNS-to-PDP-1 compiler would
place by, and what the checks use to read Ground Truth's core as Records.

The binding holds only choices that play cannot observe. Where play reads
the layout, the RUNS text has to state it, and the binding follows the
text. tools/reach_oracle.py finds where play reaches the layout; so far it
finds no layout read that play observes (INTENT.md).

The addresses come from the oracle listing's symbol table, never from a
hard-coded number."""
from __future__ import annotations

import sys
from pathlib import Path

import runs

ROOT = Path(__file__).resolve().parents[1]
SPACEWAR_C = ROOT.parent / "spacewar-c"
sys.path.insert(0, str(SPACEWAR_C / "tools"))

from oracle_check import oracle_symbols  # noqa: E402

SIMH = SPACEWAR_C / "build/pdp1"
ORACLE = SPACEWAR_C / "build/oracle.rim"

# Record field: the Macro symbol of its first word (a collection's array).
FIELDS = {
    ("objects", "routine"): "mtb", ("objects", "x"): "nx1", ("objects", "y"): "ny1",
    ("objects", "counter"): "na1", ("objects", "cycles"): "nb1",
    ("objects", "dx"): "ndx", ("objects", "dy"): "ndy",
    ("ships", "angular_momentum"): "nom", ("ships", "angle"): "nth", ("ships", "fuel"): "nfu",
    ("ships", "torpedoes"): "ntr", ("ships", "outline"): "not", ("ships", "previous_control"): "nco",
    ("ships", "saved_routine"): "nh1", ("ships", "jumps_left"): "nh2", ("ships", "recharge"): "nh3",
    ("ships", "uncertainty"): "nh4",
    ("random", "number"): "ran",
    ("frame", "spare_time"): "mtc", ("frame", "restart_delay"): "ntd", ("frame", "objects_seen"): "moc",
    ("tunables", "collision_radius"): "me1", ("tunables", "collision_radius_half"): "me2",
    ("tunables", "hyperspatial_uncertainty"): "hur",
    ("explosion_cloud", "particles"): "mxc",
    ("square_root_call", "entry"): "sqt", ("square_root_call", "passes_left"): "sq1",
    ("square_root_call", "root"): "sq2",
    ("multiply_call", "entry"): "mpy", ("multiply_call", "partial"): "mp2",
    ("integer_multiply_call", "entry"): "imp",
    ("divide_call", "high"): "dvd", ("divide_call", "quotient"): "idv",
    ("sine_call", "x"): "sin", ("sine_call", "answer"): "cos",
}

# Fields the original keeps inside an instruction, not in a word of their
# own: the value is the shift count of the instruction at that label, which
# the program builds or sets and then executes. explosion_cloud.spread picks
# mst's scr 1s or scr 3s (dap msh); explosion_cloud.scatter is the count of
# the scl the program writes whole at mi1. handoff has no place in core: its
# fields are AC and IO between two instructions.
INSTRUCTION_FIELDS = {("explosion_cloud", "spread"): "msh", ("explosion_cloud", "scatter"): "mi1"}

# calc_routine: the routine's entry, and the sign bit when it does not collide.
ROUTINE_WORDS = {"none": None, "first_spaceship": "ss1", "second_spaceship": "ss2",
                 "torpedo": "tcr", "explosion": "-mex", "in_hyperspace": "-hp1", "breakout": "hp3"}

DPY = 0o720007              # dpy, intensity in bits 6-8
DPY_NOWAIT = 0o724007


class Binding:
    def __init__(self, prog: runs.Program):
        self.prog = prog
        self.sym = oracle_symbols()
        self.routine_word = {}
        for name, s in ROUTINE_WORDS.items():
            self.routine_word[name] = 0 if s is None else \
                (self.sym[s.lstrip("-")] | (runs.SIGN if s.startswith("-") else 0))
        self.routine_of = {w: n for n, w in self.routine_word.items()}

    def address(self, record: str, fld: str, slot: int | None = None) -> int:
        return self.sym[FIELDS[(record, fld)]] + (slot or 0)

    def encode(self, record: str, fld: str, value) -> int:
        if isinstance(value, runs.Member):
            return self.routine_word[value.name]
        return value.v

    def decode(self, record: str, fld: str, word: int):
        typ = self.prog.records[record].fields[fld][0]
        if typ == "calc_routine":
            if word not in self.routine_of:
                raise ValueError(f"{record}.{fld}: {word:06o} is no calc routine")
            return runs.Member("calc_routine", self.routine_of[word])
        return runs.W(word)

    def places(self, records: list[str]):
        """Every (record, field, slot, address) of the named Records."""
        for rec in records:
            r = self.prog.records[rec]
            for fld in r.fields:
                for slot in (range(r.count) if r.count else [None]):
                    yield rec, fld, slot, self.address(rec, fld, slot)

    def deposits(self, state: dict, records: list[str]) -> dict[int, int]:
        out = {}
        for rec, fld, slot, at in self.places(records):
            v = state[rec][fld] if slot is None else state[rec][fld][slot]
            out[at] = self.encode(rec, fld, v)
        return out

    def read(self, words: dict[int, int], records: list[str]) -> dict:
        out = {}
        for rec, fld, slot, at in self.places(records):
            v = self.decode(rec, fld, words[at])
            if slot is None:
                out.setdefault(rec, {})[fld] = v
            else:
                out.setdefault(rec, {}).setdefault(fld, [None] * self.prog.records[rec].count)[slot] = v
        return out


def point(plotted: tuple[int, int, int]) -> tuple:
    """A plotted point as the display stream holds it: x, y, intensity."""
    insn, x, y = plotted
    if insn == DPY_NOWAIT:
        return (runs.W(x), runs.W(y), None)
    if insn & ~0o700 != DPY:
        raise ValueError(f"{insn:06o} is not a display instruction")
    return (runs.W(x), runs.W(y), (insn >> 6) & 7)
