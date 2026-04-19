# Document Review Output Template

Use this **exact format** when presenting synthesized review findings in Interactive mode. Findings are grouped by severity, not by reviewer.

**IMPORTANT:** Use pipe-delimited markdown tables (`| col | col |`). Do NOT use ASCII box-drawing characters.

This template describes the Phase 4 interactive presentation — what the user sees before the routing question (`references/walkthrough.md`) fires. The headless-mode envelope is documented in `references/synthesis-and-presentation.md` (Phase 4 "Route Remaining Findings" section) and is separate from this template.

## Example

```markdown
## Document Review Results

**Document:** docs/plans/2026-03-15-feat-user-auth-plan.md
**Type:** plan
**Reviewers:** coherence, feasibility, security-lens, scope-guardian
- security-lens -- plan adds public API endpoint with auth flow
- scope-guardian -- plan has 15 requirements across 3 priority levels

Applied 5 safe_auto fixes. 4 actionable findings to consider (2 errors, 2 omissions). 2 FYI observations.

### Applied safe_auto fixes

- Standardized "pipeline"/"workflow" terminology to "pipeline" throughout (coherence)
- Fixed cross-reference: Section 4 referenced "Section 3.2" which is actually "Section 3.1" (coherence)
- Updated unit count from "6 units" to "7 units" to match listed units (coherence)
- Added "update API rate-limit config" step to Unit 4 -- implied by Unit 3's rate-limit introduction (feasibility)
- Added auth token refresh to test scenarios -- required by Unit 2's token expiry handling (security-lens)

### P0 -- Must Fix

#### Errors

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 1 | Requirements Trace | Goal states "offline support" but technical approach assumes persistent connectivity | coherence | 0.92 | manual |

### P1 -- Should Fix

#### Errors

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 2 | Scope Boundaries | 8 of 12 units build admin infrastructure; only 2 touch stated goal | scope-guardian | 0.80 | manual |

#### Omissions

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 3 | Implementation Unit 3 | Plan proposes custom auth but does not mention existing Devise setup or migration path | feasibility | 0.85 | gated_auto |

### P2 -- Consider Fixing

#### Omissions

| # | Section | Issue | Reviewer | Confidence | Tier |
|---|---------|-------|----------|------------|------|
| 4 | API Design | Public webhook endpoint has no rate limiting mentioned | security-lens | 0.75 | gated_auto |

### FYI Observations

Low-confidence observations surfaced without requiring a decision. Content advisory only.

| # | Section | Observation | Reviewer | Confidence |
|---|---------|-------------|----------|------------|
| 1 | Naming | Filename `plan.md` is asymmetric with command name `user-auth`; could go either way | coherence | 0.52 |
| 2 | Risk Analysis | Rollout-cadence decision may benefit from monitoring thresholds, though not blocking | scope-guardian | 0.48 |

### Residual Concerns

Residual concerns are issues the reviewers noticed but could not confirm with above-gate confidence. These are not actionable; they appear here for transparency only and are not promoted into the review surface.

| # | Concern | Source |
|---|---------|--------|
| 1 | Migration rollback strategy not addressed for Phase 2 data changes | feasibility |

### Deferred Questions

| # | Question | Source |
|---|---------|--------|
| 1 | Should the API use versioned endpoints from launch? | feasibility, security-lens |

### Coverage

| Persona | Status | Findings | SafeAuto | GatedAuto | Manual | FYI | Residual |
|---------|--------|----------|----------|-----------|--------|-----|----------|
| coherence | completed | 5 | 3 | 0 | 1 | 1 | 0 |
| feasibility | completed | 3 | 1 | 1 | 0 | 0 | 1 |
| security-lens | completed | 2 | 1 | 1 | 0 | 0 | 0 |
| scope-guardian | completed | 2 | 0 | 0 | 1 | 1 | 0 |
| product-lens | not activated | -- | -- | -- | -- | -- | -- |
| design-lens | not activated | -- | -- | -- | -- | -- | -- |
```

## Section Rules

- **Summary line**: Always present after the reviewer list. Format: "Applied N safe_auto fixes. K actionable findings to consider (X errors, Y omissions). Z FYI observations." Omit any zero clause except the FYI clause when zero (it's informative that none surfaced).
- **Applied safe_auto fixes**: List all fixes that were applied automatically (`safe_auto` tier). Include enough detail per fix to convey the substance — especially for fixes that add content or touch document meaning. Omit section if none.
- **P0-P3 sections**: Only include sections that have actionable findings (`gated_auto` or `manual`). Omit empty severity levels. Within each severity, separate into **Errors** and **Omissions** sub-headers. Omit a sub-header if that severity has none of that type. The `Tier` column surfaces whether a finding is `gated_auto` (concrete fix exists, Apply recommended in walk-through) or `manual` (requires user judgment).
- **FYI Observations**: Low-confidence `manual` findings above the 0.40 FYI floor but below the per-severity gate. Surface here for transparency; these are not actionable and do not enter the walk-through. Omit section if none.
- **Residual Concerns**: Residual concerns noted by personas that did not make it above the confidence gate. Listed for transparency; not promoted into the review surface (cross-persona agreement boost runs on findings that already survived the gate, per synthesis step 3.4). Omit section if none.
- **Deferred Questions**: Questions for later workflow stages. Omit if none.
- **Coverage**: Always include. All counts are **post-synthesis**. **Findings** must equal SafeAuto + GatedAuto + Manual + FYI exactly — if deduplication merged a finding across personas, attribute it to the persona with the highest confidence and reduce the other persona's count. **Residual** = count of `residual_risks` from this persona's raw output (not the promoted subset in the Residual Concerns section).
