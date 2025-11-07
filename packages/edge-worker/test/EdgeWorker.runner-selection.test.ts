import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock("cyrus-ndjson-client", () => ({
	NdjsonClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	})),
}));

vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn(() => ["Read", "Edit"]),
	getReadOnlyTools: vi.fn(() => ["Read"]),
	getAllTools: vi.fn(() => ["Read", "Edit", "Task"]),
	getCoordinatorTools: vi.fn(() => ["Read"]),
}));

vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		createAgentActivity: vi.fn(),
		users: { me: vi.fn().mockResolvedValue({ id: "user", name: "Tester" }) },
	})),
}));

vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		registerOAuthCallbackHandler: vi.fn(),
		getPort: vi.fn().mockReturnValue(3456),
	})),
}));

vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => ({
		addClaudeRunner: vi.fn(),
		getSession: vi.fn(),
		getAllSessions: vi.fn().mockReturnValue([]),
		serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
		restoreState: vi.fn(),
		postRoutingThought: vi.fn(),
		postProcedureSelectionThought: vi.fn(),
		hasClaudeRunner: vi.fn().mockReturnValue(false),
	})),
}));

vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});

vi.mock("node:child_process", () => {
	const spawnSync = vi.fn(() => ({
		status: 0,
		stdout: "codex 1.0.0",
		stderr: "",
	}));
	return { spawnSync };
});

const { spawnSync } = await import("node:child_process");

describe("EdgeWorker runner configuration", () => {
	let baseRepository: RepositoryConfig;
	let baseConfig: EdgeWorkerConfig;
	let _edgeWorker: EdgeWorker;
	const originalEnvKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();

		baseRepository = {
			id: "repo-1",
			name: "Repository One",
			repositoryPath: "/tmp/repos/repo-1",
			workspaceBaseDir: "/tmp/workspaces/repo-1",
			baseBranch: "main",
			linearToken: "linear-token",
			linearWorkspaceId: "workspace-1",
			isActive: true,
		};

		baseConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/cyrus-home",
			repositories: [baseRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/tmp/workspaces/repo-1/TEST-1",
					isGitWorktree: false,
				}),
			},
		};

		process.env.OPENAI_API_KEY = "";
	});

	afterEach(() => {
		process.env.OPENAI_API_KEY = originalEnvKey;
	});

	const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

	const createEdgeWorker = (
		configOverrides?: Partial<EdgeWorkerConfig>,
	): EdgeWorker => {
		const config: EdgeWorkerConfig = {
			...clone(baseConfig),
			...(configOverrides ?? {}),
		};
		if (configOverrides?.repositories) {
			config.repositories = configOverrides.repositories;
		}
		return new EdgeWorker(config);
	};

	const callResolveRunnerSelection = (
		worker: EdgeWorker,
		repository: RepositoryConfig,
		options: {
			labels?: string[];
			procedureName?: string;
			classification?: string;
		} = {},
	) => {
		const resolver = (worker as any).resolveRunnerSelection.bind(worker);
		return resolver({
			labels: options.labels ?? [],
			repository,
			procedureName: options.procedureName,
			classification: options.classification,
		});
	};

	describe("resolveRunnerSelection", () => {
		it("prefers label agent routing overrides", () => {
			const repository = clone(baseRepository);
			repository.labelAgentRouting = [
				{ labels: ["codex-priority"], runner: "codex", model: "gpt-4o-mini" },
			];
			const worker = createEdgeWorker({ repositories: [repository] });

			const selection = callResolveRunnerSelection(worker, repository, {
				labels: ["codex-priority"],
			});

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-mini",
			});
		});

		it("honors repository procedure overrides before global defaults", () => {
			const repository = clone(baseRepository);
			repository.procedureOverrides = {
				"full-development": { runner: "codex", model: "gpt-4o-mini" },
			};
			const worker = createEdgeWorker({
				repositories: [repository],
				procedureDefaults: {
					"full-development": { runner: "claude", model: "sonnet" },
				},
			});

			const selection = callResolveRunnerSelection(worker, repository, {
				procedureName: "full-development",
			});

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-mini",
			});
		});

		it("falls back to global procedure defaults when no repo override present", () => {
			const repository = clone(baseRepository);
			const worker = createEdgeWorker({
				repositories: [repository],
				procedureDefaults: {
					"debugger-full": { runner: "codex", model: "gpt-4o-mini" },
				},
			});

			const selection = callResolveRunnerSelection(worker, repository, {
				procedureName: "debugger-full",
			});

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-mini",
			});
		});

		it("applies model-only overrides while preserving resolved runner", () => {
			const repository = clone(baseRepository);
			repository.runner = "claude";
			repository.procedureOverrides = {
				"full-development": { model: "sonnet" },
			};
			const worker = createEdgeWorker({ repositories: [repository] });

			const selection = callResolveRunnerSelection(worker, repository, {
				procedureName: "full-development",
			});

			expect(selection).toEqual({
				type: "claude",
				model: "sonnet",
			});
		});

		it("uses classification overrides when procedure name is absent", () => {
			const repository = clone(baseRepository);
			const worker = createEdgeWorker({
				repositories: [repository],
				procedureDefaults: {
					code: { runner: "codex", model: "gpt-4o-mini" },
				},
			});

			const selection = callResolveRunnerSelection(worker, repository, {
				classification: "code",
			});

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-mini",
			});
		});

		it("falls back to repository runner when no overrides matched", () => {
			const repository = clone(baseRepository);
			repository.runner = "codex";
			repository.runnerModels = {
				claude: {},
				codex: { model: "gpt-4o-reliable" },
			};
			const worker = createEdgeWorker({ repositories: [repository] });

			const selection = callResolveRunnerSelection(worker, repository);

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-reliable",
			});
		});

		it("ultimately uses default CLI when no overrides exist", () => {
			const repository = clone(baseRepository);
			const worker = createEdgeWorker({
				repositories: [repository],
				defaultCli: "codex",
				cliDefaults: { codex: { model: "gpt-4o-mini" } },
			});

			const selection = callResolveRunnerSelection(worker, repository);

			expect(selection).toEqual({
				type: "codex",
				model: "gpt-4o-mini",
			});
		});
	});

	describe("validateRunnerAvailability", () => {
		it("throws when Codex is required but no OpenAI key is configured", () => {
			const repository = clone(baseRepository);
			const worker = createEdgeWorker({
				repositories: [repository],
				defaultCli: "codex",
			});

			expect(() => (worker as any).validateRunnerAvailability()).toThrow(
				"Codex runner is configured but no OpenAI API key is available",
			);
		});

		it("throws when Codex CLI check fails", () => {
			(process.env as NodeJS.ProcessEnv).OPENAI_API_KEY = "test-key";
			(spawnSync as vi.Mock).mockReturnValueOnce({
				status: 1,
				stdout: "",
				stderr: "command not found",
			});
			const worker = createEdgeWorker({
				defaultCli: "codex",
			});

			expect(() => (worker as any).validateRunnerAvailability()).toThrow(
				"Codex runner is configured but the Codex CLI is not available",
			);
		});

		it("passes when Codex CLI and key are available via credentials", () => {
			const repository = clone(baseRepository);
			const worker = createEdgeWorker({
				repositories: [repository],
				defaultCli: "codex",
				credentials: { openaiApiKey: "stored-key" },
			});

			expect(() => (worker as any).validateRunnerAvailability()).not.toThrow();
			expect(spawnSync).toHaveBeenCalledWith("codex", ["--version"], {
				encoding: "utf-8",
			});
		});
	});
});
