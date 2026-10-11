"""The image must come from the RUNS text, not from the binding. Builds the
image once (it must match the oracle), then mutates the RUNS of every
routine and field the bindings compile, one change at a time:

- each number, and each field's initial value, one up;
- each field reference to another field of its Record of the same type
  (at most two others a reference, picked by a seeded draw);
- each operator to another (+ and -, < and >=, & and |, and and or, ...);
- each enum member to another of its enum;
- each statement deleted, and each pair of adjacent statements swapped.

Each mutant is classified. It changes the image; or the evaluator rejects
the text before anything runs (runs.check); or runsc refuses it with a
BindError naming the RUNS construct. A mutant that builds the original
image is silent, and passes only when the evaluator shows it is the same
game: the mutated routine, and failing that each bound routine that
compiles it, fired on seeded random Records before and after the mutation
must leave the same Records, the same points and the same error, with at
least a quarter of the firings running clean. Any other silent mutant, and
any crash of runsc, fails the gate. A loop's bound is RUNS's check, not
code; it is listed apart and not built.

Usage: [--sample N] [--only TEXT] (build N mutants drawn by a seeded
shuffle, not all; only those whose label holds TEXT).
Run under spacewar-c's environment:
  uv run --project ../spacewar-c python tools/check_compiled.py"""
from __future__ import annotations

import copy
import dataclasses
import multiprocessing
import random
import sys
import tempfile
import tomllib
import zlib
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import runs
import runsc

OPERATORS = {"+": "-", "-": "+", "&": "|", "|": "&", "^": "|", "<<": ">>", ">>": "<<",
             "<": ">=", ">=": "<", ">": "<=", "<=": ">", "==": "!=", "!=": "==", "and": "or", "or": "and"}
STATEMENTS = {"let", "set", "if", "loop", "for", "break", "continue", "stop", "unreachable", "wait",
              "return", "jump", "emit", "run", "match"}
FIELD_SWAPS = 2             # other fields tried a field reference
TRIALS = 200                # seeded Record states a silent mutant is fired on
CLEAN = TRIALS // 4         # firings that must run without error


@dataclasses.dataclass(frozen=True)
class Mutant:
    label: str
    kind: str               # number, initial, field, operator, member, delete, swap
    routine: str | None     # the routine mutated; None for a field's initial value
    path: tuple             # into the routine's body, or (record, field, path into its initial value)
    new: object = None      # the node put at path (number, field, operator, member)


def replaced(tree, path, new):
    if not path:
        return new
    k = path[0]
    items = list(tree)
    items[k] = replaced(tree[k], path[1:], new)
    return items if isinstance(tree, list) else tuple(items)


def at(tree, path):
    for k in path:
        tree = tree[k]
    return tree


def nodes(tree, path=()):
    """(path, node) of every list and tuple of a tree; a match's arms are a
    dict, whose bodies are not mutated."""
    yield path, tree
    if isinstance(tree, (list, tuple)):
        for k, t in enumerate(tree):
            yield from nodes(t, path + (k,))


def is_block(x) -> bool:
    return isinstance(x, list) and bool(x) and all(
        isinstance(s, tuple) and s and s[0] in STATEMENTS and isinstance(s[-1], str) for s in x)


def line(s) -> str:
    return s[-1].rsplit("/", 1)[-1]


def compiled(prog: runs.Program, name: str, bound: set[str]):
    """The routines a bound routine compiles: itself, and the ones its
    Network runs that are not bound routines of their own."""
    yield name
    for inner in sorted(runs.runs_of(prog.routines[name].body) - bound):
        yield from compiled(prog, inner, bound)


def bound_places(prog: runs.Program):
    specs = [tomllib.loads(b.read_text()) for b in sorted(runsc.BINDINGS.glob("*.toml")) if b.name != runsc.DEVICES]
    places = [p for spec in specs for p in spec.get("place", []) + spec.get("inline", []) + spec.get("code", [])]
    return specs, places, {p["routine"] for p in places if "routine" in p}


def owners(prog: runs.Program) -> dict[str, list[str]]:
    """Each compiled routine -> the bound routines whose code holds it."""
    _, _, bound = bound_places(prog)
    out: dict[str, list[str]] = {}
    for name in sorted(bound):
        for proc in dict.fromkeys(compiled(prog, name, bound)):
            out.setdefault(proc, []).append(name)
    return out


def routine_sites(prog: runs.Program, proc: str):
    body = prog.routines[proc].body
    for path, node in nodes(body):
        if isinstance(node, tuple) and node and node[0] == "num":
            yield Mutant(f"{proc} {path} {node[1]:o}", "number", proc, path, ("num", node[1] + 1))
        elif isinstance(node, tuple) and node and node[0] == "field" and node[1][0] == "name" \
                and node[1][1] in prog.records:
            rec = prog.records[node[1][1]]
            typ = rec.fields[node[2]][0]
            others = [f for f, (t, _) in rec.fields.items() if f != node[2] and t == typ]
            rng = random.Random(zlib.crc32(f"{proc} {path}".encode()))
            for f in sorted(rng.sample(others, min(FIELD_SWAPS, len(others)))):
                yield Mutant(f"{proc} field {rec.name}.{node[2]} -> {f} {path}", "field", proc, path,
                             ("field", node[1], f))
        elif isinstance(node, tuple) and node and node[0] == "bin" and node[1] in OPERATORS:
            yield Mutant(f"{proc} operator {node[1]} -> {OPERATORS[node[1]]} {path}", "operator", proc, path,
                         ("bin", OPERATORS[node[1]], *node[2:]))
        elif isinstance(node, tuple) and len(node) == 2 and node[0] == "name" and isinstance(node[1], str) \
                and node[1] not in prog.routines[proc].params:
            for enum, members in prog.enums.items():
                if node[1] in members:
                    other = next(m for m in members if m != node[1])
                    yield Mutant(f"{proc} member {node[1]} -> {other} {path}", "member", proc, path,
                                 ("name", other))
        if is_block(node):
            for k, s in enumerate(node):
                if len(node) > 1:
                    yield Mutant(f"{proc} delete {s[0]} @{line(s)}", "delete", proc, path + (k,))
                if k + 1 < len(node):
                    yield Mutant(f"{proc} swap {s[0]}/{node[k + 1][0]} @{line(s)}", "swap", proc, path + (k,))


def sites(prog: runs.Program) -> list[Mutant]:
    """Every mutant of the routines the bindings compile, and of the initial
    value of each field they place or hand a routine."""
    specs, places, bound = bound_places(prog)
    table = {k: v for spec in specs for k, v in spec.get("table", {}).items()}
    out: list[Mutant] = []
    for proc in owners(prog):
        out += routine_sites(prog, proc)
    fields = []
    for place in places:
        if place.get("table"):
            fields += [f"{r}.{f}" for r in table["records"] for f in prog.records[r].fields]
        if place.get("routine"):
            fields += [place.get(k) for k in ("entry", "ac_param", "io_param", "byname")]
            fields += place.get("result", []) + place.get("cells", []) + place.get("data", [])
        fields += place.get("fields", []) + ([place["slots"]] if "slots" in place else [])
    fields += [f for spec in specs for f in spec.get("pool", []) + list(spec.get("homes", {}))]
    for dotted in dict.fromkeys(f for f in fields if f and "." in f):     # a local has no initial value
        rec, fld = dotted.split(".")
        for path, node in nodes(prog.records[rec].fields[fld][1] or ()):
            if isinstance(node, tuple) and node and node[0] == "num":
                out.append(Mutant(f"{dotted} = {node[1]:o} {path}", "initial", None, (rec, fld, path),
                                  ("num", node[1] + 1)))
    return out


def is_bound(prog: runs.Program, m: Mutant) -> bool:
    """A mutant anywhere in a loop's bound expression."""
    if m.kind not in ("number", "field", "operator", "member"):
        return False
    node = prog.routines[m.routine].body
    for k in m.path:
        if isinstance(node, tuple) and (node[:1] == ("loop",) and k == 1 or node[:1] == ("jump",) and k == 2):
            return True
        node = node[k]
    return False


def mutate(prog: runs.Program, m: Mutant) -> runs.Program:
    if m.kind == "initial":
        rec, fld, path = m.path
        r = prog.records[rec]
        typ, init = r.fields[fld]
        fields = {**r.fields, fld: (typ, replaced(init, path, m.new))}
        return dataclasses.replace(prog, records={**prog.records, rec: runs.Record(rec, r.count, fields, r.stream)})
    r = prog.routines[m.routine]
    if m.kind in ("delete", "swap"):
        *where, k = m.path
        block = list(at(r.body, where))
        if m.kind == "delete":
            del block[k]
        else:
            block[k], block[k + 1] = block[k + 1], block[k]
        body = replaced(r.body, tuple(where), block)
    else:
        body = replaced(r.body, m.path, m.new)
    new = runs.Routine(r.kind, r.name, r.params, body, r.reads, r.writes, r.requires)
    return dataclasses.replace(prog, routines={**prog.routines, r.name: new})


# ---------------------------------------------------------------- evaluator

def call_arguments(prog: runs.Program) -> dict[str, list[list]]:
    """Each routine's argument lists, as its runs write them."""
    out: dict[str, list[list]] = {}

    def visit(tree):
        if isinstance(tree, tuple) and tree and tree[0] == "run":
            out.setdefault(tree[1], []).append(tree[2])
        if isinstance(tree, (list, tuple)):
            for t in tree:
                visit(t)
        elif isinstance(tree, dict):
            for t in tree.values():
                visit(t)
    for r in prog.routines.values():
        visit(r.body)
    return out


def random_state(prog: runs.Program, rng: random.Random) -> dict:
    """Every word of every Record drawn at random, every enum field a member
    drawn at random; instructions and streams as the program starts them."""
    m = runs.Machine(prog)
    for name, rec in prog.records.items():
        if rec.stream:
            continue
        for fld, (typ, _) in rec.fields.items():
            draw = (lambda: runs.W(rng.randrange(1 << 18))) if typ == "word" else \
                (lambda t=typ: runs.Member(t, rng.choice(prog.enums[t]))) if typ in prog.enums else None
            if draw is None:
                continue
            if rec.count is None:
                m.state[name][fld] = draw()
            else:
                m.state[name][fld] = [draw() for _ in range(rec.count)]
    return m.state


def arguments(prog: runs.Program, name: str, calls: dict, rng: random.Random) -> list:
    params = prog.routines[name].params
    if not params:
        return []
    written = rng.choice(calls[name]) if calls.get(name) else [("name", p) for p in params]
    return [runs.word_of(a[1]) if a[0] == "num" else rng.choice([0, 1, rng.randrange(0o30)]) for a in written]


def fire(prog: runs.Program, name: str, args: list, state: dict):
    """What one firing leaves: the Records and the routine code jumped to,
    or the error it stopped with."""
    m = runs.Machine(prog)
    m.state = copy.deepcopy(state)
    try:
        m.run(name, args)
    except runs.Stop:
        return "stop", m.state
    except (runs.RunsError, runs.Return, runs.Break, runs.Continue) as e:
        return f"error {type(e).__name__}: {e}", None
    return m.jumped_to, m.state


def same_game(prog: runs.Program, mutated: runs.Program, name: str, seed: str) -> tuple[bool, str]:
    rng = random.Random(zlib.crc32(seed.encode()))
    calls = call_arguments(prog)
    clean = 0
    for k in range(TRIALS):
        state = random_state(prog, rng)
        args = arguments(prog, name, calls, rng)
        a, b = fire(prog, name, args, state), fire(mutated, name, args, state)
        if a != b:
            return False, f"{name}{tuple(args)} trial {k}: {str(a[0])[:80]} / {str(b[0])[:80]}"
        clean += not str(a[0]).startswith("error")
    if clean < CLEAN:
        return False, f"{name}: only {clean} of {TRIALS} firings ran clean"
    return True, f"{name}: {TRIALS} firings, {clean} clean"


def equivalent(prog: runs.Program, mutated: runs.Program, m: Mutant) -> tuple[bool, str]:
    """The mutated routine, then each bound routine that compiles it, fired
    before and after on the same seeded Records."""
    if m.routine is None:
        return False, "an initial value"
    why = []
    for name in [m.routine] + [o for o in owners(prog).get(m.routine, []) if o != m.routine]:
        ok, how = same_game(prog, mutated, name, m.label)
        if ok:
            return True, how
        why.append(how)
    return False, "; ".join(why)


# ---------------------------------------------------------------- the gate

def verdict(m: Mutant) -> tuple[str, str]:
    """changed, rejected (by the evaluator), refused (by runsc), equivalent,
    or the failures: silent, crash."""
    prog = runs.program(runs.source())
    mutated = mutate(prog, m)
    try:
        runs.check(mutated)
    except runs.RunsError as e:
        return "rejected", str(e)
    with tempfile.TemporaryDirectory() as out:
        try:
            code = runsc.build(mutated, Path(out))
        except runsc.BindError as e:
            return "refused", str(e)
        except Exception as e:      # noqa: BLE001 - a crash is a finding of the gate
            return "crash", f"{type(e).__name__}: {e}"
    if code != 0:
        return "changed", next((s.strip() for s in runsc.build.said.splitlines() if "first difference" in s), "")
    ok, how = equivalent(prog, mutated, m)
    return ("equivalent" if ok else "silent"), how


def main() -> int:
    prog = runs.program(runs.source())
    if runsc.build(prog) != 0:
        print(runsc.build.said)
        print("check_compiled: the unmutated image does not match")
        return 1
    found = sites(prog)
    bounds = [m for m in found if is_bound(prog, m)]
    built = [m for m in found if not is_bound(prog, m)]
    if "--only" in sys.argv:
        built = [m for m in built if sys.argv[sys.argv.index("--only") + 1] in m.label]
    if "--sample" in sys.argv:
        n = int(sys.argv[sys.argv.index("--sample") + 1])
        random.Random(1962).shuffle(built)
        built = built[:n]
    with ProcessPoolExecutor(mp_context=multiprocessing.get_context("fork")) as pool:
        results = list(pool.map(verdict, built, chunksize=4))
    for m in bounds:
        print(f"  loop bound, RUNS's check only: {m.label}")
    by = Counter()
    for m, (what, how) in zip(built, results):
        by[(m.kind, what)] += 1
        if what in ("refused", "equivalent", "silent", "crash"):
            print(f"  {what.upper() if what in ('silent', 'crash') else what}: {m.label}: {how[:160]}")
    kinds = sorted({k for k, _ in by})
    for kind in kinds:
        print(f"  {kind}: " + ", ".join(f"{by[(kind, w)]} {w}" for w in
                                         ("changed", "refused", "rejected", "equivalent", "silent", "crash")
                                         if by[(kind, w)]))
    total = Counter(w for w, _ in results)
    failed = total["silent"] + total["crash"]
    print(f"check_compiled: image matches; {len(built)} mutants{' (sampled)' if '--sample' in sys.argv else ''}: "
          f"{total['changed']} change the image, {total['refused']} refused by runsc, "
          f"{total['rejected']} rejected by the evaluator, {total['equivalent']} silent and the same game, "
          f"{total['silent']} silent and not shown the same, {total['crash']} crash; {len(bounds)} loop bounds")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
