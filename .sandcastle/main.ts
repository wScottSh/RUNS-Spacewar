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

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
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
      // Opus for planning: dependency analysis benefits from deeper reasoning.
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

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
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

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: docker(),
        hooks,
      });

      try {
        // Run the implementer
        await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          // Sonnet for writing code: fast, capable implementer.
          agent: sandcastle.claudeCode("claude-sonnet-4-6"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // A branch is mergeable when it carries work not yet on the integration
        // branch — NOT merely when the implementer committed in THIS run. A
        // ticket finished in an earlier iteration leaves its commits on the
        // branch but produces nothing this run; gating on per-run commits would
        // strand that work (never merged, never reviewed) and the planner would
        // re-select the still-open issue every iteration, forever.
        const mergeable = unmergedCount(integrationBranch, issue.branch) > 0;

        // Review any branch with unmerged work (whether authored now or earlier).
        if (mergeable) {
          await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-4-8"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });
        }

        return { mergeable };
      } finally {
        await sandbox.close();
      }
    }),
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

  // Track forward progress. Identical plan key two iterations running tells us
  // the issue set never changed (nothing closed).
  const planKey = issues.map((i) => i.id).sort().join(",");
  const samePlanAsLast = planKey === lastPlanKey;
  lastPlanKey = planKey;

  if (completedBranches.length === 0) {
    // Every pipeline ran but left nothing ahead of the integration branch —
    // nothing to merge this cycle.
    console.log("No unmerged work produced. Nothing to merge.");
    if (++stalledIterations >= MAX_STALLED_ITERATIONS) {
      console.warn(
        `\nNo forward progress for ${stalledIterations} iteration(s) in a row` +
          (samePlanAsLast ? ` on the same plan (issues ${planKey})` : "") +
          " — stopping early to avoid spinning to the iteration cap.",
      );
      console.warn(
        "Likely causes: the work is already done but issues aren't being " +
          "closed (gh token needs Issues:write), or every remaining issue is " +
          "blocked. Check the merger log and `gh issue list`.",
      );
      break;
    }
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  try {
    await sandcastle.run({
      hooks,
      sandbox: docker(),
      name: "merger",
      maxIterations: 1,
      agent: sandcastle.claudeCode("claude-opus-4-8"),
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
    // later iteration can retry. Count it as a stalled iteration so we don't
    // retry forever.
    console.error(`\nMerge phase failed: ${errMsg(err)}`);
    console.error("Branches are left in place; a later iteration can retry.");
    if (++stalledIterations >= MAX_STALLED_ITERATIONS) {
      console.error(
        `Merge failed ${stalledIterations} iteration(s) in a row — stopping.`,
      );
      break;
    }
    continue;
  }

  // Verify the merges actually landed. The merger agent can report success yet
  // leave a branch unmerged (conflict it couldn't resolve, a skipped branch).
  const notLanded = completedBranches.filter(
    (b) => unmergedCount(integrationBranch, b) > 0,
  );
  if (notLanded.length > 0) {
    console.warn(
      `\nWarning: still unmerged after the merge phase: ${notLanded.join(", ")}. ` +
        "These will be retried next iteration — see the merger log.",
    );
  } else {
    console.log("\nBranches merged.");
  }

  // Real progress this iteration — reset the stall guard.
  stalledIterations = 0;
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
    agent: sandcastle.claudeCode("claude-opus-4-8"),
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
