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
			// The A-level target of 90% lines is met and enforced below. Lines and
			// statements carry ~0.4pp of headroom, branches and functions ~0.3pp,
			// because branch totals move by a handful between runs (module-init order
			// in mocked tests). Raise the floors as the numbers rise; never lower them.
			//
			// ONE-TIME RE-BASELINE 2026-11-01 (Jeff's decision on #328): the upgrade to
			// vitest 4.1.12 + @vitest/coverage-v8 4.1.12 measures the same code lower
			// than 3.2.7 does, so statements, functions and branches fall under the
			// floors above with no test removed (4,260 tests before, 4,314 after).
			// Measured on develop @ 483980d with vitest 4.1.12:
			//   lines      91.54%  (floor unchanged at 90)
			//   statements 89.49%  (was 90)
			//   functions  91.94%  (was 94.5)
			//   branches   81.98%  (was 84.5)
			// The three failing floors now sit ~0.5pp under that measurement. The
			// ratchet rule applies again from here: raise them, never lower them.
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
