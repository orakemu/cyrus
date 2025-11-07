# Executive Summary
Merge upstream `ceedaragents/cyrus:main` into our fork while preserving Codex-focused capabilities, then introduce explicit multi-CLI configuration so any site can run fully on Claude, fully on Codex, or a mix. The plan covers the merge strategy, conflict resolution, post-merge refactors (config knobs, runner validation), and documentation/testing to ship a unified, multi-CLI-aware release.

# Checkpoints
- [ ] Integration branch created and upstream main merged with conflicts resolved
- [x] Codex-specific features re-applied and verified after merge
- [x] Configuration schema exposes explicit classifier and procedure runner defaults
- [x] EdgeWorker validates runner availability before starting
- [x] Runner selection pipeline honors classification, procedure preferences, and label overrides
- [x] Orchestrator procedure supports configurable runner and subroutine prompts
- [x] Documentation and tests updated for multi-CLI procedure routing

> Status 2025-11-02: Edge-worker Codex regression + dynamic tool tests updated and passing (`pnpm --filter cyrus-edge-worker test:run`, `pnpm test:packages:run`). Config schema + CLI now expose classifier/procedure defaults and the edge worker enforces Codex prerequisites on startup. Added dedicated runner-selection coverage (label overrides, procedure defaults, Codex validation). Next up: finish doc examples and orchestrator prompt audit.
>
> Status 2025-11-06: README workflow re-tested across three sandboxes. Claude-only path succeeds. Codex-only and mixed configs initially failed because codex-cli 0.55 deprecated `codex login --api-key` and rejected our `codex exec -- bash -lc …` probe; CLI updates now pipe API keys via `--with-api-key` (with legacy fallback) and swap the validation probe to `codex login status`. Post-fix rerun (`/tmp/cyrus-{claude,codex,mixed}-validation-2`) shows `cyrus validate` passing for all three configurations; `connect-openai` now streams the stdin-based login attempt and surfaces any credential failures directly.
> Verification 2025-11-06: `pnpm typecheck`, `pnpm --filter cyrus-edge-worker test:run`, and `pnpm test:packages:run` all succeed post-CLI updates.
> Status 2025-11-06 (evening): reconciled `packages/core` config exports with upstream, revalidated CLI scaffolding against the final type shapes, bumped package versions/SDK ranges, regenerated `pnpm-lock.yaml`, and re-ran the full edge-worker Vitest suite (156 tests) to ensure procedure routing + prompt assembly stay green with the new overrides.

---

## 1. Background & Current State
- **Upstream main** (ceedaragents) is ahead by ~95 commits with intelligent procedure routing, modular subroutines, Sora/GPT image tools, Linear MCP hot-reload, `cyrus-simple-agent-runner`, and dependency updates (SDK bumps through Oct 31, 2025).
- **Our fork** adds multi-CLI (Claude + Codex) execution, Codex permission/queueing, extensive Codex tests, prompt management TUI, and docs describing multi-runner architecture.
- The histories diverged significantly (we also have ~56 commits upstream lacks), so we need a deliberate merge to combine both feature sets before layering new configuration work.

## 2. Goals & Non-Goals
### Goals
- Expose explicit configuration for:
  - The runner/model used by the classifier.
  - Default runner/model used for each procedure (including orchestrator).
  - Repository-level overrides that respect existing `runner` and label rules.
- Validate runner availability (Claude SDK ↔ Anthropic token, Codex CLI/OpenAI key) before a session starts.
- Maintain current behavior: label `codex` or repo default should still force Codex even when classification suggests Claude.

### Non-Goals
- Replacing the upstream SimpleClaudeRunner implementation with Codex out of the box (we only make it configurable).
- Rewriting Codex queueing logic—existing `EdgeWorker` enqueue/dequeue behavior remains.
- Changing Linear prompt assets beyond orchestrator tweaks needed for Codex compatibility.

## 3. Proposed Architecture
### 3.1 Merge & Integration Strategy
1. **Create integration branch**: e.g., `upstream-sync/2025-10`. Start from our `main`.
2. **Fetch upstream**: already added as `upstream`. Run `git fetch upstream main`.
3. **Merge** (preferred over rebase to preserve our Codex history) with `git merge upstream/main` on the integration branch.
4. **Resolve conflicts** in priority order:
   - `packages/edge-worker/src/EdgeWorker.ts`, `AgentSessionManager.ts`, `index.ts`
   - `packages/edge-worker/src/types.ts` and new `procedures/*` tree
   - `apps/cli/app.ts` plus deleted prompt-* files (decide whether to keep TUI inline or split into subcommand)
   - `packages/claude-runner` (preserve new image/sora tools, reconcile Codex adapters removal)
   - `docs/*` and `CHANGELOG.md`
5. **Restore Codex artifacts** removed upstream:
   - Keep Codex runner adapters/tests (`packages/agent-runner`, `packages/edge-worker/test/EdgeWorker.codex-*.test.ts`)
   - Reinstate prompt TUI files (if upstream deletes, consider moving under `apps/cli/prompts/` namespace and referencing from new CLI)
   - Retain config fields (`runner`, `runnerModels`, `labelAgentRouting`) adjusting types to fit upstream schema.
6. **Introduce upstream additions** we were missing:
   - New procedure routing files, simple-agent-runner package, config hot reload, MCP detection, Sora/image tools, dependency bumps.
7. **Post-merge sanity**: run `pnpm install`, `pnpm typecheck`, `pnpm test:packages:run`, Codex integration tests.

Document each conflict resolution in commit messages or notes to ease review.

### 3.2 Configuration Additions
Modify `EdgeWorkerConfig` (`packages/edge-worker/src/types.ts`) to include:
```ts
interface ProcedureRouterDefaults {
  runner: RunnerType;            // "claude" | "codex"
  model?: string;                // default model name for runner
}

interface ProcedureRunnerOverride {
  runner?: RunnerType;           // optional override
  model?: string;
}

interface EdgeWorkerConfig {
  classifier?: ProcedureRouterDefaults;          // NEW – defaults to Claude
  procedureDefaults?: Record<string, ProcedureRunnerOverride>; // keyed by procedure name
  // ...existing fields retained (defaultCli, cliDefaults, etc.)
}

interface RepositoryConfig {
  classifierOverride?: ProcedureRunnerOverride;  // optional per repo
  procedureOverrides?: Record<string, ProcedureRunnerOverride>;
}
```

#### Initialization
- When generating or migrating config (`apps/cli/app.ts` config scaffold and migration commands), set explicit defaults:
  - `classifier.runner = "claude"`
  - `procedureDefaults.full-development.runner = config.defaultCli ?? "claude"`
  - `procedureDefaults.orchestrator.runner = config.defaultCli ?? "claude"`

### 3.3 Procedure Metadata
- Extend `ProcedureDefinition` (`packages/edge-worker/src/procedures/types.ts`) with:
  ```ts
  interface ProcedureDefinition {
    name: string;
    preferredRunner?: RunnerType;     // optional hint bundled with prompt
  }
  ```
- Seed orchestrator to `preferredRunner: "claude"` so existing installs behave as before; repository overrides can flip to Codex.

### 3.4 Runner Selection Pipeline
Refactor the session start flow in `packages/edge-worker/src/EdgeWorker.ts`:
1. **Classify** issue text (existing `ProcedureRouter.determineRoutine`) but pass in classifier runner/model derived from config/repository override.
2. **Determine procedure** via `getProcedureForClassification`.
3. **Select runner** with new helper (`determineRunnerForSession`):
   - Explicit label overrides (e.g., label `codex`) win first.
   - Repository `procedureOverrides[procedureName]`.
   - Global `procedureDefaults[procedureName]`.
   - Repository `runner` (existing field).
   - Global `defaultCli`.
   - Fallback to the classifier runner if all else fails.
4. **Validate availability** (see §4) before instantiating ClaudeRunnerAdapter or CodexRunnerAdapter.
5. Log/post a thought summarizing classification and chosen runner for traceability.

### 3.5 Orchestrator Prompt Considerations
- Ensure orchestrator prompt instructions remain valid when Codex is selected:
  - Update `packages/edge-worker/prompts/orchestrator.md` to remove Claude-only assumptions (e.g., references to Claude sessions) or gate them behind runner checks.
  - Optionally add a short note telling Codex orchestration to confirm CLI availability.

## 4. Runner Availability Safeguards
- Add a `validateRunnerAvailability(runner: RunnerType)` utility in `packages/edge-worker/src/EdgeWorker.ts` (or a new helper module):
  - **Claude**: confirm Anthropic credentials are configured (env vars or config). Fail fast with actionable error if missing.
  - **Codex**: check `openai` CLI or Codex binary accessibility, plus ensure OpenAI API key is provided (config or env) and tests pass (`spawnSync` with `--version`).
- On EdgeWorker startup:
  - Validate the classifier runner and every runner referenced in global defaults.
  - Emit warnings for unused but misconfigured runners; only throw if a required runner is missing.
- During session start:
  - If validation fails, either:
    - Downgrade to the other runner (when allowed) and log a warning, or
    - Abort the session with a clear error (configurable behaviour, default to abort to avoid silent misrouting).

## 5. Implementation Steps (Detailed)
1. **Merge Execution**
   - Create integration branch, merge upstream, resolve conflicts per §3.1.
   - Keep detailed notes on merges to feed into code review.
2. **Dependency Alignment**
   - Update `pnpm-lock.yaml`, `pnpm-lock` run, ensure new packages (simple-agent-runner) build.
   - Verify our Codex CLI commands still compile after upstream changes.
3. **Schema & Types**
   - Edit `packages/edge-worker/src/types.ts` to add the new config interfaces.
   - Regenerate types in dependent packages if necessary (`cyrus-core`, `apps/cli`).
4. **Config Initialization**
   - Update CLI config scaffolding and migrations in `apps/cli/app.ts` to write explicit defaults.
   - Expose user-facing commands for the new knobs (`set-classifier`, `set-procedure-default`) and adjust docs/examples (`docs/multi-cli-runner-spec.md`, config snippets) to show new fields.
5. **Procedure Definitions**
   - Extend `packages/edge-worker/src/procedures/types.ts` and update registry entries with `preferredRunner` hints.
6. **Runner Determination Logic**
   - Refactor session startup in `packages/edge-worker/src/EdgeWorker.ts` to call the new helper.
   - Ensure Codex queueing (`enqueueCodexLinearActivity`) still works when classification triggers Codex.
7. **Classifier Runner Flexibility**
   - Allow `ProcedureRouter` to accept runner configuration: instantiate `SimpleClaudeRunner` or a future Codex variant based on config (initial implementation uses Claude but injects model overrides; leave TODO for Codex support).
8. **Availability Validation**
   - Implement utility checks and integrate into EdgeWorker startup and session creation paths.
9. **Prompt Adjustments**
   - Review orchestrator prompt and related subroutines; clarify instructions for Codex and ensure no Claude-specific references remain without guards.
10. **Testing**
   - Add unit tests for runner selection (classifier override, procedure overrides, label priority).
   - Extend Codex integration tests to cover orchestrator routing.
   - Smoke-test fallback behaviour when a runner is misconfigured.
11. **Documentation & Release Notes**
   - Update `CLAUDE.md` / `docs/multi-cli-runner-spec.md` with configuration instructions.
   - Prepare changelog entry under “Unreleased”.

## 6. Testing Strategy
- **Unit**: New helper for runner selection (input permutations), config parsing.
- **Integration**: Use Vitest suites (`packages/edge-worker/test/EdgeWorker.*.test.ts`) to assert classifier defaults, orchestrator runner override, runner validation error paths.
- **Manual / CLI**: Run `cyrus start` with:
  - Pure Codex configuration (classifier + procedures).
  - Mixed configuration (classifier Claude, full-development Codex).
  - Missing Codex CLI to confirm safety checks.
  - 2025-11-06: CLI updated to handle codex-cli 0.55+ (stdin login + login status probe); reran the sandbox workflow with `/tmp/cyrus-{claude,codex,mixed}-validation-2` — all three ended with `✅ Validation complete`.

## 7. Migration & Rollout
- Provide a CLI migration command update that populates new config keys for existing installations (defaulting to Claude).
- Communicate the need for updated environment variables (OpenAI keys) when switching procedures to Codex.
- After merge, align with upstream releases: run `pnpm typecheck`, `pnpm test:packages:run`, Codex suites, and update changelog.
- Coordinate final release with version bump capturing both upstream changes (0.1.49–0.1.59) and our multi-CLI enhancements.

## 8. Current Merge Conflict Snapshot (2025-11-02)
- [x] `CHANGELOG.md` – merged `[Unreleased]` section combining upstream SDK bumps with Codex queue updates.
- [x] `apps/cli/app.ts` – merged upstream CLI with Codex commands and prompt tooling intact.
- [x] `packages/edge-worker/package.json` – adopted upstream deps (Linear SDK 60, chokidar, simple-agent-runner) and retained workspace tooling.
- [x] `packages/edge-worker/src/AgentSessionManager.ts` – switched to upstream procedure-aware manager; Codex parent/resume hooks preserved.
- [x] `packages/edge-worker/src/EdgeWorker.ts` – procedure router + Codex queue/permissions integrated; stop/resume paths reconciled.
- [x] `packages/edge-worker/src/index.ts` – exports now proxy cyrus-core config types plus `SAFE_BASH_TOOL_ALLOWLIST`.
- [x] `packages/edge-worker/src/types.ts` – re-exported shared config types from core.
- [x] `packages/edge-worker/test/EdgeWorker.label-based-prompt-command.test.ts`
- [x] `packages/edge-worker/test/EdgeWorker.system-prompt-resume.test.ts`
- [x] `pnpm-lock.yaml`

### Follow-up TODOs after merge resolution
1. Wire new configuration knobs outlined in §3.2 (`classifier`, `procedureDefaults`, `classifierOverride`, `procedureOverrides`) across `cyrus-core`, edge worker, and CLI scaffolding.
2. Implement runner availability validation and surface actionable error messaging when Codex prerequisites (OpenAI key, CLI install) are missing. (Completed 2025-11-06: `cyrus connect-openai` auto-selects stdin vs. legacy login flags and `cyrus validate` checks `codex login status`; keep monitoring codex-cli releases for additional changes.)
3. Extend procedure routing tests to cover codex-specific permutations (label override + procedure runner mismatch).
4. Audit orchestrator prompt content for Claude-only assumptions; add Codex disclaimers or split instructions where necessary.
5. Update docs (`CLAUDE.md`, `README`, multi-runner spec) once configuration knobs land, clarifying how operators select default runners per procedure.

Expect additional implicit conflicts where upstream removed files we rely on (prompt TUI). Update this matrix as conflicts are resolved or new ones surface.
