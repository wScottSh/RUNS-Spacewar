# "Verified" is an objective artifact gate, not an agent's assertion

Status: accepted

What makes a unit of work "done" must be checkable without trusting the doer. The agent
harness certified its own work green by *saying so* — and re-asserted "all tests green"
across six re-verification passes of one issue without advancing. Green was a claim, not a
check.

We replace agent-assertion with an **objective artifact gate**: a unit is verified only
when, in the environment that ran it, the **listing ↔ core** cross-check holds (ADR-0006)
**and** the relevant Vectors pass. Because the gate is objective and OS-invariant
(ADR-0010), **any confluence-witnessed environment — including the isolated agent
container — may certify "done."** Authority lives in the artifact check, not in the host,
the human, or the agent.

## Why

This dissolves two faults at once:

- **Self-certification.** An agent closing its own issue on its own say-so is no longer
  possible — the gate closes it, or it stays open.
- **Churn.** An objective check cannot be re-satisfied by re-asserting it, so the loop's
  stop-condition has teeth; effort flows to the next issue instead of pooling on the
  first.

It also reconciles the blast-radius requirement (keep the container, ADR pending) with
autonomy: the container is trusted to *certify* precisely because certification is
objective — not because the container itself is trusted.

## Consequences

- The harness stop-condition becomes "artifact gate passed," not `<promise>COMPLETE</promise>`
  on the agent's word.
- "Sandbox green is an assertion" is amended, not contradicted: green-in-container *is* the
  gate once the environment is confluence-witnessed (ADR-0010). It was only an assertion
  while the toolchain was split and unwitnessed.
- Enables CI: the same gate runs unattended in any environment, so the public "all green"
  claim becomes continuously reproducible rather than a point-in-time host fact.
