/**
 * One-time cleanup of stale compound-engineering files from previous installs.
 *
 * The v3 rename changed all skill and agent names (e.g., git-commit -> ce-commit,
 * adversarial-reviewer -> ce-adversarial-reviewer). Target writers create new
 * files at the new paths but don't remove the old ones, leaving orphans that
 * confuse the agent runtime.
 *
 * This module lists the known old names and removes them from the target's
 * output directories. It's safe to run multiple times (idempotent) and safe
 * to remove entirely once the v2 -> v3 transition window has passed.
 *
 * TODO(cleanup): Remove this file after the v3 transition (circa Q3 2026).
 */

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { parseFrontmatter } from "./frontmatter"

/** Old skill directory names that no longer exist after the v3 rename. */
const STALE_SKILL_DIRS = [
  // ce: -> ce- (dirs were already hyphenated by sanitizePathName, so these
  // only collide if the old name was exactly the same after sanitization —
  // which it was for all 8 workflow skills. No orphans from this group.)

  // git-* -> ce-*
  "git-commit",
  "git-commit-push-pr",
  "git-worktree",
  "git-clean-gone-branches",

  // report-bug-ce -> ce-report-bug
  "report-bug-ce",

  // unprefixed -> ce-*
  "agent-native-architecture",
  "agent-native-audit",
  "andrew-kane-gem-writer",
  "changelog",
  "claude-permissions-optimizer",
  "deploy-docs",
  "dhh-rails-style",
  "document-review",
  "dspy-ruby",
  "every-style-editor",
  "feature-video",
  "frontend-design",
  "gemini-imagegen",
  "onboarding",
  "orchestrating-swarms",
  "proof",
  "reproduce-bug",
  "resolve-pr-feedback",
  "setup",
  "test-browser",
  "test-xcode",
  "todo-create",
  "todo-resolve",
  "todo-triage",

  // ce-review -> ce-code-review, ce-document-review -> ce-doc-review
  "ce-review",
  "ce-document-review",
]

/** Old agent names (used as generated skill dirs or flat .md files). */
const STALE_AGENT_NAMES = [
  // All 49 agents were renamed from <name> to ce-<name>
  "adversarial-document-reviewer",
  "adversarial-reviewer",
  "agent-native-reviewer",
  "ankane-readme-writer",
  "api-contract-reviewer",
  "architecture-strategist",
  "best-practices-researcher",
  "bug-reproduction-validator",
  "cli-agent-readiness-reviewer",
  "cli-readiness-reviewer",
  "code-simplicity-reviewer",
  "coherence-reviewer",
  "correctness-reviewer",
  "data-integrity-guardian",
  "data-migration-expert",
  "data-migrations-reviewer",
  "deployment-verification-agent",
  "design-implementation-reviewer",
  "design-iterator",
  "design-lens-reviewer",
  "dhh-rails-reviewer",
  "feasibility-reviewer",
  "figma-design-sync",
  "framework-docs-researcher",
  "git-history-analyzer",
  "issue-intelligence-analyst",
  "julik-frontend-races-reviewer",
  "kieran-python-reviewer",
  "kieran-rails-reviewer",
  "kieran-typescript-reviewer",
  "learnings-researcher",
  "lint",
  "maintainability-reviewer",
  "pattern-recognition-specialist",
  "performance-oracle",
  "performance-reviewer",
  "previous-comments-reviewer",
  "pr-comment-resolver",
  "product-lens-reviewer",
  "project-standards-reviewer",
  "reliability-reviewer",
  "repo-research-analyst",
  "schema-drift-detector",
  "scope-guardian-reviewer",
  "security-lens-reviewer",
  "security-reviewer",
  "security-sentinel",
  "spec-flow-analyzer",
  "testing-reviewer",
]

/** Old prompt wrapper names (we no longer generate workflow prompts). */
const STALE_PROMPT_FILES = [
  "ce-brainstorm.md",
  "ce-compound.md",
  "ce-compound-refresh.md",
  "ce-ideate.md",
  "ce-plan.md",
  "ce-review.md",
  "ce-work.md",
  "ce-work-beta.md",
]

const LEGACY_SKILL_DESCRIPTION_ALIASES: Record<string, string[]> = {
  setup: [
    "Configure project-level settings for compound-engineering workflows. Currently a placeholder — review agent selection is handled automatically by ce:review.",
  ],
}

type LegacyFingerprints = {
  skills: Map<string, string>
  agents: Map<string, string>
  prompts: Map<string, string>
}

let legacyFingerprintsPromise: Promise<LegacyFingerprints> | null = null

function currentSkillNameForLegacy(legacyName: string): string {
  switch (legacyName) {
    case "git-commit":
      return "ce-commit"
    case "git-commit-push-pr":
      return "ce-commit-push-pr"
    case "git-worktree":
      return "ce-worktree"
    case "git-clean-gone-branches":
      return "ce-clean-gone-branches"
    case "report-bug-ce":
      return "ce-report-bug"
    case "document-review":
    case "ce-document-review":
      return "ce-doc-review"
    case "ce-review":
      return "ce-code-review"
    default:
      return legacyName.startsWith("ce-") ? legacyName : `ce-${legacyName}`
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findRepoRoot(startDir: string): Promise<string | null> {
  let current = startDir
  while (true) {
    const pluginRoot = path.join(current, "plugins", "compound-engineering")
    if (await pathExists(pluginRoot)) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function buildSkillIndex(skillsRoot: string): Promise<Map<string, string>> {
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const index = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(skillsRoot, entry.name, "SKILL.md")
    if (await pathExists(skillPath)) {
      index.set(entry.name, skillPath)
    }
  }
  return index
}

async function buildAgentIndex(dir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        index.set(path.basename(entry.name, ".md"), fullPath)
      }
    }
  }

  return index
}

async function readDescription(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const { data } = parseFrontmatter(raw, filePath)
    return typeof data.description === "string" ? data.description : null
  } catch {
    return null
  }
}

async function loadLegacyFingerprints(): Promise<LegacyFingerprints> {
  if (!legacyFingerprintsPromise) {
    legacyFingerprintsPromise = (async () => {
      const repoRoot = await findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
      if (!repoRoot) {
        return { skills: new Map(), agents: new Map(), prompts: new Map() }
      }

      const pluginRoot = path.join(repoRoot, "plugins", "compound-engineering")
      const [skillIndex, agentIndex] = await Promise.all([
        buildSkillIndex(path.join(pluginRoot, "skills")),
        buildAgentIndex(path.join(pluginRoot, "agents")),
      ])

      const skills = new Map<string, string>()
      const agents = new Map<string, string>()
      const prompts = new Map<string, string>()

      for (const legacyName of STALE_SKILL_DIRS) {
        const currentPath = skillIndex.get(currentSkillNameForLegacy(legacyName))
        if (!currentPath) continue
        const description = await readDescription(currentPath)
        if (description) skills.set(legacyName, description)
      }

      for (const legacyName of STALE_AGENT_NAMES) {
        const currentPath = agentIndex.get(`ce-${legacyName}`)
        if (!currentPath) continue
        const description = await readDescription(currentPath)
        if (description) agents.set(legacyName, description)
      }

      for (const fileName of STALE_PROMPT_FILES) {
        const currentPath = skillIndex.get(currentSkillNameForLegacyPrompt(fileName))
        if (!currentPath) continue
        const description = await readDescription(currentPath)
        if (description) prompts.set(fileName, description)
      }

      return { skills, agents, prompts }
    })()
  }

  return legacyFingerprintsPromise
}

function currentSkillNameForLegacyPrompt(fileName: string): string {
  switch (fileName) {
    case "ce-review.md":
      return "ce-code-review"
    default:
      return path.basename(fileName, ".md")
  }
}

function promptSkillNamesForLegacy(fileName: string): string[] {
  switch (fileName) {
    case "ce-review.md":
      return ["ce-review", "ce-code-review"]
    default:
      return [path.basename(fileName, ".md")]
  }
}

async function isLegacyPluginOwned(
  targetPath: string,
  expectedDescription: string | undefined,
  extension: string | null,
): Promise<boolean> {
  if (extension === ".json") {
    return isLegacyKiroAgentConfig(targetPath)
  }

  if (extension === ".md" && path.basename(path.dirname(targetPath)) === "prompts") {
    return isLegacyKiroPrompt(targetPath)
  }

  if (!expectedDescription) return false
  const filePath = extension === null ? path.join(targetPath, "SKILL.md") : targetPath
  const actualDescription = await readDescription(filePath)
  if (actualDescription === expectedDescription) return true

  const aliases = extension === null
    ? LEGACY_SKILL_DESCRIPTION_ALIASES[path.basename(targetPath)] ?? []
    : []
  return aliases.includes(actualDescription ?? "")
}

async function isLegacyPromptWrapper(
  targetPath: string,
  expectedDescription: string | undefined,
): Promise<boolean> {
  if (!expectedDescription) return false

  try {
    const raw = await fs.readFile(targetPath, "utf8")
    const { data, body } = parseFrontmatter(raw, targetPath)
    if (data.description !== expectedDescription) return false

    return promptSkillNamesForLegacy(path.basename(targetPath)).some((skillName) =>
      body.includes(`Use the $${skillName} skill for this command and follow its instructions.`)
    )
  } catch {
    return false
  }
}

async function isLegacyKiroAgentConfig(targetPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(targetPath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const fileName = path.basename(targetPath, ".json")
    const resources = Array.isArray(parsed.resources) ? parsed.resources : []
    const tools = Array.isArray(parsed.tools) ? parsed.tools : []

    return parsed.name === fileName
      && parsed.prompt === `file://./prompts/${fileName}.md`
      && parsed.includeMcpJson === true
      && tools.length === 1
      && tools[0] === "*"
      && resources.includes("file://.kiro/steering/**/*.md")
      && resources.includes("skill://.kiro/skills/**/SKILL.md")
  } catch {
    return false
  }
}

async function isLegacyKiroPrompt(targetPath: string): Promise<boolean> {
  const agentName = path.basename(targetPath, ".md")
  const siblingConfigPath = path.join(path.dirname(path.dirname(targetPath)), `${agentName}.json`)
  return isLegacyKiroAgentConfig(siblingConfigPath)
}

async function removeIfExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath)
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true })
    } else {
      await fs.unlink(targetPath)
    }
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

/**
 * Remove stale skill directories from a target's skills root.
 * Call before writing new skills.
 */
export async function cleanupStaleSkillDirs(skillsRoot: string): Promise<number> {
  const { skills } = await loadLegacyFingerprints()
  let removed = 0
  for (const name of STALE_SKILL_DIRS) {
    const targetPath = path.join(skillsRoot, name)
    if (!(await isLegacyPluginOwned(targetPath, skills.get(name), null))) continue
    if (await removeIfExists(targetPath)) removed++
  }
  return removed
}

/**
 * Remove stale agent entries from a target's output directory.
 * Pass the file extension used by the target (e.g., ".md", ".agent.md", ".yaml").
 * For targets that write agents as skill dirs, pass null for extension.
 */
export async function cleanupStaleAgents(
  dir: string,
  extension: string | null,
): Promise<number> {
  const { agents } = await loadLegacyFingerprints()
  let removed = 0
  for (const name of STALE_AGENT_NAMES) {
    const target = extension
      ? path.join(dir, `${name}${extension}`)
      : path.join(dir, name)
    if (!(await isLegacyPluginOwned(target, agents.get(name), extension))) continue
    if (await removeIfExists(target)) removed++
  }
  return removed
}

/**
 * Remove stale prompt wrapper files.
 * Only applies to targets that used to generate workflow prompt wrappers (Codex).
 */
export async function cleanupStalePrompts(promptsDir: string): Promise<number> {
  const { prompts } = await loadLegacyFingerprints()
  let removed = 0
  for (const file of STALE_PROMPT_FILES) {
    const targetPath = path.join(promptsDir, file)
    if (!(await isLegacyPromptWrapper(targetPath, prompts.get(file)))) continue
    if (await removeIfExists(targetPath)) removed++
  }
  return removed
}
