import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSeedEmail } from "../../prisma/seed-identity";

function readSeed(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// The old placeholder id never belonged to a Supabase Auth user. Seeding it
// made User.supabaseId differ from the session subject, so getCurrentUser()
// returned null for a signed-in farmer and /dashboard bounced to /login.
const RETIRED_PLACEHOLDER = "00000000-0000-0000-0000-000000000001";

describe("seed identity", () => {
	it.each(["../../prisma/seed.ts", "../../prisma/seed-dev.ts"])(
		"%s resolves User.supabaseId instead of hardcoding a placeholder",
		(seedPath) => {
			const source = readSeed(seedPath);
			expect(source).not.toContain(RETIRED_PLACEHOLDER);
			expect(source).toContain("resolveSupabaseUserId");
		},
	);

	it("derives the pond-provisioned email from the farm id", () => {
		expect(buildSeedEmail("demo-farmer-1")).toBe("demo-farmer-1@pond.optifeed.local");
		expect(buildSeedEmail("  DEMO-FARMER-1 ")).toBe("demo-farmer-1@pond.optifeed.local");
	});
});
