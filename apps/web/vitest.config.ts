import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./test/setup.ts"],
		// lib/ is the measured application surface (see `coverage.include`);
		// scripts/e2e/ holds the fixture guards, whose unit tests live next to
		// the code because they are operational tooling, not app code.
		include: ["lib/**/*.test.ts", "lib/**/*.test.tsx", "scripts/**/*.test.ts"],
		coverage: {
			provider: "v8",
			// The A-level quality bar is line coverage on lib/ only.
			include: ["lib/**/*.ts", "lib/**/*.tsx"],
			exclude: ["lib/**/*.test.ts", "lib/**/*.test.tsx", "lib/**/__tests__/**"],
			reporter: ["text-summary", "text", "json-summary"],
			reportsDirectory: "./coverage",
			// RATCHET — raise these, never lower them.
			//
			// Measured 2026-10-29 after four coverage campaigns (I-73, I-74, I-75,
			// I-76), vitest 3.2.7 + @vitest/coverage-v8 3.2.7:
			//   lines      92.42%
			//   statements 92.42%
			//   functions  94.85%
			//   branches   84.94%
			//
			// RE-BASELINED 2026-11-01 (Jeff's decision, #328) for vitest 4.1.12. Vitest 4
			// uses AST-aware v8 remapping, so the same tests now measure lower. This is a
			// change of measuring tool, not lost coverage: no test was removed. Measured
			// with vitest 4.1.12 + @vitest/coverage-v8 4.1.12:
			//   lines      91.54%
			//   statements 89.49%
			//   functions  91.94%
			//   branches   81.98%
			//
			// The A-level target of 90% lines is met and enforced below. The other floors
			// carry ~0.45pp of headroom, because branch totals move by a handful between
			// runs (module-init order in mocked tests). From here the ratchet applies
			// again: raise the floors as the numbers rise; never lower them.
			thresholds: {
				lines: 90,
				statements: 89,
				functions: 91.5,
				branches: 81.5,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
		},
	},
});
