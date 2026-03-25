# PICO-8 Runtime for Spacewar! RUNS — Implementation Plan

*22 March 2026*

---

## Why PICO-8?

Because the entire point of RUNS is that game logic is portable. If Spacewar's RUNS source can run on a fantasy console from 2015 with 128×128 pixels and 8192 tokens of Lua — a machine more constrained than the PDP-1 it was born on — then it can run anywhere.

Also: PICO-8 is a single `.p8` file you can share. Someone downloads it, types `load spacewar`, presses `run`, and they're playing the first game ever written for a computer. On a fantasy computer. That's the kind of thing that makes people understand what RUNS is for.

---

## The Deep Question: Runtime or Transpile?

From first principles, there are two possible approaches:

### Option A: Generic RUNS Interpreter on PICO-8
Build a Lua program that parses `.runs` source files, constructs a Network graph, and executes Processors by interpreting their expression bodies at runtime.

**Verdict: Impossible.** PICO-8 has 8192 tokens. A generic interpreter needs:
- Expression parser (~800 tokens)
- Record system (~400 tokens)
- Network executor (~400 tokens)
- Math primitives (~600 tokens)
- The game-specific data (~2000 tokens for constants, star catalog, outlines)

That's ~4200 tokens for infrastructure alone, leaving ~4000 for the actual game logic (24 Processors). The Processors alone would need ~3000-4000 tokens. It's borderline, and the interpreter overhead would make it run at 5 fps.

### Option B: Hand-Transpile RUNS Source to Idiomatic PICO-8 Lua
Read each `.runs` Processor, understand its algorithm, and write the equivalent PICO-8 Lua. The RUNS source serves as the specification; the PICO-8 cart is one possible compiled output.

**Verdict: This is the way.** This is what cross-compilation means. The RUNS source is the canonical game logic. The PICO-8 cart is an artifact compiled from that source. A future automated RUNS→Lua compiler could produce this output; we do it by hand first.

### Option C: Hybrid — Data-Driven with Hardcoded Logic
Hardcode the Processor logic as Lua functions but keep the data structure (Records, entity table) faithful to RUNS. The Network topology (phase ordering, dispatch) is explicit in the code.

**Verdict: This is the wisest compromise.** Option B with structure. The code reads like the RUNS source — same function names, same phases, same data flow — but it's native Lua. Anyone reading the PICO-8 source can trace it back to the `.runs` files.

**Decision: Option C — Structured hand-transpilation.**

---

## PICO-8 Constraints vs Spacewar Requirements

| Constraint | PICO-8 | Spacewar Needs | Fit? |
|-----------|--------|---------------|------|
| **Display** | 128×128, 16 colors | 1024×1024, monochrome CRT | ✅ Scale down 8:1 |
| **Numbers** | 16:16 fixed-point (-32768 to 32767.99) | 18-bit fixed-point (-131072 to 131071) | ⚠️ Rescale needed |
| **Trig** | Built-in `sin()`, `cos()` (0–1 range) | Custom polynomial sin/cos | ✅ Use built-in |
| **Tokens** | 8192 max | 24 Processors + data | ⚠️ Tight but feasible |
| **Frame rate** | 30 or 60 fps | ~15 fps original | ✅ Run at 30 |
| **Input** | 6 buttons per player × 2 players | 5 buttons per player × 2 | ✅ Perfect match |
| **Sprites** | 128×128 sprite sheet | Ship outlines, star, torpedo | ✅ Use `pset`/`line` |
| **Memory** | 64KB shared | 24-slot entity table | ✅ Plenty |
| **Sound** | 4 channels, SFX editor | None in original | ✅ Bonus: add SFX! |
| **PRNG** | `rnd()` built-in | Custom rotate-XOR-add | ✅ Use built-in |
| **sqrt** | `sqrt()` built-in | Custom 23-iteration | ✅ Use built-in |

### The Number Problem (and Solution)

Spacewar uses 18-bit ones-complement fixed-point: range ±131,071. PICO-8 uses 16:16 fixed-point: integer range ±32,767.

**Solution**: Divide all Spacewar coordinates by 4. The game world becomes ±32,767 instead of ±131,071. All constants (gravity, thrust, torpedo speed, collision radii) are divided by 4 proportionally. The physics are identical at 1/4 scale.

This is mathematically clean because every constant is a power-of-two shift in the original. `sar 4s` becomes `/ 16` in PICO-8. The ratios are preserved exactly.

### The Token Budget

Estimated token costs (based on PICO-8 convention of ~100-150 tokens per game system):

| Component | Est. Tokens | Notes |
|-----------|-------------|-------|
| Entity table + constants | 400 | 24 slots × 10 fields, plus ~20 constants |
| Input mapping | 100 | `btn()` calls → player_controls |
| `_update()` main loop | 150 | Phase dispatch, slot iteration |
| Ship pipeline (rotation, gravity, thrust, wrap) | 800 | The meatiest logic block |
| Torpedo update | 150 | Gravity warpage + lifetime |
| Explosion tick | 100 | Timer + state transition |
| Hyperspace (check + transit + breakout) | 300 | Three state handlers |
| Torpedo launch + spawn | 250 | Edge detect, slot scan |
| Collision detection | 250 | Pairwise Manhattan |
| Scoring + restart + reinit | 300 | Match lifecycle |
| Starfield scroll | 100 | Timer + offset advance |
| `_draw()` rendering | 600 | Ships, torpedoes, explosions, stars, star, HUD |
| Ship outline renderer | 400 | 3-bit direction code interpreter |
| Star catalog (data) | 800 | 469 stars × ~2 tokens each, or subset |
| Init + boilerplate | 200 | `_init()`, tables, helpers |
| **TOTAL** | **~4900** | **Under 8192 ✅** |

~3300 tokens of headroom. Comfortable, even with inevitable underestimates.

**Star catalog optimization**: 469 stars at full fidelity would consume too many tokens as inline data. Three options:
1. Encode as a string and decode at runtime (~200 tokens)
2. Use sprite sheet memory as data storage (0 tokens for data)
3. Reduce to ~100 brightest stars (authentic feel, huge savings)

**Decision**: Use option 2 (sprite sheet as data) for the star catalog. Store star positions as bytes in the sprite memory, decode at init. This is standard PICO-8 practice for large data sets.

---

## Architecture

```
┌─────────────── PICO-8 Cart ───────────────┐
│                                            │
│  _init()                                   │
│    Load constants (from RUNS game_constants)│
│    Load star catalog (from sprite memory)  │
│    Load outlines (inline tables)           │
│    Call match_init()                        │
│                                            │
│  _update()                                 │
│    Read btn() → controls                   │
│    ── Phase 1: Entity dispatch ──          │
│    for slot 0→23:                          │
│      if state==ship   → ship_update(slot)  │
│      if state==torp   → torp_update(slot)  │
│      if state==expl   → expl_tick(slot)    │
│      if state==hypin  → hyp_transit(slot)  │
│      if state==hypout → hyp_break(slot)    │
│    ── Phase 2: Spawns ──                   │
│    process_spawns()                        │
│    ── Phase 3: Collision ──                │
│    collision_detect()                       │
│    ── Phase 4: Match ──                    │
│    check_restart()                          │
│    update_scores()                          │
│    ── Phase 5: World ──                    │
│    advance_scroll()                         │
│                                            │
│  _draw()                                   │
│    cls(0)  -- black background             │
│    draw_starfield()                         │
│    draw_central_star()                      │
│    for each entity:                        │
│      draw_ship() / draw_torp() / draw_expl()│
│    draw_hud()                               │
│                                            │
└────────────────────────────────────────────┘
```

This maps 1:1 to `game_tick.runs`: same 6 phases, same slot-order dispatch, same function names.

---

## Rendering Strategy

### Display Mapping

PDP-1: 1024×1024, origin at center, monochrome phosphor green.
PICO-8: 128×128, origin at top-left, 16 colors.

```lua
-- game coords (±32767) → screen coords (0–127)
function gx(x) return 64+x/512 end
function gy(y) return 64-y/512 end  -- flip Y (screen Y is inverted)
```

### Ships: Outline Renderer

The outline format (3-bit direction codes) maps beautifully to PICO-8's `pset()`:

```lua
-- decode 3-bit codes from octal word, draw relative to (cx,cy) with heading
function draw_outline(cx,cy,ang,data)
  local sx,sy=0,0
  local sa,ca=sin(ang),cos(ang)
  local ckx,cky=0,0
  for w in all(data) do
    if w==0x38000 then return end  -- 700000₈ terminator
    for b=0,15,3 do
      local c=band(shr(w,b),7)
      if c<6 then
        -- direction vectors rotated by heading
        local dx,dy=dirs[c+1][1],dirs[c+1][2]
        sx+=dx*ca-dy*sa
        sy+=dx*sa+dy*ca
        pset(gx(cx+sx),gy(cy+sy),7)  -- white dot
      elseif c==6 then ckx,cky=sx,sy  -- checkpoint save
      elseif c==7 then sx,sy=ckx,cky  -- checkpoint restore
      end
    end
  end
end
```

### Torpedoes: Single Pixel
```lua
pset(gx(e.x), gy(e.y), 10)  -- yellow dot
```

### Explosions: Scattered Pixels
```lua
for i=1,e.pcount do
  pset(gx(e.x+rnd(16)-8), gy(e.y+rnd(16)-8), 8+flr(rnd(4)))  -- random warm colors
end
```

### Central Star: Flickering Circle
```lua
circfill(64, 64, 2+rnd(1), 7)  -- white, slightly pulsing
```

### Starfield: Dots with Scroll
```lua
function draw_starfield()
  for s in all(stars) do
    local sx=(s.x-scroll)%128
    pset(sx, s.y, s.tier<3 and 7 or 5)  -- bright or dim
  end
end
```

### Color Palette

| Game Element | PICO-8 Color | Code |
|-------------|-------------|------|
| Background | Black | 0 |
| Ship 1 (Needle) | White | 7 |
| Ship 2 (Wedge) | Light blue | 12 |
| Torpedo | Yellow | 10 |
| Explosion | Orange/Red/Yellow | 8, 9, 10 |
| Central star | White (pulsing) | 7 |
| Stars (bright) | White | 7 |
| Stars (dim) | Dark gray | 5 |
| HUD text | White | 7 |
| Thrust flame | Orange | 9 |

### Sound Design (Bonus — Not in Original)

PICO-8 has 4 sound channels and a SFX editor. Spacewar had no sound (the PDP-1 had no speaker). This is creative freedom:

| Event | SFX Style |
|-------|-----------|
| Thrust | Low rumble (channel 0, looping) |
| Torpedo fire | Sharp blip (channel 1) |
| Explosion | White noise burst (channel 2) |
| Hyperspace entry | Descending woo (channel 3) |
| Hyperspace breakout | Ascending shimmer (channel 3) |
| Star capture | Deep boom (channel 2) |

---

## Input Mapping

PICO-8 provides exactly what we need:

```lua
-- Player 1: arrows + Z/X (btn 0-5, player 0)
-- Player 2: S/F/E/D + tab/Q (btn 0-5, player 1)
function read_input(p)
  return {
    ccw   = btn(0,p),  -- left
    cw    = btn(1,p),  -- right
    thrust= btn(2,p),  -- up
    fire  = btn(4,p),  -- Z/X mapped to btn 4
    hyper = btn(5,p),  -- btn 5
  }
end
```

---

## Implementation Phases

### Phase 1: Skeleton (est. 2 hours)
- `_init()`: entity table, constants, match_init
- `_update()`: empty phase structure
- `_draw()`: `cls()`, central star, HUD
- **Milestone**: Black screen with white dot at center and "0 - 0" score

### Phase 2: Ships (est. 3 hours)
- Input → rotation, thrust, velocity, position
- Toroidal wrapping
- Outline renderer (simplified — could start with `circfill` placeholder)
- **Milestone**: Two ships flying around, wrapping, with gravity pulling toward center

### Phase 3: Weapons (est. 2 hours)
- Torpedo launch (edge detect, spawn, slot allocation)
- Torpedo update (gravity warpage, lifetime)
- Collision detection (diamond Manhattan)
- **Milestone**: Ships can shoot, torpedoes fly, things explode

### Phase 4: State Machine (est. 2 hours)
- Explosions (timer, particle scatter)
- Hyperspace (check, transit, breakout, risk escalation)
- **Milestone**: Full entity state machine working

### Phase 5: Polish (est. 2 hours)
- Starfield (catalog loaded from sprite memory, scroll)
- Scoring and match lifecycle
- Sense switches (via pause menu or hidden key combos)
- Sound effects
- Full outline renderer (replace placeholder circles)
- **Milestone**: Complete, shippable PICO-8 cart

**Total estimate: ~11 hours of implementation.**

---

## Verification Against RUNS Source

Each PICO-8 function should include a comment referencing its `.runs` source:

```lua
-- spacewar:gravity.runs
-- source: L1120-1166
function gravity(s)
  ...
end
```

After implementation, run the same test vectors from `verification_report.md`:
- Both ships spiral to star capture with no input
- Torpedo fires on correct heading, lifetime = 96 frames
- Collision diamond geometry matches all 4 test cases
- Hyperspace death after 4 uses

If the PICO-8 cart matches the test vectors, it's a valid compilation of the RUNS source.

---

## What This Proves

A PICO-8 Spacewar cart proves three things:

1. **RUNS source is compilable.** If a human can hand-transpile it to Lua, an automated compiler can too.
2. **RUNS is platform-agnostic.** The same game logic runs on a fantasy console from 2015 that it does on... nothing yet (no other runtime exists). But the PICO-8 cart will be the first proof.
3. **The runtime contract works.** The `runtime_contract.md` document is sufficient to build a working game. If it's sufficient for PICO-8's extreme constraints, it's sufficient for anything.

And you get a playable Spacewar! cart you can share on [Lexaloffle BBS](https://www.lexaloffle.com/bbs/) — the PICO-8 community board. 469 hand-parsed stars, diamond-shaped hitboxes, escalating hyperspace risk, on a 128×128 pixel screen. The original PDP-1 program, resurrected on a fantasy computer, via a game logic format designed to outlast both.
