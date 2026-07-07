# `decode.js` builds the Portable Oracle by decoding the *location*, never the *value*

Status: accepted (the construction rules for the Portable Oracle defined as lossy-projection in ADR-0014; applies ADR-0008's raw-word precedent to the Realization-facing decode)

`oracle/decode.js` is `decodeFrame(rawFrame) → portableFrame`: a pure function from a frozen raw golden (octal words at core addresses) to the address-free Portable Oracle frame. This ADR records the design decisions that govern that translation, because several are surprising and hard to reverse. It does **not** reopen completeness (closed permanently by ADR-0014).

## The decisions

1. **The Portable Oracle owns a local canonical shape; it is not the RUNS Record.** The decoded shape lives in `oracle/`, discovered witness-first from the frozen goldens. It may deliberately share portable field *vocabulary* with a future `spacewar:object` Record so grading lines up field-for-field, but the Oracle is the *standard* and a Record is the *subject* graded against it — never the reverse (`CONTEXT.md` → Flagged ambiguities → "Portable Oracle" ≠ "RUNS Record"). The draft `runs-spec/RECORD_SCHEMA.md` is downstream and is **not** edited during discovery.

2. **Frame shape is three-tier, positional.**
   ```
   portableFrame = { label, objects: [ …24 ], globals: { ran } }
   ```
   `objects` is a positional list; index = object-table slot (slot 0 = ship 1, slot 1 = ship 2, torpedoes/explosions fill later slots — witnessed in `gravity.snapshot.json`: `3476`=`ss1`, `3477`=`ss2`). Identity is *by slot*; there is no object-id field in Ground Truth, so cross-frame identity **is** slot position. Positional over-constrains "same" to allocation order, which is correct because the only graded subject is the Exact Realization, which reproduces allocation order by construction.

3. **One object type; ship-only fields present only for slots 0–1; absent (not `0`) elsewhere; absent = ungraded.** The object table is not a rectangle: the 24-wide columns (`mtb nx1 ny1 na1 nb1 ndx ndy`) cover all slots; the 2-wide columns (`nom nth nfu ntr not nco nh1-4`) have source cells only for the two ships. A torpedo's angle/fuel/torpedoes/angular-velocity fields do not *exist*, so decode renders them **absent**, never fabricated as `0` — asserting `0` would be a black-box claim about a word Ground Truth never wrote. Absent means the Oracle makes no claim.

4. **Decode the location, never the value (the ADR-0008 reconcile).** Two different operations hide under "decode":
   - *Decode the location* (address `3526` → field `position_x`) — every field gets this; it is what makes the Oracle portable.
   - *Interpret the value* (word `577777` → decimal `-0.4999`) — ADR-0008 forbids this ("Vectors record raw words, never interpreted decimal"); it is where float-swap and epsilon enter.

   decode does the first, never the second, for every **Bin-A** field: the raw 18-bit word is carried **verbatim** (the pattern *is* the `spacewar:fixed18` value — ones-complement, width 18, binary_point 17 — losslessly portable to any substrate that implements `fixed18`). Only the one **Bin-B** column (`state`) is semantically decoded. So "non-PDP-1 terms" means *no core addresses*, not *re-encoded values*, and ADR-0008's "never interpreted decimal" is never violated — raw words throughout, exactly as on the math island.

5. **Bin-B `state` decode: exact-word keys, fail-closed, EPIC-#5-decoupled.** The `mtb` calc-address column decodes to `spacewar:object_state` via a static table keyed on the **exact 18-bit stored word** (never a masked base — the sign/self-mod bit `400000` is not a uniform phase marker, so masking would smuggle in an unwitnessed interpretation). An `mtb` value not in the table is a **build-stopping error** (fail-closed, matching the coverage gate ADR-0013), never a silent `unknown`. The frozen goldens' entire calc alphabet is seven values, all identified from `build/spacewar31.lst`; decode over them is therefore not blocked on EPIC #5. EPIC #5 upgrades the *claim* from "covers the frozen goldens" to "covers every reachable calc address," and resolves the one residual ambiguity — which hyperspace phase is `hyperspace_in` vs `hyperspace_out`.

## Consequences — the per-field ledger

Each captured range forces its bin. **A** = raw word verbatim (Bin-A). **B** = semantic decode (Bin-B). **C** = drop with a written white-box "never feeds the dynamics" argument (Bin-C). Read-set/inclusion analysis is **inclusion-only** (ADR-0014): it may recover a KEEP, never certify a drop — and it already earned its keep here by recovering `nco`+`nh1-4`.

| Range (octal) | Column | Bin | Field / disposition |
|---|---|---|---|
| `31` | `ran` | A | `globals.ran` — evolving PRNG state; RNG-divergence tripwire (kept per-frame) |
| `20` | `ddd` | **C** | drop — single/dual outline flag, display-only |
| `3236–3266` | scratch block | **C** | drop as *not-state* — calc-loop working registers (`dac \mdx` etc.); per-word confirmed transient; any cross-frame carrier promoted to `globals` like `ran` |
| `3476` (`mtb`) | calc addr | **B** | `state` — 7-entry exact-word table (below) |
| `nx1 / ny1` | position | A | `position_x` / `position_y` |
| `na1` | count | A | `lifetime` (explosion/torpedo life) |
| `nb1` | `mtc` budget | **C** | drop — instruction-count timing (`:677`); ADR-0014's own cited Moore-1956 hidden-timing example |
| `ndx / ndy` | velocity | A | `velocity_x` / `velocity_y` |
| `nom` | angular vel | A | ship-only; no draft-Record field (finding #1) |
| `nth` | angle | A | `angle` (ship-only) |
| `nfu` | fuel | A | `fuel` (ship-only) |
| `ntr` | torpedoes | A | `torpedoes` (ship-only) |
| `not` | outline ptr | **C (provisional)** | drop — display pointer (`:698`); pending a read confirming it never feeds the collision test |
| `nco` | old control word | **A (recovered)** | ship-only; edge-detects torpedo launch (`:1234-1241`) + hyperspace (`:1296`) — one-frame input memory, feeds dynamics |
| `nh1–4` | hyperspace state | **A (recovered)** | ship-only; **not** heading sin/cos — saved calc pointer (`:1300/:1052`), hyperspace flag (`:1291`), hyperbutton counter (`:1289`), accumulator (`:1061-1066`) |

Bin-B `state` table (exact 18-bit word → `object_state`; every value present in the 11 frozen goldens):

| word | symbol | state |
|---|---|---|
| `000000` | zero | `empty` |
| `002136` | `tcr` | `torpedo` |
| `002310` | `ss1` | `ship` |
| `002314` | `ss2` | `ship` |
| `402052` | `mex\|400000` | `exploding` |
| `402170` | `hp1\|400000` | `hyperspace_in` *(provisional — EPIC #5 to confirm direction)* |
| `002246` | `hp3` | `hyperspace_out` *(provisional — EPIC #5 to confirm direction)* |

`decode.js` is the executable form of this ledger — each column classified in code where it is reached, with the drop arguments as comments. A wrong drop (e.g. `not` turns out to feed collision) is a deliberate supersede (the ADR-0012 mechanism), never a silent correction.
