# Assembly faithfulness witness is the listing ↔ core cross-check

Status: accepted (supersedes the byte-for-byte clause of ADR-0003)

There is no published Spacewar 3.1 paper-tape image that corresponds to our reconstructed source.
The surviving public binaries are *other* versions (`spacewar_2b_m_2016`, `spacewar2015`) or the
restart-patched tape (`spaceWarRstrt.bin`), none stock 3.1. So ADR-0003's "cross-check the Image
byte-for-byte against the published Spacewar image" cannot be executed as written.

The witness for the assembly step is therefore the **internal cross-check**: the Assembler's
symbol-resolved listing agrees, word-for-word, with what the Substrate holds in core after `load`.
This was verified across the full memory map (`sqt` at 0246 and the star table at 06667 both match
exactly).

## Why

The byte-for-byte diff was always a *means*, not the end — its job is to guarantee that
assemble-then-load did not corrupt Ground Truth between source and the bytes the CPU executes. The
listing ↔ core identity gives that same guarantee without depending on an artifact that does not
exist: macro1 says address A holds word W; SIMH confirms core[A] = W, everywhere. A divergence
would surface as a mismatched word, exactly as a byte diff would.

## Revisit trigger

If a stock Spacewar 3.1 image matching this source's version is ever located, reinstate the
byte-for-byte diff as the stronger, independent witness and supersede this ADR. Until then the
listing ↔ core cross-check stands as the faithfulness gate.
