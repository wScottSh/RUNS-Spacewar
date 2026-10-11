"""runsc: RUNS and its PDP-1 binding -> the pdp1c C dialect -> pdp1cc -> the
tape image, compared by sha256 with the original's.

The RUNS text holds the game. The binding (pdp1/<unit>.toml) holds only how
the PDP-1 carries it: the order of things on the tape, each routine's
calling convention, which register or word holds a value, and how a
routine's code is laid out. pdp1cc, spacewar-c's compiler, is the back end.

A bound routine is one C function. A Processor's body is its code. A
Network's Processors are inlined in the order it runs them, under its
guards and loops, and each `run` of another bound routine is a call: the
sets of that routine's parameter fields just before the run become the
call's arguments, and its result fields read after the run are AC, or the
halves of the returned pair. A macro is a routine laid out at each run.

A unit of spacewar-c's lift.toml that has a binding is compiled from RUNS;
the others still come from the lifted C, until each is ported."""
from __future__ import annotations

import contextlib
import io
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

import runs

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "spacewar-c"))
from tools.pdp1cc import program  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SPACEWAR_C = ROOT.parent / "spacewar-c"
BINDINGS = ROOT / "pdp1"
OUT = ROOT / "build"

# C precedence, loosest first, for the operators RUNS shares with C.
C_LEVEL = {"or": 1, "and": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
           "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10}
C_OP = {"or": "||", "and": "&&"}
NEGATED = {"<": ">=", ">=": "<", ">": "<=", "<=": ">", "==": "!=", "!=": "=="}
PAIR_OPS = {"rcl", "rcr", "scl", "scr", "mus", "dis"}
IO_ROTATE = {"ral": "ril", "rar": "rir"}
# The PDP-1 back end's instruction words: the dialect's constructor of each
# instruction the machine description declares. dpy is `dpy-4000`.
INSTRUCTIONS = {"lac": "I_LAC", "lio": "I_LIO", "dac": "I_DAC", "dio": "I_DIO", "add": "I_ADD",
                "sub": "I_SUB", "jmp": "I_JMP", "stf": "I_STF", "clf": "I_CLF", "szf": "I_SZF",
                "rcl": "I_RCL", "cma": "I_CMA", "ioh": "I_IOH", "dpy": "I_DPY_NOWAIT"}
RETURNS = {0: "void", 1: "word", 2: "dword"}


class BindError(Exception):
    pass


def octal(n: int) -> str:
    return f"0{n:o}" if n > 7 else str(n)


def leaf(dotted: str) -> str:
    return dotted.split(".")[1]


def dotted_of(e) -> str | None:
    """`record.field` for a field expression, else None."""
    if e[0] == "field" and e[1][0] == "name":
        return f"{e[1][1]}.{e[2]}"
    return None


def as_field(dotted: str):
    return ("field", ("name", dotted.split(".")[0]), leaf(dotted))


def walk(stmts: list):
    """Every statement, nested ones included."""
    for s in stmts:
        yield s
        if s[0] == "if":
            for _, body in s[1]:
                yield from walk(body)
            yield from walk(s[2])
        elif s[0] in ("loop", "for", "slots"):
            yield from walk(s[-2])


def walk_expr(e):
    """Every node of an expression."""
    if isinstance(e, tuple) and e and isinstance(e[0], str):
        yield e
        for x in e[1:]:
            if isinstance(x, (tuple, list)):
                yield from walk_expr(x)
    elif isinstance(e, list):
        for x in e:
            yield from walk_expr(x)


def substitute(tree, names: dict):
    """tree with each ("name", n) for n in names replaced by names[n]."""
    if isinstance(tree, tuple) and len(tree) == 2 and tree[0] == "name" and tree[1] in names:
        return names[tree[1]]
    if isinstance(tree, list):
        return [substitute(t, names) for t in tree]
    if isinstance(tree, tuple):
        return tuple(substitute(t, names) for t in tree)
    if isinstance(tree, dict):
        return {k: substitute(v, names) for k, v in tree.items()}
    return tree


def mark_homes(tree, fields: set[str]):
    """tree with each slot of one of fields marked as where its cursor may
    have its home: ("index", field, slot, "home")."""
    if isinstance(tree, tuple) and len(tree) == 3 and tree[0] == "index" and dotted_of(tree[1]) in fields:
        return (*tree, "home")
    if isinstance(tree, list):
        return [mark_homes(t, fields) for t in tree]
    if isinstance(tree, tuple):
        return tuple(mark_homes(t, fields) for t in tree)
    return tree


def returns_to(stmts: list, label: str) -> list:
    """stmts with each return a jump to label."""
    out = []
    for s in stmts:
        if s[0] == "return":
            out.append(("goto", label, s[-1]))
        elif s[0] == "if":
            out.append(("if", [(c, returns_to(b, label)) for c, b in s[1]], returns_to(s[2], label), s[3]))
        elif s[0] in ("loop", "for"):
            out.append((*s[:-2], returns_to(s[-2], label), s[-1]))
        else:
            out.append(s)
    return out


def has_return(tree) -> bool:
    if isinstance(tree, tuple) and tree and tree[0] == "return":
        return True
    return isinstance(tree, (list, tuple, dict)) and any(
        has_return(t) for t in (tree.values() if isinstance(tree, dict) else tree))


def breaks(stmts: list) -> bool:
    """A break of this loop: one not inside a loop of its own."""
    for s in stmts:
        if s[0] == "break" or s[0] == "if" and any(breaks(b) for b in [b for _, b in s[1]] + [s[2]]):
            return True
    return False


def falls_off(stmts: list) -> bool:
    """Control can run past the last statement."""
    if not stmts:
        return True
    s = stmts[-1]
    return not (s[0] == "return" or s[0] == "loop" and not breaks(s[2]))


def table_cases(s):
    """An if-chain with no else whose every guard tests one value for
    `== n`, or an `or` of such tests, the numbers 0 to some n, each once:
    (the value, [(the arm's numbers, the arm's body)]), else None."""
    if s[0] != "if" or s[2] or len(s[1]) < 3:
        return None
    value, arms = None, []
    for c, body in s[1]:
        numbers, stack = [], [c]
        while stack:
            t = stack.pop()
            if t[0] == "bin" and t[1] == "or":
                stack += [t[3], t[2]]
                continue
            if not (t[0] == "bin" and t[1] == "==" and t[3][0] == "num" and t[2] == (value or t[2])):
                return None
            value = t[2]
            numbers.append(t[3][1])
        arms.append((numbers, body))
    if sorted(n for numbers, _ in arms for n in numbers) != list(range(sum(len(ns) for ns, _ in arms))):
        return None
    return value, arms


@dataclass
class Bound:
    """One bound routine: how the PDP-1 enters and leaves it."""
    name: str
    unit: Path
    convention: str
    entry: str | None = None            # JDA: the entry word, which holds AC on entry
    ac_param: str | None = None         # arrives in AC, with no entry word (XCT)
    io_param: str | None = None         # arrives in IO
    byname: str | None = None           # the word after the call, executed each time it is read
    result: list[str] = field(default_factory=list)     # AC, then IO
    block: str | None = None            # the body lies in a BLOCK that others jump into
    block_takes_entry: bool = False     # the block is entered with the entry word in AC
    skips: tuple[str, str] | None = None    # (field, member): return one word further when it holds member
    io: set[str] = field(default_factory=set)       # locals and fields that live in IO
    cells: list[str] = field(default_factory=list)  # other fields that live in the entry word
    loops: str | None = None            # "exit first": see Function.loop
    shifts: str | None = None           # "xct": each shift is executed from a constant word
    pool: set[str] = field(default_factory=set)     # locals that live in a pool word
    spill: set[str] = field(default_factory=set)    # AC locals kept in a pool word from their last set on
    inline: str | None = None           # a constant word after the call (INLINE)
    c_name: str | None = None           # a routine of lifted C, not compiled from RUNS: its name there
    pointers: set[str] = field(default_factory=set)     # fields that hold addresses (word *)
    io_reads: set[str] = field(default_factory=set)     # fields a guard reads into IO, AC being busy
    back: str | None = None             # code a Record holds: the routine it jumps back to
    pulse: bool = False                 # that code waits for a display completion pulse
    insns: set[str] = field(default_factory=set)        # fields that hold instructions
    code: bool = False                  # a Processor whose body jumps into code a Record holds
    args_done: str | None = None        # the Processor after which the routine steps past its inline words
    data: list[str] = field(default_factory=list)       # data words laid out inside the routine
    @property
    def symbol(self) -> str:
        return self.c_name or self.name

    def typed(self, dotted: str, name: str) -> str:
        return f"word *{name}" if dotted in self.pointers else f"word {name}"

    def params(self, block: bool = False) -> list[tuple[str, str]]:
        """(field, C declaration) in the dialect's order: AC, IO, by name."""
        out = []
        if self.entry and (not block or self.block_takes_entry):
            out.append((self.entry, self.typed(self.entry, leaf(self.entry))))
        if self.ac_param:
            out.append((self.ac_param, f"word {leaf(self.ac_param)}"))
        if self.io_param:
            kind = "insn" if self.io_param in self.insns else "word"
            out.append((self.io_param, f"register {kind} {leaf(self.io_param)}"))
        if self.byname:
            out.append((self.byname, f"BYNAME word {leaf(self.byname)}"))
        if self.inline:
            const = "const " if self.inline in self.pointers else ""
            out.append((self.inline, f"INLINE {const}{self.typed(self.inline, leaf(self.inline))}"))
        return out

    def returns(self) -> str:
        if len(self.result) == 1 and self.result[0] in self.pointers:
            return "word *"
        if len(self.result) == 1 and self.result[0] in self.io and self.convention == "JSP":
            return "io_word"
        return RETURNS[len(self.result)]

    def declaration(self, block: bool = False) -> str:
        conv = "BLOCK" if block else self.convention
        conv = "static inline" if conv == "INLINE" else conv
        skips = " SKIPS" if self.skips else ""
        params = ", ".join(d for _, d in self.params(block)) or "void"
        ret = self.returns()
        return f"{conv}{skips} {ret}{'' if ret.endswith('*') else ' '}{self.block if block else self.symbol}({params})"


class Bindings:
    """Every binding in pdp1/: the routines they bind and where fields live."""

    def __init__(self, prog: runs.Program, paths: list[Path]):
        self.prog = prog
        self.specs = {p: tomllib.loads(p.read_text()) for p in paths}
        self.bound: dict[str, Bound] = {}
        self.placed: dict[str, Path] = {}       # field -> the unit that lays out its data word
        self.cell_of: dict[str, str] = {}       # field -> the JDA routine whose entry word holds it
        self.io_fields: set[str] = set()
        self.names: dict[str, str] = {}         # field -> the C name the lifted units use
        self.registers: set[str] = set()        # Records whose fields live in AC or IO
        self.cursors: dict[str, str] = {}       # field -> the cursor on the current object's slot
        self.pool: set[str] = set()             # fields that live in a pool word
        self.homes: dict[str, str] = {}         # field -> "table" or "built": held in a shift instruction
        self.spelled: dict[str, dict] = {}      # enum -> member -> how its word is spelled
        self.streams: dict[str, str] = {}       # stream -> the instruction that takes it (dpy, hlt)
        self.devices: dict[str, dict] = {}      # field -> the device instruction that reads it
        self.flags: dict[str, int] = {}         # field -> the program flag that holds it
        self.pointers: set[str] = set()         # fields that hold addresses
        self.addresses: dict[str, str] = {}     # field -> the address it always holds
        self.table: dict = {}                   # the Records laid out field after field in one array
        self.jsp_slots: dict[str, dict] = {}    # a JSP slot's name -> what it jumps to
        self.slot_cursors: dict[str, dict] = {} # a field holding a slot -> field -> the cursor on it
        self.carried: set[str] = set()          # homed jumps a walk carries a field's word into
        self.into: dict[str, str] = {}          # field -> the collection's field it holds a place in
        self.pieces: dict[str, list] = {}       # collection field -> (first slot, last slot, C name) laid out
        self.insns = {f"{r}.{f}" for r, rec in prog.records.items() for f, (typ, _) in rec.fields.items()
                      if typ == "insn"}
        for path, spec in self.specs.items():
            for f, target in spec.get("into", {}).items():
                self.check_field(path, f)
                self.check_field(path, target)
                self.into[f] = target
                self.pointers.add(f)
            for f, name in spec.get("names", {}).items():
                self.check_field(path, f)
                self.names[f] = name
            self.registers |= set(spec.get("registers", []))
            for f, cursor in spec.get("cursors", {}).items():
                self.check_field(path, f)
                if isinstance(cursor, dict):
                    for g in cursor:
                        self.check_field(path, g)
                    self.slot_cursors[f] = cursor
                else:
                    self.cursors[f] = cursor
            self.carried |= set(spec.get("walk", {}).get("carry", {}).values())
            for f in spec.get("pool", []):
                self.check_field(path, f)
                self.pool.add(f)
            for f, how in spec.get("homes", {}).items():
                self.check_field(path, f)
                self.homes[f] = how
            self.spelled |= spec.get("spell", {})
            self.streams |= spec.get("streams", {})
            for f, how in spec.get("devices", {}).items():
                self.check_field(path, f)
                self.devices[f] = how if isinstance(how, dict) else {"read": how}
            for f, n in spec.get("flags", {}).items():
                self.check_field(path, f)
                self.flags[f] = n
            for f in spec.get("pointers", []):
                self.check_field(path, f)
                self.pointers.add(f)
            for f, where in spec.get("addresses", {}).items():
                self.check_field(path, f)
                self.addresses[f] = where
            self.table |= spec.get("table", {})
            for p in spec.get("place", []):
                if "jsp_slot" in p:
                    self.jsp_slots[p["jsp_slot"]] = p
            for p in spec.get("place", []) + [{**i, "convention": "INLINE"} for i in spec.get("inline", [])] \
                    + [{**e, "extern": True} for e in spec.get("extern", [])] \
                    + [{**c, "convention": "BLOCK", "code": True} for c in spec.get("code", [])]:
                if "routine" in p:
                    self.bind(path, p)
                for f in p.get("fields", []) + p.get("data", []):
                    self.check_field(path, f)
                    self.placed[f] = path
                if "slots" in p:
                    self.check_field(path, p["slots"])
                    lo, hi = p["range"]
                    self.pieces.setdefault(p["slots"], []).append((lo, hi, f"{self.c_name(p['slots'])}_{octal(lo)}"))
                    self.placed[p["slots"]] = path

    def check_field(self, path: Path, dotted: str):
        rec, fld = dotted.split(".")
        if rec not in self.prog.records or fld not in self.prog.records[rec].fields:
            raise BindError(f"{path.name}: no field {dotted}")

    def bind(self, path: Path, p: dict):
        """A routine compiled from RUNS, or (extern) one of lifted C that a
        compiled routine runs, which RUNS does not have yet."""
        name = p["routine"]
        extern = p.get("extern", False)
        if (name in self.prog.routines) == extern:
            raise BindError(f"{path.name}: {name} is {'ported' if extern else 'no routine'}")
        if p.get("code") and [x[0] for x in self.prog.routines[name].body] != ["jump"]:
            raise BindError(f"{path.name}: {name} is code a Record holds only if its body is one jump")
        b = Bound(name, path, p["convention"], p.get("entry"), p.get("ac_param"), p.get("io_param"),
                  p.get("byname"), p.get("result", []), p.get("block"), p.get("block_takes_entry", False),
                  tuple(p["skips"]) if "skips" in p else None, set(p.get("io", [])), p.get("cells", []),
                  p.get("loops"), p.get("shifts"), set(p.get("pool", [])), set(p.get("spill", [])),
                  p.get("inline"), p.get("name"), self.pointers, set(p.get("io_reads", [])),
                  None, p.get("pulse", False), self.insns, p.get("code", False),
                  p.get("args_done"), p.get("data", []))
        for f in [b.entry, b.ac_param, b.io_param, b.byname, b.inline, *b.result, *b.cells] + \
                ([b.skips[0]] if b.skips else []):
            if f:
                self.check_field(path, f)
        for f in [b.entry, *b.cells] if not extern else []:
            if f:
                self.cell_of[f] = name
        self.io_fields |= {f for f in b.io if "." in f}
        if b.io_param:
            self.io_fields.add(b.io_param)
        self.bound[name] = b

    def c_name(self, dotted: str) -> str:
        return self.names.get(dotted, dotted.replace(".", "_"))

    def address(self, dotted: str, slot: int) -> tuple[str, str | None]:
        """The address of a slot of a collection's field, as the C names it,
        and the array of it a binding lays out (None: after the table)."""
        for lo, hi, name in self.pieces.get(dotted, []):
            if lo <= slot <= hi:
                return (name if slot == lo else f"{name} + {octal(slot - lo)}"), name
        if self.addresses.get(dotted) == "after table":
            return f"{self.table['at']} + {octal(self.table_size() + slot)}", None
        raise BindError(f"{dotted}[{slot:o}] has no address in the binding")

    def table_fields(self) -> list[str]:
        """The fields laid out in the table, in its order."""
        return [f"{r}.{f}" for r in self.table.get("records", []) for f in self.prog.records[r].fields]

    def table_offset(self, dotted: str) -> int:
        off = 0
        for f in self.table_fields():
            if f == dotted:
                return off
            off += self.prog.records[f.split(".")[0]].count
        raise BindError(f"{dotted} is not in the table")

    def table_size(self) -> int:
        return sum(self.prog.records[f.split(".")[0]].count for f in self.table_fields())

    def stored(self, dotted: str) -> bool:
        """The field has a word of its own: data, a pool word, or an entry word."""
        return dotted in self.placed or dotted in self.cell_of or dotted in self.pool

    def in_register(self, dotted: str, unit: Path | None = None) -> bool:
        """The field lives in AC or IO, not in a word of its own. The entry
        word of a routine of another unit is, to this unit, what AC carries
        into the call and out of it."""
        if dotted in self.cell_of and unit is not None and self.bound[self.cell_of[dotted]].unit != unit:
            return dotted.split(".")[0] in self.registers and dotted not in self.placed and dotted not in self.pool
        return dotted.split(".")[0] in self.registers and not self.stored(dotted)


class Unit:
    """One binding: the RUNS routines and fields it places, in tape order."""

    def __init__(self, binds: Bindings, path: Path):
        self.binds = binds
        self.prog = binds.prog
        self.path = path
        self.spec = binds.specs[path]
        self.externs: set[str] = set()
        self.cells_used: set[str] = set()
        self.callees: set[str] = set()
        self.pool_locals: set[str] = set()
        self.tables: dict[str, list[int]] = {}  # table-held field -> the shift counts it takes, in text order
        self.kinds: dict[str, str] = {}         # field held in a shift -> the shift it is
        self.walk = self.spec.get("walk", {})   # the cursors' walk over the table's slots
        self.homed: dict[str, str | None] = {}  # cursor -> the Processor its home is in (None: first access)
        for f in self.walk.get("homes", []):
            self.homed[binds.cursors[f]] = None
        for f, proc in self.walk.get("home_in", {}).items():
            self.homed[binds.cursors[f]] = proc
        for c in self.walk.get("other", {}).values():
            self.homed[c] = None
        for f, cursors in self.spec.get("cursors", {}).items():
            if isinstance(cursors, dict):       # the cursors on a slot a field holds: homed here
                for c in cursors.values():
                    self.homed[c] = None
        self.home_kind: dict[str, str] = {}     # cursor -> its home's instruction ("LAC" in a guard), once laid out
        self.named: set[str] = set()            # routines a member's word names
        self.named_data: set[str] = set()       # arrays of lifted C a member's word names
        self.typedefs: set[str] = set()
        self.carried: dict[str, str] = {}      # a jump's home -> the field whose word it carries
        self.cleared: str | None = None        # the cursor the table's clearing loop is homed in
        self.exit = next((p["exit"] for p in self.spec.get("place", []) if "exit" in p), None)
        self.labels = 0
        self.pools_used: set[str] = set()      # pool fields the unit's code names
        self.shared_keys: dict[tuple, str] = {} # (Network, its arguments) run last by branches -> label
        self.args_done_after: str | None = None
        self.homed_pointers: set[str] = set()  # fields held in the address of an instruction
        self.home_laid_out: set[str] = set()   # those whose home is laid out already

    def initial(self, dotted: str) -> str:
        rec, fld = dotted.split(".")
        e = self.prog.records[rec].fields[fld][1]
        if e is not None and e[0] == "call" and runs.instruction_call(e[1], e[2]):
            return self.instruction(e, self.binds.c_name)
        return Function.constant(e) if e is not None else "0"

    def instruction(self, e, word) -> str:
        """An instruction as the dialect builds its word: the constructor,
        and the address of the word it names (`word` gives a field's C
        name), the routine, or the number."""
        ctor = INSTRUCTIONS[e[1]]
        if not e[2]:
            return ctor
        x = e[2][0]
        if x[0] == "num":
            return f"{ctor}({octal(x[1])})"
        if x[0] == "name" and x[1] in self.prog.routines:
            self.named.add(x[1])
            return f"{ctor}({self.binds.bound[x[1]].symbol})"
        if (d := dotted_of(x)) is None:
            raise BindError(f"{self.path.name}: an instruction names a field, a routine or a number: {x!r}")
        return f"{ctor}(&{word(d)})"

    def slots(self, p: dict) -> list[str]:
        """Slots of a collection's field laid out as data words, with their
        RUNS initial values, then `reserve` words no rule reads."""
        rec, fld = p["slots"].split(".")
        lo, hi = p["range"]
        e = self.prog.records[rec].fields[fld][1]
        values = e[1][lo:hi + 1] if e is not None and e[0] == "slots" else [e] * (hi - lo + 1)
        name = f"{self.binds.c_name(p['slots'])}_{octal(lo)}"
        out = [f"word {name}[{octal(hi - lo + 1)}] = {{ {', '.join(Function.constant(v) for v in values)} }};"]
        if p.get("reserve"):
            out.append(f"RESERVE word {name}_spare[{octal(p['reserve'])}];")
        return out

    def table_words(self) -> str:
        """The object table's words. The tape does not load them, and a new
        game clears them before anything reads them: each field's RUNS
        initial value is its zero word."""
        for f in self.binds.table_fields():
            rec, fld = f.split(".")
            e = self.prog.records[rec].fields[fld][1]
            if not (e == ("num", 0) or e[0] == "name" and self.binds.spelled.get(
                    self.prog.member(e[1]), {}).get(e[1]) == 0):
                raise BindError(f"{self.path.name}: {f} is not on the tape, so it starts at its zero word")
        return f"RESERVE word {self.binds.table['at']}[{octal(self.binds.table_size())}];"

    def check_unstored(self):
        """A field with no data word cannot carry an initial value onto the
        tape: an entry word is punched as 0, a register holds what the
        caller left, a pool word or an instruction what the program first
        stores there. Its RUNS initial value must be 0."""
        fields = set(self.binds.pool) | set(self.binds.homes)
        for p in self.spec.get("place", []) + self.spec.get("inline", []):
            if "routine" in p:
                b = self.binds.bound[p["routine"]]
                fields |= {b.entry, b.ac_param, b.io_param, b.byname, *b.result, *b.cells} - {None}
        for f in sorted(fields - set(self.binds.placed)):
            rec, fld = f.split(".")
            e = self.prog.records[rec].fields[fld][1]
            if e is not None and e != ("num", 0):
                raise BindError(f"{self.path.name}: {f} has no data word, so its initial value is 0")

    def shift_homes(self, stmts):
        """Each field held in a shift instruction: the shift it is, from the
        pair operators that take it as their count; for one held as a
        pointer into a table, the counts the text sets it to, in order."""
        for s in walk(stmts):
            if s[0] in ("let", "set") and s[2][0] == "call" and s[2][1] in PAIR_OPS and len(s[2][2]) == 3 \
                    and (f := dotted_of(s[2][2][2])) in self.binds.homes:
                if self.kinds.setdefault(f, s[2][1]) != s[2][1]:
                    raise BindError(f"{s[-1]}: {f} is one shift instruction, {self.kinds[f]}")
            if s[0] == "set" and (f := dotted_of(s[1])) in self.binds.homes \
                    and self.binds.homes[f] == "table":
                if s[2][0] != "num":
                    raise BindError(f"{s[-1]}: {f} is a table entry, so it is set to a number")
                if s[2][1] not in (table := self.tables.setdefault(f, [])):
                    table.append(s[2][1])

    def routine(self, b: Bound) -> list[str]:
        out = []
        r = self.prog.routines[b.name]
        self.pool_locals |= b.pool
        if b.block:
            own = {f: leaf(f) for f, _ in b.params()}
            wrapper = Function(self, b, own, [])
            if not b.block_takes_entry:
                wrapper.emit(1, f"{wrapper.cell(b.entry)} = {leaf(b.entry)};")
            args = ", ".join(leaf(f) for f, _ in b.params(block=True))
            wrapper.emit(1, f"return {b.block}({args});")
            out += [b.declaration(), "{", *wrapper.out, "}"]
            fn = Function(self, b, {f: leaf(f) for f, _ in b.params(block=True)}, self.arguments(self.flat_routine(r)))
            out += [b.declaration(block=True), "{", *fn.compile(), "}"]
        else:
            fn = Function(self, b, {f: leaf(f) for f, _ in b.params()}, self.arguments(self.flat_routine(r)))
            out += [b.declaration(), "{", *fn.compile(), "}"]
        return out

    def flat(self, r: runs.Routine, names: dict | None = None) -> list:
        """A routine's statements in the order the PDP-1 runs them: a
        Processor's body; a Network's Processors in the order it fires
        them, under its guards and loops, with a call where it runs another
        bound routine. A run's arguments stand for the routine's parameters:
        the slot the cursors point at, or a slot by number."""
        names = names or {}
        if r.kind == "processor":
            body = substitute(list(r.body), names)
            if (cleared := self.clears_table(body)) is not None:
                return [cleared]
            return body
        return self.flat_body(substitute(r.body, names), r)

    def label(self, what: str) -> str:
        self.labels += 1
        return f"{what}{self.labels}"

    def flat_routine(self, r: runs.Routine) -> list:
        """A bound routine's statements. A Network it runs as the last thing
        of several branches is laid out once, where the last of them runs
        it, and the others jump there. When the branches are the arms of a
        jump table, it is laid out in the first arm, which the code after
        the table follows (Function.jump_table)."""
        self.args_done_after = self.binds.bound[r.name].args_done if r.name in self.binds.bound else None
        stmts = self.flat(r)
        runs_at: list[str] = []
        first: set[str] = set()

        def collect(items, table=False):
            for s in items:
                if s[0] == "shared":
                    runs_at.append(s[1])
                    if table:
                        first.add(s[1])
                    collect(s[2], table)
                elif s[0] == "if":
                    inner = table or table_cases(s) is not None
                    for _, b in s[1]:
                        collect(b, inner)
                    collect(s[2], inner)
                elif s[0] in ("loop", "slots"):
                    collect(s[-2])
        collect(stmts)
        seen: dict[str, int] = {}

        def rebuild(items):
            out = []
            for s in items:
                if s[0] == "shared":
                    seen[s[1]] = seen.get(s[1], 0) + 1
                    if runs_at.count(s[1]) == 1:
                        out += rebuild(s[2])
                    elif seen[s[1]] == (1 if s[1] in first else runs_at.count(s[1])):
                        out += [("label", s[1], s[-1])] + rebuild(s[2])
                    else:
                        out.append(("goto", s[1], s[-1]))
                elif s[0] == "if":
                    out.append(("if", [(c, rebuild(b)) for c, b in s[1]], rebuild(s[2]), s[3]))
                elif s[0] in ("loop", "slots"):
                    out.append((*s[:-2], rebuild(s[-2]), s[-1]))
                else:
                    out.append(s)
            return out
        return rebuild(stmts)

    def flat_body(self, items: list, r: runs.Routine, in_slots: bool = False) -> list:
        out: list = []
        back = None
        for n, s in enumerate(items):
            op = s[0]
            if back and op == "run" and s[1] == back:
                back = None                 # the extern jumps back into it
                continue
            if op == "if":
                out.append(("if", [(c, self.flat_body(b, r, in_slots)) for c, b in s[1]],
                            self.flat_body(s[2], r, in_slots), s[3]))
            elif op == "loop":
                out.append(("loop", s[1], self.flat_body(s[2], r, in_slots), s[3]))
            elif op == "for":
                _, var, lo, hi, body, where = s
                out.append(("slots", var, lo, hi, self.flat_body(body, r, True), where))
            elif op == "match":
                out.append(self.dispatch(s))
            elif op in ("break", "wait", "stop"):
                out.append(s)
            elif op == "run":
                name, args = s[1], s[2]
                if name in self.binds.bound and name != r.name:
                    params = self.prog.routines[name].params if name in self.prog.routines else \
                        [a[1] for a in args if a[0] == "name"]
                    if args != [("name", p) for p in params] or not set(params) <= set(r.params):
                        raise BindError(f"{s[-1]}: run {name} passes only the slot the cursors point at")
                    self.callees.add(name)
                    out.append(("call", name, {}, s[-1]))
                    callee = self.binds.bound[name]
                    if callee.code:
                        # code a Record holds jumps back to the routine the Network runs next
                        if n + 1 >= len(items) or items[n + 1][0] != "run":
                            raise BindError(f"{s[-1]}: {name} runs code that jumps back: run where next")
                        callee.back = items[n + 1][1]
                    back = callee.back
                    if back and (n + 1 >= len(items) or items[n + 1][:2] != ("run", back)):
                        raise BindError(f"{s[-1]}: {name} jumps back to {back}, so run {back} comes next")
                    continue
                inner = self.prog.routines.get(name)
                if inner is None:
                    raise BindError(f"{s[-1]}: {name} is neither ported nor bound")
                body = self.flat(inner, dict(zip(inner.params, args)))
                if inner.kind == "processor" and has_return(inner.body) and (in_slots or n < len(items) - 1):
                    end = self.label("done")
                    body = returns_to(body, end) + [("label", end, s[-1])]
                homes = {f for f, proc in self.walk.get("home_in", {}).items() if proc == name}
                if inner.kind == "network" and n == len(items) - 1:
                    key = self.shared_keys.setdefault((name, repr(args)), name if not args else
                                                      f"{name}_{len(self.shared_keys)}")
                    out.append(("shared", key, mark_homes(body, homes), s[-1]))
                    continue
                out += mark_homes(body, homes)
                if name == self.walk.get("set_after"):
                    out.append(("cursors", s[-1]))
                if name == self.args_done_after:
                    out.append(("args_done", s[-1]))
            else:
                raise BindError(f"{s[-1]}: cannot compile {op} in a Network")
        return out

    def dispatch(self, s) -> tuple:
        """A match over a field whose members are spelled as the routines its
        arms run: a jump through the field's word."""
        _, e, arms, where = s
        enum = None
        for member, body in arms.items():
            enum = self.prog.member(member)
            how = self.binds.spelled.get(enum, {}).get(member)
            if body and body[0][0] == "unreachable" and how == 0:
                continue
            named = how.get("routine") if isinstance(how, dict) else None
            if named in self.binds.jsp_slots:       # a slot that jumps on to another routine
                named = self.binds.jsp_slots[named]["jump"] if body and body[0][1] != named else named
            if not (len(body) == 1 and body[0][0] == "run" and named == body[0][1]):
                raise BindError(f"{where}: {member} runs {body}, not the routine its word names")
        return ("dispatch", e, where, [body[0][1] for body in arms.values() if body[0][0] == "run"])

    def clears_table(self, body: list):
        """A Processor that sets every field of the table's Records to its
        zero word in every slot: the clearing loop over the whole table."""
        table = self.binds.table
        if not table or not body or any(x[0] != "for" for x in body):
            return None
        cleared = set()
        for _, var, lo, hi, inner, where in body:
            for x in inner:
                d = dotted_of(x[1][1]) if x[0] == "set" and x[1][0] == "index" else None
                if d is None or x[1][2] != ("name", var) or not self.zero(x[2]):
                    return None
                rec = d.split(".")[0]
                if lo != ("num", 0) or hi != ("num", self.prog.records[rec].count - 1):
                    return None
                cleared.add(d)
        if cleared != set(self.binds.table_fields()):
            return None
        return ("clear", body[0][-1])

    def zero(self, e) -> bool:
        if e == ("num", 0):
            return True
        enum = self.prog.member(e[1]) if e[0] == "name" else None
        return enum is not None and self.binds.spelled.get(enum, {}).get(e[1]) == 0

    def arguments(self, stmts: list) -> list:
        """The sets of a callee's parameter fields just before its call are
        the call's arguments. A field that lives in a register is passed in
        it. A jump into the callee's block stores its entry word itself, as
        jda would have, and passes it in AC."""
        out: list = []
        for s in stmts:
            if s[0] == "if":
                out.append(("if", [(c, self.arguments(b)) for c, b in s[1]], self.arguments(s[2]), s[3]))
                continue
            if s[0] == "loop":
                out.append(("loop", s[1], self.arguments(s[2]), s[3]))
                continue
            if s[0] != "call":
                out.append(s)
                continue
            callee = self.binds.bound[s[1]]
            jump = self.jumps(callee, s, stmts)
            params = [f for f, _ in callee.params(block=jump)]
            args = {f: as_field(f) for f in params if self.binds.in_register(f, self.path) and f != callee.inline}
            while out and out[-1][0] == "set" and (target := dotted_of(out[-1][1])) in params \
                    and target not in args and not (jump and target == callee.entry):
                args[target] = out.pop()[2]
            if jump and callee.entry in params:
                args[callee.entry] = as_field(callee.entry)
            if missing := [f for f in params if f not in args]:
                raise BindError(f"{s[-1]}: run {callee.name} without setting {missing} just before")
            out.append(("call", s[1], args, s[-1]))
        return out

    def jumps(self, callee: Bound, call, stmts: list) -> bool:
        """A run of a routine of this unit that has a block, as the last
        thing a routine does, is a jump into the block."""
        return bool(callee.block) and callee.unit == self.path and stmts[-1] is call

    def machine(self, p: dict, head: list[str]) -> list[str]:
        """Words the PDP-1 and its operator need, which no game rule reads.
        The sequence break: the machine saves AC, PC and IO in words 0-2
        and runs word 3, a jump to the flush, which resumes the interrupted
        program. A jump: a start address, the tape's own when `start`. A JSP
        slot: a routine the operator may rewrite in place, by default a
        jump to another, with room after it. The assembler's pools: the
        literal constants and the pool words. The patch space: room for the
        operator's patches."""
        if p.get("machine") == "constants":
            return ["CONSTANTS();"]
        if p.get("machine") == "variables":
            return ["VARIABLES();"]
        if p.get("machine") == "patch space":
            return [f"RESERVE word patch_space[{octal(p['reserve'])}];"]
        if p.get("machine") == "sequence break":
            head += ["typedef void resume_point(word ac, register word io) BLOCK;",
                     "BLOCK void flush_sequence_break(void);"]
            return ["AT(0) RESERVE word break_ac;", "RESERVE resume_point *break_pc;", "RESERVE word break_io;",
                    "BLOCK void sequence_break(void)", "{", "    return flush_sequence_break();", "}"]
        if p.get("machine") == "sequence break flush":
            return ["BLOCK void flush_sequence_break(void)", "{", "    tyi();", "    register word io = break_io;",
                    "    word ac = break_ac;", "    lsm();", "    return break_pc(ac, io);", "}"]
        if "jsp_slot" in p:
            ret = {"io": "io_word", "ac": "word"}[p["returns"]]
            head.append(f"JSP {ret} {p['jump']}(void);")
            out = [f"AT({octal(p['at'])}) JSP {ret} {p['jsp_slot']}(void)", "{", f"    return {p['jump']}();", "}"]
            if p.get("reserve"):
                out.append(f"RESERVE word {p['jsp_slot']}_space[{octal(p['reserve'])}];")
            return out
        if "jump" in p:
            head.append(f"BLOCK void {p['jump']}(void);")
            start = "START " if p.get("start") else ""
            return [f"{start}BLOCK void vector_{p['jump']}(void)", "{", f"    return {p['jump']}();", "}"]
        raise BindError(f"{self.path.name}: a place is a routine, fields, or a machine word: {p}")

    def compile(self) -> str:
        self.check_unstored()
        for p in self.spec["place"]:
            if "routine" in p:
                self.shift_homes(self.flat_routine(self.prog.routines[p["routine"]]))
        body: list[str] = []
        head: list[str] = [f'#include "{h}"' for h in self.spec.get("include", [])]
        for p in self.spec["place"]:
            if "routine" in p:
                for f in p.get("data", []):
                    kind = "insn" if f in self.binds.insns else "word"
                    head.append(f"{kind} {self.binds.c_name(f)} = {self.initial(f)};")
                body += self.routine(self.binds.bound[p["routine"]])
            elif "fields" in p:
                for f in p["fields"]:
                    body.append(f"word {self.binds.c_name(f)} = {self.initial(f)};")
            elif "slots" in p:
                body += self.slots(p)
            elif "exit" in p:
                head.append(f"BLOCK void {p['exit']}(void);")
                body += [f"BLOCK void {p['exit']}(void)", "{", "}"]
            elif p.get("table"):
                body.append(self.table_words())
            elif "shifts" in p:
                f = p["shifts"]
                entries = ", ".join(f"I_{self.kinds[f].upper()}({octal(n)})" for n in self.tables[f])
                body.append(f"shift {self.binds.c_name(f)}_shifts[{len(self.tables[f])}] = {{ {entries} }};")
            else:
                body += self.machine(p, head)
        inline: list[str] = []
        done: set[str] = set()
        while todo := sorted(n for n in self.callees - done if self.binds.bound[n].convention == "INLINE"):
            for name in todo:
                done.add(name)
                inline = self.routine(self.binds.bound[name]) + inline
        for name in [p["routine"] for p in self.spec["place"] if "routine" in p] + sorted(self.callees - done):
            b = self.binds.bound[name]
            if name in self.binds.carried:
                # a jump through the homed word a walk carries a field's word into
                self.typedefs.add("typedef void block_code(void) BLOCK;")
                head.append(f"HOMED block_code *{name};")
                continue
            head.append(b.declaration() + ";")
            if b.block and b.unit == self.path:
                head.append(b.declaration(block=True) + ";")
        head = list(dict.fromkeys(head))
        head += [f"extern word {self.binds.c_name(f)};" for f in sorted(self.externs)]
        head += [f"ENTRY_CELL({self.binds.cell_of[f]}) word {'*' if f in self.binds.pointers else ''}"
                 f"{self.binds.c_name(f)};" for f in sorted(self.cells_used)]
        # A pool field a lifted header of the unit names is declared there.
        headers = "".join((SPACEWAR_C / "lift" / h).read_text() for h in self.spec.get("include", []))
        head += [f"POOL word {self.binds.c_name(f)};" for f in sorted(set(self.spec.get("pool", [])) | self.pools_used)
                 if not re.search(rf"\b{self.binds.c_name(f)}\b", headers)]
        head += [f"POOL word {name};" for name in sorted(self.pool_locals)]
        for name in sorted(self.named):
            if name in self.binds.bound:
                head.append(self.binds.bound[name].declaration() + ";")
            elif name in self.binds.jsp_slots:
                head.append(f"JSP {'io_word' if self.binds.jsp_slots[name]['returns'] == 'io' else 'word'} {name}(void);")
            else:
                raise BindError(f"{self.path.name}: a member's word names {name}, which no binding binds")
        head += [f"extern word {name}[];" for name in sorted(self.named_data)]
        head += [f"extern HOMED block_code *{into};" for into in sorted(self.carried)]
        head += [f"HOMED word *{c};" for c in sorted(self.homed)]
        head += [f"HOMED word *{self.binds.c_name(f)};" for f in sorted(self.homed_pointers)]
        if stray := self.walk.get("stray"):
            head.append(f"POOL word *{stray['cursor']};")
        if self.cleared:
            head.append(f"HOMED word *{self.cleared} = 0;")
        head = [h for h in head if not h.startswith("#include")]
        head = [f'#include "{h}"' for h in self.spec.get("include", [])] + sorted(self.typedefs) \
            + list(dict.fromkeys(head))
        for f in sorted(self.kinds):
            name = self.binds.c_name(f)
            if self.binds.homes[f] == "table":
                head += [f"HOMED const shift *{name};", f"extern shift {name}_shifts[{len(self.tables[f])}];"]
            else:
                head.append(f"HOMED shift {name} = SHIFT_UNSET;")
        return "\n".join(head + inline + body) + "\n"


class Function:
    """One C function's body from the RUNS statements it runs."""

    def __init__(self, unit: Unit, bound: Bound, own: dict[str, str], stmts: list):
        self.unit = unit
        self.binds = unit.binds
        self.b = bound
        self.own = own                          # field -> C parameter
        self.stmts = stmts
        self.out: list[str] = []
        self.tail: list[str] = []               # laid out after the body: see loop
        self.scopes: list[set[str]] = [set(own.values())]
        self.alias: dict[str, str] = {}         # field or local -> C expression
        self.io_names = {leaf(f) if "." in f else f for f in bound.io | self.binds.io_fields}
        self.rest: list[list] = []              # what runs after the statement being compiled
        self.loops: list[tuple[str, str] | None] = []   # (break, continue) labels; None: a C loop
        self.labels = 0
        self.merged_head: tuple[object, str] | None = None
        self.results: dict[str, str] = {}       # callee -> its result's C local
        self.cursor_params = set(unit.prog.routines[bound.name].params)
        self.pending: tuple[str, str, int] | None = None    # (field, call, depth): a result in AC, see call
        self.consumed: tuple | None = None
        self.nested = 0
        self.top: list[str] = []                # declared at the function's top
        self.known: dict[str, int] = {}         # table-held field -> the count it holds here
        self.slot_maps: list[tuple[str, dict]] = []     # (slot variable, field -> cursor) of each walk
        self.resting: tuple[int, dict] | None = None    # the slot the cursors rest on after a walk
        self.held: dict = {}                    # a guard's read of a field, kept: key -> (C local, "ac"/"io")
        self.held_xor: tuple | None = None      # (field and member, C local, guards left) of a shared xor
        self.chained: dict[str, list[str]] = {} # a field holding a slot -> the fields whose cursors are set
        self.depth = 1                          # the depth of the statement being compiled
        self.has_table = any(x[0] == "if" and table_cases(x) for x in walk(stmts))
        self.heads: dict[int, tuple[str, int]] = {}  # id of a rotated loop -> (its second entry, statements)
        self.data_placed = False
        self.pair_halves(stmts)

    # ---- names

    def label(self, what: str) -> str:
        self.labels += 1
        return f"{what}{self.labels}"

    def cell(self, dotted: str) -> str:
        self.unit.cells_used.add(dotted)
        return self.binds.c_name(dotted)

    def own_result_local(self, dotted: str) -> bool:
        """A result held only in AC: a C local of this function."""
        return dotted in self.b.result and not self.binds.stored(dotted) and dotted not in self.binds.io_fields

    def place(self, dotted: str) -> str:
        if dotted in self.binds.devices:
            return f"{self.binds.devices[dotted]['read']}()"
        if dotted in self.binds.addresses:
            if self.binds.addresses[dotted] != "after table":
                raise BindError(f"{dotted}: no address {self.binds.addresses[dotted]!r}")
            return f"{self.binds.table['at']} + {octal(self.binds.table_size())}"
        if self.pending and self.pending[0] == dotted and self.pending[2] == self.nested:
            self.consumed, self.pending = self.pending, None
            return self.consumed[1]
        if dotted in self.alias:
            return self.alias[dotted]
        if dotted in self.own:
            return self.own[dotted]
        if dotted in self.binds.io_fields or self.own_result_local(dotted) \
                or self.binds.in_register(dotted, self.unit.path):
            return leaf(dotted)
        if dotted in self.binds.pool:
            self.unit.pools_used.add(dotted)
            return self.binds.c_name(dotted)
        if self.binds.homes.get(dotted) == "pointer":
            self.unit.homed_pointers.add(dotted)
            return self.binds.c_name(dotted)
        if dotted in self.binds.cell_of:
            return self.cell(dotted)
        if dotted in self.binds.placed:
            if self.binds.placed[dotted] != self.unit.path:
                self.unit.externs.add(dotted)
            return self.binds.c_name(dotted)
        raise BindError(f"{self.b.name}: {dotted} has no place in the binding")

    def declared(self, name: str) -> bool:
        return any(name in s for s in self.scopes)

    # ---- expressions

    @staticmethod
    def constant(e) -> str:
        if e[0] == "num":
            return octal(e[1])
        if e[0] == "neg" and e[1][0] == "num":
            return f"-{octal(e[1][1])}" if e[1][1] else "MINUS_ZERO"
        raise BindError(f"an initial value is a number: {e!r}")

    def expr(self, e) -> str:
        return self._expr(e)[0]

    def cursor(self, e) -> str:
        """`record.field[slot]`: through the cursor on the slot, when one
        points at it: the routine's own slot, a walk's, or the slot the
        cursors rest on after a walk. Else, for a slot by number, the word
        in the table. A cursor homed in this unit is read or written at its
        home the first time (or the first time inside the Processor that
        holds its home), and through it everywhere else."""
        d, slot, may_home = dotted_of(e[1]), e[2], len(e) == 4
        cursors = None
        if slot[0] == "name" and slot[1] in self.cursor_params:
            cursors = self.binds.cursors
        elif slot[0] == "name":
            cursors = next((m for v, m in reversed(self.slot_maps) if v == slot[1]), None)
        elif slot[0] == "num" and self.resting and self.resting[0] == slot[1]:
            cursors = self.resting[1]
        elif slot[0] == "num" and self.binds.table:
            return f"{self.binds.table['at']}[{octal(self.binds.table_offset(d) + slot[1])}]"
        elif (held := dotted_of(slot)) in self.binds.slot_cursors:
            cursors = self.binds.slot_cursors[held]
            self.chain(held, d)
        elif self.binds.into.get(held) == d:
            # a field that holds a place in the collection holds its address
            p = self.place(held)
            if self.binds.homes.get(held) == "pointer" and held not in self.unit.home_laid_out:
                self.unit.home_laid_out.add(held)
                return f"*home({p})"
            return f"*{p}"
        if cursors is None or d not in cursors:
            raise BindError(f"{self.b.name}: no cursor for {e!r}")
        c = cursors[d]
        if c in self.unit.homed and c not in self.unit.home_kind \
                and (self.unit.homed[c] is None or may_home):
            self.unit.home_kind[c] = "laid out"
            return f"*home({c})"
        return f"*{c}"

    def chain(self, held: str, upto: str | None = None):
        """The cursors on the slot a field holds are set in the table's
        order, each from the one before: the first adds the field's slots
        to the index cursor's home word, the rest add them to the one
        before, which AC still holds. Set up to `upto`, or all of them."""
        cursors = self.binds.slot_cursors[held]
        order = self.table_order(cursors)
        done = self.chained.setdefault(held, [order[0]])
        last = order.index(upto) if upto else len(order) - 1
        for n in range(len(done), last + 1):
            count = octal(self.unit.prog.records[order[n - 1].split(".")[0]].count)
            prev = cursors[order[n - 1]]
            text = f"{count} + {prev}" if n == 1 else f"{prev} + {count}"
            self.emit(self.depth, f"{cursors[order[n]]} = {text};")
            done.append(order[n])

    def slot_store(self, s, depth: int) -> bool:
        """A store into the slot a field holds. A plain value goes through
        IO, for AC holds the cursors' chain; before any other value the rest
        of the chain is set. A value that keeps the word's high bits and
        sets its address part is a dap."""
        _, target, e, _ = s
        held = dotted_of(target[2])
        d = dotted_of(target[1])
        cursors = self.binds.slot_cursors[held]
        if d in self.chained.get(held, [self.table_order(cursors)[0]]):
            plain = False
        else:
            plain = dotted_of(e) is not None or e[0] == "name"
            self.chain(held, d if plain else None)
        if e[0] == "bin" and e[1] == "|" and e[2][0] == "bin" and e[2][1] == "&" and e[2][2] == target \
                and e[2][3] == ("num", 0o770000) and e[3][0] == "num" and e[3][1] < 0o10000:
            word = self.cursor(target)
            word = f"home({word[6:-1]})" if word.startswith("*home(") else word[1:]
            self.emit(depth, f"{word}->addr = {octal(e[3][1])};")
            return True
        if plain:
            local = f"{leaf(d)}_io"
            self.emit(depth, f"register word {local} = {self.expr(e)};")
            self.emit(depth, f"{self.cursor(target)} = {local};")
            return True
        return False

    def member(self, name: str) -> str | None:
        """An enum member as the word that spells it."""
        enum = self.unit.prog.member(name)
        if enum is None or self.declared(name) or name in self.alias:
            return None
        how = self.binds.spelled.get(enum, {}).get(name)
        if how is None:
            raise BindError(f"{self.b.name}: the binding spells no word for {enum} {name}")
        if isinstance(how, int):
            return octal(how)
        if "data" in how:
            self.unit.named_data.add(how["data"])
            return how["data"]
        self.unit.named.add(how["routine"])
        if how.get("sign"):
            return f"{how['routine']} | (word){octal(runs.SIGN)}"
        return f"{how['routine']} | (word)0" if how.get("literal") else how["routine"]

    def _expr(self, e) -> tuple[str, int]:
        op = e[0]
        if op == "num":
            return octal(e[1]), 99
        if op == "name":
            if (word := self.member(e[1])) is not None:
                return word, 3 if "|" in word else 99
            if e[1] in self.unit.prog.instructions and not self.declared(e[1]) and e[1] not in self.alias:
                return INSTRUCTIONS[e[1]], 99
            return self.alias.get(e[1], e[1]), 99
        if op == "field":
            if (d := dotted_of(e)) is None:
                raise BindError(f"cannot compile {e!r}")
            return self.place(d), 99
        if op == "index":
            return self.cursor(e), 99
        if op == "neg":
            if e[1] == ("num", 0):
                return "MINUS_ZERO", 99
            return f"-{self._paren(e[1], 11)}", 11
        if op == "bin" and e[1] == ">>" and self.b.shifts == "xct":
            if e[3][0] != "num":
                raise BindError(f"{self.b.name}: a shift executed from a constant has a constant count")
            return f"xct(I_SAR({octal(e[3][1])}), {self.expr(e[2])})", 99
        if op == "bin":
            _, o, a, b = e
            lvl = C_LEVEL[o]
            return f"{self._paren(a, lvl)} {C_OP.get(o, o)} {self._paren(b, lvl + 1)}", lvl
        if op == "call" and runs.instruction_call(e[1], e[2]):
            return self.unit.instruction(e, self.place), 99
        if op == "call":
            return f"{e[1]}({', '.join(self.expr(a) for a in e[2])})", 99
        raise BindError(f"cannot compile {e!r}")

    def _paren(self, e, at_least: int) -> str:
        text, lvl = self._expr(e)
        return text if lvl >= at_least else f"({text})"

    def io_resident(self) -> set[str]:
        return self.io_names | {c for c in self.alias.values() if c.endswith(".lo")}

    def switch_test(self, e, negate: bool = False) -> str | None:
        """`field == m` for a field held in a sense switch or a program
        flag: the machine's test of it, `sense(n)` or `flag(n)`."""
        if e[0] != "bin" or e[1] not in ("==", "!=") or (d := dotted_of(e[2])) is None or e[3][0] != "name":
            return None
        if "sense" in self.binds.devices.get(d, {}):
            test = f"sense({self.binds.devices[d]['sense']})"
        elif d in self.binds.flags:
            test = f"flag({self.binds.flags[d]})"
        else:
            return None
        how = self.binds.spelled.get(self.unit.prog.member(e[3][1]), {}).get(e[3][1])
        if how not in (0, 1):
            raise BindError(f"{self.b.name}: {d} holds a member spelled 0 or 1")
        holds = (how == 1) == (e[1] == "==") != negate
        return test if holds else f"!{test}"

    def cond(self, e, negate: bool = False) -> str:
        if (text := self.switch_test(e, negate)) is not None:
            return text
        if negate:
            if e[0] != "bin" or e[1] not in NEGATED:
                raise BindError(f"cannot negate {e!r}")
            e = ("bin", NEGATED[e[1]], e[2], e[3])
        return self.expr(e)

    # ---- statements

    def emit(self, depth: int, text: str):
        self.out.append("    " * depth + text)

    def compile(self) -> list[str]:
        if any(b.pulse and b.back == self.b.name for b in self.binds.bound.values()):
            self.emit(1, "ioh();")              # wait for the pulse the code that jumps here left pending
        self.block(self.stmts, 1, top=True)
        if self.tail:
            if not self.out or not self.out[-1].lstrip().startswith(("return", "goto")):
                raise BindError(f"{self.b.name}: code laid out after the body needs the body to end in a jump")
            self.out += self.tail
        return ["    " + line for line in self.top] + self.out

    def block(self, stmts: list, depth: int, top: bool = False):
        """A pending call result (see call) is taken up by the statement
        right after the call, or the call stands alone before it."""
        self.scopes.append(set())
        entries = {}
        for j, x in enumerate(stmts):
            if x[0] == "loop" and (m := self.rotated(stmts[:j], x)):
                entries[j - m] = self.heads[id(x)] = (self.label("enter"), m)
        k = 0
        while k < len(stmts):
            if k in entries:
                self.emit(depth - 1, f"{entries[k][0]}:")
            before, mark = self.pending, len(self.out)
            self.rest.append(stmts[k + 1:])
            done = self.stmt(stmts, k, depth, top)
            self.rest.pop()
            if before is not None and self.consumed is not before:
                self.out.insert(mark, "    " * depth + before[1] + ";")
                if self.pending is before:
                    self.pending = None
            self.spill(stmts[k:k + done], stmts[k + done:], depth)
            k += done
        if self.pending is not None and self.pending[2] == self.nested:
            self.emit(depth, self.pending[1] + ";")
            self.pending = None
        if top and falls_off(stmts) and not self.out[-1].lstrip().startswith(("return", "goto")):
            self.emit(depth, self.return_text())
        self.scopes.pop()

    def spill(self, done: list, rest: list, depth: int):
        """An AC local the binding spills is kept in a pool word from its
        last set on, and read from there."""
        for name in self.b.spill - set(self.alias):
            sets = lambda stmts: any(x[0] in ("let", "set") and x[1] == ("name", name) for x in walk(stmts))
            if sets(done) and not sets(rest) and runs.mentions(rest, {name}):
                kept = f"{name}_kept"
                self.unit.pool_locals.add(kept)
                self.emit(depth, f"{kept} = {name};")
                self.alias[name] = kept

    def body(self, stmts: list, depth: int, head: list[str] = ()):
        self.emit(depth, "{")
        for line in head:
            self.emit(depth + 1, line)
        self.nested += 1
        self.block(stmts, depth + 1)
        self.nested -= 1
        self.emit(depth, "}")

    def declare_top(self, line: str):
        if line not in self.top:
            self.top.append(line)

    def ac_resident(self, text: str) -> bool:
        return text.endswith(".hi") or any(text in s for s in self.scopes) and text not in self.io_resident()

    def pair_halves(self, stmts: list):
        """A pair shifted by an executed shift instruction is one dword
        local, `pair`: xct returns the pair whole. Its two halves are that
        local's, through the whole function."""
        for s in walk(stmts):
            if s[0] in ("let", "set") and s[1][0] == "tuple" and s[2][0] == "call" \
                    and dotted_of(s[2][2][2]) in self.binds.homes:
                for half, part in zip(s[2][2][:2], ("pair.hi", "pair.lo")):
                    key = dotted_of(half) or half[1]
                    if self.alias.setdefault(key, part) != part:
                        raise BindError(f"{s[-1]}: one pair is shifted by executed shifts")
                self.declare_top("dword pair;")

    def read_later(self, name: str) -> bool:
        names = {name}
        return any(runs.mentions(r, names) or self.mentions_field(r, name) for r in self.rest)

    @staticmethod
    def mentions_field(tree, dotted: str) -> bool:
        if isinstance(tree, tuple) and tree and tree[0] == "field":
            return dotted_of(tree) == dotted
        if isinstance(tree, dict):
            tree = list(tree.values())
        return isinstance(tree, (list, tuple)) and any(Function.mentions_field(t, dotted) for t in tree)

    def return_text(self, value: str | None = None) -> str:
        if value is not None:
            return f"return {value};"
        if self.b.convention == "BLOCK" and self.unit.exit:
            # the unit's blocks leave through its shared exit
            return f"return {self.unit.exit}();"
        if self.b.convention == "BLOCK":
            # a firing ends here: the machine runs the frame again
            return f"return {self.unit.spec['repeat']}();"
        res = [self.place(f) for f in self.b.result]
        if not res:
            return "return;"
        if len(res) == 1:
            return f"return {res[0]};"
        return f"return (dword){{ {res[0]}, {res[1]} }};"

    def incremented(self, s):
        """`set x = x + 1`: the place x, else None."""
        if s[0] == "set" and s[2][0] == "bin" and s[2][1] == "+" and s[2][3] == ("num", 1) \
                and s[2][2] == s[1]:
            return s[1]
        return None

    def one_instruction(self, s, nxt) -> str | None:
        """`set a = -a` on an AC local, then `set f = 0` on a place in IO:
        cma and cli, which the PDP-1 does as one instruction. Likewise a
        program flag set, then a new AC local set to 0: clf and cla."""
        if nxt and s[0] == "set" and dotted_of(s[1]) in self.binds.flags and nxt[0] == "let" \
                and nxt[1][0] == "name" and nxt[2] == ("num", 0) and nxt[1][1] not in self.b.io:
            name = nxt[1][1]
            self.declare_top(f"word {name};")
            self.scopes[0].add(name)
            flag = self.binds.flags[dotted_of(s[1])]
            how = self.binds.spelled.get(self.unit.prog.member(s[2][1]), {}).get(s[2][1])
            return f"{'stf' if how else 'clf'}({flag}), {name} = 0;"
        if not (nxt and s[0] == nxt[0] == "set" and s[1][0] == "name" and s[2] == ("neg", s[1])
                and nxt[2] == ("num", 0) and nxt[1][0] != "tuple"):
            return None
        a, io = self.expr(s[1]), self.expr(nxt[1])
        if not self.ac_resident(a) or io not in self.io_resident():
            return None
        return f"{a} = -{a}, {io} = 0;"

    def stmt(self, stmts: list, k: int, depth: int, top: bool) -> int:
        s = stmts[k]
        op = s[0]
        nxt = stmts[k + 1] if k + 1 < len(stmts) else None
        last = top and nxt is None
        self.depth = depth
        if op == "set" and nxt and (pointer := self.through(s[1])) and self.incremented(nxt) == s[1][2]:
            # a word into the place a field holds, and the field steps on
            self.emit(depth, f"*{self.place(pointer)}++ = {self.expr(s[2])};")
            return 2
        if op == "stop":
            # the machine halts, and halts again each time it is continued
            self.emit(depth, "for (;;)")
            self.emit(depth + 1, "hlt();")
            return 1
        if op == "set" and (held := dotted_of(s[1])) in self.binds.slot_cursors:
            if s[2] != ("num", 0):
                raise BindError(f"{s[-1]}: {held} is a cursor: it starts at slot 0 and steps in a search")
            first = self.table_order(self.binds.slot_cursors[held])[0]
            offset = self.binds.table_offset(first)
            self.emit(depth, f"{self.binds.slot_cursors[held][first]} = {self.binds.table['at']}"
                             + (f" + {octal(offset)}" if offset else "") + ";")
            self.chained[held] = [first]
            return 1
        plain_store = op == "set" and s[1][0] == "index" and dotted_of(s[1][2]) in self.binds.slot_cursors \
            and (dotted_of(s[2]) is not None or s[2][0] == "name")
        for held, done in list(self.chained.items()):
            if 1 < len(done) < len(self.binds.slot_cursors[held]) and not plain_store:
                self.chain(held)                # AC is wanted for something else: finish the chain
        if op == "set" and s[1][0] == "index" and dotted_of(s[1][2]) in self.binds.slot_cursors \
                and self.slot_store(s, depth):
            return 1
        if op == "loop" and (search := self.search(s)) is not None:
            self.search_loop(s, search, depth)
            return 1
        if op == "slots":
            self.slots(s, depth)
            return 1
        if op == "dispatch":
            self.dispatch(s, depth)
            return 1
        if op == "cursors":
            self.set_cursors(depth)
            return 1
        if op == "clear":
            self.clear(depth)
            return 1
        if op == "wait":
            raise BindError(f"{s[-1]}: the binding waits only in the halt that shows a stream")
        if op == "set" and nxt and nxt[0] == "set" and nxt[2] == s[2] and s[1][0] != "tuple" \
                and nxt[1][0] != "tuple" and not re.fullmatch(r"-?\w+", self.expr(s[2])):
            # One value stored in two places: loaded once, kept in AC.
            local = self.label("value")
            self.emit(depth, f"word {local} = {self.expr(s[2])};")
            self.scopes[-1].add(local)
            for x in (s, nxt):
                self.assign((x[0], x[1], ("name", local), x[3]), None, False, depth)
            return 2
        if (target := self.incremented(s)) is not None:
            text = self.expr(target)
            if nxt and nxt[0] == "if" and len(nxt[1]) == 1 \
                    and nxt[1][0][0][0] == "bin" and nxt[1][0][0][2] == target and nxt[1][0][0][3] == ("num", 0):
                self.if_stmt(nxt, depth, f"++{text} {nxt[1][0][0][1]} 0")
                return 2
            self.emit(depth, f"++{text};")
            return 1
        if (text := self.one_instruction(s, nxt)) is not None:
            self.emit(depth, text)
            return 2
        if op in ("let", "set") and s[1][0] == "tuple":
            self.pair(s, depth)
            return 1
        if op == "let" and (rotated := self.rotated_operand(s)) is not None:
            # pdp1cc rotates a local in place: take the operand into the local first
            name = s[1][1]
            self.emit(depth, f"word {name} = {self.expr(rotated)};")
            self.scopes[-1].add(name)
            self.emit(depth, f"{name} = {self.expr(self.with_operand(s[2], name))};")
            return 1
        if op == "let":
            name = s[1][1]
            if name in self.b.io and (held := self.expr(s[2])) in self.io_resident():
                self.alias[name] = held             # already in IO: no move
                return 1
            if name in self.alias or name in self.b.pool:
                self.emit(depth, f"{self.alias.get(name, name)} = {self.expr(s[2])};")
                return 1
            if self.declared(name):             # a let of another Processor laid out in this function
                self.emit(depth, f"{name} = {self.expr(s[2])};")
                return 1
            self.emit(depth, f"{'register word' if name in self.b.io else 'word'} {name} = {self.expr(s[2])};")
            self.scopes[-1].add(name)
            return 1
        if op == "emit":
            return self.display(s, nxt, depth)
        if op == "goto":
            self.emit(depth, f"goto {s[1]};")
            return 1
        if op == "label":
            self.emit(depth, f"{s[1]}:")
            self.known.clear()
            return 1
        if op == "set":
            return self.assign(s, nxt, last, depth)
        if op == "call":
            self.call(s, last, depth)
            return 1
        if op == "for":
            _, var, lo, hi, body, where = s
            if lo[0] != "num" or hi[0] != "num" or runs.mentions(body, {var}):
                raise BindError(f"{where}: a counted loop has constant bounds and does not read its index")
            self.emit(depth, f"for (int i = 0; i < {octal(hi[1] - lo[1] + 1)}; i++)")
            self.loops.append(None)
            self.body(body, depth)
            self.loops.pop()
            return 1
        if op == "args_done":
            self.emit(depth, "ARGS_DONE();")
            return 1
        if op == "loop":
            if self.b.loops == "exit first":
                self.loop(s, depth)
            elif self.exits_last(s[2]):
                self.bottom_loop(s, depth)
            elif self.rotated([], s) is not None:
                self.rotated_loop(s, depth, last)
            else:
                self.emit(depth, "for (;;)")
                self.loops.append(None)
                self.body(s[2], depth)
                self.loops.pop()
            return 1
        if op == "if" and table_cases(s):
            self.jump_table(s, depth)
            return 1
        if op == "if":
            _, arms, other, _ = s
            if self.b.loops == "exit first" and nxt and nxt[0] == "loop" and len(arms) == 1 and not other \
                    and len(arms[0][1]) == 1 and nxt[2] and nxt[2][-1][:-1] == arms[0][1][0][:-1]:
                head = self.label("loop")
                self.merged_head = (nxt, head)
                self.emit(depth, f"if ({self.cond(arms[0][0])})")
                self.body(arms[0][1], depth, head=[f"{head}:"])
                return 1
            if (pair := self.xor_test(arms[0][0])) and len(arms) == 1 and not other and nxt \
                    and nxt[0] == "if" and self.xor_test(nxt[1][0][0]) and \
                    self.xor_test(nxt[1][0][0])[:2] == pair[:2]:
                # Two guards on one comparison: one xor, kept in AC.
                local = self.label("guard")
                self.emit(depth, f"word {local} = {pair[1]} ^ {self.expr(pair[0])};")
                self.scopes[-1].add(local)
                self.held_xor = (pair[:2], local, 2)
            self.if_stmt(s, depth)
            return 1
        if op in ("break", "continue"):
            labels = self.loops[-1] if self.loops else None
            if labels is None:
                self.emit(depth, f"{op};")
            elif op == "break" and labels[0] is None:
                self.emit(depth, self.return_text())        # the loop ends the routine
            else:
                self.emit(depth, f"goto {labels[0 if op == 'break' else 1]};")
            return 1
        if op == "return":
            self.emit(depth, self.return_text())
            return 1
        raise BindError(f"{s[-1]}: cannot compile {op}")

    @staticmethod
    def rotated_operand(s):
        """`let v = ...rar(e, n)...` with e not a name: e, else None."""
        for x in walk_expr(s[2]):
            if x[0] == "call" and x[1] in ("ral", "rar") and x[2][0][0] != "name":
                return x[2][0]
        return None

    @staticmethod
    def with_operand(e, name: str):
        if isinstance(e, tuple) and e and e[0] == "call" and e[1] in ("ral", "rar") and e[2][0][0] != "name":
            return ("call", e[1], [("name", name), *e[2][1:]])
        if isinstance(e, tuple):
            return tuple(Function.with_operand(x, name) if isinstance(x, (tuple, list)) else x for x in e)
        if isinstance(e, list):
            return [Function.with_operand(x, name) for x in e]
        return e

    # ---- the table and its cursors

    def table_order(self, cursors: dict) -> list[str]:
        return [f for f in self.binds.table_fields() if f in cursors]

    def set_cursors(self, depth: int):
        """Every cursor on the first slot: one pointer, stepped from the
        table's start by each field's slots, in the table's order."""
        table = self.binds.table["at"]
        fields = self.table_order(self.binds.cursors)
        self.emit(depth, f"word *cursor = {table};")
        for n, f in enumerate(fields):
            if n:
                count = self.unit.prog.records[fields[n - 1].split(".")[0]].count
                self.emit(depth, f"cursor = cursor + {octal(count)};")
            self.emit(depth, f"{self.binds.cursors[f]} = cursor;")

    def slots(self, s, depth: int):
        """A walk over the table's slots. The walk from slot 0 uses the
        cursors set at the frame's start; a walk from a slot after another
        walk's sets its own cursors one past that walk's, and loads what
        the binding carries. Each cursor steps on in the table's order, a
        stray cursor with them; the index cursor steps last and is tested
        against its home instruction one slot past the last."""
        _, var, lo, hi, body, where = s
        walk = self.unit.walk
        if hi[0] != "num":
            raise BindError(f"{where}: a walk over the slots ends at a slot by number")
        if lo == ("num", 0):
            cursors, outer = self.binds.cursors, True
        elif lo[0] == "bin" and lo[1] == "+" and lo[2][0] == "name" and lo[3][0] == "num" and self.slot_maps:
            outer_var, outer_cursors = self.slot_maps[-1]
            if lo[2][1] != outer_var:
                raise BindError(f"{where}: a walk starts past the walk it is in")
            cursors, outer = walk["other"], False
            for f in self.table_order(cursors):
                self.emit(depth, f"{cursors[f]} = {octal(lo[3][1])} + {outer_cursors[f]};")
            for f, into in walk.get("carry", {}).items():
                self.unit.typedefs.add("typedef void block_code(void) BLOCK;")
                self.unit.carried[into] = f
                read = self.cursor(("index", as_field(f), ("name", outer_var)))
                self.emit(depth, f"{into} = (block_code *){read};")
        else:
            raise BindError(f"{where}: a walk starts at slot 0 or one past another walk's slot")
        index = walk["index"]
        top = self.label("slot")
        self.emit(depth, f"{top}:")
        self.slot_maps.append((var, cursors))
        self.block(body, depth)
        self.slot_maps.pop()
        steps = [f for f in self.table_order(cursors) if f != index]
        stray = walk.get("stray") if outer else None
        for f in steps:
            self.emit(depth, f"++{cursors[f]};")
            if stray and stray["after"] == f:
                self.emit(depth, f"++{stray['cursor']};")
        c = cursors[index]
        if self.unit.home_kind.get(c) != "LAC":
            raise BindError(f"{where}: the index cursor {c} has no home in a guard of this walk")
        past = self.binds.table_offset(index) + hi[1] + 1
        self.emit(depth, f"if (I_LAC(++{c}) != I_LAC({self.binds.table['at']} + {octal(past)}))")
        self.emit(depth + 1, f"goto {top};")
        if outer:
            self.resting = (hi[1] + 1, cursors)

    def search(self, s):
        """A loop that steps a field holding a slot and stops when it
        reaches a slot by number: (the field, that slot), else None."""
        body = s[2]
        if len(body) < 2 or body[-1][0] != "if" or len(body[-1][1]) != 1 or body[-1][2]:
            return None
        c = body[-1][1][0][0]
        held = dotted_of(c[2]) if c[0] == "bin" and c[1] == "==" else None
        if held not in self.binds.slot_cursors or c[3][0] != "num" or self.incremented(body[-2]) != c[2]:
            return None
        return held, c[3][1]

    def search_loop(self, s, search, depth: int):
        """The search: the loop's body, then one index of the cursor and a
        test of its home instruction against the one past the last slot
        (idx; sas; jmp), and what the loop runs when it gets there."""
        held, end = search
        body = s[2]
        cursors = self.binds.slot_cursors[held]
        first = self.table_order(cursors)[0]
        top, after = self.label("search"), self.label("found")
        self.emit(depth, f"{top}:")
        self.loops.append((after, top))
        self.block(body[:-2], depth)
        self.loops.pop()
        c = cursors[first]
        kind = self.unit.home_kind.get(c)
        if kind not in ("LAC",):
            raise BindError(f"{s[-1]}: the search's cursor {c} has no home in a guard of its loop")
        past = self.binds.table_offset(first) + end
        self.emit(depth, f"if (I_{kind}(++{c}) != I_{kind}({self.binds.table['at']} + {octal(past)}))")
        self.emit(depth + 1, f"goto {top};")
        self.block(body[-1][1][0][1], depth)
        self.emit(depth, f"{after}:")
        self.chained[held] = [first]

    def dispatch(self, s, depth: int):
        """A jump through the routine word, to the calc routine it names. A
        field in a pool word is a call through it (jsp i), whose result is
        the one every routine it may name returns."""
        _, e, where, targets = s
        if dotted_of(e) in self.binds.pool:
            results = {tuple(self.binds.bound[n].result) for n in targets}
            if len(results) != 1:
                raise BindError(f"{where}: the routines a pool word names return different results")
            (result,) = results
            call = f"{self.place(dotted_of(e))}()"
            if len(result) == 1 and result[0] in self.binds.io_fields:
                self.emit(depth, f"register word {leaf(result[0])} = {call};")
            elif result:
                raise BindError(f"{where}: a call through a pool word returns in IO")
            else:
                self.emit(depth, f"{call};")
            return
        self.unit.typedefs.add("typedef void jsp_routine(void) JSP;")
        key = repr(e)
        held = self.held.pop(key, None)
        word = held[0] if held and held[1] == "ac" else self.expr(e)
        self.emit(depth, f"((jsp_routine *){word})();")

    def clear(self, depth: int):
        """Every word of the table set to 0, by a cursor homed in the dzm."""
        c, table = self.binds.table["clear"], self.binds.table["at"]
        top = self.label("clear")
        self.unit.cleared = c
        self.emit(depth, f"{c} = {table};")
        self.emit(depth, f"{top}:")
        self.emit(depth, f"*home({c}) = 0;")
        self.emit(depth, f"if (I_DZM(++{c}) != I_DZM({table} + {octal(self.binds.table_size())}))")
        self.emit(depth + 1, f"goto {top};")

    def if_stmt(self, s, depth: int, first: str | None = None):
        """An if, its first condition already compiled when `first` is
        given. When the else arm ends in an if whose arm ends with the
        statements of the first arm, those are laid out once, there, and
        the first arm jumps to them. A guard of and and or is laid out as
        jumps. When an arm ends in a jump, what follows the if is its else."""
        _, arms, other, where = s
        if len(arms) == 1 and other and (merged := self.shared_tail(other, arms[0][1])) is not None:
            label, rest = merged
            self.emit(depth, f"if ({first or self.cond(arms[0][0])})")
            self.body([("goto", label, where)], depth)
            self.block(rest, depth)
            return
        if first is None and len(arms) == 1 and self.compound(arms[0][0]) and self.enum_test(arms[0][0]) is None:
            self.jumping(s, depth)
            return
        before, ends = dict(self.known), []
        for n, (c, body) in enumerate(arms):
            head = []
            text = first if first and not n else self.guard(c, body, depth, head)
            self.emit(depth, f"{'else ' if n else ''}if ({text})")
            self.known = dict(before)
            self.body(body, depth, head)
            ends.append(self.known)
        self.known = dict(before)
        if other and len(arms) == 1 and self.ends_in_jump(arms[0][1]):
            self.block(other, depth)
            ends.append(self.known)
        elif other:
            self.emit(depth, "else")
            self.body(other, depth)
            ends.append(self.known)
        self.known = {f: v for f, v in before.items() if all(end.get(f) == v for end in ends)}

    def ends_in_jump(self, stmts: list) -> bool:
        """Control cannot run past the statements: they end in a return, a
        goto, or a run of a block, which the PDP-1 jumps to."""
        if not stmts:
            return False
        x = stmts[-1]
        if x[0] in ("return", "goto"):
            return True
        if x[0] == "call":
            return self.binds.bound[x[1]].convention == "BLOCK"
        if x[0] == "if":
            return bool(x[2]) and all(self.ends_in_jump(b) for b in [b for _, b in x[1]] + [x[2]])
        return False

    @staticmethod
    def compound(c) -> bool:
        return c[0] == "bin" and c[1] in ("and", "or")

    def enum_test(self, c):
        """A guard on one enum field that the words of its members decide by
        sign and zero alone: (the field, the C test of its word against 0).
        `!= m` for every member spelled 0 is `!= 0`; for every member
        spelled with the sign bit, `>= 0`; for both, `> 0`. `== m` for the
        member spelled 0 is `== 0`."""
        terms, stack = [], [c]
        while stack:
            t = stack.pop()
            if t[0] == "bin" and t[1] == "and":
                stack += [t[3], t[2]]
            else:
                terms.append(t)
        place = terms[0][2] if terms[0][0] == "bin" else None
        enum = None
        for t in terms:
            if t[0] != "bin" or t[1] not in ("==", "!=") or t[2] != place or t[3][0] != "name":
                return None
            enum = self.unit.prog.member(t[3][1])
            if enum is None or self.declared(t[3][1]):
                return None
        spelled = self.binds.spelled.get(enum, {})
        zero = {m for m, how in spelled.items() if how == 0}
        sign = {m for m, how in spelled.items() if isinstance(how, dict) and how.get("sign")}
        members = {t[3][1] for t in terms}
        if len(terms) == 1 and terms[0][1] == "==":
            return (place, "== 0") if members == zero else None
        if any(t[1] != "!=" for t in terms):
            return None
        return {frozenset(zero): (place, "!= 0"), frozenset(sign): (place, ">= 0"),
                frozenset(zero | sign): (place, "> 0")}.get(frozenset(members))

    def xor_test(self, c):
        """`field == m` or `!=` for a member spelled as an address: (the
        field, the member's word, the C test of their xor against 0)."""
        if c[0] != "bin" or c[1] not in ("==", "!=") or c[3][0] != "name" or self.switch_test(c) is not None:
            return None
        enum = self.unit.prog.member(c[3][1])
        if enum is None or self.declared(c[3][1]) or self.enum_test(c) is not None:
            return None
        return c[2], self.member(c[3][1]), f"{c[1]} 0"

    def guard(self, c, body: list, depth: int, head: list[str]) -> str:
        """The C condition of a guard. A guard that tests an enum field by
        sign and zero reads the field into a local first, and keeps it for
        the arm's next guard or jump through it: in AC when that comes
        first, else moved to IO (swap), past what the arm runs before it."""
        if (text := self.switch_test(c)) is not None:
            return text
        if (pair := self.xor_test(c)) is not None:
            held = self.held_xor
            if held and held[0] == pair[:2]:
                self.held_xor = (held[0], held[1], held[2] - 1) if held[2] > 1 else None
                return f"{held[1]} {pair[2]}"
            return f"({pair[1]} ^ {self.expr(pair[0])}) {pair[2]}"
        if (test := self.enum_test(c)) is None:
            sign_test = c[0] == "bin" and c[1] in ("<", ">=") and c[3] == ("num", 0)
            for d in sorted(self.b.io_reads):
                if sign_test and c[2][0] == "index" and dotted_of(c[2][1]) == d:
                    # IO tests only the sign (spi)
                    local = f"{self.binds.c_name(d)}_io"
                    self.emit(depth, f"register word {local} = {self.cursor(c[2])};")
                    return f"{local} {c[1]} 0"
                if sign_test and self.mentions_field(c, d):
                    local = f"{self.binds.c_name(d)}_io"
                    self.emit(depth, f"register word {local} = {self.place(d)};")
                    self.alias[d] = local
            text = self.cond(c)
            for d in self.b.io_reads:
                self.alias.pop(d, None)
            return text
        place, against = test
        key = repr(place)
        if key in self.held:
            local, _ = self.held.pop(key)
            return f"{local} {against}"
        local = self.label(place[1][2] if place[0] == "index" else leaf(dotted_of(place)))
        read = self.expr(place)
        if read.startswith("*home("):
            self.unit.home_kind[read[6:-1]] = "LAC"
        self.emit(depth, f"word {local} = {read};")
        self.scopes[-1].add(local)
        nxt = next((j for j, x in enumerate(body) if self.reads(x, key)), None)
        if nxt == 0 and body[0][0] == "dispatch":
            self.held[key] = (local, "ac")
        elif nxt is not None and body[nxt][0] == "if":
            if self.unit.spec.get("moves") != "swap":
                raise BindError(f"{self.b.name}: the binding moves no value from AC to IO")
            head.append(f"register word {local}_io = SWAP({local});")
            self.held[key] = (f"{local}_io", "io")
        return f"{local} {against}"

    def reads(self, x, key: str) -> bool:
        """x is a jump through the field, or a guard on it."""
        if x[0] == "dispatch":
            return repr(x[1]) == key
        if x[0] == "if":
            test = self.enum_test(x[1][0][0])
            return test is not None and repr(test[0]) == key
        return False

    def jumping(self, s, depth: int):
        """An if whose guard joins tests with and and or: each test jumps to
        the arm it decides, the last falls into the first arm. A sign test
        that jumps on its failure keeps its own skip, with the i bit
        flipped (SKIPNOT)."""
        _, ((c, body),), other, where = s
        yes, no = self.label("then"), self.label("else")
        used: set[str] = set()

        def test(e, negate: bool) -> str:
            if (text := self.switch_test(e, negate)) is not None:
                return text
            if (pair := self.xor_test(e)) is not None:
                op = NEGATED[pair[2][:2].strip()] if negate else pair[2][:2].strip()
                return f"({pair[1]} ^ {self.expr(pair[0])}) {op} 0"
            if e[0] == "bin" and e[1] in ("<", ">=") and e[3] == ("num", 0) and negate:
                return f"SKIPNOT({self.cond(e, negate=True)})"
            return self.cond(e, negate=negate)

        def jumps(e, falls: bool):
            """falls: the test after e, or the first arm, runs when e holds."""
            if e[0] == "bin" and e[1] in ("and", "or"):
                jumps(e[2], e[1] == "and")
                jumps(e[3], falls)
            elif falls:
                self.emit(depth, f"if ({test(e, True)})")
                self.emit(depth + 1, f"goto {no};")
                used.add(no)
            else:
                self.emit(depth, f"if ({test(e, False)})")
                self.emit(depth + 1, f"goto {yes};")
                used.add(yes)

        jumps(c, True)
        if yes in used:
            self.emit(depth - 1, f"{yes}:")
        self.block(body, depth)
        if other:
            if not self.ends_in_jump(body):
                raise BindError(f"{where}: the first arm of a jumping guard ends in a jump")
            self.emit(depth - 1, f"{no}:")
            self.block(other, depth)
        elif no in used:
            self.emit(depth - 1, f"{no}: ;")

    def shared_tail(self, stmts: list, tail: list):
        """stmts with `tail`, where it ends the last arm of its last if,
        labelled; None when it does not end there."""
        last = stmts[-1] if stmts else None
        if not last or last[0] != "if" or len(last[1]) != 1 or last[2]:
            return None
        (c, body), where = last[1][0], last[3]
        if len(body) >= len(tail) and body[len(body) - len(tail):] == tail:
            label = self.label("tail")
            inner = body[:len(body) - len(tail)] + [("label", label, where)] + tail
        elif (deeper := self.shared_tail(body, tail)) is not None:
            label, inner = deeper
        else:
            return None
        return label, stmts[:-1] + [("if", [(c, inner)], [], where)]

    def through(self, target) -> str | None:
        """`c[p]` with p a field that holds a place in c: p, else None."""
        if target[0] != "index" or (p := dotted_of(target[2])) is None:
            return None
        return p if self.binds.into.get(p) == dotted_of(target[1]) else None

    def rotated(self, before: list, s) -> int | None:
        """A loop whose body ends in `if c: X` with no else, X not leaving
        the loop: how many of the statements just before the loop X ends
        with (0 when none; None for another shape). Those are laid out once,
        before the loop, and X jumps back to them: the loop's second entry."""
        last = s[2][-1] if s[2] else None
        if not last or last[0] != "if" or len(last[1]) != 1 or last[2] or breaks(last[1][0][1]):
            return None
        arm = last[1][0][1]
        m = 0
        while m < min(len(arm), len(before)) and arm[len(arm) - 1 - m] == before[len(before) - 1 - m]:
            m += 1
        return m

    def rotated_loop(self, s, depth: int, last: bool):
        """The body, then the last if's test negated, jumping back to the
        top; then its arm, and a jump to the loop's second entry or its top.
        A step of the tested field just before the test is one index-and-
        skip (isp). A break of a loop that ends the routine is its return."""
        _, _, body, where = s
        *rest, end = body
        (c, arm), = end[1]
        head, m = self.heads.get(id(s), (None, 0))
        top = self.label("loop")
        after = None if last else self.label("after")
        self.emit(depth - 1, f"{top}:")
        self.loops.append((after, top))
        if rest and c[0] == "bin" and c[1] in NEGATED and c[3] == ("num", 0) \
                and self.incremented(rest[-1]) == c[2]:
            self.block(rest[:-1], depth)
            test = f"++{self.expr(c[2])} {NEGATED[c[1]]} 0"
        else:
            self.block(rest, depth)
            test = self.cond(c, negate=True)
        self.emit(depth, f"if ({test})")
        self.emit(depth + 1, f"goto {top};")
        self.block(arm[:len(arm) - m], depth)
        self.emit(depth, f"goto {head or top};")
        self.loops.pop()
        if after:
            self.emit(depth - 1, f"{after}: ;")

    def jump_table(self, s, depth: int):
        """An if-chain over 0..n is a jump table (switch). The arm of n lies
        in the table and ends in a jump. The other arms lie apart: the first
        right after the table, falling into the code after the chain; the
        rest after the routine's code, each jumping back. Data words the
        binding lays out inside the routine lie after the table, where
        control cannot reach."""
        value, arms = table_cases(s)
        n = sum(len(numbers) for numbers, _ in arms) - 1
        arm_of = {k: a for a, (numbers, _) in enumerate(arms) for k in numbers}
        inline = arm_of[n]
        if not self.ends_in_exit(arms[inline][1]):
            raise BindError(f"{s[-1]}: the last case of a jump table ends in a jump")
        labels = {a: self.label("case") for a in range(len(arms)) if a != inline}
        self.emit(depth, f"switch ((int){self.expr(value)})")
        self.emit(depth, "{")
        for k in range(n):
            self.emit(depth, f"case {k}:")
            if arm_of[k] != arm_of[k + 1]:
                self.emit(depth + 1, f"goto {labels[arm_of[k]]};")
        self.emit(depth, f"case {n}:")
        self.block(arms[inline][1], depth + 1)
        self.emit(depth, "}")
        if self.b.data and not self.data_placed:
            self.emit(depth, f"PLACE({', '.join(self.binds.c_name(f) for f in self.b.data)});")
            self.data_placed = True
        first, *apart = [a for a in range(len(arms)) if a != inline]
        after = self.label("next")
        self.emit(depth - 1, f"{labels[first]}:")
        self.block(arms[first][1], depth)
        if any(not self.ends_in_jump(arms[a][1]) for a in apart):
            self.emit(depth - 1, f"{after}:")
        main, self.out = self.out, []
        for a in apart:
            self.emit(0, f"{labels[a]}:")
            self.block(self.jumping_to(arms[a][1], ("goto", after, s[-1])), 1)
        self.tail += self.out
        self.out = main

    def ends_in_exit(self, stmts: list) -> bool:
        """The statements end in a jump, or a break out of the loop."""
        return bool(stmts) and (stmts[-1][0] == "break" or self.ends_in_jump(stmts))

    def jumping_to(self, stmts: list, jump: tuple) -> list:
        """stmts, then the jump: into each arm of a last if/else."""
        if self.ends_in_jump(stmts):
            return stmts
        last = stmts[-1] if stmts else None
        if last and last[0] == "if" and last[2]:
            return stmts[:-1] + [("if", [(c, self.jumping_to(b, jump)) for c, b in last[1]],
                                  self.jumping_to(last[2], jump), last[3])]
        return stmts + [jump]

    @staticmethod
    def exits_last(body: list) -> bool:
        """The loop's one exit is its last statement, `if c: break`."""
        end = body[-1] if body else None
        return bool(end) and end[0] == "if" and len(end[1]) == 1 and not end[2] \
            and [x[0] for x in end[1][0][1]] == ["break"] and not breaks(body[:-1]) \
            and not any(x[0] == "continue" for x in walk(body))

    def bottom_loop(self, s, depth: int):
        """A loop that exits only at its end is laid out with the test at
        the bottom, jumping back to the top while the exit is not taken."""
        _, _, body, where = s
        head = self.label("loop")
        cond = body[-1][1][0][0]
        if cond[0] != "bin" or cond[1] not in NEGATED:
            raise BindError(f"{where}: cannot negate {cond!r}")
        stay = ("bin", NEGATED[cond[1]], cond[2], cond[3])
        self.block([("label", head, where), *body[:-1], ("if", [(stay, [("goto", head, where)])], [], where)],
                   depth)

    def display(self, s, nxt, depth: int) -> int:
        """A point to plot: x in AC, y in IO, as the display instruction
        takes them. A stream the binding shows with hlt, then a wait: the
        halt, which shows AC and IO on the console lights and waits."""
        _, stream, args, where = s
        how = self.binds.streams.get(stream)
        names = list(self.unit.prog.records[stream].fields)
        if how == "dpy" and args[2][0] == "num":
            x_text, y_text = self.registers(stream, names[:2], args[:2], depth)
            if nxt is not None and nxt[0] == "call" and self.binds.bound[nxt[1]].pulse:
                # the code that runs next waits for a completion pulse: ask for one
                if args[2][1] != 0:
                    raise BindError(f"{where}: a point that asks for a pulse is plotted at intensity 0")
                self.emit(depth, f"dpy_nowait({x_text}, {y_text});")
                return 1
            self.emit(depth, f"dpy({x_text}, {y_text}, {args[2][1]});")
            return 1
        if how == "hlt" and nxt is not None and nxt[0] == "wait":
            ac, io = self.registers(stream, names, args, depth)
            self.emit(depth, f"halt({ac}, {io});")
            return 2
        raise BindError(f"{where}: the binding shows no stream {stream} here")

    def registers(self, stream: str, names: list[str], args: list, depth: int) -> tuple[str, str]:
        """The two values in AC and IO. Two zeros are cleared by one
        instruction (cla cli); a pool word goes straight into AC."""
        x_text, y_text = self.expr(args[0]), self.expr(args[1])
        if args[0] == args[1] == ("num", 0):
            self.declare_top(f"word {stream}_{names[0]};")
            self.declare_top(f"register word {stream}_{names[1]};")
            self.emit(depth, f"{stream}_{names[0]} = 0, {stream}_{names[1]} = 0;")
            return f"{stream}_{names[0]}", f"{stream}_{names[1]}"
        if self.binds.streams.get(stream) == "dpy" and dotted_of(args[0]) in self.binds.pool:
            pass
        elif not self.ac_resident(x_text):
            self.declare_top(f"word {stream}_{names[0]};")
            self.emit(depth, f"{stream}_{names[0]} = {x_text};")
            x_text = f"{stream}_{names[0]}"
        if y_text not in self.io_resident():
            self.declare_top(f"register word {stream}_{names[1]};")
            self.emit(depth, f"{stream}_{names[1]} = {y_text};")
            y_text = f"{stream}_{names[1]}"
        return x_text, y_text

    def home(self, dotted: str, e, depth: int) -> int:
        """A set of a field held in a shift instruction. One held as a
        pointer into its table steps to the next entry, or starts at the
        first; one built at run time is the shift by as many places as the
        mask has bits."""
        name = self.binds.c_name(dotted)
        if self.binds.homes[dotted] == "built":
            if e[0] != "call" or e[1] != "popcount":
                raise BindError(f"{self.b.name}: {dotted} is built from a mask: set it to popcount(w & m)")
            self.emit(depth, f"{name} = I_{self.unit.kinds[dotted].upper()}_BITS({self.expr(e[2][0])});")
            return 1
        table, v, known = self.unit.tables[dotted], e[1], self.known.get(dotted)
        if known is not None and table.index(known) + 1 < len(table) and table[table.index(known) + 1] == v:
            self.emit(depth, f"++{name};")
        elif v == table[0]:
            self.emit(depth, f"{name} = {name}_shifts;")
        else:
            raise BindError(f"{self.b.name}: {dotted} steps through its table in order")
        self.known[dotted] = v
        return 1

    def value(self, dotted: str, e) -> str:
        """e as the value of a field: a place by number in the collection a
        field holds a place in is that place's address."""
        if dotted in self.binds.into and e[0] == "num":
            text, array = self.binds.address(self.binds.into[dotted], e[1])
            if array:
                self.unit.named_data.add(array)
            return text
        return self.expr(e)

    def word_of(self, e, into_pointer: bool = False) -> str:
        """e as a word: an address held as a pointer is cast to one."""
        text = self.expr(e)
        if dotted_of(e) in self.binds.pointers and not into_pointer:
            return f"(word){text}"
        return text

    def flag(self, dotted: str, e, depth: int) -> int:
        """A field held in a program flag: the member spelled 1 sets it."""
        enum = self.unit.prog.member(e[1]) if e[0] == "name" else None
        how = self.binds.spelled.get(enum, {}).get(e[1]) if enum else None
        if how not in (0, 1):
            raise BindError(f"{self.b.name}: {dotted} is a program flag, set to a member spelled 0 or 1")
        self.emit(depth, f"{'stf' if how else 'clf'}({self.binds.flags[dotted]});")
        return 1

    def jump_address(self, dotted: str | None, e) -> str | None:
        """`set f = jmp(c[p + k])`, f a data word that holds a jump from the
        tape on (its initial value is one), p a field that holds a place in
        c: only the jump's address changes, `f.addr = p + k` (dap)."""
        init = self.unit.prog.records[dotted.split(".")[0]].fields[leaf(dotted)][1] if dotted else None
        if not (dotted in self.binds.placed and dotted in self.binds.insns and init and init[0] == "call"
                and init[1] == "jmp" and e[0] == "call" and e[1] == "jmp" and e[2][0][0] == "index"):
            return None
        _, word, slot = e[2][0]
        k = 0
        if slot[0] == "bin" and slot[1] == "+" and slot[3][0] == "num":
            slot, k = slot[2], slot[3][1]
        if self.binds.into.get(dotted_of(slot) or "") != dotted_of(word):
            raise BindError(f"{self.b.name}: {dotted} jumps to a place a field holds in {dotted_of(word)}")
        return self.place(dotted_of(slot)) + (f" + {octal(k)}" if k else "")

    def assign(self, s, nxt, last: bool, depth: int) -> int:
        _, target, e, where = s
        dotted = dotted_of(target)
        if (address := self.jump_address(dotted, e)) is not None:
            self.emit(depth, f"{self.place(dotted)}.addr = {address};")
            return 1
        if target[0] == "index":
            self.emit(depth, f"{self.cursor(target)} = {self.word_of(e)};")
            return 1
        if dotted in self.binds.flags:
            return self.flag(dotted, e, depth)
        if self.binds.homes.get(dotted) in ("table", "built"):
            return self.home(dotted, e, depth)
        if dotted and self.b.skips and dotted == self.b.skips[0]:
            if e[0] != "name":
                raise BindError(f"{where}: {dotted} takes a member")
            if e[1] == self.b.skips[1]:
                self.emit(depth, "skip_return();")
            return 1
        if e[0] == "call" and e[1] in IO_ROTATE and e[2][0] == target and self.expr(target) in self.io_resident():
            # a rotate of IO in place
            moved = self.expr(target)
            self.emit(depth, f"{moved} = {IO_ROTATE[e[1]]}({moved}, {self.expr(e[2][1])});")
            return 1
        if e[0] == "call" and e[1] in IO_ROTATE and self.expr(src := e[2][0]) in self.io_resident() \
                and not self.read_later(dotted_of(src) or src[1]):
            # pdp1cc rotates only AC: rotate IO in place, then move it
            moved = self.expr(src)
            self.emit(depth, f"{moved} = {IO_ROTATE[e[1]]}({moved}, {self.expr(e[2][1])});")
            e = src
        value = self.value(dotted, e) if dotted in self.binds.into \
            else self.word_of(e, into_pointer=dotted in self.binds.pointers)
        if dotted and self.binds.in_register(dotted, self.unit.path) and dotted not in self.alias \
                and re.fullmatch(r"\w+\.(hi|lo)", value):
            self.alias[dotted] = value          # the half of the pair the register already holds
            return 1
        device = self.binds.devices.get(dotted_of(e) or "")
        into_io = dotted in self.binds.io_fields or (target[0] == "name" and target[1] in self.b.io)
        if device and into_io and not device.get("or_into_io"):
            # the device reads into AC: move it to IO
            if self.unit.spec.get("moves") != "swap":
                raise BindError(f"{self.b.name}: the binding moves no value from AC to IO")
            value = f"SWAP({value})"
        if dotted and self.own_result_local(dotted) and (last or (nxt is not None and nxt[0] == "return")) \
                and not (device and device.get("or_into_io")):
            self.emit(depth, self.return_text(value))
            return 2 if nxt is not None else 1
        name = self.place(dotted) if dotted else self.alias.get(target[1], target[1])
        if dotted and name == leaf(dotted) and name not in self.own.values() and not self.declared(name):
            typ = "insn" if dotted in self.binds.insns else "word"
            kind = f"register {typ}" if dotted in self.binds.io_fields else typ
            kind = "word *" if dotted in self.binds.pointers else kind + " "
            if self.has_table:
                # the arms of a jump table lie apart and share their locals: declared at the top
                self.declare_top(f"{kind}{name};")
                self.scopes[0].add(name)
                self.emit(depth, f"{name} = {value};")
                return 1
            if device and device.get("or_into_io"):
                # the device ors into IO: clear it first
                self.emit(depth, f"{kind}{name} = 0;")
                self.emit(depth, f"{name} = {value};")
            else:
                self.emit(depth, f"{kind}{name} = {value};")
            self.scopes[-1].add(name)
            return 1
        self.emit(depth, f"{name} = {value};")
        return 1

    def pair(self, s, depth: int):
        """A shift of the AC:IO pair works in place: its result goes back to
        the halves it came from. A new name for a half is that half."""
        op, (_, targets), e, where = s[0], s[1], s[2], s[-1]
        if e[0] != "call" or e[1] not in PAIR_OPS:
            raise BindError(f"{where}: a pair is set only by a pair operator")
        halves = [self.expr(a) for a in e[2][:2]]
        if (count := dotted_of(e[2][2])) in self.binds.homes:
            shift = self.binds.c_name(count)
            shift = f"*home({shift})" if self.binds.homes[count] == "table" else shift
            self.emit(depth, f"pair = xct({shift}, {', '.join(halves)});")
        else:
            self.emit(depth, f"{e[1]}({', '.join(halves + [self.expr(e[2][2])])});")
        for t, half in zip(targets, halves):
            if op == "let" and t[0] == "name":
                self.alias[t[1]] = half
            elif self.expr(t) != half:
                raise BindError(f"{where}: a pair shift's result goes back where it came from")

    def call(self, s, last: bool, depth: int):
        _, name, args, where = s
        callee = self.binds.bound[name]
        jump = self.unit.jumps(callee, s, self.stmts)
        target = callee.block if jump else callee.symbol
        text = f"{target}({', '.join(self.value(f, args[f]) for f, _ in callee.params(block=jump))})"
        if callee.convention == "BLOCK":
            # A run of a block is a jump to it; the firing goes on there.
            if name in self.binds.carried:
                text = f"(*home({name}))()"
            self.emit(depth, f"return {text};")
            return
        if last and callee.result == self.b.result and bool(callee.skips) == bool(self.b.skips):
            self.emit(depth, f"return {text};")
            return
        if not jump and len(callee.result) < 2 and not callee.skips:
            # The result is in AC when the call returns: the next statement
            # takes it from there (block), or the call stands alone. A result
            # in the register the routine also takes it in stays there.
            if callee.result and callee.result[0] in args and self.binds.in_register(callee.result[0], self.unit.path) \
                    and self.read_later(callee.result[0]):
                self.emit(depth, f"{self.place(callee.result[0])} = {text};")
            elif callee.result:
                self.pending = (callee.result[0], text, self.nested)
            else:
                self.emit(depth, f"{text};")
            return
        if jump or len(callee.result) != 2:
            raise BindError(f"{where}: run {name} here is not a call the binding can lay out")
        local = self.results.get(name)
        stale = {k for k, v in self.alias.items() if local and v.startswith(local + ".")}
        for k in stale:
            del self.alias[k]
        if local is None:
            local = self.results[name] = f"{name}_result"
            self.emit(depth, f"dword {local} = {text};")
        else:
            self.emit(depth, f"{local} = {text};")
        self.alias[callee.result[0]] = f"{local}.hi"
        self.alias[callee.result[1]] = f"{local}.lo"

    def loop(self, s, depth: int):
        """The exit-first layout. The body runs up to its first exit, which
        falls through into the code after the loop; the rest of the body is
        laid out after the function's last return, and jumps back to the
        top. When the statement before the loop is `if c: X` and the body
        ends with X, the top is that X: the loop is entered at X or past it."""
        _, _, body, where = s
        first = next((n for n, x in enumerate(body) if x[0] == "if" and len(x[1]) == 1 and not x[2]
                      and x[1][0][1] and x[1][0][1][-1][0] == "break"), None)
        if first is None:
            raise BindError(f"{where}: an exit-first loop needs an `if c: ... break`")
        rest = body[first + 1:]
        if self.merged_head and self.merged_head[0] is s:
            head = self.merged_head[1]
            rest = rest[:-1]
        else:
            head = self.label("loop")
            self.emit(depth, f"{head}:")
        self.merged_head = None
        after, past = self.label("after"), self.label("rest")
        self.block(body[:first], depth)
        cond, exit_body = body[first][1][0]
        self.emit(depth, f"if ({self.cond(cond, negate=True)})")
        self.emit(depth + 1, f"goto {past};")
        self.loops.append((after, head))
        main, self.out = self.out, []
        self.emit(0, f"{past}:")
        self.block(rest, 1)
        self.emit(1, f"goto {head};")
        self.tail += self.out
        self.out = main
        self.block(exit_body[:-1], depth)
        self.loops.pop()
        self.emit(depth, f"{after}:")


def write_tree(prog: runs.Program, out: Path) -> Path:
    """spacewar-c's lift.toml under out: each bound unit compiled from RUNS,
    the rest linked to the lifted C. Returns the toml."""
    lift = tomllib.loads((SPACEWAR_C / "lift.toml").read_text())
    paths = sorted(BINDINGS.glob("*.toml"))
    binds = Bindings(prog, paths)
    bound = {spec["replaces"]: p for p, spec in binds.specs.items()}
    lifted = out / "lift"
    if lifted.exists():
        for f in lifted.iterdir():
            f.unlink()
    lifted.mkdir(parents=True, exist_ok=True)
    for f in (SPACEWAR_C / "lift").iterdir():
        (lifted / f.name).symlink_to(f)
    units = []
    for u in lift["unit"]:
        if u["c"] in bound:
            c = out / u["c"]
            c.unlink()
            c.write_text(Unit(binds, bound.pop(u["c"])).compile())
        units.append(f'[[unit]]\nc = "{u["c"]}"\nprefix = "{u["prefix"]}"\n')
    if bound:
        raise BindError(f"bindings replace no lift unit: {sorted(bound)}")
    toml = out / "lift.toml"
    head = "".join(f'{k} = "{SPACEWAR_C / v if k in ("macro1", "macro1_src", "oracle_listing") else v}"\n'
                   for k, v in lift.items() if k != "unit")
    toml.write_text(head + "\n" + "\n".join(units))
    return toml


def build(prog: runs.Program, out: Path = OUT) -> int:
    """Compile and assemble; pdp1cc prints the hash and, on a mismatch, the
    first word that differs. 0 when the image is the original's."""
    toml = write_tree(prog, out)
    with contextlib.redirect_stdout(io.StringIO()) as said:
        code = program.build(toml)
    build.said = said.getvalue()
    return code


if __name__ == "__main__":
    code = build(runs.program(runs.source()))
    print(build.said, end="")
    sys.exit(code)
