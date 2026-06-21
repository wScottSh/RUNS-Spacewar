# Substrate is SIMH + macro1.c, chosen for accuracy and instrumentation

Status: accepted (supersedes the provisional lean toward Gerasimov's JS emulator;
byte-for-byte-against-published-image clause superseded by ADR-0006)

To observe Vectors we must execute Ground Truth. The Substrate is **SIMH** (the reference
PDP-1 simulator) running an Image assembled by **`macro1.c`** (the canonical PDP-1 Macro
assembler, Messenbrink → Supnik → Budne). We write neither tool; CPU semantics stay frozen;
the assembled Image is cross-checked **byte-for-byte** against the published Spacewar image
before any Vector is trusted.

## Why

Accuracy is the priority and tooling is disposable (the RUNS realization lives in no particular
technology, so there is no stack to honour). On that test SIMH wins outright:

- It is the most-validated PDP-1 simulator — hardened specifically to run Spacewar — so it is
  the *accuracy* choice, not merely the convenient one.
- It ships, built in, the exact harness primitives Plan A needs: `examine`/`deposit` (read
  state / inject inputs), breakpoints (run-until-return), single-step. MIT-style licensed.
- `macro1.c` is its native partner, assembles *this* source, and emits a symbol-resolved
  listing — the addresses the harness needs to drive `sqt`, pin `ran`, set up object slots.

## Rejected alternatives

- **Gerasimov's browser JS emulator** — built to render-and-loop; we would hand-build the
  instrumentation SIMH already has. Its only edge (a shared JS/web stack with a future runtime)
  is moot, because the realization is tech-agnostic.
- **Write our own emulator/assembler** — defensible rigor, but front-loads the hardest tools
  before a single Vector exists; the byte-for-byte Image cross-check already buys the
  faithfulness a hand-rolled toolchain would, at none of the cost.
- **Differential (two emulators)** — not warranted at this project's scope (decided earlier);
  the published-image cross-check is the assembly-step witness we keep.
