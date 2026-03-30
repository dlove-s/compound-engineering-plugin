---
date: 2026-03-29
topic: vhs-terminal-recording-integration
focus: How VHS (charmbracelet/vhs) terminal recording could be useful in compound-engineering skills — feature-video, commit/PR workflows, or standalone
---

# Ideation: VHS Terminal Recording Integration

## Codebase Context

**Project shape:** Bun/TypeScript monorepo housing the `compound-engineering` Claude Code plugin (~42 skills, review/research/design/docs agents), a CLI that converts plugins to other agent platforms, and marketplace metadata.

**Current state of terminal recording:** VHS is not referenced anywhere in the repo. The `feature-video` skill is browser-only (agent-browser screenshots -> ffmpeg -> MP4 -> GitHub native upload via browser automation). It cannot record terminal interactions at all. The `lfg`/`slfg` pipelines call `feature-video` as their final step, meaning autonomous workflows silently produce nothing for terminal-only features.

**VHS reference implementation:** In `~/Code/open-source/contributor`, VHS is used as Tier 1 evidence for CLI PRs. The pattern: agent generates a `.tape` file declaratively -> runs `vhs` to produce a GIF -> uploads to catbox.moe -> embeds in PR description. Has a strict plan-first approach and evidence tier system (VHS > screen recording > screenshots > simulated demo).

**Relevant existing infrastructure:**
- `git-commit-push-pr` has conditional visual aids (Mermaid diagrams, ASCII art, tables) gated on content patterns, not PR size
- `reproduce-bug` has Route A (test-based) and Route B (browser-based) reproduction paths, but no terminal recording path
- `ce:compound` documents solved problems in `docs/solutions/` with structured templates
- `onboarding` generates ONBOARDING.md from project inventory
- GitHub native video upload requires browser automation (no API); catbox.moe is simpler (curl upload)
- The conditional visual aids framework (added in `44e3e77`) provides a principled model for when/how to include visual content

**Key institutional learnings:**
- GitHub native video upload: only `user-attachments/assets/` URLs render inline; browser automation with `--engine chrome --session-name github` is the only working approach
- Conditional visual aids: trigger on content patterns, not document size; PR descriptions have the highest bar; prose is authoritative over visuals
- Git workflow skills need explicit state machines with re-checked state at each transition

## Ranked Ideas

### 1. Dual-Mode feature-video: Terminal Recording via VHS

**Description:** Extend `feature-video` to detect whether the demo target is terminal or browser. When the PR changes CLI tools, scripts, or terminal output (no affected routes, no UI files), route to VHS: generate a `.tape` file from the planned demo flow, run `vhs` to produce a GIF, upload via catbox.moe, and embed in the PR. The browser path remains unchanged for web features. The `lfg`/`slfg` pipelines automatically benefit without any pipeline modifications.

**Rationale:** Highest-leverage single integration. `feature-video` already has the concept of "plan the flow, record, upload, embed." VHS is a simpler recording backend -- no ffmpeg, no browser auth, no GitHub DOM selectors. The `lfg` pipeline's Step 7 currently silently produces nothing for terminal-only features; this closes that gap. The reference implementation proves the full .tape -> VHS -> GIF -> embed pipeline works end-to-end.

**Downsides:** Increases `feature-video` complexity. Two recording paths mean two failure modes. Different upload mechanisms (catbox.moe for GIF vs. GitHub native for MP4) may confuse users. The skill already has 383 lines; adding a full VHS path could make it unwieldy.

**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

---

### 2. Standalone `vhs-record` Skill

**Description:** A general-purpose skill for on-demand terminal recording. The user says "record a demo of this CLI" or "make a GIF of the test suite." The skill handles the full lifecycle: detect what to record (from user description or branch context), generate the `.tape` DSL, execute VHS, upload the GIF (catbox.moe, or compose with the existing `rclone` skill for S3/R2), and return or embed the URL. Supports iterative refinement -- "adjust the timing" or "add a step" edits the `.tape` and re-runs.

**Rationale:** Not every recording belongs in a PR. README demos, blog post GIFs, bug report evidence, team meeting demos, upstream issue reports -- these all need terminal recordings but don't flow through `git-commit-push-pr` or `feature-video`. A standalone skill serves these cases with zero coupling to existing workflows. Low implementation risk and immediately useful.

**Downsides:** Doesn't compound with existing workflows the way feature-video integration would. If feature-video gets VHS support, there's overlap for the PR use case. Users must discover and invoke it explicitly.

**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

---

### 3. VHS Evidence in `reproduce-bug`

**Description:** Add a terminal evidence route to `reproduce-bug`. When reproducing a CLI-observable bug (failing command, wrong output, crash), generate a `.tape` file from the reproduction steps discovered in the hypothesis phase, run VHS to produce a GIF proving the bug triggers, and attach the GIF to the GitHub issue. The `.tape` file itself becomes a rerunnable reproduction recipe. After the fix, a second tape captures the "after" state.

**Rationale:** `reproduce-bug` has Route A (test-based) and Route B (browser-based) but no terminal recording path. For CLI bugs, the evidence is currently pasted text -- a VHS GIF is both more trustworthy and more scannable. The `.tape` file adds a genuinely new property: it's a rerunnable reproduction script, not just a description. When the fix lands, anyone can re-run the tape to verify.

**Downsides:** Most bugs are reproduced via test assertions, not terminal sessions. VHS adds a tool dependency to a skill that should be lightweight. Generating a good `.tape` requires knowing the exact commands in advance, which may not always be clear during hypothesis testing.

**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

---

### 4. VHS Recordings in `ce:compound` Solution Docs

**Description:** When `ce:compound` documents a solved problem involving terminal-visible behavior (CLI fix, debugging sequence, migration that now works), add an optional recording subagent that generates a `.tape` demonstrating the fix: the broken behavior (before) and the working behavior (after). The GIF embeds in the `docs/solutions/` markdown. The `.tape` file lives alongside the doc as a rerunnable verification artifact.

**Rationale:** `ce:compound`'s philosophy is "each documented solution compounds knowledge." A GIF showing the exact terminal flow compounds harder than prose. The `.tape` file adds a compounding property text lacks: anyone can re-run it to verify the solution still applies. When combined with idea #3 (reproduce-bug), the reproduction tape naturally flows into the solution doc when compounding from a bug fix.

**Downsides:** Many solutions don't involve terminal-visible behavior. GIF assets in `docs/solutions/` may bloat the repo. Adds complexity to an already-complex skill.

**Confidence:** 65%
**Complexity:** Medium
**Status:** Unexplored

---

### 5. Conditional VHS GIF in `git-commit-push-pr`

**Description:** Add a new row to the `git-commit-push-pr` visual aids routing table: "PR changes CLI commands or terminal output -> VHS GIF demo -> Within the Demo section." When the diff touches argument parsing, command output, help text, or terminal formatters, generate a `.tape`, run VHS, upload the GIF, and embed it in the PR description alongside existing Mermaid/ASCII/table visual aids.

**Rationale:** Highest-traffic integration point -- every PR goes through this skill. The conditional visual aids framework already has the content-pattern routing infrastructure. VHS would be another visual communication option, gated the same way diagrams are.

**Downsides:** A VHS recording takes 5-10 seconds; a Mermaid diagram takes 0. This changes the weight of the commit flow significantly. Adds a tool dependency (VHS must be installed) to the most commonly used skill. If VHS isn't installed, the skill needs a graceful fallback. The commit flow should be fast -- recording is fundamentally at odds with that. Better to invoke feature-video (if it supports VHS) as a separate step rather than embedding recording into the commit flow.

**Confidence:** 55%
**Complexity:** Medium-High
**Status:** Unexplored

---

### 6. Onboarding VHS Walkthroughs

**Description:** Extend the `onboarding` skill to generate `.tape` files demonstrating the project's key getting-started commands (install, test, dev server, first workflow). Embed resulting GIFs in ONBOARDING.md. The `.tape` files, committed alongside the doc, serve double duty: visual documentation AND CI-verifiable smoke tests (if the tape fails to produce a clean recording, the onboarding docs are stale).

**Rationale:** Onboarding docs say "run `bun test`" but new contributors don't know what success looks like. A GIF eliminates that ambiguity. The self-verifying property (stale tapes fail) is a genuinely novel benefit that text documentation can't provide.

**Downsides:** Onboarding docs change frequently; recordings go stale quickly and need regeneration. Generating tapes requires actually running setup commands, which may have side effects. Maintenance burden may outweigh one-time setup value.

**Confidence:** 50%
**Complexity:** Medium-High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Shared VHS recording protocol across skills | Premature abstraction -- build two integrations first, extract pattern if it repeats |
| 2 | VHS as `ce:work` verification step | VHS produces GIFs, not pass/fail signals -- it records, it doesn't assert |
| 3 | VHS as `ce:plan` acceptance spec (tape-driven development) | .tape for unbuilt features is wishful scripting with `echo` mocks, not useful specs |
| 4 | VHS in `ce:review` before/after evidence | Too expensive -- requires branch checkout during review, adds minutes to a fast flow |
| 5 | .tape files as documentation artifacts (no VHS execution) | Reduces VHS to a script format without its differentiating feature (the recording) |
| 6 | Self-documenting agent session recordings | VHS is declarative (scripted), not adaptive -- cannot record an agent's live decisions |
| 7 | Investigation recordings during bug hunt | VHS requires knowing commands in advance, incompatible with interactive debugging |

## Session Log

- 2026-03-29: Initial ideation -- 40 raw candidates from 5 parallel agents (pain/friction, unmet need, inversion/removal, assumption-breaking, leverage/compounding), deduped to 13 unique ideas, 6 survived adversarial filtering
