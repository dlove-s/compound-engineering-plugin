---
name: ce-pr-description
description: "Write or regenerate a value-first pull-request description (title + body) from an existing PR or a diff range. Use when the user says 'write a PR description', 'refresh the PR description', 'regenerate the PR body', 'rewrite this PR', 'freshen the PR', 'update the PR description', 'draft a PR body for this diff', 'describe this PR properly', 'generate the PR title', or pastes a GitHub PR URL and asks to rewrite or refresh its description. Also used internally by git-commit-push-pr (single-PR flow) and ce-pr-stack (per-layer stack descriptions) so all callers share one writing voice. Accepts pr:<number-or-url> (existing open PR — bare number, full https://github.com/.../pull/NN URL, or owner/repo#NN shorthand), range:<base>..<head> (pre-PR or dry-run), plus an optional focus:<hint>. Returns structured {title, body} for the caller to apply via gh pr edit or gh pr create — this skill never edits the PR itself and never prompts for confirmation."
argument-hint: "[pr:<number-or-url> | range:<base>..<head>] [focus:<hint>] — pr: accepts a bare number, a full https://github.com/.../pull/NN URL, or owner/repo#NN shorthand; range: works from any diff (fork PRs and non-local base refs handled automatically); focus: optional steering hint"
---

# CE PR Description

Generate a conventional-commit-style title and a value-first body for a GitHub pull request from either an existing PR (`pr:<number>`) or a raw diff range (`range:<base>..<head>`). Returns structured `{title, body}` for the caller to apply — this skill never invokes `gh pr edit` or `gh pr create`, and never prompts for interactive confirmation.

Why a separate skill: several callers need the same writing logic without the single-PR interactive scaffolding that lives in `git-commit-push-pr`. `ce-pr-stack`'s splitting workflow runs this once per layer as a batch; `git-commit-push-pr` runs it inside its full-flow and refresh-mode paths. Extracting keeps one source of truth for the writing principles.

**Naming rationale:** `ce-pr-description`, not `git-pr-description`. Stacking and PR creation are GitHub features; the "PR" in the name refers to the GitHub artifact. Using the `ce-` prefix matches the future convention for plugin skills; sibling `git-*` skills will rename to `ce-*` later, and this skill starts there directly.

---

## Inputs

Callers pass one of the two input forms below, plus an optional focus hint. If invoked directly by the user with no explicit form, infer from context (an existing open PR on the current branch -> `pr:<number>`; a branch with no PR yet -> `range:<base>..HEAD`).

- **`pr: <number-or-url>`** -- generate description for an existing PR. Accepts three forms:
  - Bare number: `pr: 561` -- resolves against the current repo
  - Full URL: `pr: https://github.com/owner/repo/pull/561` -- works from any directory, even outside a local clone of the target repo
  - Shorthand: `pr: owner/repo#561` -- works anywhere

  The skill reads title, body, and commit list via `gh pr view <number-or-url>` (which accepts all three forms natively), and derives the diff from the PR's commit range. When the URL points to a repo other than the current working directory's repo, the skill fetches the PR head from the URL-derived remote; if that is not possible (no local clone of that repo), it falls back to reading the diff directly via `gh pr diff <number-or-url>` and skips the local-git steps.
- **`range: <base>..<head>`** -- generate description for an arbitrary range without requiring an existing PR. Useful before a PR is created, or as a dry-run for a branch being prepared for stack submission.
- **`focus: <hint>`** (optional) -- a user-provided steering note such as "include the benchmarking results" or "emphasize the migration safety story". Incorporate alongside the diff-derived narrative; do not let focus override the value-first principles.

## Output

Return a structured result with two fields:

- **`title`** -- conventional-commit format: `type: description` or `type(scope): description`. Under 72 characters. Choose `type` based on intent (feat/fix/refactor/docs/chore/perf/test), not file type. Pick the narrowest useful `scope` (skill or agent name, CLI area, or shared label); omit when no single label adds clarity.
- **`body`** -- markdown following the writing principles below.

The caller decides whether to apply via `gh pr edit`, `gh pr create`, or discard. This skill does NOT call those commands itself.

---

## What this skill does not do

- No interactive confirmation prompts. If the diff is ambiguous about something important (e.g., the focus hint conflicts with the actual changes), surface the ambiguity in the returned output or raise it to the caller — do not prompt the user directly.
- No branch checkout or assumption that HEAD is the target branch. Work from the input (`pr:` or `range:`) only.
- No compare-and-confirm narrative ("here's what changed since the last version"). The description describes the end state; the caller owns any compare-and-confirm framing.
- No auto-apply via `gh pr edit` or `gh pr create`. Return the output and stop.

Interactive scaffolding (confirmation prompts, compare-and-confirm, apply step) is the caller's responsibility.

---

## Step 1: Resolve the diff and commit list

### If input is `pr: <number-or-url>`

All three input forms (bare number, full URL, `owner/repo#number` shorthand) work identically with `gh pr view` — pass the caller's value through verbatim as `<pr-ref>`:

```bash
gh pr view <pr-ref> --json number,state,title,body,baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository,commits,url
```

Note the available JSON fields: `gh pr view --json` exposes `headRepository` (the PR source repo) and `isCrossRepository` (whether the PR source differs from the base). It does NOT expose a `baseRepository` field — the base repo is the repo queried by `gh pr view` itself, inferred from the URL or current working directory. Extract the PR number (for the `refs/pull/<N>/head` fetch) and use `isCrossRepository` to decide routing.

If the returned `state` is not `OPEN`, report "PR <number> is <state> (not open); cannot regenerate description" and exit gracefully without output. Callers expecting `{title, body}` must handle this empty case.

**Determine whether the PR lives in the current working directory's repo.** Two independent signals:
- The input form: a bare number or an `owner/repo#NN` shorthand implicitly targets the current repo; a full URL may target any repo.
- The URL's repo identity: parse the URL's `<owner>/<repo>` path segments and compare against `git remote get-url origin` (strip `.git` suffix, handle `git@github.com:owner/repo` vs `https://github.com/owner/repo` forms).

If the URL-derived repo matches the local `origin` remote's repo, route to Case A. Otherwise route to Case B. For bare-number and shorthand inputs that resolve against the current directory, always Case A. The two cases:

**Case A — PR is in the current repo** (common case when the user is working inside the target repo):

Resolve the base remote (the one whose URL points to the PR's base repository; fall back to `origin`). Do not assume a local branch matching `headRefName` exists: the PR may come from a fork, the local branch may have been deleted, the clone may not have fetched it, or the user may be running the skill from a different branch.

Extract the PR head SHA directly from the `gh pr view --json commits` response. `commits` is an ordered array; the last entry is the PR's current tip. Extract it explicitly:

```bash
PR_HEAD_SHA=$(gh pr view <pr-ref> --json commits --jq '.commits[-1].oid')
```

Using an explicit SHA avoids `FETCH_HEAD` entirely, which has a multi-ref ordering problem: `git fetch --no-tags <remote> <refA> <refB>` populates `.git/FETCH_HEAD` with both refs but `git rev-parse FETCH_HEAD` returns only the first entry's SHA. When the base ref comes before the PR head in the fetch command, `rev-parse` silently returns the base SHA and subsequent `git merge-base`/`git diff` calls produce an empty diff with no error signal. Using an explicit SHA sidesteps the issue.

Now fetch the base ref (to ensure it's current locally) and the PR head SHA (to ensure the commit's object is in the local store — required by `git merge-base`, `git log`, `git diff`):

```bash
git fetch --no-tags <base-remote> <baseRefName> $PR_HEAD_SHA
```

This is a single fetch, safe to run with any ref ordering because downstream commands address commits by explicit SHA, not via `FETCH_HEAD`. The fetch is idempotent when both the base and the SHA are already local.

Gather merge base, commit list, and full diff using the explicit SHA:

```bash
MERGE_BASE=$(git merge-base <base-remote>/<baseRefName> $PR_HEAD_SHA) && echo "MERGE_BASE=$MERGE_BASE" && echo '=== COMMITS ===' && git log --oneline $MERGE_BASE..$PR_HEAD_SHA && echo '=== DIFF ===' && git diff $MERGE_BASE...$PR_HEAD_SHA
```

If the explicit-SHA fetch fails (the server refuses to serve a non-tip SHA — rare on GitHub, possible on some GHES configurations), fall back to fetching `refs/pull/<number>/head` and reading `PR_HEAD_SHA` from `.git/FETCH_HEAD` by pull-ref pattern rather than from `git rev-parse FETCH_HEAD`:

```bash
git fetch --no-tags <base-remote> "refs/pull/<number>/head"
PR_HEAD_SHA=$(awk '/refs\/pull\/[0-9]+\/head/ {print $1; exit}' "$(git rev-parse --git-dir)/FETCH_HEAD")
```

This grep-based extraction is robust against multi-ref ordering because it matches the specific ref by pattern rather than relying on `FETCH_HEAD`'s first-entry semantics.

**Case B — PR is in a different repo** (user pasted a URL to a repo not present locally):

Skip the local-git path entirely. Read the diff directly via `gh`, which hits the GitHub API:

```bash
gh pr diff <pr-ref>
gh pr view <pr-ref> --json commits --jq '.commits[] | [.oid[0:7], .messageHeadline] | @tsv'
```

This gives an equivalent diff and commit list without requiring the base or head refs to be local. The rest of the pipeline (classification, framing, writing) proceeds unchanged. Note in the returned body or a short caller-facing note when this fallback was used — it signals that evidence preservation (Step 3) relied on the PR body as fetched from the API rather than on any local working-tree state.

Also capture the existing PR body for evidence preservation in Step 3 (both cases).

### If input is `range: <base>..<head>`

Resolve both endpoints, **fetching the base ref on demand** before validating. This is important because callers often pass remote-tracking refs (`origin/main`, `origin/develop`) or branch names that may not be present in the local clone — particularly after a fresh clone, after the local branch was deleted, or when targeting a non-default base. The pre-refactor behavior in `git-commit-push-pr` fetched on demand; preserve that here.

Detect whether `<base>` looks like a remote-tracking ref (contains a `/` matching a known remote) or a bare branch name:

```bash
# If <base> is of the form <remote>/<branch>, try fetching that remote/branch first.
# If <base> is a bare branch name without a remote prefix, try the default remote (origin
# first, then the single remote if there's only one) as a fallback.
BASE=<base>
HEAD=<head>

if ! git rev-parse --verify "$BASE" 2>/dev/null >/dev/null; then
  if [[ "$BASE" == */* ]]; then
    REMOTE=${BASE%%/*}
    BRANCH=${BASE#*/}
    git fetch --no-tags "$REMOTE" "$BRANCH" 2>/dev/null
  else
    # Try origin, then single-remote fallback
    git fetch --no-tags origin "$BASE" 2>/dev/null || {
      REMOTES=$(git remote)
      REMOTE_COUNT=$(echo "$REMOTES" | grep -c .)
      if [ "$REMOTE_COUNT" = "1" ]; then
        git fetch --no-tags "$REMOTES" "$BASE" 2>/dev/null
      fi
    }
  fi
fi

# Validate after fetch attempt
git rev-parse --verify "$BASE" 2>/dev/null && git rev-parse --verify "$HEAD" 2>/dev/null
```

If either endpoint still fails to resolve after the fetch attempt, report "Invalid range: `<base>..<head>` -- `<base>` does not resolve (tried local and remote)" or similar for `<head>`, and exit gracefully without output. Do not fabricate a description from a partial or empty diff.

Gather merge base, commit list, and full diff:

```bash
MERGE_BASE=$(git merge-base "$BASE" "$HEAD") && echo "MERGE_BASE=$MERGE_BASE" && echo '=== COMMITS ===' && git log --oneline $MERGE_BASE.."$HEAD" && echo '=== DIFF ===' && git diff $MERGE_BASE..."$HEAD"
```

If the commit list is empty, report "No commits between `<base>` and `<head>`" and exit gracefully.

---

## Step 2: Classify commits before writing

Scan the commit list and classify each commit:

- **Feature commits** -- implement the PR's purpose (new functionality, intentional refactors, design changes). These drive the description.
- **Fix-up commits** -- iteration work (code review fixes, lint fixes, test fixes, rebase resolutions, style cleanups). Invisible to the reader.

When sizing the description, mentally subtract fix-up commits: a branch with 12 commits but 9 fix-ups is a 3-commit PR.

---

## Step 3: Decide on evidence

Decide whether evidence capture is possible from the full branch diff.

**Evidence is possible** when the diff changes observable behavior demonstrable from the workspace: UI, CLI output, API behavior with runnable code, generated artifacts, or workflow output.

**Evidence is not possible** for:
- Docs-only, markdown-only, changelog-only, release metadata, CI/config-only, test-only, or pure internal refactors
- Behavior requiring unavailable credentials, paid/cloud services, bot tokens, deploy-only infrastructure, or hardware not provided

**This skill does NOT prompt the user** to capture evidence. The decision logic is:

1. **Input was `pr:<number>` and the existing body contains a `## Demo` or `## Screenshots` section with image embeds:** preserve it verbatim unless the `focus:` hint asks to refresh or remove it. Include the preserved block in the returned body.
2. **Otherwise:** omit the evidence section entirely. If the caller wants to capture evidence, the caller is responsible for invoking `ce-demo-reel` separately and splicing the result in, or for asking this skill to regenerate with an updated focus hint after capture.

Do not label test output as "Demo" or "Screenshots". Place any preserved evidence block before the Compound Engineering badge.

---

## Step 4: Frame the narrative before sizing

Articulate the PR's narrative frame:

1. **Before**: What was broken, limited, or impossible? (One sentence.)
2. **After**: What's now possible or improved? (One sentence.)
3. **Scope rationale** (only if 2+ separable-looking concerns): Why do these ship together? (One sentence.)

This frame becomes the opening. For small+simple PRs, the "after" sentence alone may be the entire description.

---

## Step 5: Size the change

Assess size (files, diff volume) and complexity (design decisions, trade-offs, cross-cutting concerns) to select description depth:

| Change profile | Description approach |
|---|---|
| Small + simple (typo, config, dep bump) | 1-2 sentences, no headers. Under ~300 characters. |
| Small + non-trivial (bugfix, behavioral change) | Short narrative, ~3-5 sentences. No headers unless two distinct concerns. |
| Medium feature or refactor | Narrative frame (before/after/scope), then what changed and why. Call out design decisions. |
| Large or architecturally significant | Full narrative: problem context, approach (and why), key decisions, migration/rollback if relevant. |
| Performance improvement | Include before/after measurements if available. Markdown table works well. |

When in doubt, shorter is better. Match description weight to change weight.

---

## Step 6: Apply writing principles

### Writing voice

If the repo has documented style preferences in context, follow those. Otherwise:

- Active voice. No em dashes or `--` substitutes; use periods, commas, colons, or parentheses.
- Vary sentence length. Never three similar-length sentences in a row.
- Do not make a claim and immediately explain it. Trust the reader.
- Plain English. Technical jargon fine; business jargon never.
- No filler: "it's worth noting", "importantly", "essentially", "in order to", "leverage", "utilize."
- Digits for numbers ("3 files"), not words ("three files").

### Writing principles

- **Lead with value**: Open with what's now possible or fixed, not what was moved around. The subtler failure is leading with the mechanism ("Replace the hardcoded capture block with a tiered skill") instead of the outcome ("Evidence capture now works for CLI tools and libraries, not just web apps").
- **No orphaned opening paragraphs**: If the description uses `##` headings anywhere, the opening must also be under a heading (e.g., `## Summary`). For short descriptions with no sections, a bare paragraph is fine.
- **Describe the net result, not the journey**: The description covers the end state, not how you got there. No iteration history, debugging steps, intermediate failures, or bugs found and fixed during development. This applies equally when regenerating for an existing PR: rewrite from the current state, not as a log of what changed since the last version. Exception: process details critical to understand a design choice.
- **When commits conflict, trust the final diff**: The commit list is supporting context, not the source of truth. If commits describe intermediate steps later revised or reverted, describe the end state from the full branch diff.
- **Explain the non-obvious**: If the diff is self-explanatory, don't narrate it. Spend space on things the diff doesn't show: why this approach, what was rejected, what the reviewer should watch.
- **Use structure when it earns its keep**: Headers, bullets, and tables aid comprehension, not mandatory template sections.
- **Markdown tables for data**: Before/after comparisons, performance numbers, or option trade-offs communicate well as tables.
- **No empty sections**: If a section doesn't apply, omit it. No "N/A" or "None."
- **Test plan — only when non-obvious**: Include when testing requires edge cases the reviewer wouldn't think of, hard-to-verify behavior, or specific setup. Omit when "run the tests" is the only useful guidance. When the branch adds test files, name them with what they cover.

### Visual communication

Include a visual aid only when the change is structurally complex enough that a reviewer would struggle to reconstruct the mental model from prose alone.

**The core distinction — structure vs. parallel variation:**

- Use a **Mermaid diagram** when the change has **topology** — components with directed relationships (calls, flows, dependencies, state transitions, data paths). Diagrams express "A talks to B, B talks to C, C does not talk back to A" in a way tables cannot.
- Use a **markdown table** when the change has **parallel variation of a single shape** — N things that share the same attributes but differ in their values. Tables express "option 1 costs X, option 2 costs Y, option 3 costs Z" cleanly.

Architecture changes are almost always topology (components + edges), so Mermaid is usually the right call — a table of "components that interact" loses the edges and becomes a flat list. Reserve tables for genuinely parallel data: before/after measurements, option trade-offs, flag matrices, config enumerations.

**When to include (prefer Mermaid, not a table, for architecture/flow):**

| PR changes... | Visual aid |
|---|---|
| Architecture touching 3+ interacting components (the components have *directed relationships* — who calls whom, who owns what, which skill delegates to which) | **Mermaid** component or interaction diagram. Do not substitute a table — tables cannot show edges. |
| Multi-step workflow or data flow with non-obvious sequencing | **Mermaid** flow diagram |
| State machine with 3+ states and non-trivial transitions | **Mermaid** state diagram |
| Data model changes with 3+ related entities | **Mermaid** ERD |
| Before/after performance or behavioral measurements (same metric, different values) | **Markdown table** |
| Option or flag trade-offs (same attributes evaluated across variants) | **Markdown table** |
| Feature matrix / compatibility grid | **Markdown table** |

**When in doubt, ask: "Does the information have edges (A → B) or does it have rows (attribute × variant)?"** Edges → Mermaid. Rows → table. Architecture has edges almost by definition.

**When to skip any visual:**
- Sizing routes to "1-2 sentences"
- Prose already communicates clearly
- The diagram would just restate the diff visually
- Mechanical changes (renames, dep bumps, config, formatting)

**Format details:**
- **Mermaid** (default for topology). 5-10 nodes typical, up to 15 for genuinely complex changes. Use `TB` direction. Source should be readable as fallback.
- **ASCII diagrams** for annotated flows needing rich in-box content. 80-column max.
- **Markdown tables** for parallel-variation data only.
- Place inline at point of relevance, not in a separate section.
- Prose is authoritative when it conflicts with a visual.

Verify generated diagrams against the change before including.

### Numbering and references

Never prefix list items with `#` in PR descriptions — GitHub interprets `#1`, `#2` as issue references and auto-links them.

When referencing actual GitHub issues or PRs, use `org/repo#123` or the full URL. Never use bare `#123` unless verified.

### Applying the focus hint

If a `focus:` hint was provided, incorporate it alongside the diff-derived narrative. Treat focus as steering, not override: do not invent content the diff does not support, and do not suppress important content the diff demands simply because focus did not mention it. When focus and diff materially disagree (e.g., focus says "include benchmarking" but the diff has no benchmarks), note the conflict in a way the caller can see (leave a brief inline note or raise to the caller) rather than fabricating content.

---

## Step 7: Compose the title

Title format: `type: description` or `type(scope): description`.

- **Type** is chosen by intent, not file extension. `feat` for new functionality, `fix` for a bug fix, `refactor` for a behavior-preserving change, `docs` for doc-only, `chore` for tooling/maintenance, `perf` for performance, `test` for test-only.
- **Scope** (optional) is the narrowest useful label: a skill/agent name, CLI area, or shared area. Omit when no single label adds clarity.
- **Description** is imperative, lowercase, under 72 characters total. No trailing period.
- If the repo has commit-title conventions visible in recent commits, match them.

Breaking changes use `!` (e.g., `feat!: ...`) or document in the body with a `BREAKING CHANGE:` footer.

---

## Step 8: Compose the body

Assemble the body in this order:

1. **Opening** -- the narrative frame from Step 4, at the depth chosen in Step 5. Under a heading (e.g., `## Summary`) if the description uses any `##` headings elsewhere; a bare paragraph otherwise.
2. **Body sections** -- only the sections that earn their keep for this change: what changed and why, design decisions, tables for data, visual aids when complexity warrants. Skip empty sections entirely.
3. **Test plan** -- only when non-obvious per the writing principles. Omit otherwise.
4. **Evidence block** -- only the preserved block from Step 3, if one exists. Do not fabricate or placeholder.
5. **Compound Engineering badge** -- append a badge footer separated by a `---` rule. Skip if the existing body (for `pr:` input) already contains the badge.

**Badge:**

```markdown
---

[![Compound Engineering](https://img.shields.io/badge/Built_with-Compound_Engineering-6366f1)](https://github.com/EveryInc/compound-engineering-plugin)
![HARNESS](https://img.shields.io/badge/MODEL_SLUG-COLOR?logo=LOGO&logoColor=white)
```

**Harness lookup:**

| Harness | `LOGO` | `COLOR` |
|---------|--------|---------|
| Claude Code | `claude` | `D97757` |
| Codex | (omit logo param) | `000000` |
| Gemini CLI | `googlegemini` | `4285F4` |

**Model slug:** Replace spaces with underscores. Append context window and thinking level in parentheses if known. Examples: `Opus_4.6_(1M,_Extended_Thinking)`, `Sonnet_4.6_(200K)`, `Gemini_3.1_Pro`.

---

## Step 9: Return `{title, body}`

Return the composed title and body to the caller. Do not call `gh pr edit`, `gh pr create`, or any other mutating command. Do not ask the user to confirm. The caller owns apply.

Format the return as a clearly labeled block so the caller can extract cleanly:

```
=== TITLE ===
<title line>

=== BODY ===
<body markdown>
```

If Step 1 exited gracefully (closed/merged PR, invalid range, empty commit list), return no title or body — just the reason string.

---

## Cross-platform notes

This skill does not ask questions directly. If the diff is ambiguous about something the caller should decide (e.g., focus conflicts with the actual changes, or evidence is technically capturable but the caller did not pre-stage it), surface the ambiguity in the returned output or a short note to the caller — do not invoke a platform question tool.

Callers that need to ask the user are responsible for using their own platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini) before or after invoking this skill.
