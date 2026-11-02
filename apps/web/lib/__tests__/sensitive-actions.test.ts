import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	SENSITIVE_ACTIONS,
	SENSITIVE_ACTION_SURFACES,
	actionForAuditCode,
	groupBySurface,
	reasonOnlyActions,
	sensitiveAuditActions,
	summarizeSensitiveActions,
} from "../platform/sensitive-actions-rules";

/**
 * Command-center action catalog (issue #479, M3C.7).
 *
 * The point of this suite is that the catalog cannot drift from the code and a
 * destructive action cannot ship ungated: every entry is checked against the
 * server-action source that implements it, and every step-up call in those
 * modules must appear in the catalog.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const sourceCache = new Map<string, string>();

function source(module: string): string {
	const cached = sourceCache.get(module);
	if (cached) return cached;
	const text = readFileSync(join(WEB_ROOT, module), "utf8");
	sourceCache.set(module, text);
	return text;
}

/** The text of one exported function, up to the next top-level export. */
function functionBody(module: string, name: string): string | null {
	const text = source(module);
	const start = text.indexOf(`export async function ${name}`);
	if (start === -1) return null;
	const rest = text.slice(start + 1);
	const next = rest.indexOf("\nexport ");
	return rest.slice(0, next === -1 ? undefined : next);
}

const STEP_UP_CALL = /(withStepUp|requireStepUp)\(/;

describe("catalog shape", () => {
	it("keeps ids, audit codes and action targets unique", () => {
		const ids = SENSITIVE_ACTIONS.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(SENSITIVE_ACTIONS.map((entry) => `${entry.module}#${entry.action}`)).size).toBe(
			SENSITIVE_ACTIONS.length,
		);

		const codes = SENSITIVE_ACTIONS.flatMap((entry) => entry.auditActions);
		expect(new Set(codes).size).toBe(codes.length);
	});

	it("gives every reason-and-audit entry a note and every step-up entry none", () => {
		for (const entry of SENSITIVE_ACTIONS) {
			if (entry.requirement === "reason-and-audit") expect(entry.note, entry.id).toBeTruthy();
			else expect(entry.note, entry.id).toBeUndefined();
		}
	});

	it("only uses declared surfaces and keeps the worst-blast-radius ones", () => {
		for (const entry of SENSITIVE_ACTIONS) {
			expect(SENSITIVE_ACTION_SURFACES).toContain(entry.surface);
		}
		const stepUp = SENSITIVE_ACTIONS.filter((entry) => entry.requirement === "step-up").map(
			(entry) => entry.id,
		);
		expect(stepUp).toEqual(
			expect.arrayContaining([
				"remoteFeed",
				"remotePause",
				"setOrganizationStatus",
				"revokeOrgMembership",
				"disablePlatformUser",
				"grantPlatformAdmin",
				"startViewAs",
				"backupExport",
			]),
		);
	});
});

describe("catalog against the server-action source", () => {
	it("finds the action each entry names", () => {
		for (const entry of SENSITIVE_ACTIONS) {
			if (entry.module.endsWith("route.ts")) {
				expect(source(entry.module), entry.id).toContain(`export const ${entry.action}`);
				continue;
			}
			expect(
				functionBody(entry.module, entry.action),
				`${entry.id} → ${entry.action}`,
			).not.toBeNull();
		}
	});

	it("requires step-up inside every step-up action's own body", () => {
		for (const entry of SENSITIVE_ACTIONS) {
			if (entry.requirement !== "step-up") continue;
			const body = entry.module.endsWith("route.ts")
				? source(entry.module)
				: functionBody(entry.module, entry.action);
			expect(body, entry.id).not.toBeNull();
			expect(body as string, `${entry.id} must call withStepUp/requireStepUp`).toMatch(
				STEP_UP_CALL,
			);
		}
	});

	it("does not leave a step-up action out of the catalog", () => {
		const modules = [...new Set(SENSITIVE_ACTIONS.map((entry) => entry.module))];
		const catalogued = new Set(SENSITIVE_ACTIONS.map((entry) => `${entry.module}#${entry.action}`));

		for (const module of modules) {
			const text = source(module);
			for (const match of text.matchAll(/export async function (\w+)/g)) {
				const name = match[1];
				const body = functionBody(module, name);
				if (!body || !STEP_UP_CALL.test(body)) continue;
				expect(catalogued, `${module}#${name} is step-up gated but not catalogued`).toContain(
					`${module}#${name}`,
				);
			}
		}
	});

	it("writes the audit codes it declares", () => {
		for (const entry of SENSITIVE_ACTIONS) {
			const text = source(entry.module);
			for (const code of entry.auditActions) {
				expect(text, `${entry.id} declares ${code}`).toContain(`"${code}"`);
			}
		}
	});
});

describe("catalog summary helpers", () => {
	it("counts both requirements and the distinct surfaces and codes", () => {
		const summary = summarizeSensitiveActions();
		expect(summary.total).toBe(SENSITIVE_ACTIONS.length);
		expect(summary.stepUp + summary.reasonAndAudit).toBe(summary.total);
		expect(summary.auditActions).toBe(sensitiveAuditActions().length);
		expect(summary.surfaces).toBe(new Set(SENSITIVE_ACTIONS.map((e) => e.surface)).size);
	});

	it("lists only reason-and-audit actions as exceptions", () => {
		const exceptions = reasonOnlyActions();
		expect(exceptions.length).toBeGreaterThan(0);
		expect(exceptions.every((entry) => entry.requirement === "reason-and-audit")).toBe(true);
	});

	it("groups by the fixed surface order and skips empty surfaces", () => {
		const groups = groupBySurface();
		expect(groups.map((group) => group.surface)).toEqual(
			SENSITIVE_ACTION_SURFACES.filter((surface) =>
				SENSITIVE_ACTIONS.some((entry) => entry.surface === surface),
			),
		);
		expect(groups.flatMap((group) => group.actions)).toHaveLength(SENSITIVE_ACTIONS.length);
	});

	it("resolves an audit code back to its action and ignores foreign codes", () => {
		expect(actionForAuditCode("platform.device.feed")?.id).toBe("remoteFeed");
		expect(actionForAuditCode("platform.device.feed_refused")?.id).toBe("remoteFeed");
		expect(actionForAuditCode("platform.not.a.real.action")).toBeUndefined();
	});
});

describe("message keys", () => {
	it("has copy for every action, surface and note in every locale", () => {
		const locales = ["en.json", "hil.json", "tl.json"];
		for (const locale of locales) {
			const messages = JSON.parse(readFileSync(join(WEB_ROOT, "messages", locale), "utf8"));
			const security = messages.superadmin.security;
			for (const entry of SENSITIVE_ACTIONS) {
				expect(security.actions[entry.id], `${locale} actions.${entry.id}`).toBeTruthy();
				expect(
					security.surfaces[entry.surface],
					`${locale} surfaces.${entry.surface}`,
				).toBeTruthy();
				expect(
					security.requirement[entry.requirement],
					`${locale} requirement.${entry.requirement}`,
				).toBeTruthy();
				if (entry.note) {
					expect(security.notes[entry.note], `${locale} notes.${entry.note}`).toBeTruthy();
				}
			}
			expect(messages.superadmin.operations.tabs.security).toBeTruthy();
		}
	});
});
