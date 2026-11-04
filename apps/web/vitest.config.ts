import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		// 30s, not the 5s default: a few suites build and parse real XLSX workbooks
		// (exceljs in jsdom). They take ~1s alone but exceeded 5s once every coverage
		// worker was busy, failing the gate on wall-clock contention rather than on
		// behaviour. Assertions are untouched; a genuinely hung test still fails.
		testTimeout: 30_000,
		setupFiles: ["./test/setup.ts"],
		// Every measured surface can hold tests. `scripts/e2e/` holds the fixture
		// guards, whose unit tests live next to the code because they are
		// operational tooling, not app code.
		include: [
			"app/**/*.test.ts",
			"app/**/*.test.tsx",
			"components/**/*.test.ts",
			"components/**/*.test.tsx",
			"lib/**/*.test.ts",
			"lib/**/*.test.tsx",
			"scripts/**/*.test.ts",
		],
		coverage: {
			provider: "v8",
			// The measured application surface: the pages, layouts and route
			// handlers users hit (app/), the components they render, and the
			// logic underneath (lib/). Before #730 only lib/ was measured, so a
			// 90% number described about half of the code the app ships.
			include: [
				"app/**/*.ts",
				"app/**/*.tsx",
				"components/**/*.ts",
				"components/**/*.tsx",
				"lib/**/*.ts",
				"lib/**/*.tsx",
			],
			// Tests are not application surface. Nothing else is excluded: no
			// generated file, wrapper directory or "hard to test" area is hidden
			// from the denominator. If a genuinely generated file is added later,
			// exclude it by name with a reason here.
			exclude: [
				"app/**/*.test.ts",
				"app/**/*.test.tsx",
				"app/**/__tests__/**",
				"components/**/*.test.ts",
				"components/**/*.test.tsx",
				"components/**/__tests__/**",
				"lib/**/*.test.ts",
				"lib/**/*.test.tsx",
				"lib/**/__tests__/**",
			],
			reporter: ["text-summary", "text", "json-summary"],
			reportsDirectory: "./coverage",
			// RATCHET — raise these, never lower them.
			//
			// Thresholds are per directory (#730). Vitest applies a glob set to the
			// files it matches and applies any *non-glob* threshold to the whole
			// map, so there is deliberately no global floor: one blended number
			// would let a lib/ gain hide an app/ regression. Every directory in
			// `coverage.include` above must have a matching block below; adding a
			// directory without one leaves it unguarded.
			//
			// Measured 2026-11-04 with vitest 4.1.12 + @vitest/coverage-v8
			// 4.1.12, full suite, across four runs: local Windows, two CI
			// artifacts (runs 41801236208 and 41803115053) and a local run on
			// the rebase base (9db7eb5). Two clean samples per directory:
			//
			//                 lines   statements  functions  branches
			//   app/          66.89     65.79       58.57     53.64   (base 7701c34)
			//   app/          66.40     65.29       57.79     53.64   (base 9db7eb5)
			//   components/   55.14     53.58       51.31     53.42   (identical in every run)
			//   lib/          92.27     90.28       92.44     82.67   (base 7701c34)
			//   lib/          92.38     90.39       92.54     82.79   (base 9db7eb5)
			//   whole map     76.53     75.13       72.53     68.15   (base 9db7eb5)
			//
			// Why the margins differ. `components/` was byte-identical across
			// every run and `lib/` moved 0.11pp, so those floors sit the usual
			// 0.6pp under the lowest observation. `app/` is noisier: the same
			// suite reported 57.79-58.57 functions across runs (one tree was
			// measured twice), because v8 attributes different source ranges to
			// a module depending on load/mock order (lib/ops/cron-heartbeat.ts
			// reported 15 lines in one run and 48 in the other, of a 48-line
			// file). A 0.6pp floor failed on CI by 0.11pp with no code change,
			// so the app/ floors sit 1.4pp under its lowest observation - still
			// well under the cost of a real regression (a new untested
			// ~100-line page moves app/ by ~3.7pp), and the margins can tighten
			// once that reporting instability is fixed rather than papered over.
			//
			// app/ and components/ start lower than lib/ because most of their
			// coverage arrives through tests in lib/__tests__ that render real
			// pages, not because they are excluded from the gate.
			//
			// The lib/ floors rose with this measurement (90 -> 91.6 lines,
			// 89 -> 89.6 statements, 91.5 -> 91.8 functions, 81.5 -> 82 branches)
			// because the suite now measures higher than the 2026-11-01 baseline.
			thresholds: {
				"app/**": {
					lines: 65.0,
					statements: 63.9,
					functions: 56.4,
					branches: 52.5,
				},
				"components/**": {
					lines: 54.5,
					statements: 52.9,
					functions: 50.7,
					branches: 52.8,
				},
				"lib/**": {
					lines: 91.6,
					statements: 89.6,
					functions: 91.8,
					branches: 82.0,
				},
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
			// `server-only` throws when imported outside a React Server Component
			// bundle. Vitest imports the server actions directly, so point it at an
			// empty module; Next's build still uses the real guard.
			"server-only": path.resolve(__dirname, "test/server-only-mock.ts"),
		},
	},
});
