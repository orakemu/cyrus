Status: In Progress
Owner: Cyrus core
Last Updated: 2025-09-25
Progress Checklist:
- [x] Goals and scope
- [x] Config schema changes with examples
- [x] Runner abstraction overview
- [x] Label routing + selection order
- [x] Integration details (Claude, Codex, OpenCode)
- [x] Open Questions resolved
- [x] Links to sub-guides
- [ ] Final approval

# Cyrus Multi-CLI Agent Support (Claude & Codex)

## Goal

Extend Cyrus beyond Claude Code by adding first-class support for the OpenAI Codex CLI (openai/codex).

Users can:

- Set a default CLI and a default model per CLI (globally and per repo)
- Connect an OpenAI account (API key) for Codex
- Route Linear issues to a specific CLI based on labels

This spec outlines UX, config, architecture, adapters, and concrete changes across this repo.

For step-by-step, junior‑friendly guides, see [docs/specs/README.md](specs/README.md). Guidance for a future OpenCode adapter now lives in [docs/specs/opencode-integration-guidelines.md](specs/opencode-integration-guidelines.md).

## High-Level Design

Introduce a "Runner" abstraction so EdgeWorker can orchestrate any agent CLI with a consistent interface. We will:

- Wrap the current Claude flow behind a ClaudeRunnerAdapter
- Add CodexRunnerAdapter using `codex exec --json` (non-interactive/CI mode)
- Add selection logic to pick a runner per issue based on labels, per-repo override, or global defaults
- Normalize adapter output through the event model captured in [runner-event-normalization.md](specs/runner-event-normalization.md) so the edge worker stays CLI-agnostic
- Let Codex sandbox/approval flags come from config defaults (`cliDefaults.codex`); do not hard-code read-only

Initial implementation targets correctness and simple streaming (when available). We preserve all current Claude behavior and configuration; new features are opt-in.

## User Experience

- Global defaults live in `~/.cyrus/config.json`
  - default CLI (e.g. `"claude"` or `"codex"`)
  - default model per CLI
  - per-CLI settings (e.g. Codex approval policy, sandbox)
  - optional classifier runner/model selection and procedure defaults
- Per-repo overrides in the existing `repositories[]` entries
- Label-based routing can pick a CLI and optionally override model for that CLI
- New CLI commands in `cyrus` for connecting OpenAI, tuning the classifier, and assigning procedure defaults.

### End-to-End CLI Walkthrough (Operator Checklist)

1. **Connect OpenAI** (Codex only)
   ```bash
   cyrus connect-openai --non-interactive --api-key "$OPENAI_API_KEY"
   ```
   - Stores the API key in `credentials.openaiApiKey` and runs `codex login`. The CLI detects the installed codex-cli version, piping the key via `--with-api-key` when required and falling back to the legacy `--api-key` flag for older releases. If the CLI is missing, the command prompts the operator to install it.

2. **Set global defaults**
   ```bash
   cyrus set-default-cli claude
   cyrus set-default-model claude claude-3.7-sonnet
   cyrus set-default-model codex o3-mini
   ```
   - Establishes the fallbacks used when repositories do not specify a runner.

3. **Configure the classifier**
   ```bash
   cyrus set-classifier codex o3-mini
   ```
   - Redirects intelligent routing (procedure classification) through Codex when desired. Omit the model or pass `--clear-model` to revert to defaults.

4. **Set procedure defaults**
   ```bash
   cyrus set-procedure-default full-development codex o3-mini
   cyrus set-procedure-default orchestrator-full claude claude-3.7-sonnet
   ```
   - Pins specific procedures to preferred runners. Re-run with `--remove` to drop an override.

5. **Add a repository** (interactive wizard)
   ```bash
   cyrus add-repository
   ```
   - The wizard now prompts for repository-level runner models; it scaffolds `runner`, `runnerModels`, and `procedureOverrides` as needed.

6. **Validate configuration**
   ```bash
   cyrus validate
   ```
   - Runs the same availability checks performed at edge-worker startup (`codex --version`, `codex login status`, OpenAI key presence, Linear token health). Failures block production deployment.

7. **Start the worker**
   ```bash
   cyrus start
   ```
   - The edge worker reuses the saved configuration, enforcing Codex prerequisites before connecting to Linear.

Operators should re-run steps 3–4 when introducing new procedures or adjusting model mixes across repositories.

## Configuration Schema Changes

Add the following to the Edge app config (read from `~/.cyrus/config.json`). These augment existing fields; Claude-only fields continue to work.

Top-level additions (EdgeConfig):

- `defaultCli`: "claude" | "codex"
- `cliDefaults`:
  - `claude?: { model?: string, fallbackModel?: string }`
  - `codex?: { model?: string, approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never", sandbox?: "read-only" | "workspace-write" | "danger-full-access" }`
- `credentials?: { openaiApiKey?: string }`  // optional; env vars preferred
- `classifier?: { runner?: "claude" | "codex", model?: string }`
- `procedureDefaults?: Record<string, { runner?: "claude" | "codex", model?: string }>`

RepositoryConfig additions (packages/edge-worker/src/types.ts):

- `runner?: "claude" | "codex"`  // default CLI for this repository
- `runnerModels?: { claude?: { model?: string, fallbackModel?: string }, codex?: { model?: string } }`
- `labelAgentRouting?: Array<{ labels: string[], runner: "claude" | "codex", model?: string }>`
- `classifierOverride?: { runner?: "claude" | "codex", model?: string }`
- `procedureOverrides?: Record<string, { runner?: "claude" | "codex", model?: string }>`

Notes:

- Existing `model`/`fallbackModel` fields remain for Claude and are read as the default Claude settings for the repo. New `runnerModels.claude` will override those if present.
- Global `promptDefaults` and `labelPrompts` continue to work, independently from runner selection. Prompt choice (debugger/builder/scoper) stays Claude-centric; only which runner is used changes per routing.

### Example Config

```json
{
  "defaultCli": "claude",
  "classifier": { "runner": "claude", "model": "claude-3.7-haiku" },
  "cliDefaults": {
    "claude": { "model": "claude-3.7-sonnet", "fallbackModel": "claude-3.5-sonnet" },
    "codex": { "model": "o3", "approvalPolicy": "never", "sandbox": "workspace-write" }
  },
  "procedureDefaults": {
    "full-development": { "runner": "codex", "model": "o3-mini" },
    "orchestrator-full": { "runner": "claude", "model": "claude-3.7-sonnet" }
  },
  "credentials": { "openaiApiKey": "env:OPENAI_API_KEY" },
  "repositories": [
    {
      "id": "workspace-123",
      "name": "my-app",
      "repositoryPath": "/path/to/repo",
      "baseBranch": "main",
      "linearWorkspaceId": "abc123",
      "linearToken": "...",
      "workspaceBaseDir": "/Users/me/.cyrus/workspaces/my-app",
      "runner": "codex",
      "runnerModels": {
        "codex": { "model": "o3-mini" }
      },
      "classifierOverride": { "runner": "codex", "model": "o3-mini" },
      "procedureOverrides": {
        "debugger-full": { "runner": "claude", "model": "claude-3.7-sonnet" }
      },
      "labelAgentRouting": [
        { "labels": ["PRD"], "runner": "claude", "model": "claude-3.7-sonnet" },
        { "labels": ["Performance"], "runner": "codex", "model": "o3" }
      ],
      "labelPrompts": {
        "debugger": { "labels": ["Bug"], "allowedTools": "all" },
        "builder": { "labels": ["Feature"], "allowedTools": "safe" },
        "scoper": { "labels": ["PRD"], "allowedTools": "readOnly" }
      }
    }
  ]
}
```

## Runner Abstraction

Create a minimal cross-CLI runner interface implemented by adapters:

```ts
type RunnerType = "claude" | "codex";

interface RunnerConfig {
  type: RunnerType;
  cwd: string;                 // workspace path
  prompt: string;              // initial prompt (already built by EdgeWorker)
  model?: string;              // per-runner model identifier
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"; // codex
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never"; // codex
  mcpServers?: McpServerConfig[]; // when applicable
}

type RunnerEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input?: unknown }
  | { kind: "result"; summary?: string } // terminal event
  | { kind: "error"; error: Error };

interface Runner {
  start(onEvent: (e: RunnerEvent) => void): Promise<{ sessionId?: string }>; // returns when started (or immediately for batch)
  stop(): Promise<void>;
}
```

Adapters:

- ClaudeRunnerAdapter: wraps `cyrus-claude-runner` (no behavior change)
- CodexRunnerAdapter: spawns `codex exec --json` with the given prompt and flags; parses JSON events into normalized thought/action/log/final outputs
- *(Deferred)* OpenCodeRunnerAdapter: see [opencode-integration-guidelines](specs/opencode-integration-guidelines.md)

## Runner Selection Logic

Add a resolver that selects the runner and model for a given issue:

Order of precedence (first match wins):

1. `repository.labelAgentRouting` labels
2. Repository `procedureOverrides` (procedure name or classification key)
3. Global `procedureDefaults`
4. Repo-level `runner` / `runnerModels`
5. Global `defaultCli` / `cliDefaults`

If multiple label routing rules match, take the earliest match in `labelAgentRouting`. The resolver runs on new sessions and whenever no runner is active, so overrides take effect on follow-up comments too.

Global/repo classifier overrides affect which runner performs classification, but the chosen procedure ultimately flows through the same precedence list.

### Validation & Safety Checks

Whenever any configuration path resolves to Codex (global defaults, classifier, procedure overrides, repository overrides, or label routing), the edge worker validates the environment during startup:

1. Ensure an OpenAI API key is available (environment variable, `credentials.openaiApiKey`, or repository `openaiApiKey`).
2. Ensure the Codex CLI is installed by running `codex --version`.
3. Confirm authentication status via `codex login status`.

If any check fails, startup aborts with an actionable error. The CLI `cyrus validate` command surfaces the same checks for operators.

## Integration Details by CLI

### Claude (existing)

No changes to Claude flows besides being invoked via the abstraction. We continue to:

- Build system/user prompts from `labelPrompts` and prompt templates
- Configure allowed tools and MCP servers
- Stream SDK messages back to Linear via AgentSessionManager

Code touchpoints:

- packages/edge-worker/src/EdgeWorker.ts — replace direct `new ClaudeRunner` usage with RunnerFactory
- packages/edge-worker/src/AgentSessionManager.ts — remains main postback for Claude (see “Messaging unification” below)

### Codex CLI (openai/codex)

References:

- CLI: https://github.com/openai/codex
- Non-interactive mode: `codex exec --json "..."` (docs/getting-started.md, docs/advanced.md)
- Flags: `--model/-m`, `--cd`, `--approval-policy`, `--sandbox`, `--full-auto`
- Auth: `codex login` (OAuth) or piping an API key via `printenv OPENAI_API_KEY | codex login --with-api-key`. `cyrus connect-openai` should detect CLI ≥0.55 and choose the stdin flow automatically.
- Validation: `cyrus validate` runs a Codex health check to confirm the CLI is installed and authenticated, relying on `codex login status` for compatibility across codex-cli releases.

Invocation (baseline):

- Command: `codex exec --json --cd <workspace> -m <model> --approval-policy never --sandbox workspace-write "<prompt>"`
- Environment: `OPENAI_API_KEY` set if using API key auth
- Output handling: capture stdout/stderr, stream lines as `RunnerEvent { kind: "text" }`, emit `result` on process exit
- Optional resume: future enhancement via `codex exec resume --last` to continue prior context
- 2025-11-06 note: `cyrus validate` now uses `codex login status`; future follow-up can revisit whether a lightweight `codex exec` probe is still required once we settle on a production-safe invocation format.

Sandbox/Approvals mapping from Cyrus tool presets:

- readOnly → `--sandbox read-only`, `--approval-policy never` (model won’t escalate; emphasize read‑only in the prompt)
- safe → `--sandbox workspace-write`, `--approval-policy on-request`
- all → `--sandbox danger-full-access`, `--approval-policy never`

Notes:

- Codex doesn’t expose a JSON event stream by default; first pass will stream stdout lines to Linear
- Codex manages file edits and git; our worktree isolation remains the right safety boundary
- Linear posts (thoughts/actions/responses/errors) flow through a per-session queue so they reach Linear in emission order. This serialization currently applies only to Codex activity; Claude and other runners retain their existing post behavior.

### Future Work: OpenCode CLI (sst/opencode)

Implementation for OpenCode has been deferred. When we revisit it, reuse the preserved research in [docs/specs/opencode-integration-guidelines.md](specs/opencode-integration-guidelines.md) covering REST flows, SSE mapping, and auth expectations.

## Messaging Unification to Linear

Today, `AgentSessionManager` is Claude-specific and expects `cyrus-claude-runner` SDK messages. We need a minimal bridge so other runners can post updates:

Phase 1 (minimal):

- Add a generic posting path in EdgeWorker that:
  - Posts an instant acknowledgment thought (existing)
  - Streams textual chunks from Codex/OpenCode as simple “assistant text” thoughts to Linear agent sessions
  - Posts a final summary on completion
- Do not attempt to reconstruct tool-use graphs for non-Claude runners initially

Phase 2 (better streaming):

- Extend AgentSessionManager to accept a simplified `RunnerEvent` stream and render richer entries when possible (e.g., OpenCode tool execution events)

Files to adjust:

- packages/edge-worker/src/EdgeWorker.ts — branch to a generic “postAssistantText” path for non-Claude
- packages/edge-worker/src/AgentSessionManager.ts — optionally add helpers for posting plain text chunks tied to a session

## Selection Flow in EdgeWorker

Where: `packages/edge-worker/src/EdgeWorker.ts`

New steps around current session creation:

1. Fetch labels for the issue (existing)
2. Determine prompt type/system prompt from labels (existing)
3. Determine runner+model from `labelAgentRouting` → repo runner override → global defaults
4. Build the initial prompt string (existing logic; reused for all CLIs)
5. Create the runner via factory and start it
6. Pump events to Linear using either the Claude path or the generic text path

## Cyrus CLI Additions (apps/cli)

Add subcommands to `apps/cli/app.ts`:

- `cyrus connect-openai` — prompts for `OPENAI_API_KEY`, stores in `~/.cyrus/config.json` under `credentials.openaiApiKey` (or uses env vars), applies to Codex (`codex login --api-key`)
- `cyrus set-default-cli <claude|codex>` — updates `defaultCli`
- `cyrus set-default-model <cli> <model>` — updates `cliDefaults[cli].model`
- `cyrus set-classifier <claude|codex> [model]` — updates `classifier`
- `cyrus set-procedure-default <procedure> <claude|codex> [model]` (with `--remove`) — updates `procedureDefaults`

Wizard updates:

- During `add-repository`, ask for default runner for this repo and per-CLI model overrides (optional)

## Concrete Code Changes (by file)

Core types and config:

- packages/edge-worker/src/types.ts
  - Add fields: `runner`, `runnerModels`, `labelAgentRouting`
  - Add EdgeConfig fields: `defaultCli`, `cliDefaults`, `credentials?`

Runner abstraction and adapters:

- New package: `packages/runner` (or `packages/agent-runner`)
  - Exports `Runner`, `RunnerConfig`, `RunnerEvent`, `RunnerFactory`
  - Implements `ClaudeRunnerAdapter` (wrap `cyrus-claude-runner`)
  - Implements `CodexRunnerAdapter` (spawns `codex exec`)
  - *(Deferred)* OpenCodeRunnerAdapter lives in [opencode-integration-guidelines](specs/opencode-integration-guidelines.md)

Edge worker orchestration:

- packages/edge-worker/src/EdgeWorker.ts
  - Add `resolveRunnerSelection(labels, repo, global)`
  - Replace direct Claude instantiation with `RunnerFactory.create()`
  - Add generic streaming-to-Linear handler for non-Claude

Session messaging bridge (optional, Phase 1 minimal):

- packages/edge-worker/src/AgentSessionManager.ts
  - Add a method `postAssistantText(linearAgentActivitySessionId: string, text: string)`
  - Use for Codex/OpenCode streaming

CLI app changes:

- apps/cli/app.ts
  - Extend `EdgeConfig` type and save/load paths
  - Add new commands and prompts described above
  - Persist `cliDefaults` and repo `runner` settings

Docs/UI:

- README: add sections for multi-CLI, OpenAI connect, and label-based runner routing (follow-up PR)

## Auth & Accounts

OpenAI Account for Codex:

- Headless-friendly: run `codex login --api-key "$OPENAI_API_KEY"` before using Codex
- Cyrus command `cyrus connect-openai` can run this automatically if the CLI is available, otherwise instruct the user

OpenAI Account for OpenCode:

- Call `PUT /auth/openai` with `{ type: "api", key: "..." }` to set API credentials in OpenCode’s store
- Optionally set Anthropic, etc., via their provider ids as needed

Security/Storage:

- Prefer environment variables to store API keys; if `credentials.openaiApiKey` is present, treat it as a convenience fallback
- Do not log secrets

## Linear Label → CLI Routing

Add `labelAgentRouting` to `RepositoryConfig` with precedence over `labelPrompts`. When both exist:

- First pick the runner from `labelAgentRouting`
- Then compute prompt type/system prompt via `labelPrompts` (if Claude is selected)

If a non-Claude runner is selected, we still reuse the same prompt text builder (issue context + label template) to ensure consistent instructions across CLIs.

## Backwards Compatibility & Migration

- If no multi-CLI fields are present, behavior is identical to today (Claude-only).
- Existing config is migrated as-is; `model`/`fallbackModel` continue to apply to Claude.
- New settings are additive; repos can opt-in gradually.
- Config upgrades are performed by [`cyrus migrate-config`](docs/specs/upgrade-and-migration.md), which backs up the current file, adds missing multi-CLI keys, saves the result, and prints a diff summary without touching webhook or hosting values.

## Rollout Plan

Phase 0: Spec and scaffolding

- Add types and no-op defaults; wire defaults to Claude

Phase 1: Codex adapter (non-interactive)

- Spawn `codex exec --json` in repo worktrees; parse JSON events and forward normalized messages to Linear
- Add `cyrus connect-openai`
- Add runner selection and repo/global defaults

Phase 2: Messaging polish (Codex)

- Optional Codex session resume support (`codex exec resume`)

Deferred: OpenCode adapter work captured in [opencode-integration-guidelines](specs/opencode-integration-guidelines.md).

## Risks & Open Questions

- Codex stdout is not an official API; output format may change. We mitigate by treating it as best-effort text streaming and posting a final summary on completion.
- Tool gating parity: Claude has explicit tool/permission controls while Codex relies on sandbox/approval flags. Map Cyrus presets carefully and document limitations.

## References (from this repo)

- Current CLI app: `apps/cli/app.ts` (config load/save, setup wizard)
- Edge worker orchestrator: `packages/edge-worker/src/EdgeWorker.ts`
- Types: `packages/edge-worker/src/types.ts` (RepositoryConfig, EdgeWorkerConfig)
- Session manager: `packages/edge-worker/src/AgentSessionManager.ts`
- Claude runner: `packages/claude-runner` (adapts Claude SDK)

## Open Questions & Recommendations

1. Codex sandbox/approvals mapping
   - Question: How should Cyrus tool presets map to Codex `--sandbox` and `--approval-policy`?
   - Recommendation: readOnly → `--sandbox read-only` + `--approval-policy never`; safe → `--sandbox workspace-write` + `--approval-policy on-request`; all → `--sandbox danger-full-access` + `--approval-policy never`.

2. OpenCode defaults *(deferred)*
   - Open questions around provider selection and server URL have moved to [opencode-integration-guidelines](specs/opencode-integration-guidelines.md).

4. OpenAI API key storage
   - Question: Where should we store the user’s OpenAI API key (if they choose to persist it)?
   - Recommendation: Prefer environment variable. Optionally store under `credentials.openaiApiKey` in `~/.cyrus/config.json`. Never log. CLI can run `codex login --api-key` if available.

5. Linear posting cadence (non-Claude)
   - Question: Stream each line as a thought or batch?
   - Decision: Mirror current Claude cadence as closely as possible; if needed, coalesce to ~500–1000 char chunks to reduce noise.

6. Attachments in non-Claude prompts
   - Question: Should we embed file contents or references?
   - Decision: Reuse existing behavior. EdgeWorker already downloads attachments and appends a markdown manifest (titles, URLs, local paths) to the prompt, plus adds an attachments directory to allowed paths. Non‑Claude runners will receive the same manifest appended to their initial prompt.

7. Resume behavior for Codex/OpenCode
   - Question: Implement session resume in the first release?
   - Decision: Codex resume depends on CLI support for `codex exec resume` and surfacing conversation IDs. We will defer Codex resume until the CLI guarantees stable IDs. OpenCode resume is feasible now by reusing the OpenCode session id and POSTing additional `/session/:id/command` calls for subsequent prompts in the same Linear session.

8. Package layout for adapters
   - Question: New package vs. in-place within edge-worker?
   - Decision: Create `packages/agent-runner` from the start for clean boundaries.

9. Label routing precedence inside a repository
   - Question: How does `labelAgentRouting` interact with `labelPrompts` and repo/global runner defaults?
   - Recommendation: Determine repository (existing routing). Within that repo, `labelAgentRouting` selects runner+model first; if runner=claude, then `labelPrompts` selects prompt type.

10. Error messaging verbosity
   - Question: How verbose should guidance be in Linear thoughts on failures?
   - Recommendation: One or two actionable lines (install, link, set env) without stack traces.

11. OpenCode SSE event filtering
   - Question: Which field identifies the session in `/event` payloads?
   - Recommendation: Filter by `properties.sessionID`; fall back to defensive parsing and text aggregation if schema varies.

12. Default CLI when unspecified
   - Question: What is the global default CLI?
   - Decision: Default remains `claude` for backward compatibility. During initial setup, prompt the user to choose a default CLI and persist to `defaultCli`.

## External References

- OpenAI Codex CLI: https://github.com/openai/codex
  - Non-interactive mode: docs/getting-started.md#cli-usage, docs/advanced.md#non-interactive--ci-mode
  - Auth via API key: docs/authentication.md
  - Config & flags: docs/config.md
- OpenCode references archived in [opencode-integration-guidelines](specs/opencode-integration-guidelines.md)

---

Implementation Guides Index: see [docs/specs/README.md](specs/README.md) for phased, detailed instructions and acceptance criteria.

## Troubleshooting

### Edge worker always picks Claude despite `defaultCli: "codex"`

- **Symptoms**: All new Linear sessions instantiate `ClaudeRunner`, even with `defaultCli` and per-repo `runner` set to `"codex"`. No `[EdgeWorker][debug] [resolveRunnerSelection] …` logs appear, and the CLI banner still reports the correct defaults.
- **Root cause**: The published `cyrus-edge-worker` package exported `dist/index.js`, which is generated for the legacy single-runner build. That bundle never registers the new runner factory or `resolveRunnerSelection`, so selection always falls back to Claude.
- **Fix**: Point the package entrypoints to the new multi-runner bundle (`dist/edge-worker/src/index.js` and matching `.d.ts`), then rebuild:
  1. Update `packages/edge-worker/package.json` `main`/`types` to `dist/edge-worker/src/index.js` / `index.d.ts`.
  2. Rebuild dependant packages: `pnpm --filter cyrus-edge-worker build` and `pnpm --filter cyrus-ai build`.
  3. Restart the CLI with `DEBUG_EDGE=true … start` and confirm `[resolveRunnerSelection]` debug lines show the selected runner.
- **Verification tip**: From a REPL `import('cyrus-edge-worker').then(m => m.EdgeWorker.prototype.resolveRunnerSelection?.toString())` should include `defaultCli`. If it returns `undefined`, the old bundle is still active.

## Definition of Done

- Core goals, scope, and selection flow documented for Claude, Codex, and OpenCode.
- Config schema updates include runnable JSON examples and field parity with [docs/specs/phase-0-scaffold.md](specs/phase-0-scaffold.md).
- Runner abstraction, package layout, and adapter responsibilities align with [docs/specs/runner-interface.md](specs/runner-interface.md).
- Backwards compatibility plan references [docs/specs/upgrade-and-migration.md](specs/upgrade-and-migration.md) and reflects the migrate-config algorithm.
- Open questions resolved with actionable decisions for implementation teams.
