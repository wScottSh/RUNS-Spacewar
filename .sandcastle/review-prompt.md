# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Commits on this branch

{{COMMITS}}

## Files changed (diffstat)

{{DIFFSTAT}}

## Branch diff

The diff below is assembled by the harness from `{{TARGET_BRANCH}}...{{BRANCH}}`.
Large generated/data files (fixtures, vector tables, manifests) are **summarized,
not inlined** — for those, review structurally (line counts, schema, a few
spot-checks), and if you need the full content run
`git diff {{TARGET_BRANCH}}...{{BRANCH}} -- <file>` yourself in the sandbox. Never
try to pull an entire large generated file into your context.

{{DIFF}}

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Check correctness**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are new/changed behaviours covered by tests?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

4. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

5. **Apply project standards**: Follow the coding standards defined in @.sandcastle/CODING_STANDARDS.md

6. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run tests and type checking to ensure nothing is broken
3. Commit describing the refinements

If the code is already clean and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.
