# Oracle domain is the game's input domain, not the Substrate's

Status: accepted

The Oracle pins the inputs **Spacewar 3.1 actually exercises**, not every input the
PDP-1 word can hold. The `sqt` routine is *total* over all 2¹⁸ words — it returns a
deterministic value for negatives and for inputs above `0177777` — but those values
are out of the game's reach. We are porting a game, not a CPU.

Concretely for `sqt`: the Vector set enumerates `0..0177777` (65,536 cases, per
ADR-0004), a safe superset of what gravity (the sole caller, `jda sqt` at L1145) can
present. The CPU's behaviour above that band is studied only as *means* — to
understand the routine well enough to reproduce it exactly where the game lands —
never recorded as Ground Truth the Oracle defends. What a future Realization or
variant does with out-of-contract numbers is the variant author's decision, made in
their context, not pinned here.

The game's bound is **not** taken from the source comment `/largest input number =
177777` (Translator-class — it can be wrong about Ground Truth), nor from a lone
static derivation (reading the nth-order consequences of un-executed assembly is
itself an act of interpretation the creed distrusts). It is established by
**confluence**: the comment, a static reading of gravity's `str` computation, the
masswerk account, and — once Plan B Traces exist — empirically observed entry values,
all converging on the same ceiling. Consensus across independent paths is the witness;
no single source is the authority.

## Why

The Realization is the century-scale, system-agnostic artifact; pinning the PDP-1's
total behaviour would weld a CPU accident into the game contract and over-constrain
every Realization for inputs the game never produces. Scoping to the game keeps the
Oracle a contract about *Spacewar*. Confluence keeps the boundary honest without
pretending any single reading of frozen 1962 assembly is infallible.

## Revisit trigger

If the confluence ever **fails to converge** — the static `str` bound, the comment,
and observed Trace inputs disagree on the ceiling — the disagreement is the signal
that the domain is not yet understood. The bound is re-derived (and this ADR's `sqt`
figure revisited) before any Vector over it is trusted.
