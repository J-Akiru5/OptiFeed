import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the tenant/platform console boundary.
 *
 * The runtime behaviour is covered by tenant-admin.test.ts and the superadmin
 * action tests; these checks stop a future edit from reintroducing a global
 * `User.role` gate or a role-escalation path in the tenant console.
 */

const cwd = process.cwd();
const webRoot = existsSync(join(cwd, "app")) ? cwd : join(cwd, "apps", "web");

function read(relativePath: string): string {
	return readFileSync(join(webRoot, relativePath), "utf8");
}

function exportedFunctionBlock(source: string, name: string, nextName?: string): string {
	const start = source.indexOf(`export async function ${name}(`);
	expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
	const end = nextName ? source.indexOf(`export async function ${nextName}(`, start) : -1;
	return source.slice(start, end === -1 ? undefined : end);
}

describe("tenant admin actions", () => {
	const adminActions = read("lib/actions/admin.ts");

	it("does not use the legacy global ADMIN role as a gate", () => {
		expect(adminActions).not.toContain('requireRole("ADMIN")');
	});

	it("requires a tenant membership on every exported action", () => {
		const names = [...adminActions.matchAll(/export async function ([A-Za-z0-9_]+)/g)].map(
			(match) => match[1],
		);
		expect(names.length).toBeGreaterThan(10);
		names.forEach((name, index) => {
			const block = exportedFunctionBlock(adminActions, name, names[index + 1]);
			expect(block, `${name} must call requireTenantAdmin()`).toContain(
				"await requireTenantAdmin();",
			);
		});
	});

	it("does not let a tenant admin change the legacy global role", () => {
		const updateUser = exportedFunctionBlock(adminActions, "updateUser", "deleteUser");
		expect(updateUser).toContain("data: { displayName?: string }");
		expect(updateUser).not.toContain("role?: UserRole");
		expect(updateUser).not.toContain("data,");
	});
});

describe("console route layouts", () => {
	it("gates the tenant console on membership, not User.role", () => {
		const layout = read("app/[locale]/(admin)/layout.tsx");
		expect(layout).toContain("requireTenantAdmin()");
		expect(layout).not.toContain('requireRole("ADMIN")');
	});

	it("gates the platform console on an active PlatformAdmin row", () => {
		const layout = read("app/[locale]/(superadmin)/superadmin/layout.tsx");
		expect(layout).toContain("requirePlatformAdmin()");
	});
});
