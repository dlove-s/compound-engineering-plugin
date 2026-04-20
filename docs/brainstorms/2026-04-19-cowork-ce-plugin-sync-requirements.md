---
date: 2026-04-19
topic: cowork-ce-plugin-sync
---

# Cowork-Side Sync Tool for Compound-Engineering Plugin

## Problem Frame

Danielle works primarily in Cowork, not Claude Code, but wants to use all the skills from the `compound-engineering` Claude Code plugin (`ce-brainstorm`, `ce-plan`, `ce-work`, etc.) in Cowork. A Cowork version of the plugin exists and is installed via the standard `.plugin` file flow. It needs to be rebuilt whenever meaningful upstream changes land in the CE repo.

The last manual rebuild failed silently because one skill description in `ce-release-notes/SKILL.md` contained the substring `<skill-name>`, which Cowork's validator treats as malformed HTML. The failure banner said only "Plugin validation failed" — no offending file, no line, no rule cited. 93 other skills and agents validated fine; one string broke the whole install.

The sync tool is a Cowork plugin Danielle invokes manually. It reads the local CE repo (already pulled via git), summarizes meaningful upstream changes, pre-validates against known Cowork failure modes, and produces a fresh `.plugin` file she drops back into Cowork through the UI.

This tool is for personal use. It is not part of the CE repo's supported converters and does not need to be upstreamed.

## Requirements

**Invocation and Trigger**

- R1. The tool is a Cowork plugin installed once through the standard `.plugin` file flow, exposing at least one skill (e.g., `/update-ce-plugin`) that Danielle invokes manually.
- R2. Invocation runs against the local clone of the CE repo (currently mounted at `/sessions/bold-epic-fermi/mnt/compound-engineering-plugin`). Danielle is responsible for pulling upstream changes into that folder before invoking; the tool does not `git fetch` or `git pull` on its own.
- R3. The source path is configurable so the tool still works if the CE repo moves to a different mount point.

**Change Detection and Diff Summary**

- R4. On each invocation, the tool compares the CE repo's current state to the commit SHA of the last successful rebuild (stored in the Cowork plugin's own state folder). If no prior rebuild exists, the run is treated as a first-time build and the diff section is skipped.
- R5. The tool categorizes changed files into "meaningful to plugin output" and "not meaningful":
  - **Meaningful:** new / removed skills, agents, or commands; body content changes to any skill, agent, or command file; description field changes; `plugins/compound-engineering/.claude-plugin/plugin.json` changes; scripts or assets that a skill references.
  - **Not meaningful:** changes under `src/` (the CLI), `tests/`, CI configs, `package.json` version bumps, `docs/`, root `README.md`, `CHANGELOG.md`, `LICENSE`, and other plugins' content (e.g., `plugins/coding-tutor/`).
- R6. The tool prints a diff summary that shows meaningful changes prominently (file paths + short commit subjects), collapses skipped changes to a count, and ends with a recommendation: "rebuild — N skills affected" or "no meaningful changes since last rebuild".
- R7. Danielle can always override the recommendation and proceed (or abort) regardless of what the tool suggests.

**Validation Pre-Flight**

- R8. Before writing any output, the tool runs a validator pass over the CE plugin content. Validation failures block the rebuild and print a list of offending files, line numbers, and a short remediation hint per finding. No partial output is produced on failure.
- R9. The validator checks:
  - **Angle-bracket patterns in description fields.** Any substring matching an HTML-like pattern (`<identifier>`, `</identifier>`, `<identifier/>`) in any `description:` frontmatter field across skills, agents, commands, or plugin.json is flagged. This is the known-broken case from yesterday.
  - **Frontmatter structural sanity.** YAML frontmatter must parse. Required fields (`name`, `description`) must be present and non-empty on every skill, agent, and command.
  - **Cross-skill path references.** No skill SKILL.md body may reference files outside its own directory tree using `../` traversal or absolute paths into other skill directories. This matches the `File References in Skills` rule in `AGENTS.md`.
- R10. The validator does not auto-fix. It surfaces findings and exits. A `--auto-fix` flag is out of scope for this brainstorm.

**Conversion and Output**

- R11. The conversion logic is hand-rolled and self-contained inside the Cowork plugin. It does not invoke the CE repo's Bun CLI, does not require bun in the Cowork sandbox, and does not modify the CE repo.
- R12. On successful validation, the tool produces a single `.plugin` file in the Cowork workspace folder. Danielle installs it manually through the Cowork UI, overwriting the previous CE install.
- R13. On successful output, the tool updates its stored state with the new "last-rebuilt" upstream commit SHA so the next invocation computes its diff against this run.

**State and Scope**

- R14. The tool maintains state inside its own plugin directory (a single commit SHA and a timestamp — no full repo snapshots).
- R15. The tool is designed for single-user use on Danielle's machine. Multi-user, multi-machine, or shared-state scenarios are out of scope.

## Success Criteria

- The known failure mode from yesterday (`<skill-name>` inside `ce-release-notes/SKILL.md`) is caught by the validator before any `.plugin` file is produced, with the offending file and line identified in the output.
- After running the tool, Danielle can drop the produced `.plugin` file into Cowork and have the compound-engineering plugin install successfully without the "Plugin validation failed" banner.
- Routine upstream noise (CLI refactors under `src/`, README edits, CHANGELOG entries) does not cause the tool to recommend a rebuild.
- Genuine plugin-behavior changes (new skill, modified description, modified skill body) cause the tool to recommend a rebuild and surface a concise summary of what changed.

## Scope Boundaries

- **Not contributing a Cowork target upstream.** The CE repo's CLI (`src/targets/`) remains unchanged. This tool is a personal sync layer, not a PR to `EveryInc/compound-engineering-plugin`.
- **No automatic sync.** No scheduled tasks, no watchers on the CE folder, no auto-install into Cowork. Danielle invokes the skill manually, and she installs the resulting `.plugin` manually.
- **No auto-fix of description violations.** The validator blocks and surfaces; it does not rewrite upstream content.
- **Single plugin target.** The tool converts only `plugins/compound-engineering/` from the CE repo. Other plugins in the repo (e.g., `plugins/coding-tutor/`) are out of scope.
- **Not a generic Claude-Code-to-Cowork converter.** The tool is specific to this CE plugin's shape. Generalization may be useful later but is not a requirement now.
- **No preservation of local Cowork edits.** Output is a full rebuild from upstream; any local tweaks Danielle made to her installed Cowork plugin after a prior install are overwritten on reinstall.
- **No pulling from GitHub.** Danielle runs `git pull` herself before invoking.

## Key Decisions

- **Manual trigger with smart diff summary.** Danielle stays in control of when a rebuild happens but doesn't have to eyeball every commit to decide whether it's meaningful.
- **`.plugin` file output reinstalled via UI.** Matches the existing install flow for her current CE Cowork plugin; avoids introducing a new install mechanism.
- **Cowork plugin shape (not a loose skill).** Gives clean `/...` invocation, versioning, and a portable unit of distribution; cost over a loose skill is minimal.
- **Hand-rolled self-contained converter.** No bun dependency in the Cowork sandbox, no CE-repo modifications, no fork-maintenance treadmill. The CE plugin structure is simple enough (YAML frontmatter + markdown) that duplicating parsing is cheaper than integrating the upstream CLI.
- **Validator catches known issue + structural sanity.** The angle-bracket scanner is non-negotiable after yesterday's incident; YAML parse, required fields, and no-cross-skill-paths are low-cost additions that cover adjacent silent-failure modes.
- **Block and surface, no auto-fix default.** Preserves upstream intent, makes failures visible, and signals bug classes that should eventually be fixed upstream instead of papered over locally.
- **Last-rebuilt commit SHA as state (not a full snapshot).** Trivial state, no synchronization risk, relies on git's own history as source of truth.

## Dependencies / Assumptions

- The CE repo at the source path is a valid git checkout with `upstream` fetched. Danielle is responsible for running `git pull upstream main` (or equivalent) before invoking.
- The Cowork sandbox has access to git, a shell, and whatever scripting runtime the conversion logic uses. Language choice is deferred to planning.
- Cowork's `.plugin` install flow continues to work as it does today. If Cowork changes its plugin format or install mechanism, this tool needs rework.
- **Unverified assumption:** the angle-bracket failure is currently the only active Cowork validation constraint we know about. It is based on yesterday's single incident, not an exhaustive audit of Cowork's validator. Other constraints may exist and should be investigated during planning.

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R11][Technical] Choice of scripting language for the converter — Python, Bun/TypeScript, or Bash? Drives how much of the CE repo's existing parser logic can be cribbed.
- [Affects R5, R6][Technical] Exactly how "meaningful" is detected — pure git-diff on file paths vs. parsing SKILL.md bodies to decide. The glob pattern on "skipped" paths likely suffices, but edge cases (e.g., a `docs/` file that a skill references) need a planning-level answer.
- [Affects R8, R9][Needs research] Whether Cowork has other validation rules beyond the angle-bracket one. A focused planning-level investigation — feeding the current CE plugin through Cowork's validator with small perturbations — may reveal more constraints worth adding to the pre-flight.
- [Affects R12][Technical] Exact layout and manifest schema of the output `.plugin` file — leverage `cowork-plugin-management:create-cowork-plugin` patterns or reverse-engineer from the currently-installed Cowork CE plugin.
- [Affects R1, R11][Technical] Where the Cowork sync plugin's own source code lives — a new standalone repo, a subfolder in Danielle's fork of the CE repo, or her personal Cowork plugin directory.

## Next Steps

-> `/ce-plan` for structured implementation planning.
