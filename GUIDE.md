# Cyrus Multi-Runner User Guide

## 1. Overview
- Cyrus monitors Linear issues, creates isolated worktrees, and runs either Claude Code or Codex per issue.
- Routing is governed by global defaults, per-repository settings, labels, and procedure overrides.
- Results stream back to Linear with ordered thoughts/actions/final replies, orchestrator/subroutine support, and Codex queueing.

## 2. First-Time Setup
1. Install pnpm 10+, Node 18+, Codex CLI (if using Codex), and `jq`.
2. Clone the repo, then run:
   ```bash
   pnpm install
   pnpm build
   ```
3. Copy `apps/cli/repositories.example.json` to `~/.cyrus/config.json` and customize.

## 3. Configuration Reference (`~/.cyrus/config.json`)
- `defaultCli`: `"claude"` or `"codex"`.
- `cliDefaults`:
  - `claude`: `{ model, fallbackModel }`
  - `codex`: `{ model, approvalPolicy, sandbox, fullAuto }`
- `classifier`: `{ runner, model }` controlling procedure classification.
- `procedureDefaults`: map from procedure name to `{ runner, model }`.
- `credentials.openaiApiKey`: optional global Codex key (env vars still work).
- `repositories[]` entries include:
  - Git + Linear info: `repositoryPath`, `baseBranch`, `linearWorkspaceId`, `linearToken`, `workspaceBaseDir`.
  - Runner knobs: `runner`, `runnerModels`, `classifierOverride`, `procedureOverrides`.
  - Routing: `labelAgentRouting`, `labelPrompts`, `routingLabels`, `projectKeys`, `teamKeys`.
  - Prompt/tooling: `allowedTools`, `disallowedTools`, `promptTemplatePath`, `mcpConfigPath`.
  - OpenAI media: `openaiApiKey`, `openaiOutputDirectory`.

### Runner Selection Precedence
1. Repository `labelAgentRouting`.
2. Repository `procedureOverrides` (procedure name > classification alias).
3. Global `procedureDefaults`.
4. Repository `runner` / `runnerModels`.
5. Global `defaultCli` / `cliDefaults`.

Classifier overrides affect which runner performs classification; the chosen procedure still flows through the precedence list.

## 4. CLI Workflow (apps/cli)
| Command | Purpose |
| --- | --- |
| `cyrus connect-openai` | Stores OpenAI API key, runs `codex login`. Detects codex-cli ≥0.55 and pipes key via stdin (`--with-api-key`), falling back for older versions. |
| `cyrus set-default-cli <runner>` | Updates `defaultCli`. |
| `cyrus set-default-model <runner> <model>` | Updates `cliDefaults`. |
| `cyrus set-classifier <runner> [model]` | Pins classifier runner/model (`--clear-model` to reset). |
| `cyrus set-procedure-default <procedure> <runner> [model]` | Sets/removes (`--remove`) entries in `procedureDefaults`. |
| `cyrus add-repository` | Interactive wizard that scaffolds runner models, overrides, and prompts. |
| `cyrus validate` | Verifies Linear tokens plus Codex prerequisites (OpenAI key, `codex --version`, `codex login status`). |
| `cyrus start` | Launches the edge worker after validation. |
| `cyrus prompt ...` | Manage prompt assets (`prompt list`, `prompt edit`, `prompt tui`). |

## 5. Day-to-Day Operation
1. Run `cyrus start` (screen/tmux recommended). The worker loads config, validates Codex requirements, then listens for Linear webhooks.
2. When assigned to an issue:
   - Cyrus posts a Proxy Worker “work started” card.
   - Procedure router (SimpleClaudeRunner) classifies the request → picks procedure/subroutine stack.
   - Runner selection chooses Claude vs Codex using the precedence above.
   - Codex path enqueues work, validates permissions, and streams outputs.
3. Stop/resume: commenting “Stop” on the issue halts the current run; a single confirmation card is posted. Next comment resumes the same session.
4. Orchestrator workflow respects label routing, uses subroutines (coding-activity, verifications, etc.), and enforces verification instructions for child issues.

## 6. Customization Tips
- **Mixing Runners**: Use global `classifier` for classification, `procedureDefaults` for specific workflows, and `labelAgentRouting` for label-based overrides.
- **Model Pins**: Set `runnerModels` per repo to lock Codex vs Claude models; pair with procedure overrides for orchestrator/debugger differences.
- **Prompt Tool Presets**: Allowed tools default to a safe git/GitHub allowlist. Override via `allowedTools`/`disallowedTools` or prompt defaults.
- **MCP**: `.mcp.json` at repo root is auto-loaded; `mcpConfigPath` (single or array) adds overrides.
- **Codex Safety**: Tweak `cliDefaults.codex.approvalPolicy`, `sandbox`, and `fullAuto` to match your environment.

## 7. Testing & Validation
Run before merging or releasing:
```bash
pnpm typecheck
pnpm --filter cyrus-edge-worker test:run   # 28 files / 156 tests
pnpm test:packages:run
pnpm build
```
Edge-worker suites cover procedure routing, runner selection, prompt assembly, and Codex regressions. Prompt tests must assert entire strings using `expectUserPrompt`/`expectSystemPrompt`.

## 8. Operational Best Practices
- Keep `docs/blueprints/upstream-merge-conflict-resolution.md` updated whenever syncing upstream or resolving conflicts.
- Document multi-runner work in `docs/blueprints/multi-cli-runner-integration-blueprint.md`.
- Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes before committing.
- Re-run `cyrus validate` after altering runner defaults, Codex credentials, or installing a new codex-cli.
- For releases: publish packages in order (`ndjson-client` → `claude-runner` → `core` → `simple-agent-runner` → `edge-worker` → CLI) with `pnpm install` between publishes.

Use this guide as the operator-facing reference for configuring, customizing, and running Cyrus in multi-runner mode. Update it whenever the workflow or commands change.
