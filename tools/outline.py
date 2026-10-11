"""A stand-in, for the checks, for the presentation the RUNS port does not
have yet: a ship's compiled outline (spacewar-c's lift/outline_compiler.c).

The outline compiler turns an outline table into code; the spaceship jumps
into that code with the pen record set. Here the outline table is read
directly and the code's effect computed: its dots, the pen left at the
ship's tail, and the out steps mirrored for the second side. The checks
compare all of it with SIMH running the compiled code, so this model is
itself checked."""
from __future__ import annotations

import runs

DOWN, OUT, OUT_DOWN, IN, IN_DOWN, STORE, END = "down", "out", "out_down", "in", "in_down", "store", "end"
CODES = {0: DOWN, 1: DOWN, 2: OUT, 3: OUT_DOWN, 4: IN, 5: IN_DOWN, 6: STORE, 7: END}


def codes_so_far(table: list[int]) -> list[str]:
    """The direction codes, read from the left of each word, up to the 7."""
    out = []
    for word in table:
        for k in range(6):
            code = CODES[(word >> (15 - 3 * k)) & 7]
            out.append(code)
            if code == END:
                return out
    return out


def codes(table: list[int]) -> list[str]:
    out = codes_so_far(table)
    if END not in out:
        raise ValueError("an outline ends with a 7 code")
    return out


def draw(table: list[int], pen: dict) -> list[tuple]:
    """Run the compiled outline on the pen record (updated in place): the
    points it plots, as the display stream holds them."""
    add, sub = runs.add, runs.sub
    points = []
    for side in (1, 2):
        x, y = pen["x"], pen["y"]
        saved = None
        stores = 0
        for code in codes(table):
            if code == END:
                break
            if code == STORE:                   # alternately store and restore, from the compile
                stores += 1
                if stores % 2:
                    saved = (x, y)
                else:
                    x, y = saved
                continue
            if code == DOWN:
                x, y = add(x, pen["down_x"]), sub(y, pen["down_y"])
            elif code == OUT:
                x, y = add(x, pen["out_x"]), add(y, pen["out_y"])
            elif code == OUT_DOWN:
                x, y = add(x, pen["out_down_x"]), sub(y, pen["out_down_y"])
            elif code == IN:
                x, y = sub(x, pen["out_x"]), sub(y, pen["out_y"])
            elif code == IN_DOWN:
                x, y = add(x, pen["in_down_x"]), sub(y, pen["in_down_y"])
            points.append((x, y, 0))
        if side == 1:                           # mirror the steps for the other side
            pen["out_x"] = runs.W(pen["out_x"].v ^ runs.MASK)
            pen["out_y"] = runs.W(pen["out_y"].v ^ runs.MASK)
            pen["out_down_y"], pen["in_down_y"] = pen["in_down_y"], pen["out_down_y"]
            pen["out_down_x"], pen["in_down_x"] = pen["in_down_x"], pen["out_down_x"]
        else:
            pen["x"], pen["y"] = x, y
    return points
