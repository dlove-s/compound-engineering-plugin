---
name: ce:polish-beta
description: "[BETA] Human-in-the-loop polish phase. Runs after /ce:review and before merge: pulls a PR/branch, verifies review+CI green, starts the dev server from .claude/launch.json, hands off to the host IDE's embedded browser, generates a testable checklist, and dispatches polish sub-agents for fixes. Refuses to batch oversized work — emits stacked-PR seeds. Ship a PR through polish, then merge."
disable-model-invocation: true
argument-hint: "[PR number, PR URL, branch name, or blank for current branch] [mode:headless] [trust-fork:1] [accept-stale-review:1] [allow-port-kill:1]"
---

# Polish

Polish is the **second human-in-the-loop moment** in the compound-engineering flow — paired with `/ce:brainstorm` (WHAT to build). Polish answers *does this feel right to a real user?* It runs after `/ce:review` has greenlit correctness, security, and structure, but before merge.

Polish does not fix bugs — that is what review + work already did. Polish refines UX, perceived speed, visual craft, and the small things you only notice by *using* the feature as the end user. Sub-agents apply the fixes the human flags. The human never types fix directives blind; the skill generates a testable checklist from the diff and the human annotates it.

## When to Use

- A PR has green CI and a `Ready to merge` or `Ready with fixes` verdict from `/ce:review`
- You want to experience the change as an end user before merging
- You want automation to apply the craft fixes you flag while you keep testing

Do **not** use polish to find bugs that review missed — re-run `/ce:review` or add tests. Polish is post-review refinement, not a second bug hunt.

## Argument Parsing

Parse `$ARGUMENTS` for the following optional tokens. Strip each recognized token before interpreting the remainder as the PR number, GitHub URL, branch name, or blank (current branch).

| Token | Example | Effect |
|-------|---------|--------|
| `mode:headless` | `mode:headless` | Programmatic mode for pipelines (LFG, future chains). Emits structured envelope, never prompts interactively, does not dispatch fix sub-agents. See Mode Detection below. |
| `trust-fork:1` | `trust-fork:1` | Explicit trust override for PRs from forks. Required for cross-repository PRs before any server command runs. Printing the PR author + head repo precedes acceptance. |
| `accept-stale-review:1` | `accept-stale-review:1` | Accept a review artifact whose SHA is an ancestor of HEAD (i.e., the branch has additional commits beyond what was reviewed). Without this token, the entry gate refuses partial-coverage artifacts. |
| `allow-port-kill:1` | `allow-port-kill:1` | Headless mode only — allow killing a process bound to the dev-server port without interactive confirmation. In interactive mode, the user is always asked and this token is ignored. |
| `plan:<path>` | `plan:docs/plans/2026-04-15-001-feat-ce-polish-skill-plan.md` | Use this plan as the checklist generation context (originating requirements/test surfaces) and as the replan-seed target if batch escalation fires. |

All tokens are optional. Tokens not listed here are deferred — emit an unknown-token error envelope rather than silently ignoring them.

**Conflicting mode flags:** If multiple `mode:*` tokens appear (e.g., `mode:headless mode:autonomous`), stop without dispatching. If `mode:headless` is one of them, emit the headless error envelope: `Polish failed (headless mode). Reason: conflicting or unknown mode flags — <list>. Only mode:headless is implemented in v1.` Otherwise emit the generic form.

**Unknown tokens:** `mode:autonomous`, `mode:report-only`, and any other `mode:<value>` outside the table above are unknown in v1. Emit an unknown-mode error envelope and stop before any state changes.

## Mode Detection

| Mode | When | Behavior |
|------|------|----------|
| **Interactive** (default) | No mode token present | Full polish loop: gate checks, start dev server, generate checklist, hand to user via edit-file-then-ack, dispatch fix sub-agents, repeat until user replies `done`. |
| **Headless** | `mode:headless` in arguments | Programmatic mode. Run all gate checks, generate `checklist.md` once, emit structured envelope, exit. Never waits for user edits, never dispatches fix sub-agents. The caller re-invokes interactively (or consumes the envelope itself) to complete the loop. |

### Headless mode rules

- **Skip all user questions.** Never use the platform's question tool or any interactive prompt. Fork-PR trust, stale-review acceptance, port-kill, and `launch.json` stub-write all require their explicit tokens (`trust-fork:1`, `accept-stale-review:1`, `allow-port-kill:1`, existing `.claude/launch.json`) — absence is treated as "refuse" and emitted as a structured failure envelope.
- **Require a determinable target.** If headless mode has no PR number, no branch, and the current branch is the default/base branch, emit `Polish failed (headless mode). Reason: no target — provide a PR number, branch name, or re-invoke from a feature branch.` and stop.
- **Dispatch nothing on unreachable preconditions.** Missing review artifact, failing CI, dirty worktree, missing dev-server config → emit a structured failure envelope and stop. Never silently fall back.
- **Do not switch a shared checkout.** Same constraint as `ce:review` headless: if the target is a different branch or PR that isn't already checked out in an isolated worktree, emit `Polish failed (headless mode). Reason: cannot switch shared checkout. Re-invoke from the target worktree.`
- **Stop after emitting the envelope** with `Polish complete` as the terminal signal so callers detect completion.

## Phase 0: Input Triage

Before touching anything else, parse arguments and validate them:

1. **Strip recognized tokens** from `$ARGUMENTS`. Collect them into a flags set (`headless`, `trust_fork`, `accept_stale_review`, `allow_port_kill`, `plan_path`).
2. **Detect unknown `mode:*` tokens.** If any `mode:<value>` appears that is not in the argument table, emit the unknown-mode envelope and stop.
3. **Detect conflicting mode flags.** If more than one `mode:*` token is present, emit the conflicting-mode envelope and stop.
4. **Classify the remaining target** (what's left after stripping tokens):
   - Matches `^[0-9]+$` → PR number
   - Matches `^https://github.com/[^/]+/[^/]+/pull/[0-9]+$` → PR URL (extract number)
   - Non-empty otherwise → branch name
   - Empty → current branch (resolve via `git branch --show-current` later; defer until Phase 1)
5. **Echo the parsed intent** in interactive mode:
   ```
   Polish target: <PR #123 | branch feat/x | current branch>
   Flags: <headless=0> <trust_fork=0> <accept_stale_review=0> <plan=docs/plans/...>
   ```
   Headless mode does not echo in Phase 0 — the envelope emitted at Phase 6 carries final state.

Phase 0 must complete without any state changes. No `git checkout`, no `gh pr view`, no server probes. On unknown/conflicting tokens, exit here before anything mutable.

## Phase 1: Branch / PR Acquisition

Get the code the human is polishing onto disk without silently switching a shared checkout. State machine discipline: re-read `git branch --show-current` after every checkout or attach and never carry an earlier value forward.

### Pre-check: worktree must be clean

Before any checkout, run:

```
git status --porcelain
```

If the output is non-empty:
- **Interactive:** "You have uncommitted changes on the current branch. Stash or commit them before polishing a PR/branch, or run without an argument to polish the current branch as-is."
- **Headless:** emit `Polish failed (headless mode). Reason: dirty worktree. Stash or commit changes, or re-invoke with no target to polish the current branch.`

Either way, stop without any checkout.

### Target: PR number or PR URL

1. Fetch metadata:
   ```
   gh pr view <number-or-url> --json url,headRefName,baseRefName,headRepositoryOwner,state,mergeable,isCrossRepository,author
   ```
2. If `state` is `MERGED` or `CLOSED`: "PR not open, nothing to polish." Stop. (Headless: structured failure envelope.)
3. Probe for an existing worktree with the head branch:
   ```
   git worktree list --porcelain
   ```
   Parse the `worktree <path>` / `branch refs/heads/<headRefName>` pairs. If the head branch is already attached to a worktree:
   - Attach by `cd`-ing into that worktree (announce the path: "Attached to existing worktree at <path>"). Never re-checkout over it.
4. Otherwise run:
   ```
   gh pr checkout <number-or-url>
   ```
5. After any checkout or attach, re-read the current branch and verify it matches `headRefName`. If they diverge, stop with a state-machine-violation error — this always indicates an unexpected side effect.

In **headless mode**, shared-checkout switching is forbidden. If the PR head branch is neither the current branch nor already attached to a worktree, emit `Polish failed (headless mode). Reason: cannot switch shared checkout. Re-invoke from the target worktree.` and stop. Same rule as `ce:review` headless.

Cache the PR metadata (number, URL, author, head repo owner, `isCrossRepository`, head/base branch names, PR body) for Phase 2's fork-PR trust check and later checklist generation.

### Target: branch name

1. Probe for an existing worktree (same command as above). If the branch is in a worktree: attach, do not re-checkout.
2. Otherwise: `git checkout <branch>`.
3. Re-read `git branch --show-current` after the checkout.

No PR metadata is fetched by default for bare-branch targets. Phase 2's CI check still attempts `gh pr checks <branch>` — if no PR exists for the branch, that check degrades to "no CI signal; ask user to confirm readiness" in interactive mode and fails in headless mode.

### Target: blank (current branch)

1. Resolve base branch:
   ```
   RESOLVE_OUT=$(bash references/resolve-base.sh) || { echo "ERROR: resolve-base.sh failed"; exit 1; }
   if [ -z "$RESOLVE_OUT" ] || echo "$RESOLVE_OUT" | grep -q '^ERROR:'; then echo "${RESOLVE_OUT:-ERROR: resolve-base.sh produced no output}"; exit 1; fi
   BASE=$(echo "$RESOLVE_OUT" | sed 's/^BASE://')
   ```
2. Verify the current branch is not the resolved base branch itself. If `git branch --show-current` equals the base branch name from `resolve-base.sh`, polish refuses: "Polish runs on feature branches, not on the base branch. Switch to a feature branch or provide a PR number." (Headless: structured failure.)
3. Attempt `gh pr view --json url,headRefName,baseRefName,...` to pick up PR metadata for the current branch opportunistically. If no PR exists, continue — the absence is expected when polishing a pre-PR feature branch. Record "no PR metadata available" in the run state so Phase 5's checklist generation can skip PR-body-based inputs.

### State after Phase 1

By the end of Phase 1, the skill holds:
- `polish_target_kind` ∈ {`pr`, `branch`, `blank`}
- `current_branch` (freshly re-read after any checkout)
- `base_branch` (from `resolve-base.sh` or PR metadata)
- `pr_meta` (object or null)
- `attached_worktree_path` (path or null — set when Phase 1 attached rather than re-checked-out)

These values feed Phase 2's entry gate. Nothing state-mutating has happened beyond the checkout / attach; no server has started, no artifacts have been read.

## Phase 2: Entry Gate

Polish is post-review refinement, not a second bug hunt. The entry gate proves that `/ce:review` already greenlit this branch at its current SHA and that CI is green. Any failure here stops the skill before a dev server starts, before a checklist is generated, before any sub-agent is dispatched.

All four gate checks must pass. Failures are reported in the same order the checks run, so users see the upstream blocker first rather than chasing a downstream symptom.

### 2.1 Fork-PR trust boundary

This check only applies when `polish_target_kind == "pr"` and Phase 1 cached `pr_meta.isCrossRepository == true`. Skip otherwise.

Polish runs untrusted code from a fork through the dev server, the host browser, and sub-agent fix dispatch. A fork PR can contain arbitrary JavaScript, build scripts, or migration code that the author never ran themselves. Require explicit trust before going any further.

1. Print the author and head repo so the decision is explicit, not implicit:
   ```
   Fork PR detected.
   Author: <pr_meta.author.login>
   Head:   <pr_meta.headRepositoryOwner.login>/<repo>
   Base:   <pr_meta.baseRefName>
   ```
2. **Interactive:** ask (using the platform's blocking question tool — `AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, or present numbered options and wait for reply) whether to trust this fork PR for polish. Options: **Trust and continue**, **Stop**. Stop unless the user chooses trust.
3. **Headless:** require `trust-fork:1` in arguments. If not set, emit `Polish failed (headless mode). Reason: fork PR requires explicit trust — re-invoke with trust-fork:1 to acknowledge.` and stop. If `trust-fork:1` is set, log the trust decision to the run artifact and continue.

Same-repo branch PRs and bare-branch / current-branch targets skip this check — the author-vs-repo-owner trust boundary only exists for cross-repository PRs.

### 2.2 Review artifact discovery and SHA binding

Polish must only run on code that `/ce:review` greenlit. Discover the matching review artifact and verify it still describes the current branch state.

1. **Locate the artifact directory.** Look under `.context/compound-engineering/ce-review/` for the most recent run directory (sort by directory name — `ce:review` uses `YYYYMMDD-HHMMSS-<hex>` prefixes, so lexical sort matches chronological sort).
   - If the directory is missing or empty: `No ce:review artifact found. Run /ce:review before polishing, or the review artifact has been cleaned up from the current worktree.` (Headless: structured failure.) Stop.
2. **Read `metadata.json` from the latest artifact.**
   - If `metadata.json` is missing (pre-2026-04-15 artifacts predate the metadata file), fall back to the directory mtime: warn the user in interactive mode (`Review artifact predates metadata.json. Falling back to directory mtime for freshness only — SHA/branch binding cannot be verified.`) and continue only after explicit confirmation. In headless mode without metadata, require `accept-stale-review:1` to continue; without it, emit `Polish failed (headless mode). Reason: review artifact missing metadata.json. Re-run /ce:review or pass accept-stale-review:1 to skip SHA binding.`
   - If `metadata.json` is present, continue with the structured checks below.
3. **Verify branch match.** Compare `metadata.branch` to Phase 1's `current_branch`. If they differ, the most recent review is for a different branch entirely:
   - `Latest ce:review artifact is for branch <metadata.branch>, not <current_branch>. Run /ce:review on this branch before polishing.` Stop.
4. **Verify SHA binding.** Compare `metadata.head_sha` to `git rev-parse HEAD`:
   - **Equal:** artifact matches HEAD exactly — pass.
   - **Artifact SHA is an ancestor of HEAD** (the branch has additional commits beyond what was reviewed): the review covered earlier commits but new commits are unreviewed. Run:
     ```
     git merge-base --is-ancestor <metadata.head_sha> HEAD
     ```
     Exit code 0 means ancestor. In that case:
     - **Interactive:** warn (`Review artifact is stale — N commits have been added since /ce:review ran. Commits: <git log --oneline metadata.head_sha..HEAD>`) and ask: **Re-run /ce:review**, **Continue anyway**, **Stop**. Re-run restarts this phase after the new review lands; continue marks the run as stale-accepted; stop exits.
     - **Headless:** require `accept-stale-review:1`. Without it, emit `Polish failed (headless mode). Reason: review artifact is an ancestor of HEAD — N unreviewed commits. Re-run /ce:review or pass accept-stale-review:1.` With it, log the stale acceptance and continue.
   - **Neither equal nor ancestor:** the artifact is from a divergent history (different branch tip, reset, or force-push). `Review artifact SHA <metadata.head_sha> is not an ancestor of HEAD — history has diverged. Run /ce:review again.` Stop without offering an override.
5. **Record the resolved artifact path** in run state: `review_artifact_dir`, `review_metadata` (object), `review_stale_accepted` (bool). Later phases consume these.

### 2.3 Verdict check

Read `metadata.verdict`:
- `Ready to merge` — pass.
- `Ready with fixes` — pass, but record in run state so the checklist generator in Phase 5 can prepend review-suggested follow-ups.
- `Not ready` — stop. Polish refines what review greenlit; if review did not greenlight, the branch needs work (not polish). Interactive: `Last review verdict was "Not ready". Address the review findings with /ce:work, then re-run /ce:review, then come back to polish.` Headless: `Polish failed (headless mode). Reason: last review verdict was "Not ready".` Stop in both modes.
- Any other value (malformed artifact): treat as `Not ready` and stop with a diagnostic naming the verdict value found.

### 2.4 CI status

A green review is not sufficient — the branch also needs green CI so polish is not masking a build/test regression introduced after review.

1. **PR target:** run `gh pr checks <pr-number>`.
2. **Branch target:** run `gh pr checks <branch-name>`. If no PR exists for the branch:
   - **Interactive:** warn (`No PR exists for this branch — no CI signal available.`) and ask: **Continue without CI signal**, **Stop and open a PR first**. If user continues, record `ci_signal: "none"` in run state.
   - **Headless:** fail with `Polish failed (headless mode). Reason: no CI signal — open a PR for this branch before polishing in headless mode.` Stop.
3. **Current-branch target without PR metadata:** same behavior as bare-branch-without-PR above.

Parse the output:
- All checks `pass` or `skipped` → pass.
- Any check `fail` → stop. `CI has failing checks: <comma-separated names>. Fix them before polishing.` (Headless: structured failure.)
- Any check `pending` → in interactive mode, offer **Wait and recheck**, **Continue anyway** (record `ci_signal: "pending"`), **Stop**. In headless mode, stop with `Polish failed (headless mode). Reason: CI has pending checks — wait for completion before re-invoking.`

### 2.5 Merge base into branch (optional)

Polish on an out-of-date branch may surface conflicts or regressions that belong to the base branch, not the feature. Offering to merge the base branch in before polish keeps the dev-server experience faithful to what will actually ship.

This is **optional** and always runs with user consent:

1. Compute how many commits behind base the branch is:
   ```
   git fetch origin <base_branch>
   AHEAD_BEHIND=$(git rev-list --left-right --count HEAD...origin/<base_branch>)
   BEHIND=$(echo "$AHEAD_BEHIND" | awk '{print $2}')
   ```
2. If `BEHIND == 0`: branch is up to date — record `merge_base_action: "not_needed"` and continue.
3. If `BEHIND > 0`:
   - **Interactive:** ask: **Merge origin/<base_branch> into branch (recommended)**, **Skip**. If user merges, run `git merge origin/<base_branch> --no-edit`. On conflict, abort the merge (`git merge --abort`), report the conflicting paths, and stop: `Merge conflict against origin/<base_branch>. Resolve conflicts and re-run polish.` On clean merge, record `merge_base_action: "merged"`.
   - **Headless:** never merge. Headless mode must not introduce new commits unprompted. Record `merge_base_action: "skipped_headless"` and continue — the stale-branch risk was already accepted by the caller when they invoked headless.

### State after Phase 2

By the end of Phase 2 the skill holds, in addition to Phase 1 state:
- `trust_decision` ∈ {`not_applicable`, `trusted`, `stopped`} (stopped cases never reach here)
- `review_artifact_dir` (path)
- `review_metadata` (parsed metadata.json or `null` for pre-metadata fallback)
- `review_stale_accepted` (bool)
- `verdict` ∈ {`Ready to merge`, `Ready with fixes`}
- `ci_signal` ∈ {`pass`, `skipped`, `none`, `pending`}
- `merge_base_action` ∈ {`not_needed`, `merged`, `skipped_headless`, `skipped_user`}

All four gate checks (2.1 fork trust, 2.2 SHA binding, 2.3 verdict, 2.4 CI) passed. Phase 3 can safely start the dev server.

## Phase 3: Dev-Server Lifecycle

With the entry gate passed, start a dev server the human can use. Polish leads with user-authored `.claude/launch.json` (explicit, trust-bounded, portable across IDEs), falls back to per-framework auto-detect when absent, and offers to persist a stub so subsequent runs are deterministic.

### 3.1 Resolve start command from `.claude/launch.json`

Run the launch.json reader:

```bash
bash scripts/read-launch-json.sh
```

Interpret the output:

| Output | Meaning | Action |
|--------|---------|--------|
| Single-line JSON object | Valid single configuration | Use it verbatim (see 3.3). |
| `__MULTIPLE_CONFIGS__` followed by a JSON array of names | More than one configuration defined | **Interactive:** ask the user to pick by name (blocking question tool — `AskUserQuestion` / `request_user_input` / `ask_user`). Re-invoke `bash scripts/read-launch-json.sh <chosen-name>`. **Headless:** emit `Polish failed (headless mode). Reason: .claude/launch.json has multiple configurations — author a single config or re-invoke interactively to pick.` and stop. |
| `__NO_LAUNCH_JSON__` | File does not exist | Fall through to 3.2 (auto-detect). |
| `__INVALID_LAUNCH_JSON__` | File exists but parses fail | Stop. `.claude/launch.json exists but is malformed. Fix the JSON and re-run polish — polish will not silently fall back from a broken explicit config.` (Headless: structured failure with same reason.) |
| `__MISSING_CONFIGURATIONS__` | Valid JSON, no `configurations` array | Same as `__NO_LAUNCH_JSON__` — treat as "no launch.json" and auto-detect. |
| `__CONFIG_NOT_FOUND__` | User-supplied name didn't match any configuration | **Interactive:** re-ask with the name list. **Headless:** structured failure. |

Schema details and stub templates live in `references/launch-json-schema.md`.

### 3.2 Auto-detect fallback (when launch.json is absent)

Run the project-type detector:

```bash
bash scripts/detect-project-type.sh
```

Output is a single token or compound value:
- `<type>` — single match at root (e.g., `next`, `rails`)
- `<type>@<cwd>` — single monorepo hit (e.g., `next@apps/web`)
- `multiple` — multiple disjoint root signatures
- `multiple:<type>@<cwd>,<type>@<cwd>,...` — multiple monorepo hits

| Output | Reference file | Behavior |
|--------|----------------|----------|
| `rails` | `references/dev-server-rails.md` | Load reference, use `bin/dev` at port 3000 (adjust via cascade). |
| `next` | `references/dev-server-next.md` | Load reference, use detected pm at port 3000. |
| `vite` | `references/dev-server-vite.md` | Load reference, use detected pm at port 5173. |
| `nuxt` | `references/dev-server-nuxt.md` | Load reference, use detected pm at port 3000. |
| `astro` | `references/dev-server-astro.md` | Load reference, use detected pm at port 4321. |
| `remix` | `references/dev-server-remix.md` | Load reference, use detected pm at port 3000. |
| `sveltekit` | `references/dev-server-sveltekit.md` | Load reference, use detected pm at port 5173. |
| `procfile` | `references/dev-server-procfile.md` | Load reference, use `overmind start -f Procfile.dev` (or foreman fallback) at port 3000. |
| `multiple` | — | **Interactive:** ask the user to disambiguate (which framework runs the polish-facing dev server?). **Headless:** `Polish failed (headless mode). Reason: multiple project-type signatures detected. Author .claude/launch.json to disambiguate.` Stop. |
| `unknown` | — | **Interactive:** ask the user for `runtimeExecutable` + `runtimeArgs` + `port` explicitly. **Headless:** `Polish failed (headless mode). Reason: unknown project type. Author .claude/launch.json.` Stop. |

When the detector returns `<type>@<cwd>`, route by `<type>` as usual and carry `<cwd>` into the stub-writer for Phase 3.3. When the detector returns `multiple:<type1>@<cwd1>,<type2>@<cwd2>,...`, the interactive prompt lists the `<type>@<cwd>` pairs and asks the user to pick one; headless mode emits `Polish failed (headless mode). Reason: multiple project-type signatures detected: <type1>@<cwd1>, <type2>@<cwd2>. Author .claude/launch.json to disambiguate.` and stops.

For port resolution, call `scripts/resolve-port.sh` (see `references/dev-server-detection.md` for probe order and framework defaults).

### 3.3 Offer to persist a `launch.json` stub

Only runs when 3.2 produced the working command (not when 3.1 already found one — no point writing back what already exists).

1. **Interactive:** ask (blocking question tool): `Save this as .claude/launch.json for future runs? It will pin <runtimeExecutable> + <runtimeArgs> + port <port> so polish skips auto-detect next time.` Options: **Save**, **Skip**.
2. **Headless:** never write. The caller invoked headless for automation, not for repo-state mutation. Record `launch_json_stub_action: "skipped_headless"`.
3. On **Save** (interactive only):
   - Render the stub template from `references/launch-json-schema.md` matching the detected project type.
   - For Next/Vite/Nuxt/Astro/Remix/SvelteKit stubs, call `scripts/resolve-package-manager.sh` (passing `<cwd>` as the positional arg when detector emitted `<type>@<cwd>`) and substitute the emitted binary and args into `runtimeExecutable` / `runtimeArgs`.
   - Call `scripts/resolve-port.sh [<cwd>] --type <type>` and substitute the emitted port.
   - When the detector emitted `<type>@<cwd>`, populate the stub's `cwd` field with that value.
   - Write to `<repo-root>/.claude/launch.json`. Create `.claude/` if missing.
   - Record `launch_json_stub_action: "written"`.

### 3.4 Kill existing listener on the target port (with consent)

Before starting the server, check whether another process is already bound to the port — often a stale dev server from a previous session.

1. Probe (one-shot, no chaining):
   ```bash
   lsof -i :<port> -t
   ```
   Empty output: port is free, skip to 3.5.
2. Non-empty output: at least one PID. Look up the process name:
   ```bash
   ps -p <pid> -o comm=
   ```
3. **Interactive:** ask: `Kill existing listener on port <port> (PID <pid>, command <name>)?` Options: **Kill**, **Stop**. On **Kill**: `kill <pid>`; re-probe after 1 second; if still bound, ask once more: `Process did not exit. Force-kill (SIGKILL)?` Options: **Force-kill**, **Stop**. On **Force-kill**: `kill -9 <pid>`. On any **Stop**: report `Cannot continue without a free dev-server port.` and exit.
4. **Headless:** require `allow-port-kill:1`. Without it, emit `Polish failed (headless mode). Reason: port <port> is in use (PID <pid>, <name>). Re-invoke with allow-port-kill:1 to auto-kill.` and stop. With it: `kill <pid>`; re-probe; if still bound, `kill -9 <pid>` (no second prompt — the token authorized force-kill as well).

### 3.5 Start the server in the background

Prepare the run-artifact directory and log path:

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' ')
mkdir -p ".context/compound-engineering/ce-polish/$RUN_ID"
SERVER_LOG=".context/compound-engineering/ce-polish/$RUN_ID/server.log"
```

Start the server via the platform's background primitive:
- **Claude Code:** `Bash(..., run_in_background=true)` with stdout+stderr redirected to `$SERVER_LOG`.
- **Codex / platforms without a background primitive:** ask the user to start the server in another terminal and paste back `PID` and confirm the port. Record `server_start_mode: "user-started"`.

Record the PID:
```bash
SERVER_PID=<pid-from-background-launch>
```

Probe reachability for up to 30 seconds:
```bash
for i in $(seq 1 30); do
  if curl -sfI "http://localhost:<port>" >/dev/null; then
    break
  fi
  sleep 1
done
```

If the probe never succeeds:
- **Interactive:** tail the last 20 lines of `$SERVER_LOG`, show to user, ask whether to retry or exit.
- **Headless:** emit `Polish failed (headless mode). Reason: dev server at :<port> did not become reachable in 30s. Log tail: <last 5 lines>.` and stop.

On success, report:
```
Dev server: <SERVER_PID> on :<port> (logs: <SERVER_LOG>)
```

Record `server_pid`, `server_port`, `server_log_path` in run state.

### 3.6 Host IDE detection and browser handoff

Load `references/ide-detection.md` for the env-var probe table and per-IDE open instructions.

Probe env vars inline:

```bash
if [ -n "${CLAUDE_CODE:-}" ]; then
  IDE="claude-code"
elif [ -n "${CURSOR_TRACE_ID:-}" ]; then
  IDE="cursor"
elif [ "${TERM_PROGRAM:-}" = "vscode" ]; then
  IDE="vscode"
else
  IDE="none"
fi
```

Emit the IDE-specific open instruction from the detection reference. On `IDE=none`, print the URL verbatim. Detection failure is never fatal — the server is running either way.

Record `ide: <claude-code|cursor|vscode|none>` in run state.

### State after Phase 3

In addition to Phase 2 state, the skill holds:
- `launch_json_source` ∈ {`explicit`, `auto-detect-stub-written`, `auto-detect-stub-skipped`, `user-prompted`}
- `dev_server_config` (object: runtimeExecutable, runtimeArgs, port, cwd, env)
- `server_pid`, `server_port`, `server_log_path`
- `server_start_mode` ∈ {`background`, `user-started`}
- `ide` ∈ {`claude-code`, `cursor`, `vscode`, `none`}
- `run_id`, `run_artifact_dir` (`.context/compound-engineering/ce-polish/<run-id>/`)

Phase 4 generates the checklist from the diff and hands it to the user.

## Phase 4: Checklist + Size Gate + Dispatch

Phase 4 is the user-facing core. The dev server is running (Phase 3), the
entry gate passed (Phase 2), and the branch is on disk (Phase 1). Now:

1. Classify the diff surfaces and generate a user-editable checklist.
2. Apply the three-tier size gate (per-item oversized classification, per-item
   `replan` action, per-batch preemptive check).
3. Hand the checklist to the user via edit-file-then-ack.
4. On `ready`, re-parse, dispatch sub-agents for `fix` items, write stacked-PR
   seeds for `stacked` items, and loop.
5. Exit on `done` or when an escalation trigger fires.

Headless mode short-circuits after step 1: polish emits the checklist, writes
any stacked-PR seeds that pin on generation, emits the envelope, and stops
without dispatching.

### 4.1 Extract surfaces from the diff

Run surface extraction against the base branch resolved in Phase 1:

```bash
SURFACES_JSON=$(bash scripts/extract-surfaces.sh "$BASE")
```

`SURFACES_JSON` is a JSON array of `{file, surface}` objects covering every
file in `git diff --name-only $BASE...HEAD`. An empty diff (`[]`) is a
terminal state — report `Nothing to polish — branch has no diff against
$BASE.` and stop. Headless emits the same reason in the envelope.

### 4.2 Group files into checklist items

Polish does not present one item per file — that would be too granular and
would hide oversized batches behind many small items. Group files into items
using two inputs:

1. **PR body (when available).** If the PR body contains markdown headings
   (`## <heading>` or `### <heading>`), treat each heading as a candidate
   item. Assign each changed file to the heading whose body text names the
   file, directory, or component most specifically. Files unclaimed by any
   heading fall into an "Uncategorized" item.
2. **Plan units (when `plan:<path>` was passed).** Read the plan's
   `Implementation Units` section. Each unit becomes a candidate item; files
   listed under the unit's `Files` field assign to that unit.

When both are available, plan units take precedence over PR-body headings —
the plan is more structured and was the planning-time artifact of record.

If neither is available (no PR metadata in Phase 1, no `plan:` token), fall
back to surface-based grouping: one item per dominant surface category
(view, controller, model, api), plus one item per non-dominant surface that
has 2+ files. `test`, `config`, and `asset` surfaces collapse into per-parent-
directory groups (e.g., all `config/*` in one item).

Item titles derive from:
- PR/plan heading when applicable
- The item's dominant file's basename + surface otherwise (e.g.,
  `Polish users_controller.rb (controller)`)

### 4.3 Classify each item

For each item, call the classifier with the item's file list:

```bash
ITEM_FILES=$(jq -c --arg t "<title>" '[.[] | select(.title == $t)] | map({file, surface})' <<< "$ITEMS_WITH_FILES")
CLASSIFICATION=$(bash scripts/classify-oversized.sh "$BASE" "$ITEM_FILES")
```

`CLASSIFICATION` returns `{status, reason, file_count, surface_count, diff_lines}`.
Merge `status` and `reason` into the item and record the raw counts for the
stacked-PR seed template.

### 4.4 Pin actions from status

Default actions per the checklist template:

| Status | Default action | User may change to |
|--------|---------------|--------------------|
| `manageable` (feature surface) | `fix` | `keep`, `skip`, `note`, `replan` |
| `manageable` (test/config/asset) | `keep` | `skip`, `note`, `fix` (rare — dev explicitly wants to polish config) |
| `oversized` | `stacked` (pinned) | Cannot change — parser rejects |

### 4.5 Generate checklist.md

Render the checklist using `references/checklist-template.md` as the schema.
Write it to the run artifact directory:

```bash
CHECKLIST_PATH="$RUN_ARTIFACT_DIR/checklist.md"
# ...render from template with per-item filled fields...
```

Also pre-write any stacked-PR seed files for items classified `oversized` at
generation time, one per oversized item:

```bash
for i in <each oversized item>; do
  SEED_PATH="$RUN_ARTIFACT_DIR/stacked-pr-$i.md"
  # ...render stacked-pr-seed-template.md with filled frontmatter + body...
done
```

Rendering the seed files at generation time (not after user ack) means the
user can read them alongside the checklist when deciding what to do.

### 4.6 Preemptive batch check

Before handing the checklist to the user, run the batch-preemptive check:

| Trigger | Condition | Result |
|---------|-----------|--------|
| `batch_diff_preemptive` | total files across all items > 30, OR total diff lines > 1000 | Write replan seed, skip to 4.10 |
| `majority_oversized` | oversized item count > (total items / 2) | Write replan seed, skip to 4.10 |
| (no `replan_actions` check here — that trigger only fires after user edits) | — | — |

If any preemptive trigger fires, render `replan-seed.md` using
`references/replan-seed-template.md`, report it to the user (interactive) or
emit it in the envelope (headless), and stop without dispatch.

### 4.7 Hand the checklist to the user (edit-file-then-ack)

**Interactive mode only.** Print:

```
Polish checklist ready: <CHECKLIST_PATH>

Edit the file to set each item's `action`, then reply:
  ready  — re-read the checklist and dispatch
  done   — end polish without further dispatch
  cancel — end polish and do not commit any pending work
```

Use the platform's question tool (`AskUserQuestion` / `request_user_input` /
`ask_user`) or fall back to reading user input as a text reply. The three
replies are the only accepted inputs — anything else re-prompts with the
same three options.

**Headless mode** skips this step entirely. The checklist as generated is the
final state; polish never re-reads it.

### 4.8 On `ready` — parse and validate

```bash
PARSED_JSON=$(bash scripts/parse-checklist.sh "$CHECKLIST_PATH")
```

The parser validates allowed actions, allowed statuses, and the pinning rule
(oversized items must remain `stacked`). On parse error, the parser prints
line-numbered messages to stderr and exits non-zero. Polish reports those
errors verbatim and re-prompts for the next ack — the user fixes the file
and replies `ready` again. The dev server keeps running; the parse loop
does not restart the entry gate.

### 4.9 Apply batch-preemptive check again (post-edit)

After successful parse, re-run the batch check with the user's edits applied.
The third trigger is now live:

| Trigger | Condition |
|---------|-----------|
| `batch_diff_preemptive` | (same as 4.6) |
| `majority_oversized` | (same as 4.6) |
| `replan_actions` | count of items with `action == "replan"` >= 3 |

Any trigger firing writes the replan seed and skips to 4.10. Per-item
`action: stacked` (authored by the user against generator default `fix`
when the user judges an item too big even though classifier missed it) is
also allowed — those rewrite the per-item stacked seed with
`user_judgment: yes` in the frontmatter.

### 4.10 Dispatch sub-agents (interactive, post-ack)

**Headless mode** never reaches 4.10 — it stopped at 4.6/4.7. The rest of
this section is interactive-only.

1. **Partition items by action:**
   - `fix` → dispatch per 4.11
   - `stacked` → seed file was written at 4.5 or 4.9; no dispatch, log only
   - `replan` → replan seed written at 4.9; dispatch halts for the run
   - `note` → append the item's notes to the run artifact's `dispatch-log.json`; no agent dispatch
   - `keep`, `skip` → no-op

2. **If 4.9 wrote a replan seed, skip to 4.12.** The user has already been
   told polish is stopping for this batch; do not dispatch any sub-agents
   even for `fix` items in the same checklist.

### 4.11 Sub-agent dispatch

Load `references/subagent-dispatch-matrix.md` for the surface → agent map.

**Grouping:** Union items whose file sets intersect (file-collision safety).
Each disjoint group dispatches sequentially internally (one item at a time).
Independent groups dispatch in parallel when there are 5 or more disjoint
groups; below that, dispatch sequentially to keep output legible.

**Per-item prompt:** Build the sub-agent prompt from:
- Item title, files, notes
- Dev server URL: `http://localhost:$SERVER_PORT`
- Plan path (if `plan:<path>` was provided)

**Agent selection:** Primary agent from the surface map; supplement with
override agents when item notes match keyword triggers (see dispatch matrix).

Each dispatched item appends an entry to `dispatch-log.json`:

```json
{
  "item_id": <N>,
  "title": "<title>",
  "agent": "compound-engineering:<cat>:<name>",
  "group_id": <N>,
  "started_at": "<ISO>",
  "completed_at": "<ISO>",
  "result": "success|failed|timeout",
  "summary": "<agent's final message>"
}
```

### 4.12 Loop back to 4.7

After dispatch completes (or 4.9 halted dispatch for a replan), re-emit the
ack prompt:

```
Dispatch round <N> complete. <M> items fixed, <K> noted, <O> stacked seeds.
Re-read or edit the checklist, then reply: ready | done | cancel
```

`ready` → re-parse (4.8). The classifier and dispatch run again on the
re-edited checklist — the user may flip items that were previously `keep` to
`fix` as they discover issues while polishing.

`done` → exit the loop, proceed to Phase 5.

`cancel` → exit the loop, roll back any uncommitted changes from this
dispatch round (`git checkout .` — only the files polish touched via
sub-agents), report what was rolled back, proceed to Phase 5's cleanup.

### State after Phase 4

In addition to Phase 3 state:
- `run_artifact_dir` populated with `checklist.md`, `dispatch-log.json`,
  zero-or-more `stacked-pr-<n>.md`, optional `replan-seed.md`
- `exit_reason` ∈ {`user_done`, `user_cancel`, `replan_emitted`,
  `nothing_to_polish`}
- `headless_emit_only` (bool) — true when headless stopped at 4.6/4.7

Phase 5 finalizes the envelope, commits (when appropriate), and wraps up.

## Phase 5: Envelope, Artifact, and Workflow Stitching

Phase 5 finalizes the run. It writes the canonical artifact contents,
prepares the commit/PR update for the fixes that landed, and emits the
completion envelope in the shape callers expect. The dev server stays
running unless the user explicitly asks polish to stop it — keeping it up
lets the user verify fixes in the browser after the skill exits.

### 5.1 Write `summary.md` to the run artifact

Render a markdown summary of what happened this run, covering:

- Scope (PR number / branch / current)
- Review artifact path that gated entry
- Dev server PID, port, and log path (still running)
- Per-item disposition: fixed / noted / skipped / stacked / replan
- Stacked-PR seeds emitted (list of `stacked-pr-<n>.md`)
- Replan seed emitted (path or "none")
- Escalation state (`none | replan-suggested | replan-required`)

The summary is human-readable. `dispatch-log.json` is the structured
counterpart consumed by tooling. Both files live in the run artifact dir
alongside `checklist.md` (which evolves across dispatch rounds and reflects
the final state when Phase 5 writes).

### 5.2 Commit fixes (interactive only)

If any `fix` items produced file changes, prompt the user to commit them
using the platform's blocking question tool:

```
Polish produced changes. Commit them now?
  commit  — stage + commit with a polish-scoped message per round
  later   — leave the changes in the worktree; skip to envelope
  discard — roll back all polish-dispatched changes (git checkout . for touched files)
```

On **commit**, build the commit message from the fixed items:

```
polish(ce-polish): <title of item 1>, <title of item 2>, ...

- Item 1: <title> (agent: <agent>)
- Item 2: <title> (agent: <agent>)
...
```

The commit prefix `polish(<scope>)` is a conventional-commit form that keeps
polish commits visually distinct from feature commits. Release automation
can classify them independently if needed in the future.

**Headless mode never commits.** Dispatch never ran (Phase 4 stopped at
4.6/4.7), so there are no fix changes to commit.

### 5.3 Dev-server handoff

The server keeps running after polish exits. Print:

```
Dev server still running: PID <server_pid> on :<server_port>
Log file: <server_log_path>

To stop the server: kill <server_pid>
```

The user may still be browsing; tearing the server down behind them is a
worse default than leaving it up. The PID/log path is durable in
`summary.md` so the user can find it after the skill returns.

### 5.4 Emit the completion envelope

**Interactive mode** — print a concise pipe-delimited report:

```
Polish complete.

Scope:           <PR #123 | branch feat/x | current branch>
Review artifact: <review_artifact_dir>
Dev server:      <server_pid> on :<server_port> (logs: <server_log_path>)
IDE browser:     opened-in:<claude-code|cursor|vscode|none>
Checklist items: <n> total (<k> fixed, <m> skipped, <j> stacked, <r> replan, <u> noted)
Stacked PRs:     <stacked-pr-1.md, stacked-pr-2.md | none>
Replan seed:     <replan-seed.md | none>
Escalation:      <none | replan-suggested | replan-required>
Artifact:        .context/compound-engineering/ce-polish/<run_id>/

Next:            <git push to open for merge | address replan seed | finish the stacked PRs and re-polish>
Polish complete
```

**Headless mode** — emit the same envelope shape, with one deviation: the
`Next:` line is omitted (no interactive guidance in headless), and the
first line is `Polish complete (headless mode).` to match the structural
pattern of ce:review's headless output:

```
Polish complete (headless mode).

Scope:           <...>
Review artifact: <...>
Dev server:      <...>
IDE browser:     <...>
Checklist items: <...>
Stacked PRs:     <...>
Replan seed:     <...>
Escalation:      <...>
Artifact:        .context/compound-engineering/ce-polish/<run_id>/

Polish complete
```

The terminal `Polish complete` signal is on its own line and is the last
output in both modes. Callers (LFG, future pipeline chains) detect it
unconditionally — grep for `^Polish complete$`.

### 5.5 Terminal states

| Exit reason | Envelope variation |
|-------------|--------------------|
| `user_done` | Normal envelope; escalation: `none`; fixed/noted/skipped counts reflect final state |
| `user_cancel` | Normal envelope; `Checklist items` includes per-action counts; summary notes that dispatch was canceled mid-loop |
| `replan_emitted` | Envelope carries `Replan seed: <path>`; escalation: `replan-required`; no dispatch ran after the trigger |
| `nothing_to_polish` | Envelope reports `Checklist items: 0 total`; dev server was still probed so PID/port may still be reported |
| Phase 2 gate failure | Error envelope (see "Error envelope shapes (headless)" below) — no Phase 5 output |
| Phase 3 server failure | Error envelope — no Phase 5 output |

### 5.6 Integration points with the broader workflow

Polish sits between `/ce:review` and merge:

```
/ce:work → /ce:review → /ce:polish-beta → merge
                              ↓
                       (stacked-pr seeds)
                              ↓
                        re-plan / re-brainstorm
```

- **Inputs from `/ce:review`:** the run-artifact directory with
  `metadata.json`. Without it, polish's Phase 2 refuses to run.
- **Outputs consumed downstream:**
  - `stacked-pr-<n>.md` seeds → hand to `/ce:brainstorm` or `/ce:plan` for
    the slice work.
  - `replan-seed.md` → hand to `/ce:plan` (or `/ce:brainstorm` when scope
    framing is still fuzzy) for the whole-branch re-plan.
  - `dispatch-log.json` → future tooling for threshold tuning once enough
    real runs accumulate.
- **No auto-chain:** polish never invokes `/ce:plan` or `/ce:brainstorm`
  itself. The seed files are the handoff; the human (or a future LFG
  chain) decides when to run them.

### State after Phase 5

Run artifact layout:

```
.context/compound-engineering/ce-polish/<run-id>/
├── checklist.md          # final state across all rounds
├── dispatch-log.json     # structured per-item record
├── server.log            # dev-server stdout+stderr
├── summary.md            # human-readable recap
├── stacked-pr-1.md       # zero or more
├── stacked-pr-2.md
└── replan-seed.md        # present only when escalation fired
```

The skill exits. The dev server keeps running until the user kills it.

## Error envelope shapes (headless)

All headless failures follow the same structural pattern so callers can parse them with one regex per shape:

```
Polish failed (headless mode). Reason: <reason>. <remediation>.
Polish complete
```

Examples:
- `Polish failed (headless mode). Reason: conflicting or unknown mode flags — mode:headless mode:autonomous. Only mode:headless is implemented in v1. Re-invoke with only mode:headless.`
- `Polish failed (headless mode). Reason: no target — provide a PR number, branch name, or re-invoke from a feature branch.`

The terminal `Polish complete` signal is emitted on both success and structured failure; callers detect it unconditionally and inspect the preceding `Polish failed` line for errors.

## Included References

Large reference files (loaded on demand via backtick paths above):
- `references/launch-json-schema.md` — launch.json v0.2.0 schema + per-framework stubs
- `references/ide-detection.md` — host IDE detection probes and browser-handoff instructions
- `references/dev-server-detection.md` — port resolution documentation (runtime path is `scripts/resolve-port.sh`)
- `references/dev-server-rails.md` — Rails polish-facing dev-server defaults
- `references/dev-server-next.md` — Next.js polish-facing dev-server defaults
- `references/dev-server-vite.md` — Vite polish-facing dev-server defaults
- `references/dev-server-nuxt.md` — Nuxt polish-facing dev-server defaults
- `references/dev-server-astro.md` — Astro polish-facing dev-server defaults
- `references/dev-server-remix.md` — Remix (classic) polish-facing dev-server defaults
- `references/dev-server-sveltekit.md` — SvelteKit polish-facing dev-server defaults
- `references/dev-server-procfile.md` — Procfile-based polish-facing dev-server defaults
- `references/checklist-template.md` — checklist.md field semantics + allowed actions
- `references/subagent-dispatch-matrix.md` — surface → agent dispatch map + grouping rule
- `references/stacked-pr-seed-template.md` — per-oversized-item seed template
- `references/replan-seed-template.md` — batch-escalation replan seed template

Scripts (invoked via `bash scripts/<name>`):
- `scripts/read-launch-json.sh` — launch.json reader with sentinel outputs
- `scripts/detect-project-type.sh` — project-type classifier (root detection + monorepo probe)
- `scripts/resolve-package-manager.sh` — lockfile-based package-manager resolver
- `scripts/resolve-port.sh` — 8-probe port resolution cascade
- `scripts/extract-surfaces.sh` — diff → surface-category JSON
- `scripts/classify-oversized.sh` — per-item manageable/oversized classifier
- `scripts/parse-checklist.sh` — user-edited checklist.md → structured JSON
- `references/resolve-base.sh` — base-branch resolver (duplicated from ce-review)
