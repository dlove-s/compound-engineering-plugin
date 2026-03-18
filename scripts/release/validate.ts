#!/usr/bin/env bun
import path from "path"
import { validateReleasePleaseConfig } from "../../src/release/config"
import { syncReleaseMetadata } from "../../src/release/metadata"
import { readJson } from "../../src/utils/files"

const releasePleaseConfig = await readJson<{ packages: Record<string, unknown> }>(
  path.join(process.cwd(), ".github", "release-please-config.json"),
)
const configErrors = validateReleasePleaseConfig(releasePleaseConfig)
const result = await syncReleaseMetadata({ write: false })
const changed = result.updates.filter((update) => update.changed)

if (configErrors.length === 0 && changed.length === 0) {
  console.log("Release metadata is in sync.")
  process.exit(0)
}

if (configErrors.length > 0) {
  console.error("Release configuration errors detected:")
  for (const error of configErrors) {
    console.error(`- ${error}`)
  }
}

if (changed.length > 0) {
  console.error("Release metadata drift detected:")
  for (const update of changed) {
    console.error(`- ${update.path}`)
  }
}
process.exit(1)
