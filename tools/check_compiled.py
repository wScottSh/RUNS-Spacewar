"""The image must come from the RUNS text, not from the lifted C or the
binding. Builds the image once (it must match the oracle), then changes
each number in each routine and field the bindings compile, one at a time,
and requires the image to change. A loop's bound is RUNS's check, not
code; it is listed apart and not built.

Run under spacewar-c's environment:
  uv run --project ../spacewar-c python tools/check_compiled.py"""
from __future__ import annotations

import multiprocessing
import sys
import tempfile
import tomllib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import runs
import runsc


def numbers(tree, path=()):
    """(path, n) of every number in a statement tree."""
    if isinstance(tree, tuple) and tree and tree[0] == "num":
        yield path, tree[1]
        return
    if isinstance(tree, (list, tuple)):
        for k, t in enumerate(tree):
            yield from numbers(t, path + (k,))


def replaced(tree, path, new):
    if not path:
        return new
    k = path[0]
    items = list(tree)
    items[k] = replaced(tree[k], path[1:], new)
    return items if isinstance(tree, list) else tuple(items)


def compiled(prog: runs.Program, name: str, bound: set[str]):
    """The Processors a bound routine compiles: itself, or the ones its
    Network runs that are not bound routines of their own."""
    r = prog.routines[name]
    if r.kind == "processor":
        yield name
        return
    for s in r.body:
        if s[1] not in bound:
            yield from compiled(prog, s[1], bound)


def sites(prog: runs.Program):
    """(label, mutate) for each number the bindings compile, and the initial
    value of each field they place or hand a routine."""
    places = [p for b in sorted(runsc.BINDINGS.glob("*.toml")) for p in tomllib.loads(b.read_text())["place"]]
    bound = {p["routine"] for p in places if "routine" in p}
    fields = []
    for place in places:
        if name := place.get("routine"):
            for proc in dict.fromkeys(compiled(prog, name, bound)):
                for path, n in numbers(prog.routines[proc].body):
                    yield f"{proc} {path} {n:o}", ("routine", proc, path, n)
            fields += [place.get(k) for k in ("entry", "ac_param", "io_param", "byname")]
            fields += place.get("result", []) + place.get("cells", [])
        fields += place.get("fields", [])
    for dotted in dict.fromkeys(f for f in fields if f):
        rec, fld = dotted.split(".")
        init = prog.records[rec].fields[fld][1]
        for path, n in numbers(init):
            yield f"{dotted} = {n:o}", ("field", rec, fld, path, n)


def is_bound(prog, site) -> bool:
    if site[0] != "routine":
        return False
    _, name, path, _ = site
    node = prog.routines[name].body
    for k in path[:-1]:
        node = node[k]
    return node[0] == "loop" and path[-1] == 1


def mutate(prog: runs.Program, site) -> runs.Program:
    if site[0] == "routine":
        _, name, path, n = site
        r = prog.routines[name]
        new = runs.Routine(r.kind, r.name, r.params, replaced(r.body, path, ("num", n + 1)),
                           r.reads, r.writes, r.requires)
        return runs.Program(prog.enums, prog.records, {**prog.routines, name: new})
    _, rec, fld, path, n = site
    r = prog.records[rec]
    typ, init = r.fields[fld]
    fields = {**r.fields, fld: (typ, replaced(init, path, ("num", n + 1)))}
    return runs.Program(prog.enums, {**prog.records, rec: runs.Record(rec, r.count, fields, r.stream)},
                        prog.routines)


def changes_image(site) -> tuple[bool, str]:
    """Whether the mutated text builds a different image, or none: a number
    the binding cannot carry (an entry word's initial value) is refused."""
    prog = runs.program(runs.source())
    with tempfile.TemporaryDirectory() as out:
        try:
            code = runsc.build(mutate(prog, site), Path(out))
        except runsc.BindError as e:
            return True, f"refused: {e}"
    first = next((line.strip() for line in runsc.build.said.splitlines() if "first difference" in line), "")
    return code != 0, first


def main() -> int:
    prog = runs.program(runs.source())
    if runsc.build(prog) != 0:
        print(runsc.build.said)
        print("check_compiled: the unmutated image does not match")
        return 1
    found = list(sites(prog))
    bounds = [label for label, s in found if is_bound(prog, s)]
    built = [(label, s) for label, s in found if not is_bound(prog, s)]
    with ProcessPoolExecutor(mp_context=multiprocessing.get_context("fork")) as pool:
        results = list(pool.map(changes_image, [s for _, s in built]))
    silent = [label for (label, _), (changed, _) in zip(built, results) if not changed]
    refused = [label for (label, _), (_, how) in zip(built, results) if how.startswith("refused")]
    for label in bounds:
        print(f"  loop bound, RUNS's check only: {label}")
    for label in refused:
        print(f"  refused by the binding: {label}")
    for label in silent:
        print(f"  NO CHANGE: {label}")
    print(f"check_compiled: image matches; {len(built) - len(silent)}/{len(built)} numbers change it "
          f"({len(refused)} of them refused by the binding), {len(bounds)} loop bounds")
    return 1 if silent else 0


if __name__ == "__main__":
    sys.exit(main())
