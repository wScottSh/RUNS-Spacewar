# Gravity Processor Postmortem

## 1. Discrepancies Found

### SW2 / heavy_star Polarity (CRITICAL)

The existing pseudo-code had:
```
if config.heavy_star:
  divisor = divisor >> 2    # Comment: "Another >>2 = x4 gravity"
```

**This is inverted.** PDP-1 source at L1150-1151:
```
szs i 20        / switch 2 for light star
scr 2s
```

`szs i 20` = skip if SW2 IS set (inverted sense instruction). When SW2 is set (`heavy_star=true`), the `scr 2s` is **skipped** — leaving the divisor small and gravity **strong** (normal/heavy). When SW2 is NOT set (`heavy_star=false`), the `scr 2s` executes — making the divisor larger and gravity **weaker** (1/4 normal).

Masswerk confirms: *"If sense switch 2 would not be zero... we're skipping the next instruction. If zero (not set), we're applying another scr 2s, thus low gravity will be a quarter of the normal amount."*

Corrected DIGS: `let div = if config.heavy_star then divisor else divisor >> 2`

The `game_config.runs` description is also misleading: it says "Effect when true: doubles gravity effect" but the actual effect of `heavy_star=true` is **normal gravity** (the default). When `heavy_star=false`, gravity is 1/4 normal. The field name `heavy_star` is arguably backwards — setting SW2 gives you the "heavy" (normal) star, which is the default. The PDP-1 comment calls it "switch 2 for light star," meaning SW2 controls the **light star** option, not the heavy one.

### SW5 / star_teleport Polarity (QUESTIONABLE)

L1319: `szs 50` — skip if SW5 is OFF. When SW5 is OFF → skip `jmp po1` → fall-through to teleport code (L1321-1323). When SW5 is ON → execute `jmp po1` → explode (L1329-1332).

The `game_config.runs` says `star_teleport=true` when SW5 is set (ON). But per PDP-1: SW5 ON → explode, SW5 OFF → teleport. So `star_teleport=true` should mean EXPLODE, not teleport.

However, the DIGS spec example (authority #3) at L545-552 uses the same convention as the existing processor (`if config.star_teleport: → teleport`). This suggests the `game_config` polarity was deliberately inverted to make the field name semantically match the behavior (teleport=true → teleport). I preserved this convention but documented the PDP-1 discrepancy.

### Divide Call Arguments

The existing pseudo-code used:
```
gravity_x = spacewar:divide(-object.position_x, 0, divisor).quotient
```

This passes `dividend_high = -position_x`, `dividend_low = 0`, which reconstructs to `mag_dividend = |position_x| × 131072` — a factor-of-131072 error. The PDP-1's `idv` routine takes a single 18-bit dividend and divides it.

Corrected DIGS: uses direct arithmetic `(0 - object.position_x) / div`, matching the DIGS spec example (L566-567).

### Missing `output` Statements

The existing pseudo-code used bare assignments (`captured = false`, `gravity_x = 0`) instead of DIGS `output` statements. Also missing `output object = object` on the no-change paths (gravity computed, or zero-divisor bailout).

### Missing Version Header and Preconditions

Added `#! runs-prim 1.0` and `preconditions: object.state == spacewar:ship`.

### `var` Mutation

The existing code used `var divisor` with reassignment. DIGS has no mutation — replaced with `let` shadowing and inline conditional expression.

## 2. Surprising Findings

- **The `scr 2s` normalization**: Masswerk explains that `mpy` returns "34 bits and 2 signs" — sign pads at both AC[0] and IO[17]. The first `scr 2s` both normalizes the sign padding (1 bit) and divides by 2 (1 bit). The DIGS spec example handles this by simply using `product.low >> 2`, which works because the product is small enough for AC to be zero after shifting.

- **Division by zero returns zero**: Masswerk explains that `idv` on a zero divisor hits the overflow/error path, which happens to return 0 rather than crashing. The gravity code relies on this implicitly — there's no explicit zero-divisor check in the PDP-1 source. In DIGS, we add an explicit `if div == 0` guard.

- **Field name confusion**: `heavy_star` is named for what setting SW2 gives you (the heavy/normal star), but from the PDP-1 perspective, SW2 is the "light star switch" — it's the switch you turn on to get a light star. The naming inversion is a semantic mismatch between "what the switch is called" and "what true means."

## 3. Concordance Corrections Needed

| Document | Issue |
|----------|-------|
| `game_config.runs` L27-33 | `heavy_star` description says "doubles gravity effect" — should say "enables normal gravity; when false, gravity is 1/4 normal" |
| `game_config.runs` L51-57 | `star_teleport` polarity description may be inverted vs PDP-1; document that the field semantically matches behavior (true=teleport) rather than matching PDP-1 switch-set polarity (SW5 set=explode) |
| DIGS spec L559 | The gravity example uses `if config.heavy_star then divisor >> 2 else divisor` — this applies the extra shift when heavy_star is TRUE, which contradicts PDP-1. Should be `if config.heavy_star then divisor else divisor >> 2` |

## 4. Sub-Processor Dependencies

| Processor | DIGS Body Written? | Notes |
|-----------|-------------------|-------|
| `spacewar:sqrt` | ❌ No (header + comments only) | Blocking — body deferred to "Phase 4" |
| `spacewar:multiply` | ✅ Yes | Valid DIGS |
| `spacewar:divide` | ✅ Yes | Valid DIGS — but gravity no longer calls it (uses direct arithmetic) |
| `spacewar:sin` | ✅ Yes | Not called by gravity directly |

## 5. Test Vectors

Derived from Masswerk's table (Part 6) and hand computation. All values in ones-complement 18-bit.

### Test 1: Maximum distance (corners)
- **Input**: position_x = 131071 (0o377777), position_y = 131071, heavy_star = true
- **Computation**: xn=63, yn=63, x_sq=3969, y_sq=3969, r_sq=7937 (>0, no capture)
- r_sq_full=7938, sqrt≈89 (×512 raw, >>9 = 89), product=89×7938, divisor=product.low>>2
- **Expected**: gravity_x = -1, gravity_y = -1 (per Masswerk table, bx=by=-1)
- **Expected**: captured = false (no capture output; object unchanged)

### Test 2: Star capture — teleport mode
- **Input**: position_x = 4131 (0o10031, screen ~10₈), position_y = 4131, star_teleport = true
- **Computation**: xn=4131>>11=2, yn=2, x_sq=4, y_sq=4, r_sq=8-1=7
- r_sq=7 > 0 → no capture? Let me check: xn=2, x_sq=4, y_sq=4, sum=8, 8-1=7>0.
- Actually from Masswerk table: at x=y=0o10 (decimal 8), xn = 8>>3 = 1 in screen coords, but mx1=4131 so xn=4131>>11=2. 2²+2²=8, 8-1=7>0, not captured.
- Let me use smaller: position_x=0, position_y=0. xn=0, yn=0, x_sq=0, y_sq=0, r_sq=0-1=-1≤0 → capture!
- **Expected**: object.position_x = 131071, position_y = 131071, velocity zeroed
- **Expected**: gravity_x = 0, gravity_y = 0

### Test 3: Gravity disabled (SW6)
- **Input**: position_x = 65536, position_y = 65536, disable_gravity = true
- **Expected**: gravity_x = 0, gravity_y = 0, object unchanged

### Test 4: Medium distance
- **Input**: position_x = 65536 (0o200000, screen ~400₈), position_y = 65536, heavy_star = true
- **Computation**: xn=65536>>11=32, yn=32, x_sq=1024, y_sq=1024, r_sq=2047
- r_sq_full=2048, sqrt(2048)≈45 (raw ~23040, >>9=45), product=45×2048=92160
- product.low=92160 & 131071=92160, divisor=92160>>2=23040
- No light-star shift (heavy_star=true), div=23040
- gravity_x = -65536/23040 = -2, gravity_y = -2
- **Expected**: gravity_x ≈ -2, gravity_y ≈ -2 (approximate due to integer sqrt precision)
