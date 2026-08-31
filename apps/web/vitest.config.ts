import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./test/setup.ts"],
		include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
		},
	},
});
