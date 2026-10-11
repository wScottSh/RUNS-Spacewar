"""The image must come from the RUNS text, not from the binding. Builds the
image once (it must match the oracle), then mutates the RUNS of every
routine and field the bindings compile, one change at a time:

- each number, and each field's initial value, one up;
- each field reference to each other field of its Record of the same type;
- each operator to another (+ and -, < and >=, & and |, and and or, ...);
- each enum member to another of its enum;
- each statement deleted, and each pair of adjacent statements swapped;
- each set of a field at a Processor's top level made a local of the
  field's name, which the Processor's later statements read instead;

and deletes each key line and each section of each binding, which must
then build another image or be refused: a key that changes nothing is dead.

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
import shutil
import sys
import tempfile
import tomllib
import zlib
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import runs
import runsc
from runsc import dotted_of

OPERATORS = {"+": "-", "-": "+", "&": "|", "|": "&", "^": "|", "<<": ">>", ">>": "<<",
             "<": ">=", ">=": "<", ">": "<=", "<=": ">", "==": "!=", "!=": "==", "and": "or", "or": "and"}
STATEMENTS = {"let", "set", "if", "loop", "for", "break", "continue", "stop", "unreachable", "wait",
              "return", "jump", "emit", "run", "match"}
TRIALS = 200                # seeded Record states a silent mutant is fired on
CLEAN = TRIALS // 4         # firings that must run without error and reach the mutated routine
EDGES = [0, runs.MASK, 1, runs.MASK ^ 1, 0o377777, 0o400000, 0o777, 0o400777]   # 0, -0, 1, -1, the extremes


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


def replaced_all(tree, old, new):
    """tree with every node equal to old as new."""
    if tree == old:
        return new
    if isinstance(tree, list):
        return [replaced_all(t, old, new) for t in tree]
    if isinstance(tree, tuple):
        return tuple(replaced_all(t, old, new) for t in tree)
    if isinstance(tree, dict):
        return {k: replaced_all(v, old, new) for k, v in tree.items()}
    return tree


def unplaced(tree):
    """tree without the source lines its statements carry."""
    if isinstance(tree, tuple) and tree and tree[0] in STATEMENTS and isinstance(tree[-1], str):
        return tuple(unplaced(x) for x in tree[:-1])
    if isinstance(tree, (list, tuple)):
        return type(tree)(unplaced(x) for x in tree)
    if isinstance(tree, dict):
        return {k: unplaced(v) for k, v in tree.items()}
    return tree


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
            for f in [f for f, (t, _) in rec.fields.items() if f != node[2] and t == typ]:
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
        if path == () and prog.routines[proc].kind == "processor":
            own = runsc.routine_locals(prog.routines[proc])
            for k, s in enumerate(node):
                fields = [x for x in (s[1][1] if s[1][0] == "tuple" else [s[1]]) if x[0] == "field"]
                if s[0] == "set" and fields and not {x[2] for x in fields} & own:
                    yield Mutant(f"{proc} local {', '.join(dotted_of(x) for x in fields)} @{line(s)}", "local",
                                 proc, (k,))
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
    if m.kind == "local":
        (k,) = m.path
        s = r.body[k]
        target, rest = s[1], r.body[k + 1:]
        for x in (s[1][1] if s[1][0] == "tuple" else [s[1]]):
            if x[0] == "field":
                target, rest = replaced_all(target, x, ("name", x[2])), replaced_all(rest, x, ("name", x[2]))
        body = r.body[:k] + [("let", target, s[2], s[3])] + rest
    elif m.kind in ("delete", "swap"):
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
    """Every word of every Record drawn at random, a quarter of them from the
    words at the edges, every enum field a member drawn at random;
    instructions and streams as the program starts them."""
    m = runs.Machine(prog)

    def word() -> runs.W:
        return runs.W(rng.choice(EDGES) if rng.random() < 0.25 else rng.randrange(1 << 18))
    for name, rec in prog.records.items():
        if rec.stream:
            continue
        for fld, (typ, _) in rec.fields.items():
            draw = word if typ == "word" else \
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
    or the error it stopped with; and the routines it ran."""
    m = runs.Machine(prog)
    m.state = copy.deepcopy(state)
    try:
        m.run(name, args)
    except runs.Stop:
        return ("stop", m.state), {n for n, _ in m.fired}
    except (runs.RunsError, runs.Return, runs.Break, runs.Continue) as e:
        return (f"error {type(e).__name__}: {e}", None), {n for n, _ in m.fired}
    return (m.jumped_to, m.state), {n for n, _ in m.fired}


def same_game(prog: runs.Program, mutated: runs.Program, name: str, seed: str,
              mutated_routine: str | None = None) -> tuple[bool, str]:
    """Fire name before and after the mutation on the same seeded Records:
    the same Records, points and error every time, with enough firings
    that run clean through the mutated routine."""
    rng = random.Random(zlib.crc32(seed.encode()))
    calls = call_arguments(prog)
    clean = 0
    for k in range(TRIALS):
        state = random_state(prog, rng)
        args = arguments(prog, name, calls, rng)
        (a, ran), (b, _) = fire(prog, name, args, state), fire(mutated, name, args, state)
        if a != b:
            return False, f"{name}{tuple(args)} trial {k}: {str(a[0])[:80]} / {str(b[0])[:80]}"
        clean += not str(a[0]).startswith("error") and (mutated_routine or name) in ran
    if clean < CLEAN:
        return False, f"{name}: only {clean} of {TRIALS} firings ran clean through {mutated_routine or name}"
    return True, f"{name}: {TRIALS} firings, {clean} clean through {mutated_routine or name}"


def equivalent(prog: runs.Program, mutated: runs.Program, m: Mutant) -> tuple[bool, str]:
    """The mutated routine, then each bound routine that compiles it, fired
    before and after on the same seeded Records."""
    if m.routine is None:
        return False, "an initial value"
    if unplaced(mutated.routines[m.routine].body) == unplaced(prog.routines[m.routine].body):
        return True, "the same text (identical statements swapped)"
    why = []
    for name in [m.routine] + [o for o in owners(prog).get(m.routine, []) if o != m.routine]:
        ok, how = same_game(prog, mutated, name, m.label, m.routine)
        if ok:
            return True, how
        why.append(how)
    return False, "; ".join(why)


# ---------------------------------------------------------------- the binding

def key_lines() -> list[tuple[str, int, int]]:
    """(binding file, first line, past the last) of each whole key = value
    line, and of each [section] or [[place]] with its keys."""
    out = []
    for b in sorted(runsc.BINDINGS.glob("*.toml")):
        lines = b.read_text().splitlines()
        heads = [n for n, text in enumerate(lines) if text.startswith("[")] + [len(lines)]
        out += [(b.name, a, z) for a, z in zip(heads, heads[1:])]
        for n, text in enumerate(lines):
            s = text.strip()
            if s and not s.startswith(("#", "[")) and "=" in s and s.count("[") == s.count("]") \
                    and s.count("{") == s.count("}"):
                out.append((b.name, n, n + 1))
    return out


def without_key(where: tuple[str, int, int]) -> tuple[str, str]:
    """A binding with one key line, or one section, deleted must build
    another image or be refused: a key that changes nothing is dead."""
    name, n, past = where
    prog = runs.program(runs.source())
    home = runsc.BINDINGS
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        shutil.copytree(home, tmp / "pdp1")
        lines = (tmp / "pdp1" / name).read_text().splitlines()
        del lines[n:past]
        (tmp / "pdp1" / name).write_text("\n".join(lines) + "\n")
        runsc.BINDINGS = tmp / "pdp1"
        try:
            return ("changed" if runsc.build(prog, tmp / "out") else "dead"), ""
        except (runsc.BindError, tomllib.TOMLDecodeError) as e:
            return "refused", str(e)
        except Exception as e:      # noqa: BLE001 - a crash is a finding of the gate
            return "crash", f"{type(e).__name__}: {e}"
        finally:
            runsc.BINDINGS = home


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
    keys = key_lines()
    with ProcessPoolExecutor(mp_context=multiprocessing.get_context("fork")) as pool:
        results = list(pool.map(verdict, built, chunksize=4))
        kept = list(pool.map(without_key, keys))
    dead = [f"{name}:{n + 1} {what.upper()} {how}" for (name, n, _), (what, how) in zip(keys, kept)
            if what in ("dead", "crash")]
    for where in dead:
        print(f"  binding key {where}")
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
    failed = total["silent"] + total["crash"] + len(dead)
    print(f"check_compiled: image matches; {len(built)} mutants{' (sampled)' if '--sample' in sys.argv else ''}: "
          f"{total['changed']} change the image, {total['refused']} refused by runsc, "
          f"{total['rejected']} rejected by the evaluator, {total['equivalent']} silent and the same game, "
          f"{total['silent']} silent and not shown the same, {total['crash']} crash; {len(bounds)} loop bounds; "
          f"{len(keys) - len(dead)}/{len(keys)} binding keys and sections live")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
