# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSING ISSUES

Do NOT close any GitHub issues. The host orchestrator closes them after it
verifies each merge landed, using its own gh auth. Your job is only to merge.

For reference, the issues these branches correspond to:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
