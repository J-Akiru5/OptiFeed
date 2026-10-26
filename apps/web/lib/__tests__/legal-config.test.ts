import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DPO_EMAIL,
	DPO_NAME,
	LEGAL_APP_RELEASE,
	LEGAL_EFFECTIVE_DATE,
	LEGAL_HISTORY,
	LEGAL_PUBLISHED,
	LEGAL_STATUS,
	LEGAL_SUBPROCESSORS,
	LEGAL_VERSION,
} from "@/lib/legal/config";
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal/sections";
import { describe, expect, it } from "vitest";

const webRoot = existsSync(join(process.cwd(), "app"))
	? process.cwd()
	: join(process.cwd(), "apps", "web");
const repoRoot = join(webRoot, "..", "..");
const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
	version: string;
};

describe("legal document configuration", () => {
	it("tracks the root app release, not the stale web workspace version", () => {
		expect(LEGAL_APP_RELEASE).toBe(rootPackage.version);
	});

	it("keeps the publication flag consistent with the status", () => {
		expect(["draft", "effective"]).toContain(LEGAL_STATUS);
		expect(LEGAL_PUBLISHED).toBe(LEGAL_STATUS === "effective");
	});

	it("uses a version that matches the history and an ISO effective date", () => {
		expect(LEGAL_HISTORY[0]?.version).toBe(LEGAL_VERSION);
		expect(LEGAL_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("keeps the DPO contact present", () => {
		expect(DPO_NAME.length).toBeGreaterThan(3);
		expect(DPO_EMAIL).toContain("@");
	});

	it("lists the actual processors and does not reintroduce Telegram", () => {
		const names = LEGAL_SUBPROCESSORS.map((processor) => processor.name).join(" ");
		expect(names).toMatch(/Supabase/);
		expect(names).toMatch(/Vercel/);
		expect(names).toMatch(/OpenCodeGo/);
		expect(names).toMatch(/Resend/);
		expect(names).toMatch(/Google/);
		expect(names).not.toMatch(/Telegram/i);
	});

	it("has unique anchor ids for both documents", () => {
		for (const sections of [PRIVACY_SECTIONS, TERMS_SECTIONS]) {
			const ids = sections.map((section) => section.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});
});
