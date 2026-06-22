# TASK

You are the **seed** phase of an autonomous architecture-improvement run. There
is **no human watching** — never ask a question, never wait for approval, never
present a numbered list for sign-off. Drive every skill in "take everything"
mode and make the decisions yourself.

Your job, in order:

1. Surface architectural deepening opportunities.
2. Break **all** of them into thin vertical slices.
3. Refine those slices for verticality.
4. File every refined slice as a GitHub issue labeled `sandcastle`.
5. Write a markdown report of what you surfaced to `{{REPORT_PATH}}`.

# STEP 1 — Find deepening opportunities

Use the **improve-codebase-architecture** skill to find deepening opportunities,
informed by `CONTEXT.md` and any ADRs in `docs/adr/`.

Autonomous overrides for this run:

- **Take ALL candidates** the exploration surfaces. Do **not** stop to ask
  "which of these would you like to explore?" and do **not** enter the grilling
  loop — there is no human to grill.
- **Do NOT generate the HTML report and do NOT open a browser.** Instead, write
  the equivalent report as **Markdown** to the absolute path `{{REPORT_PATH}}`
  (see the REPORT section below). This file becomes the body of the pull request,
  so it must read as standalone context for "what was surfaced and why."

# STEP 2 — Draft vertical slices (do not publish yet)

Use the **to-issues** skill to break the candidates into **tracer-bullet
vertical slices** — thin paths that cut through every layer end-to-end.

Autonomous overrides:

- **Draft only.** Do **NOT** run the skill's publish step yet, and do **NOT**
  quiz the user about granularity or dependencies. Produce the slice list in
  your working context and move on.
- Cover **every** candidate from Step 1, not just the top recommendation.

# STEP 3 — Refine for verticality

Use the **vertical-slice-refiner** skill on the slices drafted in Step 2. Rewrite
any slice that is too horizontal or "build this thing"-shaped into a thin,
end-to-end, independently verifiable slice. Prefer many thin slices over few
thick ones. The refined set is what you publish.

# STEP 4 — Publish the issues

For each refined slice, create a GitHub issue with the `gh` CLI, using the
to-issues issue-body template (What to build / Acceptance criteria / Blocked by).

- Label **every** issue with `sandcastle` (`gh issue create ... --label sandcastle`).
  This is the exact label the sandcastle planner filters on.
- Publish in **dependency order** (blockers first) so you can reference real
  issue numbers in each slice's "Blocked by" section.
- Use `CONTEXT.md` vocabulary for domain terms; respect ADRs in the area.

# REPORT

Write the report to `{{REPORT_PATH}}` as GitHub-flavored Markdown. For each
candidate include:

- **Files** — modules involved
- **Problem** — the friction in the current architecture
- **Solution** — plain-English description of the deepening
- **Benefits** — in terms of locality and leverage, and how tests improve
- **Before / After** — a **Mermaid** fenced code block (```mermaid```), since
  GitHub renders Mermaid in PR bodies. Do not use raw HTML or SVG.
- **Recommendation strength** — Strong / Worth exploring / Speculative

End with a **Top recommendation** section. If a candidate maps to issues you
filed, you may note the issue numbers, but keep the report focused on rationale.

# CONSTRAINTS

- **Do not modify the repo working tree and do not make any git commits.** Your
  only two outputs are (a) the GitHub issues and (b) the markdown report at
  `{{REPORT_PATH}}` (which is outside the repo). The host repo must stay clean so
  the next phase can branch off `main`.
- If exploration genuinely surfaces nothing worth filing, file **no** issues and
  still write a short report saying so — the caller will detect the empty queue
  and exit without a branch or PR.

# DONE

Once all issues are filed and the report is written, output
<promise>COMPLETE</promise>.
