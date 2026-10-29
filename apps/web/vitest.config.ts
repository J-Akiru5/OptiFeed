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
			// Measured 2026-10-29 on develop @ 8eb6ce4 (242 files, 2498 tests,
			// vitest 3.2.7 + @vitest/coverage-v8 3.2.7, 214 lib files):
			//   lines      80.92% (19,871 / 24,554)
			//   statements 80.92% (19,871 / 24,554)
			//   functions  89.25% (955 / 1,070)
			//   branches   78.78% (4,964 / 6,301)
			//
			// The A-level target is 90% lines: that needs 22,099 covered lines,
			// i.e. 2,228 more than today (4,683 lines are uncovered). The
			// thresholds below are the measured floor, not the target, so the
			// gate fails a regression while the gap is closed file by file.
			// Largest uncovered files: lib/actions/admin.ts (302),
			// lib/growth-plan-apply.ts (234), lib/assistant/catalog.ts (204),
			// lib/membership-invite.ts (160), lib/actions/superadmin.ts (156).
			// Lines/statements sit 0.02pp under the measurement (a few lines);
			// branch totals move by a handful between runs (module-init order in
			// mocked tests), so branches/functions keep ~0.3pp of headroom.
			thresholds: {
				lines: 80.9,
				statements: 80.9,
				functions: 89,
				branches: 78.5,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
		},
	},
});
