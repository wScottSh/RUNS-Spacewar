"""runsc: RUNS and its PDP-1 binding -> the pdp1c C dialect -> pdp1cc -> the
tape image, compared by sha256 with the original's.

The RUNS text holds the game. The binding (pdp1/<unit>.toml) holds only how
the PDP-1 carries it: the order of things on the tape, each routine's
calling convention, which register or word holds a value, and how a
routine's code is laid out. pdp1cc, spacewar-c's compiler, is the back end.

A bound routine is one C function. A Processor's body is its code. A
Network's Processors are inlined in the order it runs them, and each `run`
of another bound routine is a call: the sets of that routine's parameter
fields just before the run become the call's arguments, and its result
fields read after the run are the halves of the returned pair.

A unit of spacewar-c's lift.toml that has a binding is compiled from RUNS;
the others still come from the lifted C, until each is ported."""
from __future__ import annotations

import contextlib
import io
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

    def params(self, block: bool = False) -> list[tuple[str, str]]:
        """(field, C declaration) in the dialect's order: AC, IO, by name."""
        out = []
        if self.entry and (not block or self.block_takes_entry):
            out.append((self.entry, f"word {leaf(self.entry)}"))
        if self.ac_param:
            out.append((self.ac_param, f"word {leaf(self.ac_param)}"))
        if self.io_param:
            out.append((self.io_param, f"register word {leaf(self.io_param)}"))
        if self.byname:
            out.append((self.byname, f"BYNAME word {leaf(self.byname)}"))
        return out

    def declaration(self, block: bool = False) -> str:
        conv = "BLOCK" if block else self.convention
        skips = " SKIPS" if self.skips else ""
        params = ", ".join(d for _, d in self.params(block))
        return f"{conv}{skips} {RETURNS[len(self.result)]} {self.block if block else self.name}({params})"


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
        for path, spec in self.specs.items():
            for f, name in spec.get("names", {}).items():
                self.check_field(path, f)
                self.names[f] = name
            for p in spec["place"]:
                if "routine" in p:
                    self.bind(path, p)
                for f in p.get("fields", []):
                    self.check_field(path, f)
                    self.placed[f] = path

    def check_field(self, path: Path, dotted: str):
        rec, fld = dotted.split(".")
        if rec not in self.prog.records or fld not in self.prog.records[rec].fields:
            raise BindError(f"{path.name}: no field {dotted}")

    def bind(self, path: Path, p: dict):
        name = p["routine"]
        if name not in self.prog.routines:
            raise BindError(f"{path.name}: no routine {name}")
        b = Bound(name, path, p["convention"], p.get("entry"), p.get("ac_param"), p.get("io_param"),
                  p.get("byname"), p.get("result", []), p.get("block"), p.get("block_takes_entry", False),
                  tuple(p["skips"]) if "skips" in p else None, set(p.get("io", [])), p.get("cells", []),
                  p.get("loops"))
        for f in [b.entry, b.ac_param, b.io_param, b.byname, *b.result, *b.cells] + \
                ([b.skips[0]] if b.skips else []):
            if f:
                self.check_field(path, f)
        for f in [b.entry, *b.cells]:
            if f:
                self.cell_of[f] = name
        self.io_fields |= {f for f in b.io if "." in f}
        if b.io_param:
            self.io_fields.add(b.io_param)
        self.bound[name] = b

    def c_name(self, dotted: str) -> str:
        return self.names.get(dotted, dotted.replace(".", "_"))

    def stored(self, dotted: str) -> bool:
        """The field has a word of its own: data, or an entry word."""
        return dotted in self.placed or dotted in self.cell_of


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

    def initial(self, dotted: str) -> str:
        rec, fld = dotted.split(".")
        e = self.prog.records[rec].fields[fld][1]
        return Function.constant(e) if e is not None else "0"

    def check_unstored(self):
        """A field with no data word cannot carry an initial value onto the
        tape: an entry word is punched as 0, a register holds what the
        caller left. Its RUNS initial value must be 0."""
        for p in self.spec["place"]:
            if "routine" not in p:
                continue
            b = self.binds.bound[p["routine"]]
            for f in {b.entry, b.ac_param, b.io_param, b.byname, *b.result, *b.cells} - {None} \
                    - set(self.binds.placed):
                rec, fld = f.split(".")
                e = self.prog.records[rec].fields[fld][1]
                if e is not None and e != ("num", 0):
                    raise BindError(f"{self.path.name}: {f} has no data word, so its initial value is 0")

    def routine(self, b: Bound) -> list[str]:
        out = []
        r = self.prog.routines[b.name]
        if b.block:
            own = {f: leaf(f) for f, _ in b.params()}
            wrapper = Function(self, b, own, [])
            if not b.block_takes_entry:
                wrapper.emit(1, f"{wrapper.cell(b.entry)} = {leaf(b.entry)};")
            args = ", ".join(leaf(f) for f, _ in b.params(block=True))
            wrapper.emit(1, f"return {b.block}({args});")
            out += [b.declaration(), "{", *wrapper.out, "}"]
            fn = Function(self, b, {f: leaf(f) for f, _ in b.params(block=True)}, self.arguments(self.flat(r)))
            out += [b.declaration(block=True), "{", *fn.compile(), "}"]
        else:
            fn = Function(self, b, {f: leaf(f) for f, _ in b.params()}, self.arguments(self.flat(r)))
            out += [b.declaration(), "{", *fn.compile(), "}"]
        return out

    def flat(self, r: runs.Routine) -> list:
        """A routine's statements in the order the PDP-1 runs them: a
        Processor's body; a Network's Processors one after another, with a
        call where it runs another bound routine."""
        if r.kind == "processor":
            return list(r.body)
        out: list = []
        items = r.body
        for n, s in enumerate(items):
            if s[0] != "run" or s[2]:
                raise BindError(f"{s[-1]}: a bound Network only runs routines, without arguments")
            name = s[1]
            if name in self.binds.bound and name != r.name:
                self.callees.add(name)
                out.append(("call", name, {}, s[-1]))
                continue
            inner = self.prog.routines[name]
            if inner.kind == "processor" and n < len(items) - 1 and has_return(inner.body):
                raise BindError(f"{s[-1]}: {name} returns, so it must be the last routine run")
            out += self.flat(inner)
        return out

    def arguments(self, stmts: list) -> list:
        """The sets of a callee's parameter fields just before its call are
        the call's arguments. A jump into the callee's block stores its
        entry word itself, as jda would have, and passes it in AC."""
        out: list = []
        for s in stmts:
            if s[0] != "call":
                out.append(s)
                continue
            callee = self.binds.bound[s[1]]
            jump = self.jumps(callee, s, stmts)
            params = [f for f, _ in callee.params(block=jump)]
            args = {}
            while out and out[-1][0] == "set" and (target := dotted_of(out[-1][1])) in params \
                    and target not in args and not (jump and target == callee.entry):
                args[target] = out.pop()[2]
            if jump and callee.entry in params:
                args[callee.entry] = ("field", ("name", callee.entry.split(".")[0]), leaf(callee.entry))
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
        jump to another, with room after it."""
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
        body: list[str] = []
        head: list[str] = []
        for p in self.spec["place"]:
            if "routine" in p:
                body += self.routine(self.binds.bound[p["routine"]])
            elif "fields" in p:
                for f in p["fields"]:
                    body.append(f"word {self.binds.c_name(f)} = {self.initial(f)};")
            else:
                body += self.machine(p, head)
        for name in [p["routine"] for p in self.spec["place"] if "routine" in p] + sorted(self.callees):
            b = self.binds.bound[name]
            head.append(b.declaration() + ";")
            if b.block and b.unit == self.path:
                head.append(b.declaration(block=True) + ";")
        head = list(dict.fromkeys(head))
        head += [f"extern word {self.binds.c_name(f)};" for f in sorted(self.externs)]
        head += [f"ENTRY_CELL({self.binds.cell_of[f]}) word {self.binds.c_name(f)};"
                 for f in sorted(self.cells_used)]
        return "\n".join(head + body) + "\n"


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
        if dotted in self.alias:
            return self.alias[dotted]
        if dotted in self.own:
            return self.own[dotted]
        if dotted in self.binds.io_fields or self.own_result_local(dotted):
            return leaf(dotted)
        if dotted in self.binds.cell_of:
            return self.cell(dotted)
        if dotted in self.binds.placed:
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

    def _expr(self, e) -> tuple[str, int]:
        op = e[0]
        if op == "num":
            return octal(e[1]), 99
        if op == "name":
            return self.alias.get(e[1], e[1]), 99
        if op == "field":
            if (d := dotted_of(e)) is None:
                raise BindError(f"cannot compile {e!r}")
            return self.place(d), 99
        if op == "neg":
            return f"-{self._paren(e[1], 11)}", 11
        if op == "bin":
            _, o, a, b = e
            lvl = C_LEVEL[o]
            return f"{self._paren(a, lvl)} {C_OP.get(o, o)} {self._paren(b, lvl + 1)}", lvl
        if op == "call":
            return f"{e[1]}({', '.join(self.expr(a) for a in e[2])})", 99
        raise BindError(f"cannot compile {e!r}")

    def _paren(self, e, at_least: int) -> str:
        text, lvl = self._expr(e)
        return text if lvl >= at_least else f"({text})"

    def io_resident(self) -> set[str]:
        return self.io_names | {c for c in self.alias.values() if c.endswith(".lo")}

    def cond(self, e, negate: bool = False) -> str:
        if negate:
            if e[0] != "bin" or e[1] not in NEGATED:
                raise BindError(f"cannot negate {e!r}")
            e = ("bin", NEGATED[e[1]], e[2], e[3])
        return self.expr(e)

    # ---- statements

    def emit(self, depth: int, text: str):
        self.out.append("    " * depth + text)

    def compile(self) -> list[str]:
        self.block(self.stmts, 1, top=True)
        if self.tail:
            if not self.out or not self.out[-1].lstrip().startswith("return"):
                raise BindError(f"{self.b.name}: code laid out after the body needs the body to end in a return")
            self.out += self.tail
        return self.out

    def block(self, stmts: list, depth: int, top: bool = False):
        self.scopes.append(set())
        k = 0
        while k < len(stmts):
            self.rest.append(stmts[k + 1:])
            k += self.stmt(stmts, k, depth, top)
            self.rest.pop()
        if top and falls_off(stmts) and not self.out[-1].startswith("    " * depth + "return"):
            self.emit(depth, self.return_text())
        self.scopes.pop()

    def body(self, stmts: list, depth: int, head: list[str] = ()):
        self.emit(depth, "{")
        for line in head:
            self.emit(depth + 1, line)
        self.block(stmts, depth + 1)
        self.emit(depth, "}")

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

    def stmt(self, stmts: list, k: int, depth: int, top: bool) -> int:
        s = stmts[k]
        op = s[0]
        nxt = stmts[k + 1] if k + 1 < len(stmts) else None
        last = top and nxt is None
        if (target := self.incremented(s)) is not None:
            text = self.expr(target)
            if nxt and nxt[0] == "if" and len(nxt[1]) == 1 and not nxt[2] \
                    and nxt[1][0][0][0] == "bin" and nxt[1][0][0][2] == target and nxt[1][0][0][3] == ("num", 0):
                self.emit(depth, f"if (++{text} {nxt[1][0][0][1]} 0)")
                self.body(nxt[1][0][1], depth)
                return 2
            self.emit(depth, f"++{text};")
            return 1
        if op in ("let", "set") and s[1][0] == "tuple":
            self.pair(s, depth)
            return 1
        if op == "let":
            name = s[1][1]
            if name in self.b.io and (held := self.expr(s[2])) in self.io_resident():
                self.alias[name] = held             # already in IO: no move
                return 1
            self.emit(depth, f"{'register word' if name in self.b.io else 'word'} {name} = {self.expr(s[2])};")
            self.scopes[-1].add(name)
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
        if op == "loop":
            if self.b.loops == "exit first":
                self.loop(s, depth)
            else:
                self.emit(depth, "for (;;)")
                self.loops.append(None)
                self.body(s[2], depth)
                self.loops.pop()
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
            for n, (c, body) in enumerate(arms):
                self.emit(depth, f"{'else ' if n else ''}if ({self.cond(c)})")
                self.body(body, depth)
            if other:
                self.emit(depth, "else")
                self.body(other, depth)
            return 1
        if op in ("break", "continue"):
            labels = self.loops[-1] if self.loops else None
            if labels is None:
                self.emit(depth, f"{op};")
            else:
                self.emit(depth, f"goto {labels[0 if op == 'break' else 1]};")
            return 1
        if op == "return":
            self.emit(depth, self.return_text())
            return 1
        raise BindError(f"{s[-1]}: cannot compile {op}")

    def assign(self, s, nxt, last: bool, depth: int) -> int:
        _, target, e, where = s
        dotted = dotted_of(target)
        if dotted and self.b.skips and dotted == self.b.skips[0]:
            if e[0] != "name":
                raise BindError(f"{where}: {dotted} takes a member")
            if e[1] == self.b.skips[1]:
                self.emit(depth, "skip_return();")
            return 1
        if e[0] == "call" and e[1] in IO_ROTATE and self.expr(src := e[2][0]) in self.io_resident() \
                and not self.read_later(dotted_of(src) or src[1]):
            # pdp1cc rotates only AC: rotate IO in place, then move it
            moved = self.expr(src)
            self.emit(depth, f"{moved} = {IO_ROTATE[e[1]]}({moved}, {self.expr(e[2][1])});")
            e = src
        value = self.expr(e)
        if dotted and self.own_result_local(dotted) and (last or (nxt is not None and nxt[0] == "return")):
            self.emit(depth, self.return_text(value))
            return 2 if nxt is not None else 1
        name = self.place(dotted) if dotted else self.alias.get(target[1], target[1])
        if dotted and name == leaf(dotted) and name not in self.own.values() and not self.declared(name):
            kind = "register word" if dotted in self.binds.io_fields else "word"
            self.emit(depth, f"{kind} {name} = {value};")
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
        target = callee.block if jump else name
        text = f"{target}({', '.join(self.expr(args[f]) for f, _ in callee.params(block=jump))})"
        if last and callee.result == self.b.result and bool(callee.skips) == bool(self.b.skips):
            self.emit(depth, f"return {text};")
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
