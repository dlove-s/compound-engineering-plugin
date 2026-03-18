import { describe, expect, test } from "bun:test"
import { buildCompoundEngineeringDescription } from "../src/release/metadata"

describe("release metadata", () => {
  test("builds the current compound-engineering manifest description from repo counts", async () => {
    const description = await buildCompoundEngineeringDescription(process.cwd())
    expect(description).toBe(
      "AI-powered development tools. 29 agents, 44 skills, 1 MCP server for code review, research, design, and workflow automation.",
    )
  })
})
