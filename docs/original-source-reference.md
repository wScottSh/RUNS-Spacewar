# Spacewar! Original PDP-1 Source Code (1962)

This document preserves the original PDP-1 assembly source code for Spacewar! from 1962.

**Authoritative Source**: https://www.masswerk.at/spacewar/sources/

## Historical Context

Spacewar! was one of the first digital computer games, developed in 1962 by Steve Russell, Martin Graetz, Wayne Wiitanen, Peter Samson, Dan Edwards, and Martin Graetz at MIT on the PDP-1 computer.

**Authentic Source Files** (from masswerk.at):
- `spacewar_2b_25mar62.txt` — Authentic listing of Spacewar 2B
- `stars_by_prs_for_sw2b_mar62.txt` — Peter Samson's starfield data (13 Mar. 1962)
- `macro_fiodec_jun63.txt` — Macro definitions
- `hyperspace85.txt` — Original hyperspace patch by J.M. Graetz

---

## Key Game Constants (from authentic source)

```assembly
nob = 30            ; Total number of colliding objects
tno = 41            ; Number of torpedoes + 1
tvl = sar 4s        ; Torpedo velocity (shift right 4)
rlt = 20            ; Torpedo reload time (ticks)
tlf = 140           ; Torpedo lifetime (ticks)
trf = law i 300     ; Life of torpedo (alternative constant)
foo = -20000        ; Fuel supply (negative for countdown)
maa = 10            ; Angular acceleration
sac = sar 4s        ; Ship acceleration (shift right 4)
str = 1             ; Star capture radius
me1 = 10000         ; Epsilon for collisions (octal)
me2 = 4000          ; Epsilon over 2 (octal)
mhs = 10            ; Hyperspace shots available
```

---

## Ship Outline Direction Codes (AUTHENTIC)

The original uses an **outline compiler** (`oc` routine) that interprets direction codes. Each octal digit (0-7) represents a drawing direction:

```
Direction codes:
  0 = right (→)      4 = left (←)
  1 = up-right (↗)   5 = down-left (↙)
  2 = up (↑)         6 = down (↓)
  3 = up-left (↖)    7 = down-right (↘) / terminator
```

### Wedge Ship (ot1) - Address 2735

```assembly
ot1,    111131
        111111
        111111
        111163
        311111
        146111
        111114
        700000
```

### Needle Ship (ot2) - Address 2746

```assembly
ot2,    013113
        113111
        116313
        131111
        161151
        111633
        365114
        700000
```

> **Note**: The `7` in the final word signals outline termination. The compiler decodes these direction sequences into display commands.

---

## Background Starfield (AUTHENTIC)

Peter Samson's "Expensive Planetarium" (13 Mar. 1962) contains ~400 real star positions from star catalogs. Data file: `stars_by_prs_for_sw2b_mar62.txt`

### Star Coordinate Macro

```assembly
define
    mark X, Y
    repeat 8, Y=Y+Y
    8192-X    Y
    terminate
```

The `mark` macro stores X as `(8192 - X)` and Y multiplied by 256.

### Sample Stars (Brightest)

```assembly
1j,     mark 1537, 371      /87 Taur, Aldebaran
        mark 1762, -189     /19 Orio, Rigel
        mark 1990, 168      /58 Orio, Betelgeuze
        mark 2280, -377     /9 CMaj, Sirius
        mark 2583, 125      /10 CMin, Procyon
        mark 3431, 283      /32 Leon, Regulus
        mark 4551, -242     /67 Virg, Spica
        mark 4842, 448      /16 Boot, Arcturus
1q,     mark 6747, 196      /53 Aqil, Altair

2j,     mark 1819, 143      /24 Orio, Bellatrix
        mark 1884, -29      /46 Orio
        mark 1910, -46      /50 Orio
        mark 1951, -221     /53 Orio
        ...
```

Star lists are organized into 4 groups (1j-1q, 2j-2q, 3j-3q, 4j-4q) for display cycling.

---

## Central Star Rendering (AUTHENTIC)

```assembly
blp,    dap blx             / star display routine
        szs 60              / check sense switch 6
        jmp blx
        random \ran         / LFSR random
        rar 9s
        and (add 340
        spa
        xor (377777
        dac \bx
        lac \ran
        ral 4s
        and (add 340
        spa
        xor (377777
        dac \by
        jsp bpt
        ioh
blx,    jmp .
```

The star is rendered as scattered points around center using LFSR random values, NOT as radiating rays. The `dpy-4000` display command draws a single point.

---

## LFSR Random Number Generator (AUTHENTIC)

```assembly
define
random N
        lac N
        rar 1s              ; rotate right 1
        xor (335671         ; XOR with constant (octal)
        add (335671         ; ADD same constant
        dac N
        term
```

Uses octal constant `335671` for both XOR and ADD operations.

---

## Gravity Calculation (AUTHENTIC)

```assembly
        sar 9s
        sar 2s
        dac \t1
        jda sqt             ; integer square root
        sar 9s
        jda mpy             ; multiply
        lac \t1
        scr 2s
        szs 20              ; sense switch 2 for heavy star
        scr 2s              ; additional shift for lighter gravity
```

Uses:
- Integer square root (`sqt` subroutine)
- Fixed-point multiply (`mpy` subroutine)
- Sense switch 2 toggles "heavy star" mode

---

## Sine/Cosine Subroutine (AUTHENTIC)

```assembly
cos,    0
        dap csx
        lac (62210          ; π/2 in fixed-point
        add cos
        dac sin
        jmp .+4

sin,    0
        dap csx
        lac sin
        spa
si1,    add (311040         ; 2π in fixed-point
        sub (62210
        sma
        jmp si2
        add (62210

si3,    ral 2s
        mult (242763        ; Taylor series coefficients
        dac sin
        mult sin
        dac cos
        mult (756103
        add (121312
        mult cos
        add (532511
        mult cos
        add (144417
        mult sin
        scl 3s
        ...
```

Uses Taylor series polynomial approximation with fixed-point coefficients.

---

## Technical Details

| Property | Value |
|:---------|:------|
| Platform | PDP-1 (18-bit word, 4K words memory) |
| Display | Type 30 CRT (1024×1024, circular) |
| Arithmetic | 18-bit fixed-point |
| Frame Rate | ~60 Hz (display refresh tied) |
| Coordinate Range | 0-1023 (10-bit) |

---

## References

- **Authoritative Sources**: https://www.masswerk.at/spacewar/sources/
- **Playable Emulation**: https://www.masswerk.at/spacewar/
- **Spacewar 2B Preservation Project**: https://www.masswerk.at/spacewar/2b/
- **Computer History Museum**: https://www.computerhistory.org/revolution/computer-games/16/182
- **Wikipedia**: https://en.wikipedia.org/wiki/Spacewar!

---

## RUNS Port Notes

This source serves as the **ground truth** for the RUNS implementation. Key principles:

1. **Bit-Identical Logic**: RUNS processors must produce identical results to PDP-1 calculations
2. **Authentic Constants**: All me1, me2, maa, sac values come directly from source
3. **LFSR Identical**: Random sequences must match original polynomial
4. **Platform-Agnostic**: AEMS/RUNS define the game; runtimes (JS, N64) merely execute

The goal is **pixel-perfect preservation**, not interpretation.
