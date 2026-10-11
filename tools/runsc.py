"""runsc: RUNS and its PDP-1 binding -> the pdp1c C dialect -> pdp1cc -> the
tape image, compared by sha256 with the original's.

The RUNS text holds the game. The binding (pdp1/<unit>.toml) holds only how
the PDP-1 carries it: the order of things on the tape, each routine's
calling convention, which register holds a local. pdp1cc, spacewar-c's
compiler, is the back end.

A unit of spacewar-c's lift.toml that has a binding is compiled from RUNS;
the others still come from the lifted C, until each is ported."""
from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path

import runs

ROOT = Path(__file__).resolve().parents[1]
SPACEWAR_C = ROOT.parent / "spacewar-c"
BINDINGS = ROOT / "pdp1"
OUT = ROOT / "build"

# C precedence, loosest first, for the operators RUNS shares with C.
C_LEVEL = {"or": 1, "and": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
           "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10}
C_OP = {"or": "||", "and": "&&"}


class BindError(Exception):
    pass


def octal(n: int) -> str:
    return f"0{n:o}" if n > 7 else str(n)


class Unit:
    """One binding: the RUNS routines and fields it places, in tape order."""

    def __init__(self, prog: runs.Program, path: Path):
        self.prog = prog
        self.path = path
        self.spec = tomllib.loads(path.read_text())
        self.out: list[str] = []

    # ---- names

    def c_name(self, record: str, fld: str) -> str:
        return f"{record}_{fld}"

    def expr(self, e, scope: dict) -> str:
        return self._expr(e, scope)[0]

    def _expr(self, e, scope: dict) -> tuple[str, int]:
        op = e[0]
        if op == "num":
            return octal(e[1]), 99
        if op == "name":
            return scope.get(e[1], e[1]), 99
        if op == "field":
            rec = e[1][1]
            return scope.get(f"{rec}.{e[2]}", self.c_name(rec, e[2])), 99
        if op == "neg":
            return f"-{self._paren(e[1], scope, 11)}", 11
        if op == "bin":
            _, o, a, b = e
            lvl = C_LEVEL[o]
            return f"{self._paren(a, scope, lvl)} {C_OP.get(o, o)} {self._paren(b, scope, lvl + 1)}", lvl
        if op == "call":
            return f"{e[1]}({', '.join(self.expr(a, scope) for a in e[2])})", 99
        raise BindError(f"cannot compile {e!r}")

    def _paren(self, e, scope: dict, at_least: int) -> str:
        text, lvl = self._expr(e, scope)
        return text if lvl >= at_least else f"({text})"

    # ---- statements

    def block(self, stmts: list, scope: dict, depth: int):
        k = 0
        while k < len(stmts):
            k += self.stmt(stmts, k, scope, depth)

    def emit(self, depth: int, text: str):
        self.out.append("    " * depth + text)

    def incremented(self, s) -> str | None:
        """`set x = x + 1`: the place x, else None."""
        if s[0] == "set" and s[2][0] == "bin" and s[2][1] == "+" and s[2][3] == ("num", 1) \
                and s[2][2] == s[1]:
            return s[1]
        return None

    def stmt(self, stmts: list, k: int, scope: dict, depth: int) -> int:
        s = stmts[k]
        op = s[0]
        nxt = stmts[k + 1] if k + 1 < len(stmts) else None
        if (place := self.incremented(s)) is not None:
            target = self.expr(place, scope)
            if nxt and nxt[0] == "if" and len(nxt[1]) == 1 and not nxt[2] \
                    and nxt[1][0][0][0] == "bin" and nxt[1][0][0][2] == place and nxt[1][0][0][3] == ("num", 0):
                cond = nxt[1][0][0]
                self.emit(depth, f"if (++{target} {cond[1]} 0)")
                self.body(nxt[1][0][1], scope, depth)
                return 2
            self.emit(depth, f"++{target};")
            return 1
        if op == "let":
            _, target, e, _ = s
            if target[0] == "tuple":
                raise BindError(f"{s[-1]}: let of a tuple")
            name = target[1]
            kind = "register word" if name in scope["@io"] else "word"
            self.emit(depth, f"{kind} {name} = {self.expr(e, scope)};")
            return 1
        if op == "set":
            _, target, e, where = s
            if target[0] == "tuple":
                if e[0] == "call" and [self.expr(a, scope) for a in e[2][:2]] == \
                        [self.expr(t, scope) for t in target[1]]:
                    self.emit(depth, f"{self.expr(e, scope)};")
                    return 1
                raise BindError(f"{where}: a shift's result goes back where it came from")
            self.emit(depth, f"{self.expr(target, scope)} = {self.expr(e, scope)};")
            return 1
        if op == "loop":
            self.emit(depth, "for (;;)")
            self.body(s[2], scope, depth)
            return 1
        if op == "if":
            _, arms, other, _ = s
            for n, (cond, body) in enumerate(arms):
                self.emit(depth, f"{'else ' if n else ''}if ({self.expr(cond, scope)})")
                self.body(body, scope, depth)
            if other:
                self.emit(depth, "else")
                self.body(other, scope, depth)
            return 1
        if op in ("break", "continue"):
            self.emit(depth, f"{op};")
            return 1
        if op == "return":
            result = scope.get("@result")
            self.emit(depth, f"return {result};" if result else "return;")
            return 1
        raise BindError(f"{s[-1]}: cannot compile {op}")

    def body(self, stmts: list, scope: dict, depth: int):
        self.emit(depth, "{")
        self.block(stmts, scope, depth + 1)
        self.emit(depth, "}")

    # ---- places

    def field_ref(self, dotted: str) -> tuple[str, str]:
        rec, fld = dotted.split(".")
        if rec not in self.prog.records or fld not in self.prog.records[rec].fields:
            raise BindError(f"{self.path.name}: no field {dotted}")
        return rec, fld

    def initial(self, rec: str, fld: str) -> str:
        e = self.prog.records[rec].fields[fld][1]
        return self.expr(e, {}) if e is not None else "0"

    def processor(self, p: dict):
        r = self.prog.routines[p["processor"]]
        conv = p["convention"]
        scope: dict = {"@io": set(p.get("io", []))}
        params = ""
        if entry := p.get("entry"):
            rec, fld = self.field_ref(entry)
            scope[entry] = fld
            params = f"word {fld}"
        returns = "void"
        if result := p.get("result"):
            rec, fld = self.field_ref(result)
            scope["@result"] = self.c_name(rec, fld)
            returns = "word"
        for rec, fld in (self.field_ref(f) for f in self.data_fields()):
            self.emit(0, f"extern word {self.c_name(rec, fld)};")
        self.emit(0, f"{conv} {returns} {r.name}({params})")
        self.body(r.body, scope, 0)

    def data_fields(self) -> list[str]:
        return [f for p in self.spec["place"] for f in p.get("fields", [])]

    def compile(self) -> str:
        self.out = []
        for p in self.spec["place"]:
            if "processor" in p:
                self.processor(p)
            else:
                for f in p["fields"]:
                    rec, fld = self.field_ref(f)
                    self.emit(0, f"word {self.c_name(rec, fld)} = {self.initial(rec, fld)};")
        return "\n".join(self.out) + "\n"


def build() -> int:
    prog = runs.program(runs.source())
    lift = tomllib.loads((SPACEWAR_C / "lift.toml").read_text())
    bound = {tomllib.loads(b.read_text())["replaces"]: b for b in sorted(BINDINGS.glob("*.toml"))}
    lifted = OUT / "lift"
    if lifted.exists():
        for f in lifted.iterdir():
            f.unlink()
    lifted.mkdir(parents=True, exist_ok=True)
    for f in (SPACEWAR_C / "lift").iterdir():
        (lifted / f.name).symlink_to(f)
    units = []
    for u in lift["unit"]:
        if u["c"] in bound:
            c = OUT / u["c"]
            c.unlink()
            c.write_text(Unit(prog, bound.pop(u["c"])).compile())
        units.append(f'[[unit]]\nc = "{u["c"]}"\nprefix = "{u["prefix"]}"\n')
    if bound:
        raise BindError(f"bindings replace no lift unit: {sorted(bound)}")
    toml = OUT / "lift.toml"
    head = "".join(f'{k} = "{SPACEWAR_C / v if k in ("macro1", "macro1_src", "oracle_listing") else v}"\n'
                   for k, v in lift.items() if k != "unit")
    toml.write_text(head + "\n" + "\n".join(units))
    return subprocess.run(["uv", "run", "--project", str(SPACEWAR_C), "python", "-m", "tools.pdp1cc.cli",
                           "build", str(toml)], cwd=SPACEWAR_C).returncode


if __name__ == "__main__":
    sys.exit(build())
