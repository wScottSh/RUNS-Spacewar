# Part 1: Source Code Concordance

## How to Read This Document

This concordance maps every line of `source/spacewar3.1_complete.txt` (1,870 lines of PDP-1 Macro assembler) to its RUNS equivalent. Each entry specifies:

- **Source lines**: the exact line range in the original file
- **Labels**: the assembler symbols defined in that range
- **System**: what functional area this code belongs to
- **RUNS mapping**: the Record, Processor, Network, or runtime concern this code becomes — or "not converted" for assembler infrastructure with no RUNS equivalent

The source file has three `start` directives (L62, L655, L1367) that delimit three logical parts:
- **Part 1** (L1–654): Macros, constants, math library, outline compiler, star display, Expensive Planetarium
- **Part 2** (L659–1365): Main loop, entity table, scoring, collision, explosion, torpedo, hyperspace, spaceship calc, ship outlines, patch space
- **Part 3** (L1371–1870): Peter Samson's star catalog

---

## Master Concordance Table

### Part 1: Infrastructure, Math, and Display (L1–654)

| Source Lines | Labels | System | RUNS Mapping |
|-------------|--------|--------|-------------|
| L1 | — | File header | Not converted — assembler directive (`macro fio-dec system`) |
| L3–6 | `szm`, `spq`, `clc`, `ioh` | Opcode aliases | Not converted — PDP-1 instruction mnemonics |
| L8–11 | `senseswitch` | Macro: sense switch test | Not converted — macro infrastructure. Switches themselves → `spacewar:game_config` Record |
| L13–16 | `initialize` | Macro: set indirect pointer | Not converted — macro infrastructure |
| L18–22 | `index` | Macro: increment-compare-jump | Not converted — loop construct (inlined into Processors) |
| L24–29 | `listen` | Macro: wait for keyboard | Not converted — debug/interactive I/O |
| L31–34 | `swap` | Macro: swap AC and IO | Not converted — register manipulation |
| L36–39 | `load` | Macro: load variable | Not converted — data movement |
| L41–44 | `setup` | Macro: set variable to constant | Not converted — data movement |
| L46–49 | `count` | Macro: decrement-and-jump | Not converted — loop/timer construct. Timer semantics → Processor logic |
| L51–54 | `move` | Macro: copy variable | Not converted — data movement |
| L56–60 | `clear` | Macro: zero a memory range | Not converted — initialization |
| L62–66 | `start`, header | Part 1 entry | Not converted — assembler directive |
| L67–69 | Jump table | Entry points: `sbf`, `a40`, `a1` | Not converted — boot sequence (maps to runtime initialization) |
| **L72–96** | **`tno`–`ran`** | **Game constants** | **`spacewar:game_constants` Record** (see Constants Table below) |
| L98–107 | Control word comments, `cwr` | Control word routine space + default | Not converted — runtime concern (input mapping) |
| L110–116 | `sbf` | Sequence break flush | Not converted — PDP-1 interrupt handling |
| L118–126 | `xincr` | Macro: X-increment with rotation | Not converted — inlined into ship outline rendering (runtime) |
| L128–136 | `yincr` | Macro: Y-increment with rotation | Not converted — inlined into ship outline rendering (runtime) |
| L139–144 | `dispatch` | Macro: computed jump | Not converted — RUNS uses guarded Arcs instead |
| L146–151 | `dispt` | Macro: display point | Not converted — runtime rendering primitive |
| L153–158 | `scale` | Macro: load-shift-store | Not converted — inlined into Processor bodies as shift operations |
| L160–167 | `diff` | Macro: velocity→position integrator | `spacewar:velocity_integrate` Processor (core integration step) |
| **L170–177** | **`random`** | **PRNG** | **`spacewar:random` Processor** — rotate-right-1, XOR `355670₈`, add `355670₈` |
| L179–187 | `ranct` | Macro: random value in range | Not converted — inlined into Processors that need bounded random |
| **L190–254** | **`sin`, `cos`, `si1`–`csx`** | **Sine/cosine subroutine (Adams Associates)** | **`spacewar:sin`, `spacewar:cos` Processors** — argument has binary point right of bit 3; result has binary point right of bit 0 |
| **L257–301** | **`mpy`, `imp`, `mp2`, `mp3`** | **Multiply subroutine (BBN)** | **`spacewar:multiply` Processor** — 18-bit ones-complement, returns 34-bit product (high word in AC, low in IO) |
| **L304–343** | **`sqt`, `sq1`–`sq3`** | **Integer square root** | **`spacewar:sqrt` Processor** — input: binary point right of bit 17; output: binary point between bits 8–9 |
| **L346–396** | **`dvd`, `idv`, `dv1`–`dve`** | **Divide subroutine (BBN)** | **`spacewar:divide` Processor** — dividend in AC+IO, divisor from next instruction |
| L398–507 | `oc`, `ocs`, `ock`–`oc9` | **Outline compiler** | Not converted — **runtime concern**. Compiles outline tables into display code at initialization. In RUNS, the runtime reads outline data from `spacewar:ship_config` and renders using platform-specific drawing. |
| L510–520 | `starp` | **Star point-plot macro** | Not converted — **runtime rendering primitive**. Adds gravity accumulator offsets (`\bx`, `\by`) to star position and calls `dpy-4000`. Inlined into `bds` repeat block. |
| L522–539 | `blp`, `blx` | **Central star display** | Not converted — **runtime rendering**. Uses PRNG to scatter random dots around center and calls `bpt` for flicker. But the star's existence → `spacewar:central-star` AEMS Manifestation; its gravity → `spacewar:gravity` Processor; its capture → `spacewar:collision_detect` via `str` constant. |
| L541–561 | `bpt`, `bds`, `bjm`, `bpx` | **Star flicker + dot burst routine** | Not converted — **runtime rendering**. `bpt` generates random burst count and intensity. `bds` is a 20-repeat block of `starp` calls. Aesthetic detail for runtime implementers. |
| L565–621 | `dislis` macro | **Star catalog display routine** | Not converted — **runtime rendering**. The `dislis` macro iterates a brightness tier and plots each star with a `dpy` instruction at the appropriate intensity. |
| **L623–649** | **`bck`, `background`** | **Background starfield controller** | **`spacewar:advance_starfield_scroll` Processor** — `bkc` countdown (L640–643, fires every 20 frames), `fpr` right-margin pointer (L644–648, advances by 1 and wraps at `20000₈`). Outputs → `spacewar:starfield_state` outbound Record. Stars plotted via `dislis` are runtime. |
| L651–653 | `bcc`, `bkc`, `fpr` | Background state variables | `spacewar:starfield_state` Record fields: `scroll_counter` = `bkc`, `scroll_offset` = `fpr` (initial value `10000₈`) |
| L655 | `start` | Part 1 end | Not converted — assembler directive |

### Part 2: Game Logic and Entity Management (L659–1365)

| Source Lines | Labels | System | RUNS Mapping |
|-------------|--------|--------|-------------|
| L661–663 | Comment, `nob=30` | Entity table size | `spacewar:object[]` — array of 30 (octal) = 24 (decimal) entity slots |
| **L665–715** | **`ml0`, pointer setup, `nnn`** | **Entity table parallel-array initialization** | **`spacewar:object` Record definition** — each `add (nob)` / `dap` pair defines one parallel array: `mtb` (calc routine/state), `nx1` (X position), `ny1` (Y position), `na1` (lifetime counter), `nb1` (instruction budget), `ndx` (X velocity), `ndy` (Y velocity), `nom` (angular velocity), `nth` (angle), `nfu` (fuel), `ntr` (torpedoes remaining), `not` (outline pointer), `nco` (old control word), `nh1`–`nh4` (hyperspace state). L715: `nnn=nh4 2` — end-of-table sentinel, used at L792 `clear mtb, nnn-1`. |
| **L717–736** | **Win detection** | **Restart condition check** | **`spacewar:check_restart` Processor** — tests if both ships alive (`ss1`/`ss2` in `mtb`/`mtb+1`); if both alive and both out of torpedoes (`ntr`, `ntr+1`), sets restart delay = 2× torpedo life |
| **L738–754** | **`mdn`, scoring** | **Score update + restart** | **`spacewar:update_scores` Processor** — counts down `\ntd` (restart timer); when it fires, checks which ships are alive; surviving ship's score (`\1sc` / `\2sc`) is incremented. Both alive = both get points (tie round). Both dead = no points. Then jumps to `a` (reinitialize). See `04_conversion_phases.md` Phase 5 for verified instruction trace. |
| L756–762 | `a1`, `a40` | Control word routing | Not converted — selects between test-word input (`mg2`) and IOT input (`cwr`). **Runtime concern** (input method selection) |
| **L764–791** | **`a`, game count logic** | **Match lifecycle** | **`spacewar:match_result` Record fields** — `\gct` = `rounds_remaining` (L764–767); `\1sc` / `\2sc` = `score_1` / `score_2` (L768–769, L777–778, L784–785); tie detection (L769–772); `lat` instruction reads game count from operator panel bits 6–11 (L786–791) → `spacewar:game_config.game_count` |
| L777–779 | `a4`, score display + halt | Score display | Not converted — `hlt` displays scores in console lights. In RUNS, `match_result` outbound Record carries scores to runtime |
| **L792–828** | **`a2`, reinitialization** | **Match reset** | Part of the lifecycle Network — clears all tables, sets ship 1 to `ss1`, ship 2 to `ss2`, initial positions (`200000₈` / its complement), initial angle (`144420₈`), compiles outlines, sets torpedo count, fuel, hyperspace shots |
| L830–841 | `mg1`, `mg2` | Control word read routines | Not converted — **runtime concern**. `mg1`: reads `iot 11` (hardware control boxes). `mg2`: reads `lat` (test word switches). Both produce control word in IO register → `spacewar:player_controls` inbound Record |
| **L843–868** | **`ml1`, main loop body** | **Main loop — per-entity dispatch** | **`spacewar:game_tick` Network** — iterates entity table, tests if active (`sza i`), tests if calc routine is for second pass (`moc`/`spq` for collidability). Dispatches to calc routine via `dap .+1; jsp .` |
| **L868–904** | **Collision detection** | **Pairwise collision check** | **`spacewar:collision_detect` Processor** — for each pair: computes `|dx| = |mx1 - mx2|`, tests `< me1` (epsilon); computes `|dy|`, tests `< me1`; computes `|dx| + |dy|`, tests `< me2`. On collision: writes `mex 400000` into both slots (→ exploding state), sets explosion duration from `mb1 + mb2` |
| L889–891 | Collision → explosion | State transition | Write `state = exploding`, `collidable = false` (sign bit `400000` on `mex` = non-collidable) |
| **L906–941** | **`mq4`, calc dispatch + timing** | **Calc execution + frame budget** | Dispatches to entity's calc routine (`dap .+1; jsp .`), adds instruction count to `\mtc`. After all entities: displays background (`bck`), displays central star (`blp`), busy-waits until `\mtc` reaches 0 (L940: `count \mtc, .`), then jumps to `ml0` |
| **L946–983** | **`mex`, explosion calc** | **Explosion tick** | **`spacewar:explosion_tick` Processor** — decelerates (`diff \mdx`, `diff \mdy` with `sar 3s`); distributes random particles (L964–976: `random`, construct `scl` instruction, add to position, `dpy` at intensity `300₈`); counts down `ma1`; when done, zeros the entity slot (`dzm i ml1` → `state = empty`) |
| **L985–1005** | **`tcr`, torpedo calc** | **Torpedo update** | **`spacewar:torpedo_update` Processor** — counts down `ma1` (lifetime); on timeout: writes `mex 400000` (→ exploding); during life: applies gravity warpage via `the` constant (`sar 9s` scaled, added to velocity via `diff`), displays as single point |
| **L1007–1045** | **`hp1`, hyperspace entry** | **Hyperspace transit** | **`spacewar:hyperspace_transit` Processor** — counts down `ma1` (time in hyperspace, from `hd1`); on exit: sets calc to `hp3`, sets instruction budget to 7, applies random displacement (L1018–1026: `random`, `xct hr1`, add to position), applies random velocity (L1027–1032: `random`, `xct hr2`), normalizes angle to ±2π (L1036–1041, constant `311040₈` = 2π), sets breakout timer from `hd2` |
| **L1047–1077** | **`hp3`, hyperspace breakout** | **Hyperspace breakout** | **`spacewar:hyperspace_breakout` Processor** — counts down `ma1` (breakout timer from `hd2`); on exit: restores calc to `\mh1` (saved ship calc), sets budget to 2000. Checks hyperspace shots remaining (`\mh2`); if zero, no more hyperspace. Recharges hyperspace: `hd3` → `\mh3` (recharge timer); uncertainty `hur` → `\mh4` (uncertainty accumulator); random roll (L1064–1068): if `ran | 400000 + \mh4 ≥ 0`, explode instead of returning |
| **L1079–1090** | **`ss1`, `ss2`, ship entry** | **Ship calc entry points** | **`spacewar:ship_update` Network entry** — `ss1` is ship 1, `ss2` is ship 2. Gets control word via `jsp i \cwg`, rotates for player 2 (`rir 4s`), stores in `\scw` |
| **L1091–1110** | **`sr0`–`sr8`, rotation** | **Rotation update** | **`spacewar:rotation_update` Processor** — reads control word (L1092: `lio \scw`), tests rotate-CCW (`spi` → `add maa`), tests rotate-CW (`ril 1s; spi` → `sub maa`), adds to angular velocity (`mom`). **Sense switch 1** (L1101: `szs 10`): if set, zeros angular velocity (angular damping). Checks fuel (`\mfu`): if empty, clears thrust flag |
| **L1112–1117** | **Angle update + normalization** | **Part of rotation** | Adds angular velocity to angle (`mth`), normalizes to ±2π by add/sub `311040₈` (= 2π) |
| **L1118–1119** | **Sin/cos computation** | **Part of ship update** | Calls `jda sin`, stores sin in `\sn` — used for thrust, gravity, and display |
| **L1120–1166** | **Gravity computation** | **`spacewar:gravity` Processor** | Clears gravity accumulators (`\bx`, `\by`). **Sense switch 6** (L1122: `szs 60`): if set, skips gravity entirely. Computes distance to origin: `x/2¹¹` squared + `y/2¹¹` squared, subtracts `str` (capture radius). If negative → ship in star → `pof` (L1142). Computes gravity: `sqrt(r²)`, divides `x` and `y` by `sqrt(r²)·r²/4`. **Sense switch 2** (L1150: `szs i 20`): if set, doubles gravity (`scr 2s` applied twice). Stores gravity components in `\bx`, `\by` |
| **L1167–1186** | **Thrust computation** | **`spacewar:thrust` Processor** | If fuel empty (`sad i \mfu` → 0), disables thrust. Calls `jda cos` for heading. Thrust: `cos · sac` (with `szf i 6` = thrust flag); added to `\by` gravity accumulator. `sin · sac` negated; added to `\bx`. Both applied to velocity via `diff` macro (velocity integration) |
| **L1187–1216** | **Ship display setup** | **`spacewar:build_render_list` Processor (partial)** | Scales sin/cos for outline rendering (`sp1`, `sp2`): `sn/32` and `cs/32` for fine rotation; `sn/512` and `cs/512` for coarse rotation. Computes ship position offsets (`\sx1`, `\sy1`, `\stx`, `\sty`). Pre-computes rotation matrix components (`\ssm`, `\ssc`, `\ssd`, `\csn`, `\csm`, `\scm`). Plots initial point. **These are all runtime rendering concerns** — in RUNS, the render_object carries position + angle + outline_data; the runtime does the rotation. |
| L1217–1231 | `sq6`–`sq9`, exhaust flame | **Exhaust rendering** | Not converted directly — runtime renders exhaust from `flame_length` on `spacewar:render_object`. Game logic computes `flame_length` from fuel state and random count (`\src`) |
| **L1232–1244** | **`sq9`–`sr5`, torpedo reload + launch check** | **`spacewar:torpedo_launch` Processor** | Counts down `ma1` (reload timer). If reloaded: reads previous control word (`mco`), XORs with current (`\scw`), tests fire bit (L1239–1240: `ral 3s; sma`). **Sense switch 3** (L1236: `szs i 30`): if set, allows rapid fire (skips reload check by complementing mask). Checks torpedo count (`\mtr`); if zero, no launch. |
| **L1245–1288** | **`st1`–`sr7`, torpedo spawn** | **`spacewar:process_spawns` Processor** | Searches entity table for empty slot (`lac .; sza i`). If no slot: `hlt` (error). Sets slot to `tcr` (torpedo calc), computes initial position from `\stx`/`\sty` (ship nose), computes velocity from sin/cos × `tvl` + ship velocity, sets reload timer from `rlt`, sets torpedo life from `tlf`. |
| **L1289–1309** | **`sr5`–`st3`, hyperspace entry check** | **`spacewar:hyperspace_check` Processor** | Checks hyperspace recharge timer (`\mh3`): if still cooling, skip. Checks hyperspace shots (`\mh2`): if zero, skip. Detects hyperspace chord: current control XOR'd with previous, masked for both rotate bits (`600000₈`). If chord detected: saves current calc routine in `\mh1`, writes `hp1 400000` to slot (→ hyperspace_in, non-collidable), sets delay from `hd1`, sets instruction budget to 3. |
| **L1312–1333** | **`pof`, `po1`, star capture** | **Part of `spacewar:gravity` Processor output** | Ship in star: zeros velocity. **Sense switch 5** (L1319: `szs 50`): if set, teleports ship to far corner (`377777₈`, `377777₈`) instead of exploding. Otherwise: writes `mex 400000` (→ exploding), sets explosion duration. |
| L1336–1345 | `ot1` | **Ship 1 outline (Needle)** | **AEMS Manifestation `spacewar:needle`** `outline_data` property: `111131 111111 111111 111163 311111 146111 111114 700000` |
| L1348–1355 | `ot2` | **Ship 2 outline (Wedge)** | **AEMS Manifestation `spacewar:wedge`** `outline_data` property: `013113 113111 116313 131111 161151 111633 365114 700000` |
| L1360 | `constants` | Assembler constants block | Not converted — assembler directive |
| L1361 | `variables` | Assembler variables block | Not converted — assembler directive |
| L1362 | `p, . 200/` | **Patch space** (128 words) | Not converted — historical modding convention. RUNS fork/variant model replaces runtime patching |
| L1365 | `mtb` | Entity table base address | The address where `spacewar:object[]` starts in memory. In RUNS: the Record array itself |
| L1367 | `start` | Part 2 end | Not converted — assembler directive |

### Part 3: Peter Samson's Star Catalog (L1371–1870)

| Source Lines | Labels | System | RUNS Mapping |
|-------------|--------|--------|-------------|
| L1371 | Header | "stars by prs for s/w 2b" | Attribution: Peter R. Samson, star catalog for Spacewar! 2b (carried forward to 3.1) |
| L1373 | `6077/` | Load address | Not converted — assembler load directive |
| L1375 | Comment | "stars 1 — 3/13/62, prs." | Catalog date: March 13, 1962 |
| L1377 | `decimal` | Number base switch | Not converted — assembler directive (all star data in decimal) |
| L1379–1383 | `mark` macro | Star entry format | Each `mark X, Y` encodes one star: X = horizontal position (0–8191), Y = vertical position (±512). `Y=Y+Y` repeats 8 times = Y×256 for display register format. `8192-X` computes right-margin-relative coordinate. Maps to `spacewar:star_entry { x, y, brightness, designation }` |
| **L1385–1393** | **`1j`–`1q`** | **Tier 1 stars (brightest)** | **`spacewar:star_catalog` entries, `brightness: 1`** — 9 stars: Aldebaran, Rigel, Betelgeuse, Sirius, Procyon, Regulus, Spica, Arcturus, Altair |
| **L1395–1403** | **`2j`–`2q`** | **Tier 2 stars** | **`spacewar:star_catalog` entries, `brightness: 2`** — 10 stars: Bellatrix, 46 Orio, 50 Orio, 53 Orio, 2 CMaj, 24 Gemi, Alphard, Denebola, 55 Ophi |
| **L1405–1486** | **`3j`–`3q`** | **Tier 3 stars** | **`spacewar:star_catalog` entries, `brightness: 3`** — 82 stars |
| **L1490–1866** | **`4j`–`4q`** | **Tier 4 stars (dimmest)** | **`spacewar:star_catalog` entries, `brightness: 4`** — ~377 stars |
| L1868 | `start 4` | Program entry (boot at address 4) | Not converted — assembler directive |
| L1870 | — | End of file | — |

**Star catalog totals**: 9 + 10 + 82 + 377 = **478 stars**.

---

## Game Constants Table

Every constant from L72–96, with its source symbol, octal value, decimal equivalent, and RUNS Field name:

| Source Line | Symbol | Source Value | Decimal | RUNS Field (`spacewar:game_constants`) | Meaning |
|-------------|--------|-------------|---------|---------------------------------------|---------|
| L77 | `tno` | `law i 41` | 33 | `max_torpedoes` | Number of torpedoes + 1 (actual count = 32) |
| L78 | `tvl` | `sar 4s` | ÷16 | `torpedo_velocity_shift` | Torpedo velocity scale (arithmetic shift right 4) |
| L79 | `rlt` | `law i 20` | 16 | `torpedo_reload_time` | Frames before torpedo tube reloads |
| L80 | `tlf` | `law i 140` | 96 | `torpedo_lifetime` | Frames before torpedo auto-detonates |
| L81 | `foo` | `-20000` | -8192 | `max_fuel` | Fuel supply (negative = ones-complement count-up to 0) |
| L82 | `maa` | `10` | 8 | `angular_acceleration` | Added/subtracted to angular velocity per rotate input |
| L83 | `sac` | `sar 4s` | ÷16 | `thrust_scale_shift` | Thrust scale (arithmetic shift right 4) |
| L84 | `str` | `1` | 1 | `star_capture_radius` | Distance threshold for star capture |
| L85 | `me1` | `6000` | 3072 | `collision_radius` | Primary collision epsilon |
| L86 | `me2` | `3000` | 1536 | `collision_radius_half` | Secondary collision epsilon (me1/2) |
| L87 | `ddd` | `-0` | -0 | — | Sentinel value (negative zero). Used to test `spi i` at L809 for outline compiler branching |
| L88 | `the` | `sar 9s` | ÷512 | `torpedo_gravity_warpage_shift` | Scale of gravity effect on torpedoes |
| L89 | `mhs` | `law i 10` | 8 | `hyperspace_max_shots` | Number of hyperspace uses per match |
| L90 | `hd1` | `law i 40` | 32 | `hyperspace_entry_delay` | Frames invisible in hyperspace before breakout |
| L91 | `hd2` | `law i 100` | 64 | `hyperspace_breakout_duration` | Frames in breakout phase |
| L92 | `hd3` | `law i 200` | 128 | `hyperspace_recharge_time` | Frames before hyperspace can be used again |
| L93 | `hr1` | `scl 9s` | ×512 | `hyperspace_displacement_scale` | Scale of random position displacement on exit |
| L94 | `hr2` | `scl 4s` | ×16 | `hyperspace_velocity_scale` | Scale of random velocity on exit |
| L95 | `hur` | `40000` | 16384 | `hyperspace_uncertainty` | Added to uncertainty accumulator each use; higher = more likely to explode |
| L96 | `ran` | `0` | 0 | — | PRNG state (runtime-mutable, not a constant) |

---

## Sense Switch Concordance

Six PDP-1 sense switches, each tested with `szs` (skip-on-sense-switch-set). Maps to `spacewar:game_config` inbound boundary Record:

| Switch | Instruction | Source Lines Referenced | `spacewar:game_config` Field | Effect When Set |
|--------|------------|----------------------|-------------------------------|----------------|
| SW1 | `szs 10` | L1101 (in `sr0` rotation) | `angular_damping: bool` | Zeroes angular velocity each frame — ships don't drift when rotating |
| SW2 | `szs i 20` | L1150 (in gravity calc) | `heavy_star: bool` | Doubles gravity effect (applies extra `scr 2s` to gravity divisor) |
| SW3 | `szs i 30` | L1236 (in torpedo launch) | `rapid_fire: bool` | Allows re-firing before reload timer expires (complements the mask) |
| SW4 | `szs 40` | L630 (in `bck` background) | `disable_background: bool` | Disables Expensive Planetarium display entirely |
| SW5 | `szs 50` | L1319 (in `pof` star capture) | `star_teleport: bool` | Ships dragged into star are teleported to far corner instead of exploding |
| SW6 | `szs 60` | L523 (in `blp` star display), L1122 (in gravity calc) | `disable_gravity: bool` | Disables both background starfield AND central star gravity entirely |

---

## Entity Table Memory Layout

The parallel arrays starting at `mtb` (L1365), with 24 (decimal) slots per array (30 octal = `nob`):

| Array | Symbol | Offset from `mtb` | RUNS Record Field | Source Lines |
|-------|--------|-------------------|-------------------|-------------|
| Calc routine | `mtb` | +0 | `state` (enum) | L666 |
| X position | `nx1` | +24 | `position_x` (fixed18) | L668–669 |
| Y position | `ny1` | +48 | `position_y` (fixed18) | L670–672 |
| Lifetime counter | `na1` | +72 | `lifetime` (int) | L674–675 |
| Instruction budget | `nb1` | +96 | — (not converted; PDP-1 timing artifact) | L677–678 |
| X velocity | `ndx` | +120 | `velocity_x` (fixed18) | L680–681 |
| Y velocity | `ndy` | +144 | `velocity_y` (fixed18) | L682–684 |
| Angular velocity | `nom` | +168 | `angular_velocity` (fixed18) | L686–687 |
| Angle | `nth` | +170 | `angle` (fixed18) | L689–690 |
| Fuel | `nfu` | +172 | `fuel` (int) | L692–693 |
| Torpedoes remaining | `ntr` | +174 | `torpedoes` (int) | L695–696 |
| Outline pointer | `not` | +176 | `outline_ref` (→ `spacewar:ship_config`) | L698–699 |
| Old control word | `nco` | +178 | `prev_controls` (controls) | L701–702 |
| Hyperspace saved calc | `nh1` | +180 | `hyperspace_saved_state` (enum) | L704–705 |
| Hyperspace shots | `nh2` | +182 | `hyperspace_shots_remaining` (int) | L706–708 |
| Hyperspace recharge | `nh3` | +184 | `hyperspace_recharge_timer` (int) | L710–711 |
| Hyperspace uncertainty | `nh4` | +186 | `hyperspace_uncertainty_acc` (int) | L712–714 |

Note: `nth` through `nh4` use 2-slot spacing (not `nob`-slot), because only ships 1 and 2 have these fields. The first 7 arrays (L666–684) are parallel across all 24 entities; the remaining 10 arrays (L686–714) are 2-wide (ship 1 and ship 2 only).

---

## State Machine: Calc Routine → State Enum

| Calc Routine Address | Source Label | `spacewar:object.state` Enum | Collidable? | Source Context |
|---------------------|-------------|-------------------------------|-------------|---------------|
| `ss1` | L1081 | `ship` (player 1) | Yes | Spaceship 1 calc routine |
| `ss2` | L1086 | `ship` (player 2) | Yes | Spaceship 2 calc routine |
| `tcr` | L987 | `torpedo` | Yes | Torpedo calc routine |
| `mex 400000` | L950 | `exploding` | No (sign bit) | Explosion calc; `400000₈` sets non-collidable flag |
| `hp1 400000` | L1012 | `hyperspace_in` | No (sign bit) | Hyperspace entry; non-collidable |
| `hp3` | L1050 | `hyperspace_out` | Yes | Hyperspace breakout; collidable again |
| `0` | — | `empty` | — | Unused slot |

State transitions are implemented by writing a new calc routine address into `mtb[i]` via `dac i ml1`. Every `dac i ml1` in the source is a state transition.
