---
name: verify-tickets
description: Verify Spacewar Oracle tickets against EPIC #5's per-class standard and shore up weak ones in place. Use when checking that /to-issues output for the RUNS-Spacewar Oracle is self-contained, has a falsifiable DoD, and is dead-branch-safe before AFK agents grab it.
---

# Verify Tickets

An interactive gate on Oracle ticket quality. You point it at the issues `/to-issues`
produced from EPIC #5; it walks them one at a time, checks each against the standard, and —
on your approval — rewrites the live issue body to bring it up to standard. Same interaction
model as `/triage`: surface one, review together, apply, move on.

The full standard lives in **[STANDARD.md](STANDARD.md)** — read it before the first ticket.
It is the checklist *and* the authority-layering rule (EPIC #5 = ticket schema; ADRs =
witness/strength definitions; ADR wins on conflict).

## Sources of truth (load these first)

- **EPIC #5** — `gh issue view 5` (repo `wScottSh/RUNS-Spacewar`). Live-read every run for
  the per-class field schema, the partition (ticket catalog), and the one-way /
  correctly-dead register. Never copy it into the skill.
- **The ADRs** — `docs/adr/0004`, `0006`, `0007`, `0012` are canon for what a valid
  witness/DoD is. `source/spacewar3.1_complete.txt` and `source/masswerk/` are what
  references must resolve against.

## Invocation

Scott points at the set: "verify the tickets from #5", a label, or an explicit list of
issue numbers. Gather the set (`gh issue list` by the EPIC's label, or the given numbers).

## The loop

**Phase 0 — set completeness (once).** Against the EPIC's ticket catalog, confirm every
ticket it names exists, and that all four non-line-range tickets (T-IMAGE, T-METER,
T-OC-OUTPUT, T-COVERAGE) are present (STANDARD.md → *Set completeness*). Report any missing
or extra ticket before drilling in.

**Phase 1 — per ticket, oldest first, one at a time:**

1. **Read the current body** — `gh issue view N`. Parse its class, fields, and DoD as they
   stand now (re-runnable: if a body was already shored up, recognize it and move on).
2. **Detect the class** — M / E / D / non-line-range — from the routine and the EPIC's
   partition row for that ticket ID.
3. **Run the checklist** — every item in STANDARD.md for that class, plus the universal and
   anti-loop items. Produce a specific pass/fail list — name the gap, not "needs work".
4. **Recommend the fix** — a concrete rewrite of the body that closes each gap, sourcing the
   missing facts from the EPIC's row and the governing ADRs. Where the EPIC's own phrasing is
   stale (the T-IMAGE precedent), correct to the ADR and say so.
5. **Show, then wait.** Present the proposed body (and what changed) and wait for Scott's
   approval. Do not edit unprompted.
6. **Apply live on approval** — `gh issue edit N --body-file -` writing the approved body into
   the original ticket. If the publish classifier blocks the edit (memory
   **egs-agent-publish-boundary**), hand Scott the final body to paste.
7. **Next ticket.** Continue until the whole set passes.

## Posture

- **Prescriptive, not hedging.** This is a conventions-tier tool (memory
  **conventions-tier-is-prescriptive**): state plainly what a good ticket carries; never
  soften a required field to "optional".
- **Verify, don't invent.** Every shored-up fact is sourced from the EPIC row, an ADR, or the
  source/Translator — never hand-derived (the rule that dissolved the sqt scope explosion).
- **The anti-loop bar is the point.** A DoD passes only if a judgment-free process could
  decide done from it. "Looks done" and "matches masswerk" always fail.
