import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./test/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules",
				"test",
				"dist",
				"**/*.d.ts",
				"**/*.config.*",
				"**/mockData.ts",
			],
		},
		testTimeout: 30000,
		hookTimeout: 30000,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@test": path.resolve(__dirname, "./test"),
			"cyrus-core": path.resolve(__dirname, "../core/src/index.ts"),
			"cyrus-claude-runner": path.resolve(
				__dirname,
				"../claude-runner/src/index.ts",
			),
			"cyrus-agent-runner": path.resolve(
				__dirname,
				"../agent-runner/src/index.ts",
			),
			"cyrus-simple-agent-runner": path.resolve(
				__dirname,
				"../simple-agent-runner/src/index.ts",
			),
		},
	},
});
