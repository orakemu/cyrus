# Executive Summary
Resolve the current merge of `upstream/main` into `upstream-sync/merge-oct-31`, reconcile upstream Claude-first features with our Codex multi-CLI work, and exit with a clean branch ready to continue the unified multi-CLI implementation. This blueprint maps each conflicted area, the desired end state, and verification steps so the merge preserves both upstream gains and our fork’s differentiators.

# Checkpoints
- [ ] Branch `upstream-sync/merge-oct-31` updated with latest origin and upstream refs
- [x] Conflict matrix reviewed and decisions documented for every file
- [x] CLI (`apps/cli/app.ts`) merged preserving prompt TUI + new upstream commands
- [x] Edge worker core (`packages/edge-worker/*`) merged with procedure routing and Codex support intact
- [x] Config/datatype updates synchronized across `cyrus-core`, `edge-worker`, and CLI
- [x] Tests compile and pass (`pnpm typecheck`, `pnpm test:packages:run`, Codex suites) – reran `pnpm typecheck`, `pnpm --filter cyrus-edge-worker test:run`, and `pnpm test:packages:run` on 2025-11-02 after introducing runner overrides; repeated the same trio on 2025-11-06 (all green) after fixing the simple-agent-runner entrypoint.
- [x] Blueprint updated with resolution notes and follow-on tasks

---

## 1. Context Recap
- Branch `upstream-sync/merge-oct-31` currently contains an interrupted `git merge upstream/main` with conflicts in `apps/cli/app.ts`, multiple edge-worker files, `CHANGELOG.md`, `pnpm-lock.yaml`, and a handful of tests.
- Upstream introduces procedure routing, modular subroutines, Sora/GPT image tools, dynamic config reload, and `cyrus-simple-agent-runner`.
- Our fork adds Codex multi-CLI support, prompt management TUI, Codex queueing/permissions, and documentation/specs.
- Goal: combine both in the integration branch, then continue with the multi-CLI configuration work defined in `docs/blueprints/multi-cli-runner-integration-blueprint.md`.

## 2. Working Branch & Environment Prep
1. Ensure local branch matches latest remote refs:
   ```bash
   git checkout upstream-sync/merge-oct-31
   git fetch origin main
   git fetch upstream main
   ```
   (Do **not** restart the merge; we continue resolving.)
2. Confirm no additional local edits:
   ```bash
   git status -sb
   ```
   Expect conflict markers (`UU`) only in the files listed earlier.
3. Install dependencies (needed for formatting/typing checks later):
   ```bash
   pnpm install
   ```

## 3. Conflict Matrix & Resolution Strategy

| Area | Files | Goal | Resolution Notes |
| --- | --- | --- | --- |
| Documentation & Metadata | `CHANGELOG.md`, `README.md`, `CLAUDE.md` | Preserve upstream release history and add a short note referencing Codex features under “Unreleased”. | `[Unreleased]` now blends upstream SDK bumps with Codex queue/TUI updates. README + CLAUDE.md refreshed on 2025-11-06 with classifier/procedure override docs, Codex validation behaviour, and prompt testing guidance. |
| CLI Entry Point | `apps/cli/app.ts` | Keep upstream’s streamlined command set **plus** our prompt TUI + CLI defaults commands. Ensure imports reflect final `EdgeWorkerConfig` types. | Resolved by rebasing onto upstream CLI, restoring Codex commands (`connect-openai`, defaults/model/migrate/validate), adding multi-runner management (`set-classifier`, `set-procedure-default`), and routing Codex validation through updated config scaffolding. |
| Edge Worker Types & Config | `packages/edge-worker/package.json`, `packages/edge-worker/src/types.ts`, `packages/core/src/config-types.ts`, `packages/core/src/index.ts` | Integrate procedure routing types while retaining Codex model defaults (`runner`, `runnerModels`, label routing). | Completed 2025-11-06: reconciled with upstream shapes, re-exported via `cyrus-core`, updated CLI scaffolding, and reran `pnpm typecheck` (green). |
| Edge Worker Runtime | `packages/edge-worker/src/EdgeWorker.ts`, `src/index.ts`, `src/AgentSessionManager.ts` | Embed procedure router, subroutine system, and keep Codex queueing/permission logic. | Codex helpers re-integrated into procedure-driven flow: runner selection stored in `sessionRunnerSelections`, `startNonClaudeRunner` now feeds queue ordering, stop handling uses `safeStopRunner`, and Claude path untouched. Re-verified Codex event streaming after queue refactor. |
| Tests | `packages/edge-worker/test/EdgeWorker.label-based-prompt-command.test.ts`, `EdgeWorker.system-prompt-resume.test.ts` | Ensure new routing tests compile while preserving Codex regression suites. | ✅ Updated Codex regression + dynamic tools expectations (markSessionComplete gating, safe bash allowlist). All edge-worker tests green on 2025-11-02. |
| Dependency Locks | `packages/edge-worker/package.json`, `pnpm-lock.yaml`, `package.json` | Align versions (Linear SDK 60, Anthropic SDK 0.68) and ensure new packages (simple-agent-runner, image/sora tools) remain. | 2025-11-06: bumped workspace package versions to upstream tags (`core@0.0.21`, `claude-runner@0.0.32`, `edge-worker@0.0.41`, `simple-agent-runner@0.0.4`), updated `@anthropic-ai/claude-agent-sdk` ranges, removed stale `prompt-template-v2.md`, then regenerated lock via `pnpm install`. |

### 2025-11-06 Updates
- CLI smoke test initially failed with `ERR_MODULE_NOT_FOUND` because `cyrus-simple-agent-runner` exported `dist/index.js` that no longer exists. Updated that package’s `main`/`types` to point at `dist/simple-agent-runner/src/index.*`; add a release checklist item so the published tarball matches the workspace build.
- Initial README workflow validation exposed new Codex CLI 0.55 behaviour: `codex login --api-key` now errors (“Pipe the key instead…”) and `codex exec -- bash -lc …` rejects `-lc`.
- Follow-up applied: `cyrus connect-openai` now pipes API keys (fallbacks to legacy flag) and `cyrus validate` uses `codex login status`, restoring the manual validation workflow on codex-cli 0.55.
- Post-fix verification (`/tmp/cyrus-{claude,codex,mixed}-validation-2`, 2025-11-06): Claude-only, Codex-only, and mixed configs all report “✅ Codex authentication verified.” during `cyrus validate`; the login command now surfaces stdin-based authentication output (permission errors expected with placeholder keys).
- Example repository scaffold refreshed (`apps/cli/repositories.example.json`) to document multi-CLI fields: global runner defaults, per-procedure overrides, and label routing.
- Evening follow-up (2025-11-06): realigned `config-types` with upstream, ensured `apps/cli` scaffolding consumes the final shapes, bumped package versions, ran `pnpm typecheck` and `pnpm --filter cyrus-edge-worker test:run` (156 tests) to confirm procedure routing + prompt suites remain green.

Update the table with specific decisions as you work; commit it later for transparency.

## 4. Step-by-Step Resolution Workflow
1. **Documentation Files**
   - Start with `CHANGELOG.md` (smaller conflicts). Keep upstream releases 0.1.49–0.1.59 verbatim.
   - Under `[Unreleased]`, add subsection noting Codex multi-CLI enhancements and upcoming runner-config work.
   - Resolve `README.md`/`CLAUDE.md` by merging upstream instructions and keeping our Codex sections (multi-runner spec references).

2. **CLI File**
   - Use upstream’s structure (imports from `cyrus-core`, minimal surface) as baseline.
   - Reintroduce prompt command helpers (`prompt-executor`, `prompt-list`, `prompt-mutators`, `prompt-tui`) and CLI options (connect-openai, set-default-cli/model, migrate-config, validate).
   - Ensure the CLI still reads package version via `package.json` (upstream already handles this).
   - Verify TypeScript compile by running `pnpm --filter cyrus-ai typecheck` once the merge compiles.

3. **Types & Config**
   - Merge `packages/edge-worker/src/types.ts` with upstream file:
     - Start from upstream type definitions (procedure routing fields) and add back Codex-specific interfaces (`CodexRunnerModelConfig`, `CliDefaults.codex`, label routing).
     - Mirror changes into `packages/core/src/config-types.ts` and exports in `packages/core/src/index.ts`.
   - Update `apps/cli/app.ts` to consume the final shape (no duplicate declarations).

4. **Edge Worker Runtime**
   - Compare upstream `EdgeWorker.ts` to our fork:
     - Identify where upstream now orchestrates procedures and prompts.
     - Reinsert Codex-specific logic (activity queue, permissions, session metadata) into the appropriate lifecycle hooks:
       - Session start (choose runner, maintain queue).
       - Thought/response posting (use queue for Codex).
   - Do the same for `AgentSessionManager.ts` and `index.ts` (exports).
   - Ensure new procedure router is invoked even when Codex is chosen.

5. **Tests**
   - Merge conflicting tests ensuring they reflect both procedure routing and Codex features.
   - Confirm new upstream tests (procedure routing suite) compile with our configuration.

6. **Dependencies**
   - Accept upstream version bumps; ensure `package-lock.json` stays only if necessary (decide whether to keep or remove if repo standard is pnpm only).
   - Run `pnpm install` to regenerate `pnpm-lock.yaml` after conflict resolution.

7. **Sanity Verification**
   - Run:
     ```bash
     pnpm typecheck
     pnpm test:packages:run
     pnpm --filter cyrus-edge-worker test EdgeWorker.codex-integration.test.ts
     ```
   - Manually execute `pnpm --filter cyrus-ai exec -- node dist/apps/cli/app.js --help` to ensure CLI prints merged commands.

8. **Commit & Notes**
   - Once conflicts resolved and tests pass:
     ```bash
     git add .
     git commit -m "Merge upstream main into upstream-sync/merge-oct-31"
     ```
   - Update this blueprint’s conflict matrix with key decisions and any TODOs (e.g., follow-up refactors).
   - If unresolved questions remain (e.g., whether to keep `prompt-tui.tsx` inline), open an issue or add TODO in docs.

## 5. Risks & Mitigations
- **Risk**: Codex queueing logic lost during merge → Mitigation: add unit test verifying sequential Codex activity posting before committing.
- **Risk**: Config mismatch between CLI and edge-worker → Mitigation: run `pnpm typecheck` after merging types; ensure exports match.
- **Risk**: Orchestrator prompt references Claude-only flows → Mitigation: after merge, review prompt file and add TODO to harmonize with Codex; reference initial multi-CLI blueprint.

## 6. Follow-On Tasks (After Merge)
- Continue with configuration runner-selection work from `multi-cli-runner-integration-blueprint.md`.
- Produce a more granular conflict resolution log if additional issues surface.
- Schedule manual validation in a staging environment connecting both Claude and Codex CLIs.
