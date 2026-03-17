---
title: "Beta skills framework: config-driven skill versioning for safe rollouts"
category: skill-design
date: 2026-03-17
module: plugins/compound-engineering/skills
component: SKILL.md, compound-engineering.local.md, setup
tags:
  - skill-design
  - beta-testing
  - configuration
  - skill-versioning
  - rollout-safety
  - compound-engineering-local
severity: medium
description: "Pattern for trialing new skill versions with a subset of users using a beta gate directive in SKILL.md and a general beta: true flag in compound-engineering.local.md. Covers gate placement, config schema, setup integration, and promotion path."
related:
  - docs/brainstorms/2026-03-17-beta-skills-framework-brainstorm.md
  - docs/solutions/skill-design/compound-refresh-skill-improvements.md
---

## Problem

Core workflow skills like `ce:plan` and `deepen-plan` are deeply chained (`ce:brainstorm` → `ce:plan` → `deepen-plan` → `ce:work`) and orchestrated by `lfg` and `slfg`. Rewriting these skills risks breaking the entire workflow for all users simultaneously. There was no mechanism to let a subset of users trial new skill versions while others stay on the stable version.

Alternatives considered and rejected:
- **Parallel beta skill names** (e.g., `ce-plan-beta`): requires duplicating handoff chains across lfg/slfg/brainstorm. Too much maintenance churn.
- **Pure router SKILL.md** with both versions in `references/`: adds a file-read penalty to the stable path and refactors stable skills unnecessarily.
- **Separate beta plugin**: heavy infrastructure for a temporary need.

## Solution

### 1. Beta Gate Pattern

Prepend a forceful routing directive to each beta-eligible SKILL.md. The stable instructions remain inline and unchanged. New/beta instructions live in `references/beta.md`.

```markdown
---
name: ce-plan
description: [unchanged from stable]
---

<!-- BETA GATE -->
MANDATORY FIRST ACTION. Read `compound-engineering.local.md` in the project root.
If `beta: true` is in the YAML frontmatter, STOP — follow ONLY
[beta.md](./references/beta.md) and ignore everything below.
<!-- END BETA GATE -->

# [Stable Skill Title]
[... original stable instructions, untouched ...]
```

**Key properties:**
- Stable users see the exact same skill content as before (gate falls through)
- Beta content is isolated in a reference file — easy to iterate on independently
- No skill renaming, no duplicate handoff chains
- Orchestration skills (lfg/slfg) call skills by name as usual — routing is transparent

### 2. Configuration: General `beta: true` Flag

The flag lives in `compound-engineering.local.md` YAML frontmatter — the same file that already stores `review_agents` and `plan_review_agents`.

```yaml
---
review_agents: [kieran-rails-reviewer, code-simplicity-reviewer]
plan_review_agents: [kieran-rails-reviewer, code-simplicity-reviewer]
beta: true
---
```

**Design choice: general flag, not per-skill.** A single `beta: true` applies to all beta-eligible skills. Skills without beta variants ignore the flag entirely. Per-skill granularity (`beta_skills: [ce-plan, deepen-plan]`) was considered but rejected as YAGNI — if needed later, it can be added without breaking the general flag.

**How users enable it:**
- Run `/setup` (updated to offer beta opt-in)
- Or manually add `beta: true` to existing `compound-engineering.local.md` frontmatter

### 3. Setup Integration

The `/setup` skill gets a new question in its flow asking about beta participation. This makes the flag discoverable through the existing configuration workflow rather than requiring users to know about manual YAML editing.

### 4. Beta Skill File Placement

Beta skill content goes in `references/beta.md` within the skill's directory:

```
skills/ce-plan/
├── SKILL.md              # Stable instructions + beta gate prepended
└── references/
    └── beta.md           # New/experimental skill instructions
```

The `references/` directory follows existing plugin conventions for supplementary skill files (see AGENTS.md skill compliance checklist — all reference files must be linked with proper markdown links, not bare backtick references).

**Frontmatter handling:** SKILL.md frontmatter (name, description, argument-hint) is parsed by Claude Code at skill registration time. `references/beta.md` is loaded at runtime via Read — its frontmatter would not be processed. To preserve the beta version's intended frontmatter without losing it, add it as an HTML comment at the top of beta.md:

```markdown
<!-- BETA FRONTMATTER — apply to SKILL.md when promoting beta to stable
---
name: skill-name
description: beta version description
argument-hint: "[beta argument hint]"
---
-->

# Skill Title
[... beta instructions ...]
```

### 5. Orchestration Skills Don't Need Changes

`lfg` and `slfg` call `/ce:plan` and `/deepen-plan` by name. Because routing happens inside the skills themselves, orchestration workflows are unaware of and unaffected by the beta mechanism. This is the primary advantage over the parallel-skill-names approach.

### 6. Downstream Compatibility

`ce:work` reads plan files from `docs/plans/` regardless of which skill version wrote them. As long as both stable and beta `ce:plan` produce plans with compatible frontmatter schema and section structure, downstream consumption works unchanged.

## Promotion Path

When the beta version is validated:

1. Replace SKILL.md stable content with beta.md content
2. Delete the `<!-- BETA GATE -->` block
3. Delete `references/beta.md`
4. One commit, one PR

## Known Risk: Instruction Blending

When `beta: true` is set, Claude sees both the beta gate directive AND the stable instructions in SKILL.md context before loading `references/beta.md` via Read tool. The aggressive "STOP IMMEDIATELY" directive mitigates this, but there is a non-zero chance of instruction blending.

**Escalation indicator:** Beta users report behavior that mixes stable and beta patterns (e.g., using old template structure with new workflow phases).

**Fallback:** If blending occurs in practice, escalate to the pure-router approach — move both stable and beta instructions to `references/` and make SKILL.md a 10-line router with no inline instructions to compete.

## Prevention

- When adding a beta variant to any skill, always copy this gate pattern exactly — do not paraphrase or weaken the directive language
- Always test with a project that has `beta: true` set AND a project without it to verify both paths work
- Verify plan output format compatibility between stable and beta before shipping — run both versions against the same input and confirm `ce:work` can consume both outputs
- When promoting beta to stable, search for any other skills or docs that reference `references/beta.md` before deleting it
