import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { parseFrontmatter } from "../src/utils/frontmatter"
import { cleanupStaleSkillDirs, cleanupStaleAgents, cleanupStalePrompts } from "../src/utils/legacy-cleanup"

async function createDir(dir: string, content = "placeholder") {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), content)
}

async function createFile(filePath: string, content = "placeholder") {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function pluginDescription(relativePath: string): Promise<string> {
  const raw = await fs.readFile(path.join(import.meta.dir, "..", relativePath), "utf8")
  const { data } = parseFrontmatter(raw, relativePath)
  if (typeof data.description !== "string") {
    throw new Error(`Missing description in ${relativePath}`)
  }
  return data.description
}

function skillContent(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n`
}

function agentContent(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nBody\n`
}

function promptWrapperContent(skillName: string, description: string, body = "Body") {
  return `---\ndescription: ${JSON.stringify(description)}\n---\n\nUse the $${skillName} skill for this command and follow its instructions.\n\n${body}\n`
}

describe("cleanupStaleSkillDirs", () => {
  test("removes known stale skill directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-skills-"))
    await createDir(
      path.join(root, "git-commit"),
      skillContent(
        "git-commit",
        await pluginDescription("plugins/compound-engineering/skills/ce-commit/SKILL.md"),
      ),
    )
    await createDir(
      path.join(root, "setup"),
      skillContent(
        "setup",
        await pluginDescription("plugins/compound-engineering/skills/ce-setup/SKILL.md"),
      ),
    )
    await createDir(
      path.join(root, "document-review"),
      skillContent(
        "document-review",
        await pluginDescription("plugins/compound-engineering/skills/ce-doc-review/SKILL.md"),
      ),
    )

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(3)
    expect(await exists(path.join(root, "git-commit"))).toBe(false)
    expect(await exists(path.join(root, "setup"))).toBe(false)
    expect(await exists(path.join(root, "document-review"))).toBe(false)
  })

  test("preserves non-stale directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-preserve-"))
    await createDir(path.join(root, "ce-plan"))
    await createDir(path.join(root, "ce-commit"))
    await createDir(path.join(root, "custom-user-skill"))

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "ce-plan"))).toBe(true)
    expect(await exists(path.join(root, "ce-commit"))).toBe(true)
    expect(await exists(path.join(root, "custom-user-skill"))).toBe(true)
  })

  test("removes ce-review and ce-document-review (renamed skills)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-renamed-"))
    await createDir(
      path.join(root, "ce-review"),
      skillContent(
        "ce-review",
        await pluginDescription("plugins/compound-engineering/skills/ce-code-review/SKILL.md"),
      ),
    )
    await createDir(
      path.join(root, "ce-document-review"),
      skillContent(
        "ce-document-review",
        await pluginDescription("plugins/compound-engineering/skills/ce-doc-review/SKILL.md"),
      ),
    )

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "ce-review"))).toBe(false)
    expect(await exists(path.join(root, "ce-document-review"))).toBe(false)
  })

  test("returns 0 when directory does not exist", async () => {
    const removed = await cleanupStaleSkillDirs("/tmp/nonexistent-cleanup-dir-12345")
    expect(removed).toBe(0)
  })

  test("preserves same-named user skill directories when content does not match plugin fingerprints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-user-skill-"))
    await createDir(
      path.join(root, "setup"),
      skillContent("setup", "User-owned setup skill unrelated to compound-engineering."),
    )

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "setup"))).toBe(true)
  })

  test("removes legacy setup skill even when current description has drifted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-setup-legacy-"))
    await createDir(
      path.join(root, "setup"),
      skillContent(
        "setup",
        "Configure project-level settings for compound-engineering workflows. Currently a placeholder — review agent selection is handled automatically by ce:review.",
      ),
    )

    const removed = await cleanupStaleSkillDirs(root)

    expect(removed).toBe(1)
    expect(await exists(path.join(root, "setup"))).toBe(false)
  })
})

describe("cleanupStaleAgents", () => {
  test("removes flat .md agent files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-md-"))
    await createFile(
      path.join(root, "adversarial-reviewer.md"),
      agentContent(
        "adversarial-reviewer",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-adversarial-reviewer.md"),
      ),
    )
    await createFile(
      path.join(root, "learnings-researcher.md"),
      agentContent(
        "learnings-researcher",
        await pluginDescription("plugins/compound-engineering/agents/research/ce-learnings-researcher.md"),
      ),
    )

    const removed = await cleanupStaleAgents(root, ".md")

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "adversarial-reviewer.md"))).toBe(false)
    expect(await exists(path.join(root, "learnings-researcher.md"))).toBe(false)
  })

  test("removes .agent.md files (Copilot format)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-copilot-"))
    await createFile(
      path.join(root, "security-sentinel.agent.md"),
      agentContent(
        "security-sentinel",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-security-sentinel.md"),
      ),
    )
    await createFile(
      path.join(root, "performance-oracle.agent.md"),
      agentContent(
        "performance-oracle",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-performance-oracle.md"),
      ),
    )

    const removed = await cleanupStaleAgents(root, ".agent.md")

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "security-sentinel.agent.md"))).toBe(false)
  })

  test("removes agent directories when extension is null", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-dir-"))
    await createDir(
      path.join(root, "code-simplicity-reviewer"),
      skillContent(
        "code-simplicity-reviewer",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-code-simplicity-reviewer.md"),
      ),
    )
    await createDir(
      path.join(root, "repo-research-analyst"),
      skillContent(
        "repo-research-analyst",
        await pluginDescription("plugins/compound-engineering/agents/research/ce-repo-research-analyst.md"),
      ),
    )

    const removed = await cleanupStaleAgents(root, null)

    expect(removed).toBe(2)
    expect(await exists(path.join(root, "code-simplicity-reviewer"))).toBe(false)
    expect(await exists(path.join(root, "repo-research-analyst"))).toBe(false)
  })

  test("preserves ce-prefixed agent files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-keep-"))
    await createFile(path.join(root, "ce-adversarial-reviewer.md"), agentContent("ce-adversarial-reviewer", "custom"))
    await createFile(path.join(root, "ce-learnings-researcher.md"), agentContent("ce-learnings-researcher", "custom"))

    const removed = await cleanupStaleAgents(root, ".md")

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "ce-adversarial-reviewer.md"))).toBe(true)
  })

  test("preserves same-named user agent files when content does not match plugin fingerprints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-agents-user-"))
    await createFile(
      path.join(root, "lint.md"),
      agentContent("lint", "A project-local lint helper unrelated to compound-engineering."),
    )

    const removed = await cleanupStaleAgents(root, ".md")

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "lint.md"))).toBe(true)
  })
})

describe("cleanupStalePrompts", () => {
  test("removes old workflow prompt wrappers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-prompts-"))
    await createFile(
      path.join(root, "ce-plan.md"),
      promptWrapperContent(
        "ce-plan",
        await pluginDescription("plugins/compound-engineering/skills/ce-plan/SKILL.md"),
      ),
    )
    await createFile(
      path.join(root, "ce-review.md"),
      promptWrapperContent(
        "ce-review",
        await pluginDescription("plugins/compound-engineering/skills/ce-code-review/SKILL.md"),
      ),
    )
    await createFile(
      path.join(root, "ce-brainstorm.md"),
      promptWrapperContent(
        "ce-brainstorm",
        await pluginDescription("plugins/compound-engineering/skills/ce-brainstorm/SKILL.md"),
      ),
    )

    const removed = await cleanupStalePrompts(root)

    expect(removed).toBe(3)
    expect(await exists(path.join(root, "ce-plan.md"))).toBe(false)
    expect(await exists(path.join(root, "ce-review.md"))).toBe(false)
  })

  test("preserves non-stale prompt files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-prompts-keep-"))
    await createFile(path.join(root, "my-custom-prompt.md"))
    await createFile(path.join(root, "review-command.md"))

    const removed = await cleanupStalePrompts(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "my-custom-prompt.md"))).toBe(true)
  })

  test("preserves same-named user prompt files when content does not match plugin fingerprints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-prompts-user-"))
    await createFile(
      path.join(root, "ce-plan.md"),
      "---\ndescription: \"A project-local ce-plan helper\"\n---\n\nCustom prompt body\n",
    )

    const removed = await cleanupStalePrompts(root)

    expect(removed).toBe(0)
    expect(await exists(path.join(root, "ce-plan.md"))).toBe(true)
  })
})

describe("idempotency", () => {
  test("running cleanup twice returns 0 on second run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-idempotent-"))
    await createDir(
      path.join(root, "git-commit"),
      skillContent(
        "git-commit",
        await pluginDescription("plugins/compound-engineering/skills/ce-commit/SKILL.md"),
      ),
    )
    await createFile(
      path.join(root, "adversarial-reviewer.md"),
      agentContent(
        "adversarial-reviewer",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-adversarial-reviewer.md"),
      ),
    )

    const first = await cleanupStaleSkillDirs(root) + await cleanupStaleAgents(root, ".md")
    expect(first).toBe(2)

    const second = await cleanupStaleSkillDirs(root) + await cleanupStaleAgents(root, ".md")
    expect(second).toBe(0)
  })
})
