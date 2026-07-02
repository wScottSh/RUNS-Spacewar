// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.ts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { z } from "zod";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Agent backend selection
//
// The template is swappable between Anthropic's Claude Code and a local,
// network-hosted OpenAI-compatible model driven through the OpenCode CLI.
// Pick the backend with the AGENT env var:
//
//   AGENT=claude    → sandcastle.claudeCode(...)  (the original behavior)
//   AGENT=opencode  → sandcastle.opencode(...)    (local OpenAI-compatible model)
//
// For opencode, the endpoint + model live in opencode.json at the repo root
// (provider id "local"); the model id below must match an entry there. A single
// local model usually serves every phase, so OPENCODE_MODEL is shared across
// roles — whereas Claude uses opus for reasoning-heavy phases and sonnet to
// write code. See opencode.json and .sandcastle/.env.example.
// ---------------------------------------------------------------------------
const AGENT = (process.env.AGENT ?? "opencode").toLowerCase();

// Model id passed to `opencode run --model`. Must resolve to a model declared in
// opencode.json — by default "local/<model>", where "local" is the provider id
// and "<model>" is the key under that provider's `models`.
const OPENCODE_MODEL =
  process.env.OPENCODE_MODEL ?? "local/Qwen3.6-35B-A3B-UD-Q5_K_M.gguf";

// The five workflow phases. Claude maps these onto two models (opus for
// planning/review/merge/seed, sonnet for implementing); opencode maps them all
// onto the one local model.
type Role = "plan" | "implement" | "review" | "merge" | "seed";

// Build the agent provider for a given phase, honoring the AGENT selector.
function agentFor(role: Role): sandcastle.AgentProvider {
  if (AGENT === "claude") {
    const model = role === "implement" ? "claude-sonnet-4-6" : "claude-opus-4-8";
    return sandcastle.claudeCode(model);
  }
  if (AGENT === "opencode") {
    return sandcastle.opencode(OPENCODE_MODEL);
  }
  throw new Error(
    `Unknown AGENT="${AGENT}". Set AGENT=opencode (local model) or AGENT=claude.`,
  );
}

// ---------------------------------------------------------------------------
// Dynamic concurrency
//
// The execute phase fans out one pipeline per unblocked issue. Firing every
// pipeline at once overwhelms a capacity-limited backend: the local model
// server advertises a fixed number of inference slots (llama.cpp's
// `total_slots`), and N concurrent requests against S slots just queue
// S-at-a-time anyway — while the simultaneous cold-start burst is exactly when
// a transient backend hiccup can take down every in-flight pipeline together.
//
// So we size the pool to whatever the platform actually offers, discovered at
// run time rather than hardcoded: 2 slots → 2 at a time; 100 slots → 100 at a
// time. Escape hatch: SANDCASTLE_MAX_CONCURRENCY overrides discovery entirely.
// ---------------------------------------------------------------------------

// Conservative cap used only when the platform's capacity can't be probed
// (network error, or a backend that doesn't expose slots). Unbounded fan-out is
// the known-bad case for the local model, so we under-, not over-, commit.
const FALLBACK_CONCURRENCY = 2;

// Read the provider baseURL from opencode.json for the provider named in
// OPENCODE_MODEL ("<provider>/<model>"), resolving any {env:VAR} placeholders.
function opencodeBaseURL(): string | undefined {
  try {
    const cfg = JSON.parse(readFileSync("./opencode.json", "utf8"));
    const providerId = OPENCODE_MODEL.split("/")[0];
    const raw: unknown = cfg?.provider?.[providerId]?.options?.baseURL;
    if (typeof raw !== "string" || raw.length === 0) return undefined;
    return raw.replace(/\{env:([A-Z0-9_]+)\}/gi, (_, v) => process.env[v] ?? "");
  } catch {
    return undefined;
  }
}

// Ask the backend how many inference slots it has. llama.cpp's OpenAI-compatible
// server reports `total_slots` at /props (a sibling of the /v1 OpenAI routes,
// hence resolving the path against the origin). Returns undefined if the
// endpoint can't be reached or doesn't speak this dialect.
async function discoverSlots(): Promise<number | undefined> {
  const baseURL = opencodeBaseURL();
  if (!baseURL) return undefined;
  try {
    const propsURL = new URL("/props", baseURL).toString();
    const res = await fetch(propsURL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const props = (await res.json()) as { total_slots?: unknown };
    const slots = Number(props?.total_slots);
    return Number.isFinite(slots) && slots > 0 ? slots : undefined;
  } catch {
    return undefined;
  }
}

// Resolve how many issue pipelines to run at once this iteration, never
// exceeding the number of issues we actually have to run.
async function resolveConcurrency(issueCount: number): Promise<number> {
  const cap = (n: number) => Math.max(1, Math.min(n, issueCount));

  const override = Number(process.env.SANDCASTLE_MAX_CONCURRENCY);
  if (Number.isFinite(override) && override > 0) {
    console.log(
      `Concurrency: ${cap(override)} (SANDCASTLE_MAX_CONCURRENCY override).`,
    );
    return cap(override);
  }

  if (AGENT === "opencode") {
    const slots = await discoverSlots();
    if (slots !== undefined) {
      console.log(`Concurrency: ${cap(slots)} (backend advertises ${slots} slot(s)).`);
      return cap(slots);
    }
    console.warn(
      `Concurrency: ${cap(FALLBACK_CONCURRENCY)} (could not probe backend slots; ` +
        `set SANDCASTLE_MAX_CONCURRENCY to override).`,
    );
    return cap(FALLBACK_CONCURRENCY);
  }

  // Cloud backends (claude) have no local slot count we can probe; run every
  // pipeline and let the API's own rate limiting pace us.
  console.log(`Concurrency: ${cap(issueCount)} (cloud backend; no slot limit).`);
  return cap(issueCount);
}

// Promise.allSettled, but with at most `limit` workers running at once. Results
// come back in input order with the same {status, value|reason} shape, so this
// is a drop-in for Promise.allSettled at the call site.
async function allSettledLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const run = async () => {
    for (let i = cursor++; i < items.length; i = cursor++) {
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i]!, i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

// Hooks run inside the sandbox before the agent starts each iteration.
// `npm install` populates dependencies; the explicit `npx patch-package` then
// applies patches/ deterministically. We do NOT rely on npm's postinstall
// lifecycle to run patch-package, because that is unreliable in the sandbox: a
// reused worktree whose node_modules was installed before a patch landed gives a
// no-op `npm install` that can leave the package unpatched, and any
// --ignore-scripts/--omit=dev install skips postinstall entirely. When the
// @ai-hero/sandcastle opencode patch is missing, the provider reverts to
// inlining the prompt in argv and the planner dies with `spawn ENAMETOOLONG` on
// Windows-length command lines. Running patch-package explicitly (idempotent —
// a no-op when already applied) guarantees the patch is present every iteration.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install && npx patch-package" }] },
};

// NOTE: We intentionally do NOT use sandcastle's `copyToWorktree` to copy
// node_modules from the host. That feature shells out to the Unix `cp`
// command, which doesn't exist on Windows (spawn cp ENOENT). Instead we rely
// solely on the `npm install` in the onSandboxReady hook to populate deps.

// ---------------------------------------------------------------------------
// Work loop
//
// The plan → execute → review → merge cycle. Used as-is by the plain
// `npm run sandcastle` entry point, and called as the middle phase of the
// `--improve` flow below. Merges land on whatever branch the host repo is
// checked out on when this runs.
// ---------------------------------------------------------------------------

async function runWorkLoop() {
// The branch the host is checked out on now is where merges land. A branch is
// "mergeable" if it carries commits not yet on this branch — see unmergedCount.
let integrationBranch: string;
try {
  integrationBranch = cap("git rev-parse --abbrev-ref HEAD").trim();
} catch (err) {
  console.error(
    "Cannot start the work loop: not inside a git repository, or git is unavailable.",
  );
  console.error(`  ${errMsg(err)}`);
  return;
}

// Stall guard. Each iteration that ends without a successful merge counts as a
// stalled iteration; a successful merge resets the count. Once we hit the limit
// we stop rather than burn the remaining iterations re-discovering the same
// fixed point (the original "repeats and never exits" symptom). `lastPlanKey`
// lets us say *why* — a recurring identical plan with no progress almost always
// means the work is done but issues aren't being closed (gh token missing
// Issues:write) or everything left is blocked.
const MAX_STALLED_ITERATIONS = 2;
let stalledIterations = 0;
let lastPlanKey = "";

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  // The planner can fail hard: a malformed/missing <plan> tag throws
  // StructuredOutputError, and the sandbox itself can fail to start (e.g. gh
  // auth or network). Either way, don't let one bad planning round abort the
  // whole run — log it and treat it as a stalled iteration.
  let issues: z.infer<typeof planSchema>["issues"];
  try {
    const plan = await sandcastle.run({
      hooks,
      sandbox: docker(),
      name: "planner",
      // One iteration is enough: the planner just needs to read and reason,
      // not write code. (Structured output requires maxIterations: 1.)
      maxIterations: 1,
      // Planning is pinned to Claude Opus regardless of AGENT — like the
      // reviewer below. Planning is the phase that most needs faithful
      // reasoning over the issue list, and a weak local model hallucinates the
      // plan (selecting closed/nonexistent issues it was never given), so the
      // strongest model earns its keep here. Requires ANTHROPIC_API_KEY in
      // .sandcastle/.env and the Claude Code CLI in the image (the Dockerfile
      // keeps it).
      agent: sandcastle.claudeCode("claude-opus-4-8"),
      promptFile: "./.sandcastle/plan-prompt.md",
      // Extract and validate the <plan> JSON into a typed object. Throws
      // StructuredOutputError if the tag is missing, the JSON is malformed, or
      // validation fails.
      output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
    });
    issues = plan.output.issues;
  } catch (err) {
    console.error(`Planning failed this iteration: ${errMsg(err)}`);
    if (++stalledIterations >= MAX_STALLED_ITERATIONS) {
      console.error(
        `Planner failed ${stalledIterations} iteration(s) in a row — stopping. ` +
          `Check the planner prompt, the <plan> output, and that gh can list issues.`,
      );
      break;
    }
    console.error("Retrying on the next iteration.");
    continue;
  }

  // Re-validate the planner's OUTPUT against the live open set. The plan prompt
  // feeds the model only open issues, but filtering the INPUT can't help if the
  // model ignores it: a weak model can hallucinate a plan referencing
  // already-closed or nonexistent issues (observed — a local model emitting
  // #6–#11 when fed #14–#27). So we drop any selected issue that isn't a
  // currently-open sandcastle issue, rather than spawning implementers on dead
  // work. The check runs on the host (where gh is authed), one network call.
  const openIds = openSandcastleIssues();
  const validIssues = issues.filter((issue) => {
    if (openIds.has(Number(issue.id))) return true;
    console.warn(
      `  ! Dropping planned issue #${issue.id} (${issue.title}): not a ` +
        `currently-open sandcastle issue — the planner selected an issue that ` +
        `is closed or was never in the open list it was given.`,
    );
    return false;
  });
  if (validIssues.length < issues.length) {
    console.warn(
      `  Planner proposed ${issues.length} issue(s); ${validIssues.length} ` +
        `are open and will be worked.`,
    );
  }
  issues = validIssues;

  if (issues.length === 0) {
    // No unblocked work — either everything is done, everything is blocked, or
    // the planner produced nothing that survived the open-issue validation.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  // Size the fan-out to the backend's real capacity (see resolveConcurrency):
  // queue pipelines through the available inference slots instead of bursting
  // all of them at the platform at once.
  const concurrency = await resolveConcurrency(issues.length);
  const settled = await allSettledLimited(
    issues,
    concurrency,
    async (issue) => {
      // Create the sandbox. If even that fails (e.g. a corrupt reused worktree),
      // we can't run agents — but the branch may already hold mergeable work
      // from a prior run, so fall back to the host's view instead of discarding
      // it.
      let sandbox: Awaited<ReturnType<typeof sandcastle.createSandbox>>;
      try {
        sandbox = await sandcastle.createSandbox({
          branch: issue.branch,
          sandbox: docker(),
          hooks,
        });
      } catch (err) {
        console.error(
          `  ✗ ${issue.id} (${issue.branch}): could not create sandbox: ${errMsg(err)}`,
        );
        if (isCorruptWorktreeError(err)) {
          console.error(
            "     Looks like a corrupt worktree — run `git worktree prune` and " +
              "remove stale dirs under .sandcastle/worktrees, then re-run.",
          );
        }
        return { mergeable: unmergedCount(integrationBranch, issue.branch) > 0 };
      }

      try {
        // Run the implementer. A failure here — including the agent's 10MB
        // stdin limit, or any crash — must NOT discard work already committed
        // to the branch, so we log it and fall through to the branch-state
        // check below rather than letting the pipeline reject.
        try {
          await sandbox.run({
            name: "implementer",
            maxIterations: 100,
            // The code-writing workhorse.
            agent: agentFor("implement"),
            promptFile: "./.sandcastle/implement-prompt.md",
            promptArgs: {
              TASK_ID: issue.id,
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });
        } catch (err) {
          logAgentFailure("implementer", issue.id, err);
        }

        // A branch is mergeable when it carries work not yet on the integration
        // branch — NOT merely when the implementer committed in THIS run. A
        // ticket finished in an earlier iteration leaves its commits on the
        // branch but produces nothing this run; gating on per-run commits would
        // strand that work (never merged, never reviewed) and the planner would
        // re-select the still-open issue every iteration, forever.
        const mergeable = unmergedCount(integrationBranch, issue.branch) > 0;

        // Review any branch with unmerged work. The harness assembles the diff
        // itself (buildReviewContext) and caps it: rogue large/generated files
        // (a branch that commits 500k lines of vector tables) are summarized
        // instead of inlined, so the prompt always stays well under the agent's
        // 10MB stdin limit and the reviewer can ALWAYS run. The try/catch below
        // is just a backstop — if review still fails, we don't lose the work.
        if (mergeable) {
          try {
            const review = buildReviewContext(integrationBranch, issue.branch);
            await sandbox.run({
              name: "reviewer",
              maxIterations: 1,
              // Reviewer is pinned to Claude Opus regardless of AGENT — we want
              // the strongest reviewer to catch subtle bugs in the local
              // model's output. Requires ANTHROPIC_API_KEY in .sandcastle/.env
              // and the Claude Code CLI in the image (the Dockerfile keeps it).
              agent: sandcastle.claudeCode("claude-opus-4-8"),
              promptFile: "./.sandcastle/review-prompt.md",
              promptArgs: {
                BRANCH: issue.branch,
                // TARGET_BRANCH is a reserved built-in in @ai-hero/sandcastle:
                // sandbox.run auto-injects it as the host's current branch,
                // which is integrationBranch here. Passing it explicitly makes
                // the library throw ("cannot be overridden via promptArgs"),
                // which silently skips the Opus review and merges unreviewed.
                COMMITS: review.commits,
                DIFFSTAT: review.stat,
                DIFF: review.diff,
              },
            });
          } catch (err) {
            logAgentFailure("review", issue.id, err, "merging without review");
          }
        }

        return { mergeable };
      } finally {
        await sandbox.close();
      }
    },
  );

  // Log any agents that threw (network error, sandbox crash, corrupt reused
  // worktree, etc.). Promise.allSettled means one failure doesn't cancel the
  // others, but we still surface each one.
  const rejected = settled.filter((o) => o.status === "rejected").length;
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${errMsg(outcome.reason)}`,
      );
    }
  }
  if (rejected === issues.length) {
    // Every pipeline blew up — almost certainly systemic (docker down, gh auth,
    // or corrupt worktrees). Surface it loudly; the no-progress guard below
    // will stop the run if it keeps happening.
    console.error(
      `All ${issues.length} pipeline(s) failed this iteration. ` +
        `If this is a corrupt worktree, run \`git worktree prune\` and remove ` +
        `stale dirs under .sandcastle/worktrees; if it's auth, check GH_TOKEN.`,
    );
  }

  // Only pass branches with unmerged work to the merge phase. An agent that ran
  // successfully but left nothing ahead of the integration branch has nothing
  // to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.mergeable,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with unmerged work:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  // Identical plan key two iterations running tells us the issue set never
  // changed — used only to enrich the stall message.
  const planKey = issues.map((i) => i.id).sort().join(",");
  const samePlanAsLast = planKey === lastPlanKey;
  lastPlanKey = planKey;

  // -------------------------------------------------------------------------
  // Phase 3: Merge (only when something has unmerged work this cycle)
  //
  // One agent merges all completed branches into the integration branch,
  // resolving conflicts and running tests to confirm everything works.
  // -------------------------------------------------------------------------
  let landedAny = false;
  // Branches whose work is provably on the integration branch as of this cycle.
  // This is ground truth — we just merged them and re-checked — so it does NOT
  // depend on merge topology. A fast-forward merge leaves base == branch (both
  // unmergedCount directions read 0), which is indistinguishable from a
  // not-started branch by git alone; recording the land here lets us close such
  // issues anyway, instead of stranding them open for the planner to re-select
  // every iteration (the "already done, never closed, burns tokens" failure).
  const landedThisCycle = new Set<string>();
  if (completedBranches.length === 0) {
    console.log("No unmerged work produced. Nothing to merge this cycle.");
  } else {
    let mergeFailed = false;
    try {
      await sandcastle.run({
        hooks,
        sandbox: docker(),
        name: "merger",
        maxIterations: 1,
        agent: agentFor("merge"),
        promptFile: "./.sandcastle/merge-prompt.md",
        promptArgs: {
          // A markdown list of branch names, one per line.
          BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
          // A markdown list of issue IDs and titles, one per line.
          ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
        },
      });
    } catch (err) {
      // A failed merge isn't fatal: the branches still hold their work, so a
      // later iteration can retry. The stall guard below stops us if it keeps
      // happening.
      console.error(`\nMerge phase failed: ${errMsg(err)}`);
      console.error("Branches are left in place; a later iteration can retry.");
      mergeFailed = true;
    }

    if (!mergeFailed) {
      // Verify the merges actually landed. The merger agent can report success
      // yet leave a branch unmerged (a conflict it couldn't resolve, a skip).
      const notLanded = completedBranches.filter(
        (b) => unmergedCount(integrationBranch, b) > 0,
      );
      for (const b of completedBranches) {
        if (unmergedCount(integrationBranch, b) === 0) landedThisCycle.add(b);
      }
      landedAny = notLanded.length < completedBranches.length;
      if (notLanded.length > 0) {
        console.warn(
          `\nWarning: still unmerged after the merge phase: ${notLanded.join(", ")}. ` +
            "These will be retried next iteration — see the merger log.",
        );
      } else {
        console.log("\nBranches merged.");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3.5: Close finished issues — from the HOST.
  //
  // Closing is what lets the planner stop re-selecting finished work. We do it
  // here, not in the merger, because the merger runs in a sandbox whose
  // GH_TOKEN may be read-only for Issues — and when it is, the agent merges
  // fine, narrates a close failure in prose, and still returns success, so the
  // orchestrator never noticed (the original silent failure). The host process
  // runs under the user's own gh auth, the authoritative place to close.
  //
  // We close ONLY issues whose branch the merge phase actually landed this
  // cycle (landedThisCycle) — closing is driven by a real merge, never by git
  // topology that can't tell a merged branch from one that is simply behind the
  // integration branch (which would close work that was never done). A close
  // that fails here is the real, loop-blocking problem: surface it and stop,
  // rather than spinning through every remaining iteration re-planning issues
  // that can never close.
  const { closed, failed } = closeMergedDoneIssues(
    issues,
    integrationBranch,
    landedThisCycle,
  );

  if (failed.length > 0) {
    console.error(
      `\n✗ Merged work but could NOT close ${failed.length} issue(s) from the host:`,
    );
    for (const f of failed) console.error(`    #${f.id}: ${f.detail}`);
    console.error(
      "\nThis is the real blocker: until these issues close, the planner will " +
        "re-select them every iteration and the run can never converge. The host " +
        "`gh` needs Issues:write on this repo (a classic token with `repo` scope, " +
        "or a fine-grained token with Issues:write). Fix the token, or close the " +
        "issues manually, then re-run. Stopping now.",
    );
    process.exitCode = 1;
    break;
  }

  // -------------------------------------------------------------------------
  // Progress accounting / stall guard. Progress = something merged or an issue
  // closed. No progress two iterations running means we're spinning — stop.
  // -------------------------------------------------------------------------
  if (landedAny || closed.length > 0) {
    stalledIterations = 0;
  } else if (++stalledIterations >= MAX_STALLED_ITERATIONS) {
    console.warn(
      `\nNo forward progress for ${stalledIterations} iteration(s) in a row` +
        (samePlanAsLast ? ` on the same plan (issues ${planKey})` : "") +
        " — stopping early to avoid spinning to the iteration cap.",
    );
    console.warn(
      "Likely every remaining issue is blocked, or the agents can't make " +
        "progress on them. Check the logs and `gh issue list`.",
    );
    break;
  }
}

  console.log("\nAll done.");
}

// ---------------------------------------------------------------------------
// --improve flow
//
// Adds a seeding phase before the work loop and a pull-request phase after:
//
//   Phase 0  (Seed):   A single opus agent runs on the HOST (noSandbox) so the
//                      host's ~/.claude/skills are available. It drives
//                      improve-codebase-architecture → to-issues (draft) →
//                      vertical-slice-refiner, then files every refined slice as
//                      a GitHub issue labeled `sandcastle`, and writes a markdown
//                      report to a temp file for the PR body.
//   Phase 0.5 (Branch): Create an integration branch off main; the work loop's
//                      merges land here.
//   Phases 1-3:        The existing runWorkLoop().
//   Phase 4  (PR):     If anything merged, push the branch and open a PR into
//                      main, using the markdown report as the body.
// ---------------------------------------------------------------------------

// Capture a string of command output (for parsing).
function cap(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" });
}

// Run a side-effecting command, streaming its output to this process.
function run(cmd: string): void {
  execSync(cmd, { stdio: "inherit" });
}

// Render an unknown thrown value as a single readable line. Error objects
// (including sandcastle's FiberFailure / WorktreeError) carry the useful text
// in `.message`; everything else is stringified.
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// The agent rejects a prompt whose piped stdin exceeds 10MB. This happens when
// a prompt embeds large command output — e.g. the reviewer's `git diff` on a
// branch that commits big generated fixtures (sin/cos vector tables, star maps).
function isStdinTooLargeError(err: unknown): boolean {
  const m = errMsg(err).toLowerCase();
  return m.includes("stdin input exceeds") || (m.includes("stdin") && m.includes("10mb"));
}

// A reused git worktree whose admin files are corrupt (the recurring
// "failed to read .git/worktrees/.../commondir" on concurrent Windows runs).
function isCorruptWorktreeError(err: unknown): boolean {
  const m = errMsg(err).toLowerCase();
  return m.includes("commondir") || m.includes("worktree");
}

// Report an agent (implementer/reviewer) failure without discarding the
// branch's work. The 10MB-stdin case is common and actionable, so it gets a
// specific, non-alarming message and a fix hint; anything else is a plain error.
function logAgentFailure(
  phase: string,
  issueId: string,
  err: unknown,
  fallbackNote?: string,
): void {
  const tail = fallbackNote ? ` — ${fallbackNote}` : "";
  if (isStdinTooLargeError(err)) {
    console.warn(
      `  ! ${phase} for #${issueId} hit the agent's 10MB stdin limit ` +
        `(embedded prompt content too large)${tail}.`,
    );
    console.warn(
      "     Trim what the prompt embeds for this branch (e.g. exclude generated " +
        "fixtures from the diff in review-prompt.md).",
    );
  } else {
    console.error(`  ! ${phase} for #${issueId} failed: ${errMsg(err)}${tail}.`);
  }
}

// How many commits `branch` has that `base` does not. > 0 means the branch
// holds work not yet merged into the integration branch. Returns 0 if the
// branch ref is missing (e.g. an issue whose worktree failed to check out), so
// a broken pipeline is simply treated as "nothing to merge".
function unmergedCount(base: string, branch: string): number {
  try {
    return Number(cap(`git rev-list --count ${base}..${branch}`).trim()) || 0;
  } catch {
    return 0;
  }
}

// Capture command output, tolerant of large diffs (raised maxBuffer) and
// non-zero exits (returns whatever was produced). Used to assemble review
// context from git without ever throwing on a huge or empty diff.
function gitCapture(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stdout?: string };
    return e.stdout ?? "";
  }
}

// Per-file budget: a single file's diff larger than this is summarized, not
// inlined. Total budget keeps the whole assembled diff far under the agent's
// 10MB stdin limit even with several near-cap files.
const REVIEW_PER_FILE_BYTES = 400_000;
const REVIEW_TOTAL_BYTES = 2_000_000;

// Assemble the review context for `base...branch` entirely on the host, with a
// hard size cap. This is what makes review survive a rogue large file: instead
// of inlining a 10MB generated fixture (which blows the agent's stdin limit and
// makes the branch unreviewable), we replace any oversized file's diff with a
// one-line summary + the exact command to inspect it. The reviewer therefore
// ALWAYS gets a bounded, reviewable prompt — no human in the loop required.
function buildReviewContext(
  base: string,
  branch: string,
): { commits: string; stat: string; diff: string } {
  const range = `${base}...${branch}`;
  const commits =
    gitCapture(`git log ${base}..${branch} --oneline --no-decorate`).trim() ||
    "(no commits)";
  const stat = gitCapture(`git diff --stat ${range}`).trim() || "(no changes)";
  const files = gitCapture(`git diff --name-only ${range}`)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const parts: string[] = [];
  let total = 0;
  let omitted = 0;
  for (const file of files) {
    const d = gitCapture(`git diff ${range} -- "${file}"`);
    const tooBig = d.length > REVIEW_PER_FILE_BYTES;
    const wouldOverflow = total + d.length > REVIEW_TOTAL_BYTES;
    if (tooBig || wouldOverflow) {
      const numstat = gitCapture(`git diff --numstat ${range} -- "${file}"`)
        .trim()
        .split(/\s+/);
      const adds = numstat[0] ?? "?";
      const dels = numstat[1] ?? "?";
      parts.push(
        `### ${file}\n[large/generated file — diff omitted to stay within the ` +
          `agent input limit; +${adds}/-${dels}. Inspect with: ` +
          `git diff ${range} -- "${file}"]`,
      );
      omitted++;
    } else {
      parts.push(d.trimEnd());
      total += d.length;
    }
  }

  let diff = parts.join("\n\n") || "(no diff)";
  if (omitted > 0) {
    diff =
      `_${omitted} large/generated file(s) summarized rather than inlined — ` +
      `review those structurally, not line-by-line._\n\n` +
      diff;
  }
  return { commits, stat, diff };
}

// Is the GitHub issue still open? Returns false if the state can't be read
// (treat unknown as "not ours to close" rather than erroring the run).
function isIssueOpen(id: string): boolean {
  try {
    return cap(`gh issue view ${id} --json state --jq .state`).trim() === "OPEN";
  } catch {
    return false;
  }
}

// A copy of the host env with GH_TOKEN/GITHUB_TOKEN removed, so gh falls back to
// the user's stored keyring login (from `gh auth login`). Sandcastle loads
// .sandcastle/.env for the *sandboxes*, and if those vars also land in the host
// process, gh would otherwise prefer the .env PAT — which may be read-only for
// Issues. The keyring login is the user's real, write-capable credential.
function envWithoutGhToken(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

// Close an issue using the host's gh auth. `2>&1` folds stderr into stdout so
// the failure detail is captured for surfacing. To maximize the chance of a
// write-capable credential, we try the keyring login first, then any GH_TOKEN;
// and within each, a close-with-comment first, then a bare close (in case only
// the addComment mutation is blocked). Idempotent: the caller pre-checks state.
function closeIssueFromHost(id: string): { ok: boolean; detail: string } {
  const creds: { label: string; env: NodeJS.ProcessEnv }[] = [
    { label: "keyring", env: envWithoutGhToken() },
    { label: "GH_TOKEN", env: process.env },
  ];
  const commands = [
    `gh issue close ${id} --comment "Completed by Sandcastle" 2>&1`,
    `gh issue close ${id} 2>&1`,
  ];
  let lastDetail = "unknown error";
  for (const cred of creds) {
    for (const cmd of commands) {
      try {
        execSync(cmd, { encoding: "utf8", env: cred.env });
        return { ok: true, detail: `closed (${cred.label})` };
      } catch (err) {
        const e = err as { stdout?: string; message?: string };
        lastDetail = (e.stdout || e.message || String(err)).trim();
      }
    }
  }
  return { ok: false, detail: lastDetail };
}

// Close every planned issue whose branch the merge phase provably landed on
// `base` THIS cycle. Closing is a consequence of MERGING and nothing else: an
// issue closes because we just merged its work, never because of a guess about
// git topology.
//
// `landedThisCycle` is ground truth — the merge phase merged the branch and
// re-checked that `base` now contains it (see Phase 3). It is authoritative and
// topology-independent, so it also closes issues whose merge fast-forwarded
// (base == branch, both rev-list directions read 0).
//
// We deliberately do NOT infer "done" from `base` being ahead of the branch
// (the old `baseAdvancedBeyond` heuristic). A branch that is merely BEHIND
// `base` — because it was never worked, or because `base` moved forward for
// unrelated reasons — trivially looks "fully contained in base", so closing on
// that basis closes tickets whose work was never done. That is the bug this
// guards against: a cycle in which every implementer failed (nothing merged)
// must close nothing, not sweep-close every planned issue. Returns the IDs
// closed and any that failed.
function closeMergedDoneIssues(
  plannedIssues: { id: string; branch: string }[],
  base: string,
  landedThisCycle: Set<string>,
): { closed: string[]; failed: { id: string; detail: string }[] } {
  const closed: string[] = [];
  const failed: { id: string; detail: string }[] = [];
  for (const issue of plannedIssues) {
    // Only a branch the merge phase landed on `base` this cycle is eligible to
    // close. The defensive re-check that nothing is still ahead of `base` guards
    // against a branch that regressed after landing; it never broadens what
    // closes (landedThisCycle already implies it).
    if (!landedThisCycle.has(issue.branch)) continue;
    if (unmergedCount(base, issue.branch) !== 0) continue;
    if (!isIssueOpen(issue.id)) continue; // already closed
    const r = closeIssueFromHost(issue.id);
    if (r.ok) {
      console.log(`  ✓ closed #${issue.id}`);
      closed.push(issue.id);
    } else {
      failed.push({ id: issue.id, detail: r.detail });
    }
  }
  return { closed, failed };
}

// sandcastle's noSandbox provider runs host commands via `spawn("sh", ...)`.
// Git for Windows ships a POSIX sh at <gitroot>/usr/bin but only puts
// <gitroot>/cmd on PATH, so a normal PowerShell session can't resolve `sh` and
// the seed run dies with `spawn sh ENOENT`. Derive sh's dir from `git` and
// prepend it to PATH (which the provider's spawn inherits via process.env).
function ensurePosixShellOnPath(): void {
  if (process.platform !== "win32") return;
  try {
    execSync("sh -c true", { stdio: "ignore" });
    return; // sh already resolvable — nothing to do
  } catch {
    // fall through and try to locate Git's sh
  }
  try {
    const gitExe = cap("where git").split(/\r?\n/)[0]!.trim();
    const shDir = join(dirname(dirname(gitExe)), "usr", "bin");
    if (existsSync(join(shDir, "sh.exe"))) {
      process.env.PATH = shDir + delimiter + process.env.PATH;
      console.log(`(added ${shDir} to PATH so the seed agent can spawn sh)`);
    }
  } catch {
    // best-effort; if it fails the seed run surfaces the original ENOENT
  }
}

// Hold a Windows power request (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) for the
// duration of an unattended run so the host doesn't sleep mid-flight. (A prior
// run stalled ~11h when the machine slept overnight: the Node process and its
// docker sandboxes were suspended and only resumed when the host woke.)
//
// Node can't call SetThreadExecutionState directly, so we spawn a detached
// PowerShell helper that holds the request and releases it when it exits. It
// also watches this process's PID and self-exits if we die without cleaning up,
// so the request is never leaked. Returns a release() callback.
function preventSleepWhileRunning(): () => void {
  if (process.platform !== "win32") return () => {};

  const ps1 = join(tmpdir(), `sandcastle-keepawake-${process.pid}.ps1`);
  const script = `
param([int]$ParentPid)
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED — prevent idle sleep (display may still turn off).
[Win32.Power]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
try {
  while ($true) {
    try { Get-Process -Id $ParentPid -ErrorAction Stop | Out-Null } catch { break }
    Start-Sleep -Seconds 30
  }
} finally {
  # ES_CONTINUOUS alone clears the request (process exit would too).
  [Win32.Power]::SetThreadExecutionState([uint32]"0x80000000") | Out-Null
}
`;

  try {
    writeFileSync(ps1, script);
    const child = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, String(process.pid)],
      { stdio: "ignore", detached: true, windowsHide: true },
    );
    child.unref();
    console.log("(holding a power request so the host won't sleep during the run)");

    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        child.kill();
      } catch {
        // child may already be gone
      }
      try {
        rmSync(ps1, { force: true });
      } catch {
        // best-effort temp cleanup
      }
    };
  } catch {
    // If we couldn't start the guard, run anyway — worst case is the old
    // sleep-stall behavior, not a failed run.
    return () => {};
  }
}

// The set of open issue numbers currently labeled `sandcastle`.
function openSandcastleIssues(): Set<number> {
  const out = cap(
    "gh issue list --state open --label sandcastle --limit 200 --json number",
  ).trim();
  const arr: { number: number }[] = JSON.parse(out || "[]");
  return new Set(arr.map((i) => i.number));
}

async function runImprove() {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  // Timestamp with no separators: YYYYMMDDHHmm.
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
  const branch = `sandcastle/improve-${stamp}`;
  // Report and PR body live outside the repo so the work tree stays clean.
  const reportPath = join(tmpdir(), `improve-report-${stamp}.md`);

  // -------------------------------------------------------------------------
  // Phase 0: Seed
  // -------------------------------------------------------------------------
  console.log("\n=== Phase 0: Seed (architecture review → issues) ===\n");

  ensurePosixShellOnPath();

  const before = openSandcastleIssues();

  // No `hooks` here: the agent runs on the host, which already has deps.
  await sandcastle.run({
    sandbox: noSandbox(),
    name: "seed",
    maxIterations: 50,
    agent: agentFor("seed"),
    promptFile: "./.sandcastle/improve-seed-prompt.md",
    promptArgs: { REPORT_PATH: reportPath },
  });

  const after = openSandcastleIssues();
  const filed = [...after].filter((n) => !before.has(n));

  if (filed.length === 0) {
    console.log(
      "\nSeed produced no new `sandcastle` issues. Nothing to improve — exiting without a branch or PR.",
    );
    return;
  }

  console.log(
    `\nSeed filed ${filed.length} new issue(s): ${filed.map((n) => `#${n}`).join(", ")}`,
  );

  // -------------------------------------------------------------------------
  // Phase 0.5: Integration branch off main
  // -------------------------------------------------------------------------
  console.log(`\n=== Creating integration branch ${branch} off main ===\n`);
  run("git checkout main");
  run(`git checkout -b ${branch}`);

  // -------------------------------------------------------------------------
  // Phases 1-3: Work loop (merges land on the integration branch)
  // -------------------------------------------------------------------------
  await runWorkLoop();

  // -------------------------------------------------------------------------
  // Phase 4: Pull request
  // -------------------------------------------------------------------------
  const ahead = Number(cap(`git rev-list --count main..${branch}`).trim());

  if (ahead === 0) {
    console.log(
      "\nNo commits merged into the integration branch — skipping PR.",
    );
    console.log(
      `Open issues remain (${filed.map((n) => `#${n}`).join(", ")}). Investigate the logs or rerun.`,
    );
    return;
  }

  let body: string;
  try {
    body = readFileSync(reportPath, "utf8");
  } catch {
    body = "Autonomous Sandcastle architecture-improvement run.";
  }

  // Note any seeded issues still open after the loop (e.g. hit the iteration cap).
  const stillOpen = openSandcastleIssues();
  const unfinished = filed.filter((n) => stillOpen.has(n));
  if (unfinished.length > 0) {
    body +=
      `\n\n---\n\n> **Partial run.** ${unfinished.length} seeded issue(s) still open ` +
      `after the work loop: ${unfinished.map((n) => `#${n}`).join(", ")}.`;
  }

  const bodyFile = join(tmpdir(), `improve-pr-body-${stamp}.md`);
  writeFileSync(bodyFile, body);

  console.log(`\n=== Phase 4: Opening PR for ${branch} → main ===\n`);
  run(`git push -u origin ${branch}`);
  run(
    `gh pr create --base main --head ${branch} ` +
      `--title "Sandcastle architecture improvements (${stamp})" ` +
      `--body-file "${bodyFile}"`,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Top-level guard: surface any unexpected failure as a clean message and a
// non-zero exit code, rather than an unhandled-rejection stack trace.
try {
  if (process.argv.includes("--improve")) {
    // Hold a sleep-preventing power request for the whole unattended run, and
    // release it however the run ends (success, early return, or throw).
    const releaseSleepGuard = preventSleepWhileRunning();
    try {
      await runImprove();
    } finally {
      releaseSleepGuard();
    }
  } else {
    await runWorkLoop();
  }
} catch (err) {
  console.error(`\nSandcastle run aborted: ${errMsg(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
