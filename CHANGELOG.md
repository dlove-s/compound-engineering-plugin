# Changelog

All notable changes to the `@every-env/compound-plugin` CLI tool will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - 2026-03-01

### Added

- **OpenClaw target** — `--to openclaw` converts plugins to OpenClaw format. Agents become `.md` files, commands become `.md` files, pass-through skills copy unchanged, and MCP servers are written to `openclaw-extension.json`. Output goes to `~/.openclaw/extensions/<plugin-name>/` by default. Use `--openclaw-home` to override. ([#217](https://github.com/EveryInc/compound-engineering-plugin/pull/217)) — thanks [@TrendpilotAI](https://github.com/TrendpilotAI)!
- **Qwen Code target** — `--to qwen` converts plugins to Qwen Code extension format. Agents become `.yaml` files with Qwen-compatible fields, commands become `.md` files, MCP servers write to `qwen-extension.json`, and a `QWEN.md` context file is generated. Output goes to `~/.qwen/extensions/<plugin-name>/` by default. Use `--qwen-home` to override. ([#220](https://github.com/EveryInc/compound-engineering-plugin/pull/220)) — thanks [@rlam3](https://github.com/rlam3)!
- **Windsurf target** — `--to windsurf` converts plugins to Windsurf format. Claude agents become Windsurf skills (`skills/{name}/SKILL.md`), commands become flat workflows (`global_workflows/{name}.md` for global scope, `workflows/{name}.md` for workspace), and pass-through skills copy unchanged. MCP servers write to `mcp_config.json` (machine-readable, merged with existing config). ([#202](https://github.com/EveryInc/compound-engineering-plugin/pull/202)) — thanks [@rburnham52](https://github.com/rburnham52)!
- **Global scope support** — New `--scope global|workspace` flag (generic, Windsurf as first adopter). `--to windsurf` defaults to global scope (`~/.codeium/windsurf/`), making installed skills, workflows, and MCP servers available across all projects. Use `--scope workspace` for project-level `.windsurf/` output.
- **`mcp_config.json` integration** — Windsurf converter writes proper machine-readable MCP config supporting stdio, Streamable HTTP, and SSE transports. Merges with existing config (user entries preserved, plugin entries take precedence). Written with `0o600` permissions.
- **Shared utilities** — Extracted `resolveTargetOutputRoot` to `src/utils/resolve-output.ts` and `hasPotentialSecrets` to `src/utils/secrets.ts` to eliminate duplication.

### Fixed

- **OpenClaw code injection** — `generateEntryPoint` now uses `JSON.stringify()` for all string interpolation (was escaping only `"`, leaving `\n`/`\\` unguarded).
- **Qwen `plugin.manifest.name`** — context file header was `# undefined` due to using `plugin.name` (which doesn't exist on `ClaudePlugin`); fixed to `plugin.manifest.name`.
- **Qwen remote MCP servers** — curl fallback removed; HTTP/SSE servers are now skipped with a warning (Qwen only supports stdio transport).
- **`--openclaw-home` / `--qwen-home` CLI flags** — wired through to `resolveTargetOutputRoot` so custom home directories are respected.

---

## [0.9.1] - 2026-02-20

### Changed

- **Remove docs/reports and docs/decisions directories** — only `docs/plans/` is retained as living documents that track implementation progress
- **OpenCode commands as Markdown** — commands are now `.md` files with deep-merged config, permissions default to none ([#201](https://github.com/EveryInc/compound-engineering-plugin/pull/201)) — thanks [@0ut5ider](https://github.com/0ut5ider)!
- **Fix changelog GitHub link** ([#215](https://github.com/EveryInc/compound-engineering-plugin/pull/215)) — thanks [@XSAM](https://github.com/XSAM)!
- **Update Claude Code install command in README** ([#218](https://github.com/EveryInc/compound-engineering-plugin/pull/218)) — thanks [@ianguelman](https://github.com/ianguelman)!

---

## [0.9.0] - 2026-02-17

### Added

- **Kiro CLI target** — `--to kiro` converts plugins to `.kiro/` format with custom agent JSON configs, prompt files, skills, steering files, and `mcp.json`. Only stdio MCP servers are supported ([#196](https://github.com/EveryInc/compound-engineering-plugin/pull/196)) — thanks [@krthr](https://github.com/krthr)!

---

## [0.8.0] - 2026-02-17

### Added

- **GitHub Copilot target** — `--to copilot` converts plugins to `.github/` format with `.agent.md` files, `SKILL.md` skills, and `copilot-mcp-config.json`. Also supports `sync --target copilot` ([#192](https://github.com/EveryInc/compound-engineering-plugin/pull/192)) — thanks [@brayanjuls](https://github.com/brayanjuls)!
- **Native Cursor plugin support** — Cursor now installs via `/add-plugin compound-engineering` using Cursor's native plugin system instead of CLI conversion ([#184](https://github.com/EveryInc/compound-engineering-plugin/pull/184)) — thanks [@ericzakariasson](https://github.com/ericzakariasson)!

### Removed

- Cursor CLI conversion target (`--to cursor`) — replaced by native Cursor plugin install

---

## [0.6.0] - 2026-02-12

### Added

- **Droid sync target** — `sync --target droid` symlinks personal skills to `~/.factory/skills/`
- **Cursor sync target** — `sync --target cursor` symlinks skills to `.cursor/skills/` and merges MCP servers into `.cursor/mcp.json`
- **Pi target** — First-class `--to pi` converter with MCPorter config and subagent compatibility ([#181](https://github.com/EveryInc/compound-engineering-plugin/pull/181)) — thanks [@gvkhosla](https://github.com/gvkhosla)!

### Fixed

- **Bare Claude model alias resolution** — Fixed OpenCode converter not resolving bare model aliases like `claude-sonnet-4-5-20250514` ([#182](https://github.com/EveryInc/compound-engineering-plugin/pull/182)) — thanks [@waltbeaman](https://github.com/waltbeaman)!

### Changed

- Extracted shared `expandHome` / `resolveTargetHome` helpers to `src/utils/resolve-home.ts`, removing duplication across `convert.ts`, `install.ts`, and `sync.ts`

---

## [0.5.2] - 2026-02-09

### Fixed

- Fix cursor install defaulting to cwd instead of opencode config dir

## [0.5.1] - 2026-02-08

- Initial npm publish
