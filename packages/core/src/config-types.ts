import type { Issue as LinearIssue } from "@linear/sdk";
import type { SDKMessage } from "cyrus-claude-runner";
import type { Workspace } from "./CyrusAgentSession.js";

export type RunnerType = "claude" | "codex";

export interface ProcedureRunnerOverride {
	runner?: RunnerType;
	model?: string;
}

export interface ClassifierConfig extends ProcedureRunnerOverride {}

export interface ClaudeRunnerModelConfig {
	model?: string;
	fallbackModel?: string;
}

export interface CodexRunnerModelConfig {
	model?: string;
}

export interface CodexCliDefaults extends CodexRunnerModelConfig {
	approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
	sandbox?: "read-only" | "workspace-write" | "danger-full-access";
	fullAuto?: boolean;
}

export interface CliDefaults {
	claude?: ClaudeRunnerModelConfig;
	codex?: CodexCliDefaults;
}

export interface EdgeCredentials {
	openaiApiKey?: string;
}

export interface RepositoryRunnerModels {
	claude?: ClaudeRunnerModelConfig;
	codex?: CodexRunnerModelConfig;
}

export interface RepositoryLabelAgentRoutingRule {
	labels: string[];
	runner: RunnerType;
	model?: string;
}

export type PromptToolPreset =
	| string[]
	| "readOnly"
	| "safe"
	| "all"
	| "coordinator";

export interface PromptRuleConfig {
	labels?: string[];
	allowedTools?: PromptToolPreset;
	disallowedTools?: string[];
	promptPath?: string;
}

/**
 * OAuth callback handler type
 */
export type OAuthCallbackHandler = (
	token: string,
	workspaceId: string,
	workspaceName: string,
) => Promise<void>;

/**
 * Configuration for a single repository/workspace pair
 */
export interface RepositoryConfig {
	// Repository identification
	id: string; // Unique identifier for this repo config
	name: string; // Display name (e.g., "Frontend App")
	runner?: RunnerType; // Preferred runner for this repository
	classifierOverride?: ProcedureRunnerOverride; // Override classifier runner/model for this repository

	// Git configuration
	repositoryPath: string; // Local git repository path
	baseBranch: string; // Branch to create worktrees from (main, master, etc.)

	// Linear configuration
	linearWorkspaceId: string; // Linear workspace/team ID
	linearWorkspaceName?: string; // Linear workspace display name (optional, for UI)
	linearToken: string; // OAuth token for this Linear workspace
	teamKeys?: string[]; // Linear team keys for routing (e.g., ["CEE", "BOOK"])
	routingLabels?: string[]; // Linear labels for routing issues to this repository (e.g., ["backend", "api"])
	projectKeys?: string[]; // Linear project names for routing (e.g., ["Mobile App", "API"])

	// Workspace configuration
	workspaceBaseDir: string; // Where to create issue workspaces for this repo

	// Optional settings
	isActive?: boolean; // Whether to process webhooks for this repo (default: true)
	promptTemplatePath?: string; // Custom prompt template for this repo
	allowedTools?: string[]; // Override Claude tools for this repository (overrides defaultAllowedTools)
	disallowedTools?: string[]; // Tools to explicitly disallow for this repository (no defaults)
	mcpConfigPath?: string | string[]; // Path(s) to MCP configuration JSON file(s) (format: {"mcpServers": {...}})
	appendInstruction?: string; // Additional instruction to append to the prompt in XML-style wrappers
	model?: string; // Claude model to use for this repository (e.g., "opus", "sonnet", "haiku")
	fallbackModel?: string; // Fallback model if primary model is unavailable
	runnerModels?: RepositoryRunnerModels; // Per-runner model configuration overrides

	// OpenAI configuration (for Sora video generation and DALL-E image generation)
	openaiApiKey?: string; // OpenAI API key for Sora and DALL-E
	openaiOutputDirectory?: string; // Directory to save generated media (defaults to workspace path)
	procedureOverrides?: Record<string, ProcedureRunnerOverride | undefined>; // Procedure-specific runner overrides

	// Runner routing
	labelAgentRouting?: RepositoryLabelAgentRoutingRule[]; // Label-based runner routing rules

	// Label-based system prompt configuration
	labelPrompts?: {
		debugger?: PromptRuleConfig;
		builder?: PromptRuleConfig;
		scoper?: PromptRuleConfig;
		orchestrator?: PromptRuleConfig;
		[key: string]: PromptRuleConfig | undefined;
	};
}

/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
	// Proxy connection config
	proxyUrl: string;
	baseUrl?: string;
	webhookBaseUrl?: string; // Legacy support - use baseUrl instead
	webhookPort?: number; // Legacy support - now uses serverPort
	serverPort?: number; // Unified server port for both webhooks and OAuth callbacks (default: 3456)
	serverHost?: string; // Server host address ('localhost' or '0.0.0.0', default: 'localhost')
	ngrokAuthToken?: string; // Ngrok auth token for tunnel creation

	// Claude config (shared across all repos)
	defaultAllowedTools?: string[];
	defaultDisallowedTools?: string[]; // Tools to explicitly disallow across all repositories (no defaults)
	defaultModel?: string; // Default Claude model to use across all repositories (e.g., "opus", "sonnet", "haiku")
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable
	defaultCli?: RunnerType; // Default runner to use when repository doesn't override
	cliDefaults?: CliDefaults; // Per-runner default configuration
	credentials?: EdgeCredentials; // Stored credential shortcuts (e.g., OpenAI API key reference)
	classifier?: ClassifierConfig; // Runner/model configuration for the classifier
	procedureDefaults?: Record<string, ProcedureRunnerOverride | undefined>; // Default runner overrides per procedure name

	// Global defaults for prompt types
	promptDefaults?: {
		debugger?: PromptRuleConfig;
		builder?: PromptRuleConfig;
		scoper?: PromptRuleConfig;
		orchestrator?: PromptRuleConfig;
		[key: string]: PromptRuleConfig | undefined;
	};

	// Repository configurations
	repositories: RepositoryConfig[];

	// Cyrus home directory
	cyrusHome: string;

	// Optional handlers that apps can implement
	handlers?: {
		// Called when workspace needs to be created
		// Now includes repository context
		createWorkspace?: (
			issue: LinearIssue,
			repository: RepositoryConfig,
		) => Promise<Workspace>;

		// Called with Claude messages (for UI updates, logging, etc)
		// Now includes repository ID
		onClaudeMessage?: (
			issueId: string,
			message: SDKMessage,
			repositoryId: string,
		) => void;

		// Called when session starts/ends
		// Now includes repository ID
		onSessionStart?: (
			issueId: string,
			issue: LinearIssue,
			repositoryId: string,
		) => void;
		onSessionEnd?: (
			issueId: string,
			exitCode: number | null,
			repositoryId: string,
		) => void;

		// Called on errors
		onError?: (error: Error, context?: any) => void;

		// Called when OAuth callback is received
		onOAuthCallback?: OAuthCallbackHandler;
	};

	// Optional features (can be overridden per repository)
	features?: {
		enableContinuation?: boolean; // Support --continue flag (default: true)
		enableTokenLimitHandling?: boolean; // Auto-handle token limits (default: true)
		enableAttachmentDownload?: boolean; // Download issue attachments (default: false)
		promptTemplatePath?: string; // Path to custom prompt template
		postStatusActivities?: boolean; // Post status cards when sessions complete (default: false)
	};
}

/**
 * Edge configuration containing all repositories and global settings
 */
export interface EdgeConfig {
	repositories: RepositoryConfig[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string; // Default Claude model to use across all repositories
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable
	defaultCli?: RunnerType; // Default runner to use when repository doesn't override
	cliDefaults?: CliDefaults; // Per-runner default configuration
	credentials?: EdgeCredentials; // Stored credentials shortcuts (e.g., OpenAI API key reference)
	classifier?: ClassifierConfig; // Runner/model configuration for the classifier
	procedureDefaults?: Record<string, ProcedureRunnerOverride | undefined>; // Default runner overrides per procedure name
	promptDefaults?: {
		debugger?: PromptRuleConfig;
		builder?: PromptRuleConfig;
		scoper?: PromptRuleConfig;
		orchestrator?: PromptRuleConfig;
		[key: string]: PromptRuleConfig | undefined;
	};
	global_setup_script?: string; // Optional path to global setup script that runs for all repositories
}
