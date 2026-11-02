import { describe, expect, it } from "vitest";

import { exportHeader, sqlCommentText } from "@/lib/backup/sql";

/**
 * #671: the header is a sequence of `--` comment lines, so every value that
 * comes from a caller must stay on one line. A newline used to end the comment
 * and let the rest of the value run as SQL when the dump was restored.
 */

const BASE = {
	scope: "tenant" as const,
	actor: "admin@example.com",
	reason: "Scheduled tenant export",
	orgNames: ["Pond Co"],
	generatedAt: new Date("2026-11-03T00:00:00.000Z"),
};

describe("sqlCommentText", () => {
	it("replaces control characters with spaces and collapses whitespace", () => {
		expect(sqlCommentText("a\nDROP TABLE x; --")).toBe("a DROP TABLE x; --");
		expect(sqlCommentText("a\r\n\tb")).toBe("a b");
		expect(sqlCommentText("  spaced   out  ")).toBe("spaced out");
	});
});

describe("exportHeader", () => {
	it("keeps a newline in the reason from escaping the comment", () => {
		const header = exportHeader({
			...BASE,
			reason: 'ok\nDROP TABLE "User"; --',
		});

		expect(header).toContain('-- Reason: ok DROP TABLE "User"; --');
		expect(header).not.toMatch(/\nDROP TABLE/);
	});

	it("neutralises newlines in the actor and organization names", () => {
		const header = exportHeader({
			...BASE,
			actor: "admin@example.com\n-- injected",
			orgNames: ["Pond Co\nDROP SCHEMA public CASCADE"],
		});

		expect(header).not.toMatch(/^-- injected/m);
		expect(header).not.toMatch(/^DROP SCHEMA/m);
		expect(header).toContain("Pond Co DROP SCHEMA public CASCADE");
	});

	it("still writes a normal header unchanged", () => {
		const header = exportHeader(BASE);

		expect(header).toContain("-- Requested by: admin@example.com");
		expect(header).toContain("-- Reason: Scheduled tenant export");
		expect(header).toContain("Scope: tenant export for Pond Co");
	});
});
