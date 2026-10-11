"""A reference evaluator for the RUNS draft used by this port.

It reads .runs files (types, enums, records, streams, networks) and
.runs-prim files (processors), and runs a Network over Records.

The evaluator enforces the paradigm, not just the syntax. The topology is a
Petri net: Records are places, Processors are transitions.
- a processor reads only the Records it declares (reads or writes), and
  writes only the ones it declares under writes; it fires no other routine;
- a network writes nothing: it only fires processors and networks, chooses
  with guards that read Records, and loops with a bound and a guarded exit;
- nothing calls a routine from an expression. The only calls are the word's
  own operators (rcl, scr, popcount, ...), so every value that passes from
  one routine to another goes through a Record;
- a field with no initial value is unknown until the game sets it or the
  world gives it: reading it unknown is an error, and a top Network whose
  Processors read it declares its Record under reads:;
- `wait` hands the world the firing: the host shows what has left the game
  and may change what comes in, then the firing goes on;
- `jump` runs words of code a Record holds, by the original machine's rules
  for the instructions the machine description declares (`type insn`).

The word type is the PDP-1's 18-bit ones' complement word, with the
operations as the machine computes them."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

MASK = 0o777777
SIGN = 0o400000


# ---------------------------------------------------------------- the word

@dataclass(frozen=True)
class W:
    v: int

    def __repr__(self) -> str:
        return f"W({self.v:06o})"


def word_of(n: int) -> W:
    if n > MASK or -n > MASK:
        raise RunsError(f"{n} does not fit a word")
    return W((~(-n)) & MASK if n < 0 else n)


def as_word(x) -> W:
    if isinstance(x, W):
        return x
    if isinstance(x, int) and not isinstance(x, bool):
        return word_of(x)
    raise RunsError(f"not a word: {x!r}")


def as_count(x) -> int:
    if isinstance(x, int) and not isinstance(x, bool):
        return x
    if isinstance(x, W) and not x.v & SIGN:
        return x.v
    raise RunsError(f"not a count: {x!r}")


def add(a: W, b: W) -> W:
    r = a.v + b.v
    if r > MASK:
        r = (r + 1) & MASK
    return W(0 if r == MASK else r)


def sub(a: W, b: W) -> W:
    r = (a.v ^ MASK) + b.v
    if r > MASK:
        r = (r + 1) & MASK
    return W(r ^ MASK)


def sal(a: W, n: int) -> W:
    v = a.v
    for _ in range(n):
        v = (v & SIGN) | ((v << 1) & (MASK >> 1)) | (1 if v & SIGN else 0)
    return W(v)


def sar(a: W, n: int) -> W:
    v = a.v
    for _ in range(n):
        v = (v >> 1) | (v & SIGN)
    return W(v)


def ral(a: W, n: int) -> W:
    v = a.v
    for _ in range(n):
        v = ((v << 1) | (v >> 17)) & MASK
    return W(v)


def rar(a: W, n: int) -> W:
    v = a.v
    for _ in range(n):
        v = ((v >> 1) | ((v & 1) << 17)) & MASK
    return W(v)


def rcl(h: W, l: W, n: int) -> tuple[W, W]:
    hv, lv = h.v, l.v
    for _ in range(n):
        c = (hv >> 17) & 1
        hv = ((hv << 1) | ((lv >> 17) & 1)) & MASK
        lv = ((lv << 1) | c) & MASK
    return W(hv), W(lv)


def rcr(h: W, l: W, n: int) -> tuple[W, W]:
    hv, lv = h.v, l.v
    for _ in range(n):
        c = lv & 1
        lv = ((lv >> 1) | ((hv & 1) << 17)) & MASK
        hv = ((hv >> 1) | (c << 17)) & MASK
    return W(hv), W(lv)


def scl(h: W, l: W, n: int) -> tuple[W, W]:
    hv, lv = h.v, l.v
    for _ in range(n):
        s = hv & SIGN
        hv = s | ((hv << 1) & (MASK >> 1)) | ((lv >> 17) & 1)
        lv = ((lv << 1) | (1 if s else 0)) & MASK
    return W(hv), W(lv)


def scr(h: W, l: W, n: int) -> tuple[W, W]:
    hv, lv = h.v, l.v
    for _ in range(n):
        lv = ((lv >> 1) | ((hv & 1) << 17)) & MASK
        hv = (hv & SIGN) | (hv >> 1)
    return W(hv), W(lv)


def mus(h: W, l: W, m: W) -> tuple[W, W]:
    ac = h.v
    if l.v & 1:
        ac += m.v
        if ac > MASK:
            ac = (ac + 1) & MASK
    return W(ac >> 1), W((l.v >> 1) | ((ac & 1) << 17))


def dis(h: W, l: W, m: W) -> tuple[W, W]:
    top = h.v >> 17
    ac = ((h.v << 1) | (l.v >> 17)) & MASK
    lv = ((l.v << 1) | (top ^ 1)) & MASK
    ac = ac + (m.v ^ MASK) if lv & 1 else ac + m.v + 1
    if ac > MASK:
        ac = (ac + 1) & MASK
    return W(0 if ac == MASK else ac), W(lv)


BUILTINS = {
    "ral": lambda a, n: ral(as_word(a), as_count(n)),
    "rar": lambda a, n: rar(as_word(a), as_count(n)),
    "rcl": lambda h, l, n: rcl(as_word(h), as_word(l), as_count(n)),
    "rcr": lambda h, l, n: rcr(as_word(h), as_word(l), as_count(n)),
    "scl": lambda h, l, n: scl(as_word(h), as_word(l), as_count(n)),
    "scr": lambda h, l, n: scr(as_word(h), as_word(l), as_count(n)),
    "mus": lambda h, l, m: mus(as_word(h), as_word(l), as_word(m)),
    "dis": lambda h, l, m: dis(as_word(h), as_word(l), as_word(m)),
    "popcount": lambda a: bin(as_word(a).v).count("1"),
}


# ------------------------------------------------------------ instructions

# The instructions of the original machine the game reaches, and the kind
# of operand each takes: a word of a Record (`place`), a word of code or a
# routine (`target`), a number, or none. The machine description declares
# which of them the game uses (`type insn`); their rules are in Machine.execute.
OPERANDS = {"lac": "place", "lio": "place", "dac": "place", "dio": "place", "add": "place",
            "sub": "place", "jmp": "target", "stf": "number", "clf": "number", "szf": "number",
            "rcl": "number", "cma": None, "ioh": None, "dpy": None}


@dataclass(frozen=True)
class Place:
    """A word of a Record, as an instruction names it."""
    record: str
    field: str
    slot: int | None = None


@dataclass(frozen=True)
class Insn:
    """A word of code: an instruction and its operand (a Place, a routine's
    name, a number, or None)."""
    op: str
    operand: object = None

    def __repr__(self) -> str:
        x = self.operand
        if isinstance(x, Place):
            x = f"{x.record}.{x.field}" + ("" if x.slot is None else f"[{x.slot:o}]")
        return self.op if x is None else f"{self.op}({x})"


# The instructions the program being loaded declares, for the parser.
declared_instructions: set[str] = set()


def instruction_call(name: str, args: list) -> bool:
    """name(args) builds an instruction: one operand, or none. `rcl` with
    three is the pair operator."""
    return name in declared_instructions and len(args) == (OPERANDS[name] is not None)


# ------------------------------------------------------------------ lexing

class RunsError(Exception):
    pass


TOKEN = re.compile(r"\s*(?:(\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\.\.|->|==|!=|<=|>=|<<|>>|[-+&|^~<>=()\[\],:.]))")


def tokens(text: str, where: str) -> list[str]:
    out, pos = [], 0
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m:
            if text[pos:].strip() == "":
                break
            raise RunsError(f"{where}: cannot read {text[pos:]!r}")
        out.append(next(g for g in m.groups() if g is not None))
        pos = m.end()
    return out


@dataclass
class Line:
    toks: list[str]
    where: str
    children: list["Line"] = field(default_factory=list)


def lines(path: Path) -> list[Line]:
    root = Line([], str(path))
    stack = [(-1, root)]
    for n, raw in enumerate(path.read_text().splitlines(), 1):
        text = raw.split("#", 1)[0].rstrip()
        if not text.strip():
            continue
        indent = len(text) - len(text.lstrip(" "))
        if indent % 2:
            raise RunsError(f"{path}:{n}: indentation is two spaces a level")
        line = Line(tokens(text, f"{path}:{n}"), f"{path}:{n}")
        while stack[-1][0] >= indent:
            stack.pop()
        stack[-1][1].children.append(line)
        stack.append((indent, line))
    return root.children


# ------------------------------------------------------------- expressions

class Cursor:
    def __init__(self, toks: list[str], where: str):
        self.toks, self.i, self.where = toks, 0, where

    def peek(self, k: int = 0):
        return self.toks[self.i + k] if self.i + k < len(self.toks) else None

    def take(self, want: str | None = None) -> str:
        t = self.peek()
        if t is None or (want is not None and t != want):
            raise RunsError(f"{self.where}: expected {want or 'more'}, found {t!r}")
        self.i += 1
        return t

    def done(self) -> bool:
        return self.i >= len(self.toks)


BINARY = [("or",), ("and",), (), ("==", "!=", "<", "<=", ">", ">="), ("|",), ("^",), ("&",),
          ("<<", ">>"), ("+", "-")]


def expr(c: Cursor, level: int = 0):
    if level == 2:                                      # not
        if c.peek() == "not":
            c.take()
            return ("not", expr(c, 2))
        return expr(c, 3)
    if level == len(BINARY):
        return unary(c)
    left = expr(c, level + 1)
    while c.peek() in BINARY[level]:
        op = c.take()
        left = ("bin", op, left, expr(c, level + 1))
    return left


def unary(c: Cursor):
    if c.peek() in ("-", "~"):
        op = c.take()
        return ("neg", unary(c))
    return postfix(c)


def postfix(c: Cursor):
    e = primary(c)
    while True:
        if c.peek() == ".":
            c.take()
            e = ("field", e, c.take())
        elif c.peek() == "[":
            c.take()
            i = expr(c)
            c.take("]")
            e = ("index", e, i)
        elif c.peek() == "(" and e[0] == "name":
            c.take()
            args = []
            while c.peek() != ")":
                args.append(expr(c))
                if c.peek() == ",":
                    c.take()
            c.take(")")
            if e[1] not in BUILTINS and not instruction_call(e[1], args):
                raise RunsError(f"{c.where}: {e[1]} is not an operator of the word; a routine is run, not called")
            e = ("call", e[1], args)
        else:
            return e


def primary(c: Cursor):
    t = c.take()
    if t.isdigit():
        if t[0] == "0" and not set(t) <= set("01234567"):
            raise RunsError(f"{c.where}: {t} is not an octal number")
        return ("num", int(t, 8) if len(t) > 1 and t[0] == "0" else int(t))
    if t in ("true", "false"):
        return ("bool", t == "true")
    if t == "(":
        items = [expr(c)]
        while c.peek() == ",":
            c.take()
            items.append(expr(c))
        c.take(")")
        return items[0] if len(items) == 1 else ("tuple", items)
    if re.match(r"[A-Za-z_]", t):
        return ("name", t)
    raise RunsError(f"{c.where}: unexpected {t!r}")


def whole(toks: list[str], where: str):
    c = Cursor(toks, where)
    e = expr(c)
    if not c.done():
        raise RunsError(f"{where}: unexpected {c.peek()!r}")
    return e


# -------------------------------------------------------------- statements

def block(children: list[Line]) -> list:
    out, k = [], 0
    while k < len(children):
        line = children[k]
        t, where = line.toks, line.where
        head = t[0]
        if head == "if":
            arms = [(whole(t[1:-1], where), block(line.children))]
            other = []
            while k + 1 < len(children) and children[k + 1].toks[0] in ("elif", "else"):
                k += 1
                nxt = children[k]
                if nxt.toks[0] == "elif":
                    arms.append((whole(nxt.toks[1:-1], nxt.where), block(nxt.children)))
                else:
                    other = block(nxt.children)
            out.append(("if", arms, other, where))
        else:
            out.append(statement(line))
        k += 1
    return out


def statement(line: Line):
    t, where = line.toks, line.where
    head = t[0]
    if head in ("let", "set"):
        eq = t.index("=")
        target = whole(t[1:eq], where)
        return (head, target, whole(t[eq + 1:], where), where)
    if head == "loop":
        if t[1:3] != ["at", "most"] or t[-1] != ":":
            raise RunsError(f"{where}: loop at most N:")
        return ("loop", whole(t[3:-1], where), block(line.children), where)
    if head == "for":
        dots = t.index("..")
        return ("for", t[1], whole(t[3:dots], where), whole(t[dots + 1:-1], where),
                block(line.children), where)
    if head in ("break", "continue", "stop", "unreachable", "wait"):
        return (head, where)
    if head == "return":
        return ("return", whole(t[1:], where) if len(t) > 1 else None, where)
    if head == "jump":
        if t[-3:-1] != ["at", "most"]:
            raise RunsError(f"{where}: jump <word of code> at most N")
        return ("jump", whole(t[1:-3], where), whole(t[-1:], where), where)
    if head == "emit":
        c = Cursor(t[3:], where)
        args = [expr(c)]
        while c.peek() == ",":
            c.take()
            args.append(expr(c))
        return ("emit", t[1], args, where)
    if head == "run":
        c = Cursor(t[2:], where)
        args = []
        if not c.done():
            c.take("(")
            while c.peek() != ")":
                args.append(expr(c))
                if c.peek() == ",":
                    c.take()
            c.take(")")
        if not c.done():
            raise RunsError(f"{where}: unexpected {c.peek()!r}")
        return ("run", t[1], args, where)
    if head == "match":
        arms = {}
        for arm in line.children:
            colon = arm.toks.index(":")
            body = [statement(Line(arm.toks[colon + 1:], arm.where))] if arm.toks[colon + 1:] \
                else block(arm.children)
            arms[arm.toks[0]] = body
        return ("match", whole(t[1:-1], where), arms, where)
    raise RunsError(f"{where}: unknown statement {head!r}")


# ------------------------------------------------------------ declarations

@dataclass
class Record:
    name: str
    count: int | None
    fields: dict[str, tuple[str, object]]          # name: (type, initial expr)
    stream: bool = False


@dataclass
class Routine:
    kind: str                                      # processor, network
    name: str
    params: list[str]
    body: list
    reads: set[str] = field(default_factory=set)
    writes: set[str] = field(default_factory=set)
    requires: list = field(default_factory=list)


@dataclass
class Program:
    enums: dict[str, list[str]] = field(default_factory=dict)
    records: dict[str, Record] = field(default_factory=dict)
    routines: dict[str, Routine] = field(default_factory=dict)
    instructions: set[str] = field(default_factory=set)     # type insn: the instructions the game reaches
    display: str | None = None                              # type insn: the stream dpy plots on

    def member(self, name: str) -> str | None:
        return next((e for e, ms in self.enums.items() if name in ms), None)


def params_of(toks: list[str]) -> list[str]:
    if "(" not in toks:
        return []
    inner = toks[toks.index("(") + 1:toks.index(")")]
    out, k = [], 0
    while k < len(inner):
        out.append(inner[k])
        k += 1
        while k < len(inner) and inner[k] != ",":
            k += 1
        k += 1
    return out


def machine_types(prog: Program, files: list[list[Line]]) -> None:
    """The machine description's `type insn`: the instructions the game
    reaches, and the stream dpy plots on. Read before anything is parsed."""
    for line in (line for f in files for line in f):
        if line.toks[:2] != ["type", "insn"]:
            continue
        for c in line.children:
            key, values = c.toks[0], c.toks[2:]
            if key == "instructions":
                if unknown := set(values) - set(OPERANDS):
                    raise RunsError(f"{c.where}: the machine has no rules for {sorted(unknown)}")
                prog.instructions = set(values)
            elif key == "display":
                prog.display = values[0]
    declared_instructions.clear()
    declared_instructions.update(prog.instructions)


def initial(c: Line, count: int | None):
    """A field's initial value: one expression, or, under a field of a
    collection that ends in `=`, one line a slot."""
    if "=" not in c.toks:
        return None
    eq = c.toks.index("=")
    if eq < len(c.toks) - 1:
        return whole(c.toks[eq + 1:], c.where)
    if len(c.children) != count:
        raise RunsError(f"{c.where}: {len(c.children)} initial values for {count} slots")
    return ("slots", [whole(v.toks, v.where) for v in c.children])


def load(paths: list[Path]) -> Program:
    prog = Program()
    files = [lines(path) for path in paths]
    machine_types(prog, files)
    for path, file in zip(paths, files):
        for line in file:
            t, where = line.toks, line.where
            kind = t[0]
            if kind == "type":
                continue
            if kind == "enum":
                prog.enums[t[1]] = [c.toks[0] for c in line.children]
            elif kind in ("record", "stream"):
                count = as_count(int(t[3], 8) if t[3].startswith("0") else int(t[3])) if len(t) > 2 else None
                fields = {c.toks[0]: (c.toks[2], initial(c, count)) for c in line.children}
                prog.records[t[1]] = Record(t[1], count, fields, kind == "stream")
            elif kind in ("processor", "network"):
                r = Routine(kind, t[1], params_of(t), [])
                body = []
                headers = ("reads", "writes", "requires")
                for c in line.children:
                    if c.toks[0] in headers and c.toks[1:2] == [":"]:
                        if c.toks[0] == "requires":
                            r.requires.append(whole(c.toks[2:], c.where))
                        else:
                            getattr(r, c.toks[0]).update(x for x in c.toks[2:] if x != ",")
                    else:
                        body.append(c)
                r.body = block(body)
                shape(r.body, r, in_loop=False)
                if r.name in prog.routines:
                    raise RunsError(f"{where}: {r.name} defined twice")
                prog.routines[r.name] = r
            else:
                raise RunsError(f"{where}: unknown declaration {kind!r}")
    return prog


NETWORK_OPS = {"if", "for", "match", "run", "stop", "unreachable", "loop", "break", "wait"}
FIRING_OPS = {"run", "stop", "match", "wait"}


def guarded_exit(stmt) -> bool:
    """An `if` with an arm that ends in break: an exit of a network loop."""
    return stmt[0] == "if" and any(body and body[-1][0] == "break"
                                   for body in [b for _, b in stmt[1]] + [stmt[2]])


def shape(stmts: list, r: Routine, in_loop: bool):
    """What each kind may say, checked over the whole body before anything runs.
    A network writes nothing: it has no let, set, emit or return. Its loop is
    bounded and leaves only through an `if` on Records that breaks."""
    for s in stmts:
        op, where = s[0], s[-1]
        if r.kind == "network":
            if op not in NETWORK_OPS:
                raise RunsError(f"{where}: a network only fires and chooses ({op})")
            if op == "break" and not in_loop:
                raise RunsError(f"{where}: break outside a loop")
            if op == "loop" and not any(guarded_exit(x) for x in s[2]):
                raise RunsError(f"{where}: a network loop needs an exit: an if with an arm that ends in break")
        elif op in FIRING_OPS:
            raise RunsError(f"{where}: {op} belongs to a network")
        if op == "if":
            for _, body in s[1]:
                shape(body, r, in_loop)
            shape(s[2], r, in_loop)
        elif op in ("loop", "for"):
            shape(s[-2], r, in_loop=in_loop or op == "loop")
        elif op == "match":
            for body in s[2].values():
                shape(body, r, in_loop)


# --------------------------------------------------------------- execution

class Break(Exception): pass
class Continue(Exception): pass
class Stop(Exception): pass


class Return(Exception):
    def __init__(self, value):
        self.value = value


class NotPorted(RunsError):
    pass


class StopAt(Exception):
    def __init__(self, name):
        self.name = name


class Unknown:
    """The value of a field with no initial value, until the game sets it or
    the world gives it."""

    def __repr__(self) -> str:
        return "unknown"


UNKNOWN = Unknown()


@dataclass(frozen=True)
class Member:
    enum: str
    name: str


class Machine:
    """The Records and a Program to run over them."""

    def __init__(self, prog: Program):
        self.prog = prog
        self.state: dict[str, object] = {}
        self.stop_before: set[str] = set()
        self.fired: list[tuple[str, tuple]] = []
        self.on_wait = lambda machine: None     # the host's turn at a wait
        self.jumped_to: str | None = None       # the routine code jumped to as it left
        declared_instructions.clear()
        declared_instructions.update(prog.instructions)
        for rec in prog.records.values():
            self.state[rec.name] = [] if rec.stream else self.fresh(rec)

    def fresh(self, rec: Record):
        def init(e, typ):
            return self.typed(self.eval(e, Scope("initial", {})), typ) if e is not None else UNKNOWN

        def slots(e, typ):
            if e is not None and e[0] == "slots":
                return [init(x, typ) for x in e[1]]
            return [init(e, typ) for _ in range(rec.count)]
        if rec.count is None:
            return {f: init(e, typ) for f, (typ, e) in rec.fields.items()}
        return {f: slots(e, typ) for f, (typ, e) in rec.fields.items()}

    # ---- running

    def run(self, name: str, args=()):
        r = self.prog.routines.get(name)
        if name in self.stop_before:
            raise StopAt(name)
        if r is None:
            raise NotPorted(f"{name} is not ported")
        self.fired.append((name, tuple(args)))
        scope = Scope(r.kind, dict(zip(r.params, args)), r)
        for cond in r.requires:
            if not self.truth(self.eval(cond, scope)):
                raise RunsError(f"{name}{tuple(args)}: precondition fails")
        try:
            self.block(r.body, scope)
        except Return:
            pass
        except (Break, Continue):
            raise RunsError(f"{name}: break or continue outside a loop")

    def block(self, stmts: list, scope: "Scope"):
        for k, s in enumerate(stmts):
            self.stmt(s, scope)
            if self.jumped_to is not None and scope.kind == "network":
                nxt = stmts[k + 1] if k + 1 < len(stmts) else None
                if not (nxt and nxt[0] == "run" and nxt[1] == self.jumped_to):
                    raise RunsError(f"{s[-1]}: the code jumped to {self.jumped_to}, so the Network runs it next")
                self.jumped_to = None

    def stmt(self, s, scope: "Scope"):
        op = s[0]
        if op == "if":
            _, arms, other, _ = s
            for cond, body in arms:
                if self.truth(self.eval(cond, scope)):
                    return self.block(body, scope)
            return self.block(other, scope)
        if op == "let":
            _, target, e, where = s
            self.bind(target, self.eval(e, scope), scope, where, new=True)
        elif op == "set":
            _, target, e, where = s
            self.bind(target, self.eval(e, scope), scope, where, new=False)
        elif op == "loop":
            _, bound, body, where = s
            n = bound[1] if bound[0] == "num" else as_count(self.eval(bound, scope))
            for _ in range(n):
                try:
                    self.block(body, scope)
                except Break:
                    return
                except Continue:
                    pass
            raise RunsError(f"{where}: loop ran past its bound of {n}")
        elif op == "for":
            _, var, lo, hi, body, _ = s
            for i in range(as_count(self.eval(lo, scope)), as_count(self.eval(hi, scope)) + 1):
                scope.locals[var] = i
                self.block(body, scope)
        elif op == "break":
            raise Break()
        elif op == "continue":
            raise Continue()
        elif op == "return":
            raise Return(self.eval(s[1], scope) if s[1] is not None else None)
        elif op == "emit":
            _, name, args, _ = s
            scope.check(name, write=True)
            rec = self.prog.records[name]
            vals = [self.eval(a, scope) for a in args]
            self.state[name].append(tuple(as_count(v) if t == "int" else as_word(v)
                                          for v, (t, _) in zip(vals, rec.fields.values())))
        elif op == "run":
            _, name, args, _ = s
            self.run(name, [self.eval(a, scope) for a in args])
        elif op == "match":
            _, e, arms, where = s
            v = self.eval(e, scope)
            enum = self.prog.enums[v.enum]
            missing = set(enum) - set(arms)
            if missing:
                raise RunsError(f"{where}: match misses {sorted(missing)}")
            self.block(arms[v.name], scope)
        elif op == "stop":
            raise Stop()
        elif op == "wait":
            self.on_wait(self)
        elif op == "jump":
            _, target, bound, where = s
            rec, fld, at = self.place(target, scope, where)
            if at is None:
                raise RunsError(f"{where}: code is a slot of a collection")
            self.jumped_to = self.execute(Place(rec, fld, at), as_count(self.eval(bound, scope)), scope, where)
        elif op == "unreachable":
            raise RunsError(f"{s[1]}: reached unreachable")

    def truth(self, v) -> bool:
        if not isinstance(v, bool):
            raise RunsError(f"not a condition: {v!r}")
        return v

    # ---- binding

    def bind(self, target, value, scope: "Scope", where: str, new: bool):
        if target[0] == "tuple":
            if not isinstance(value, tuple) or len(value) != len(target[1]):
                raise RunsError(f"{where}: cannot spread {value!r}")
            for t, v in zip(target[1], value):
                self.bind(t, v, scope, where, new)
            return
        if target[0] == "name":
            if not new and target[1] not in scope.locals:
                raise RunsError(f"{where}: set {target[1]} before let")
            scope.locals[target[1]] = value
            return
        if new:
            raise RunsError(f"{where}: let binds a local name")
        rec, fld, idx = self.place(target, scope, where)
        scope.check(rec, write=True)
        typ = self.prog.records[rec].fields[fld][0]
        value = self.typed(value, typ)
        if typ == "word":
            value = as_word(value)
        elif typ == "insn" and not isinstance(value, Insn):
            raise RunsError(f"{where}: {rec}.{fld} holds an instruction, not {value!r}")
        elif typ in self.prog.enums and not (isinstance(value, Member) and value.enum == typ):
            raise RunsError(f"{where}: {rec}.{fld} holds {typ}, not {value!r}")
        if idx is None:
            self.state[rec][fld] = value
        else:
            self.state[rec][fld][idx] = value

    def place(self, target, scope: "Scope", where: str):
        if target[0] == "field" and target[1][0] == "name" and target[1][1] in self.prog.records:
            return target[1][1], target[2], None
        if target[0] == "index" and target[1][0] == "field" and target[1][1][0] == "name":
            rec, fld = target[1][1][1], target[1][2]
            return rec, fld, slot(self.state[rec][fld], as_count(self.eval(target[2], scope)), target)
        raise RunsError(f"{where}: not a Record field")

    # ---- expressions

    def eval(self, e, scope: "Scope"):
        op = e[0]
        if op == "num":
            return word_of(e[1])
        if op == "bool":
            return e[1]
        if op == "tuple":
            return tuple(self.eval(x, scope) for x in e[1])
        if op == "name":
            n = e[1]
            if n in scope.locals:
                return scope.locals[n]
            if n in self.prog.records:
                scope.check(n, write=False)
                return ("record", n)
            enum = self.prog.member(n)
            if enum:
                return Member(enum, n)
            if n in self.prog.instructions and OPERANDS[n] is None:
                return Insn(n)
            raise RunsError(f"unknown name {n}")
        if op == "field":
            base = self.eval(e[1], scope)
            if not (isinstance(base, tuple) and base[:1] == ("record",)):
                raise RunsError(f"{e[2]}: field of a non-Record")
            return known(self.state[base[1]][e[2]], f"{base[1]}.{e[2]}")
        if op == "index":
            seq = self.eval(e[1], scope)
            return known(seq[slot(seq, as_count(self.eval(e[2], scope)), e)], repr(e[1]))
        if op == "call" and instruction_call(e[1], e[2]):
            return Insn(e[1], self.operand(e[1], e[2][0], scope))
        if op == "call":
            return BUILTINS[e[1]](*[self.eval(a, scope) for a in e[2]])
        if op == "neg":
            return W(as_word(self.eval(e[1], scope)).v ^ MASK)
        if op == "not":
            return not self.truth(self.eval(e[1], scope))
        if op == "bin":
            _, o, l, r = e
            if o == "and":
                return self.truth(self.eval(l, scope)) and self.truth(self.eval(r, scope))
            if o == "or":
                return self.truth(self.eval(l, scope)) or self.truth(self.eval(r, scope))
            a, b = self.eval(l, scope), self.eval(r, scope)
            if isinstance(a, Member) and isinstance(b, Member):
                b = self.typed(b, a.enum)
            return binary(o, a, b)
        raise RunsError(f"cannot evaluate {e!r}")

    def operand(self, op: str, e, scope: "Scope"):
        """An instruction's operand: the word of a Record it names (its slot
        computed now, the word itself not read), a routine, or a number."""
        kind = OPERANDS[op]
        if kind == "number":
            if e[0] != "num":
                raise RunsError(f"{op} takes a number: {e!r}")
            return e[1]
        if kind == "target" and e[0] == "name" and e[1] in self.prog.routines:
            return e[1]
        if e[0] == "field" and e[1][0] == "name" and e[1][1] in self.prog.records:
            rec, fld, slot = e[1][1], e[2], None
        elif e[0] == "index" and e[1][0] == "field" and e[1][1][0] == "name":
            rec, fld, slot = e[1][1][1], e[1][2], as_count(self.eval(e[2], scope))
        else:
            raise RunsError(f"{op} names a word of a Record{' or a routine' if kind == 'target' else ''}: {e!r}")
        r = self.prog.records.get(rec)
        if r is None or fld not in r.fields or (slot is None) != (r.count is None) \
                or slot is not None and slot >= r.count:
            raise RunsError(f"{op}: no word {rec}.{fld}{'' if slot is None else f'[{slot:o}]'}")
        return Place(rec, fld, slot)

    # ---- code

    def execute(self, start: Place, bound: int, scope: "Scope", where: str) -> str:
        """Run the words of code from start by the PDP-1's rules, until a
        jump leaves for a routine: its name. AC, IO and the program flags
        are the code's own, unknown until it sets them. The words it reads
        and writes go through the running Processor's contract."""
        ac = io = UNKNOWN
        flags: dict[int, bool] = {}
        pc = start.slot

        def read(at: Place):
            scope.check(at.record, write=False)
            v = self.state[at.record][at.field]
            return known(v if at.slot is None else v[at.slot], f"{at.record}.{at.field}")

        def write(at: Place, value):
            scope.check(at.record, write=True)
            if self.prog.records[at.record].fields[at.field][0] != "word":
                raise RunsError(f"{where}: {at.record}.{at.field} is not a word")
            if at.slot is None:
                self.state[at.record][at.field] = value
            else:
                self.state[at.record][at.field][at.slot] = value

        for _ in range(bound):
            insn = read(Place(start.record, start.field, pc))
            if not isinstance(insn, Insn):
                raise RunsError(f"{where}: {start.record}.{start.field}[{pc:o}] is not an instruction")
            pc += 1
            op, x = insn.op, insn.operand
            if op == "lac":
                ac = as_word(read(x))
            elif op == "lio":
                io = as_word(read(x))
            elif op == "dac":
                write(x, known(ac, "AC"))
            elif op == "dio":
                write(x, known(io, "IO"))
            elif op == "add":
                ac = add(known(ac, "AC"), as_word(read(x)))
            elif op == "sub":
                ac = sub(known(ac, "AC"), as_word(read(x)))
            elif op == "cma":
                ac = W(known(ac, "AC").v ^ MASK)
            elif op == "rcl":
                ac, io = rcl(known(ac, "AC"), known(io, "IO"), x)
            elif op in ("stf", "clf"):
                flags[x] = op == "stf"
            elif op == "szf":
                if not known(flags.get(x, UNKNOWN), f"program flag {x}"):
                    pc += 1
            elif op == "ioh":
                pass                                    # waits for the display: timing
            elif op == "dpy":
                scope.check(self.prog.display, write=True)
                self.state[self.prog.display].append((known(ac, "AC"), known(io, "IO"), 0))
            elif op == "jmp" and isinstance(x, str):
                return x
            elif op == "jmp":
                if (x.record, x.field) != (start.record, start.field):
                    raise RunsError(f"{where}: a jump from {start.record}.{start.field} to {x.record}.{x.field}")
                pc = x.slot
            else:
                raise RunsError(f"{where}: the machine has no rule for {op}")
        raise RunsError(f"{where}: the code ran past {bound} instructions")

    def typed(self, value, enum: str):
        """A member's name is the member of the enum it is compared with or
        stored as, when two enums share the name (off, on)."""
        if isinstance(value, Member) and value.enum != enum and value.name in self.prog.enums.get(enum, []):
            return Member(enum, value.name)
        return value


def slot(seq: list, n: int, e) -> int:
    """A slot of a collection: reading or writing past its last is an error."""
    if n >= len(seq):
        raise RunsError(f"{e!r}: slot {n:o} is past the collection's {len(seq):o} slots")
    return n


def known(value, what: str):
    if value is UNKNOWN:
        raise RunsError(f"{what} is unknown: the game has not set it, so the world gives it")
    return value


def binary(o: str, a, b):
    if isinstance(a, Member) or isinstance(b, Member):
        if o not in ("==", "!="):
            raise RunsError(f"{o} on enum")
        return (a == b) == (o == "==")
    index = any(isinstance(x, int) and not isinstance(x, bool) for x in (a, b))
    if index and o in ("+", "-", "==", "!=", "<", "<=", ">", ">="):
        a, b = as_count(a), as_count(b)
        return {"+": a + b, "-": a - b, "==": a == b, "!=": a != b, "<": a < b, "<=": a <= b,
                ">": a > b, ">=": a >= b}[o]
    if o in ("<", "<=", ">", ">="):
        w, z = as_word(a), as_word(b)
        if z.v != 0:
            raise RunsError("a word compares with 0 only")
        neg = bool(w.v & SIGN)
        return {"<": neg, ">=": not neg, "<=": neg or w.v == 0, ">": not (neg or w.v == 0)}[o]
    if o in ("<<", ">>"):
        return (sal if o == "<<" else sar)(as_word(a), as_count(b))
    a, b = as_word(a), as_word(b)
    if o == "==":
        return a.v == b.v
    if o == "!=":
        return a.v != b.v
    if o == "+":
        return add(a, b)
    if o == "-":
        return sub(a, b)
    if o == "&":
        return W(a.v & b.v)
    if o == "|":
        return W(a.v | b.v)
    if o == "^":
        return W(a.v ^ b.v)
    raise RunsError(f"no word operator {o}")


@dataclass
class Scope:
    kind: str
    locals: dict
    routine: Routine | None = None

    def check(self, record: str, write: bool):
        if self.kind == "initial":
            raise RunsError(f"an initial value touches no Record ({record})")
        if self.kind == "network":
            if write:
                raise RunsError(f"a network writes no Record ({record})")
            return
        r = self.routine
        if record not in r.writes and (write or record not in r.reads):
            raise RunsError(f"{r.name} does not declare {'writes' if write else 'reads'}: {record}")


def source() -> Path:
    """The RUNS source to run: runs/, or RUNS_SOURCE when a check runs a variant."""
    import os
    return Path(os.environ.get("RUNS_SOURCE", Path(__file__).resolve().parents[1] / "runs"))


def mentions(tree, names: set[str]) -> set[str]:
    """The names a statement or expression tree mentions. An instruction
    names a word it does not read: only its slot's expression counts."""
    if isinstance(tree, str):
        return {tree} & names
    if isinstance(tree, tuple) and tree[:1] == ("field",):
        return mentions(tree[1], names)         # a field's own name mentions nothing
    if isinstance(tree, tuple) and tree[:1] == ("call",) and instruction_call(tree[1], tree[2]):
        return mentions([tree[2][0][2]] if tree[2] and tree[2][0][0] == "index" else [], names)
    if isinstance(tree, (list, tuple)):
        return set().union(*(mentions(t, names) for t in tree)) if tree else set()
    if isinstance(tree, dict):
        return mentions(list(tree.values()), names)
    return set()


def runs_of(tree) -> set[str]:
    """The routines a body's run statements name."""
    if isinstance(tree, tuple) and tree and tree[0] == "run":
        return {tree[1]}
    if isinstance(tree, (list, tuple)):
        return set().union(*(runs_of(t) for t in tree)) if tree else set()
    if isinstance(tree, dict):
        return runs_of(list(tree.values()))
    return set()


def fires(prog: Program, name: str, seen: set[str]) -> set[str]:
    """Every routine a routine fires, itself included, through its sub-Networks."""
    if name in seen or name not in prog.routines:
        return seen
    seen.add(name)
    for target in runs_of(prog.routines[name].body):
        fires(prog, target, seen)
    return seen


def reads_of(tree, records: set[str]) -> set[str]:
    """The Records a body reads: every Record it mentions, except as the
    Record a set writes."""
    if isinstance(tree, tuple) and tree and tree[0] == "set":
        target = tree[1]
        targets = target[1] if target[0] == "tuple" else [target]
        inner = [t[2] for t in targets if t[0] == "index"]
        return mentions(tree[2], records) | mentions(inner, records)
    if isinstance(tree, tuple) and tree[:1] == ("field",):
        return mentions(tree, records)
    if isinstance(tree, (list, tuple)):
        return set().union(*(reads_of(s, records) for s in tree)) if tree else set()
    return mentions(tree, records)


def check_inputs(prog: Program, n: Routine, inside: set[str]) -> None:
    """A field with no initial value comes in from outside the game: a top
    Network whose routines read its Record declares it under reads:."""
    unknown = {name for name, r in prog.records.items()
               if not r.stream and any(e is None for _, e in r.fields.values())}
    for name in sorted(inside):
        r = prog.routines[name]
        for rec in sorted(reads_of(r.body, unknown) - n.reads):
            raise RunsError(f"network {n.name}: {rec} comes in from outside the game ({r.name} reads it "
                            f"and it has fields with no initial value); declare reads: {rec}")


def check_contracts(prog: Program) -> None:
    """A Network that declares reads or writes states its contract with the
    world outside it, as a Processor does. A top Network, one that nothing
    fires, is a whole game: it always has a contract, its boundary with
    presentation. Every Record a Network's Processors touch is its own,
    unless a Processor it does not fire touches it too, or it is a stream:
    those cross its boundary and must be declared. A Processor that nothing
    fires (a tunable whose caller is not ported yet) shares nothing at run
    time. Each declared Record must be touched inside.

    A game may have several top Networks: the start Networks, which the
    host fires once, and the frame, which it fires each frame. Together
    they are the game, so a Record they share does not cross the boundary."""
    records = set(prog.records)
    fired = set().union(*(runs_of(r.body) - {r.name} for r in prog.routines.values()))
    tops = [n.name for n in prog.routines.values() if n.kind == "network" and n.name not in fired]
    game = set().union(*(fires(prog, t, set()) for t in tops))
    for n in prog.routines.values():
        if n.kind != "network" or not (n.reads or n.writes or n.name not in fired):
            continue
        inside = fires(prog, n.name, set())
        procs = [prog.routines[r] for r in inside if prog.routines[r].kind == "processor"]
        read = set().union(*(p.reads | p.writes for p in procs))
        written = set().union(*(p.writes for p in procs))
        guarded = set().union(*(mentions(prog.routines[r].body, records) for r in inside
                                if prog.routines[r].kind == "network"))
        outside = [r for name, r in prog.routines.items()
                   if name not in inside and name in fired and r.kind == "processor"
                   and (n.name in fired or name not in game)]
        shared = set().union(*(p.reads | p.writes for p in outside))
        for rec in sorted(written & (shared | {r for r in records if prog.records[r].stream})):
            if rec not in n.writes:
                raise RunsError(f"network {n.name}: {rec} leaves it; declare writes: {rec}")
        for rec in sorted((read | guarded) - written & shared):
            if rec not in n.reads and rec not in n.writes:
                raise RunsError(f"network {n.name}: {rec} comes from outside it; declare reads: {rec}")
        if stale := sorted(n.writes - written):
            raise RunsError(f"network {n.name} declares writes: {stale}, but nothing inside writes them")
        if stale := sorted(n.reads - read - guarded):
            raise RunsError(f"network {n.name} declares reads: {stale}, but nothing inside reads them")
        if n.name not in fired:
            check_inputs(prog, n, inside)


def program(root: Path) -> Program:
    prog = load(sorted(root.glob("*.runs")) + sorted(root.glob("*.runs-prim")))
    check_contracts(prog)
    return prog
