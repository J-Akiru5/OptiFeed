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

	it("gates every member mutation on manage_members", () => {
		const mutations: [string, string][] = [
			["inviteMember", "changeMemberRole"],
			["changeMemberRole", "revokeMember"],
			["revokeMember", "getPonds"],
		];
		for (const [name, next] of mutations) {
			const block = exportedFunctionBlock(adminActions, name, next);
			expect(block, `${name} must require manage_members`).toContain(
				'await requirePermission("manage_members");',
			);
		}
	});
});

describe("platform membership actions", () => {
	const actions = read("lib/actions/platform/members.ts");

	it("requires an active PlatformAdmin on every exported action", () => {
		const names = [...actions.matchAll(/export async function ([A-Za-z0-9_]+)/g)].map(
			(match) => match[1],
		);
		expect(names).toEqual(
			expect.arrayContaining([
				"getOrgDetail",
				"inviteOrgMember",
				"changeOrgMemberRole",
				"setOrgMemberPermission",
				"revokeOrgMembership",
			]),
		);
		names.forEach((name, index) => {
			const block = exportedFunctionBlock(actions, name, names[index + 1]);
			expect(block, `${name} must call requirePlatformAdmin()`).toContain(
				"await requirePlatformAdmin();",
			);
		});
	});

	it("requires a reason, step-up and one membership audit row per mutation", () => {
		const mutations: [string, string | undefined][] = [
			["inviteOrgMember", "changeOrgMemberRole"],
			["changeOrgMemberRole", "setOrgMemberPermission"],
			["setOrgMemberPermission", "revokeOrgMembership"],
			["revokeOrgMembership", undefined],
		];
		for (const [name, next] of mutations) {
			const block = exportedFunctionBlock(actions, name, next);
			expect(block, `${name} must validate a reason`).toMatch(/requireReason|checkedReason/);
			expect(block, `${name} must require step-up`).toContain("withStepUp(");
			// Exactly one call site per mutation; invite's call is inside onLinked.
			expect(block.match(/auditMembership\(/g)?.length, `${name} audit call sites`).toBe(1);
		}
	});
});

describe("platform device registry actions", () => {
	const actions = read("lib/actions/platform/devices.ts");

	it("requires an active PlatformAdmin on every exported action", () => {
		const names = [...actions.matchAll(/export async function ([A-Za-z0-9_]+)/g)].map(
			(match) => match[1],
		);
		expect(names).toEqual(
			expect.arrayContaining([
				"listPlatformDevices",
				"getOrgPondOptions",
				"registerDevice",
				"rotateDeviceToken",
				"getPlatformDevicesForLabels",
				"remoteFeedDevice",
				"remoteSetDevicePause",
			]),
		);
		names.forEach((name, index) => {
			const block = exportedFunctionBlock(actions, name, names[index + 1]);
			expect(block, `${name} must call requirePlatformAdmin()`).toContain(
				"await requirePlatformAdmin();",
			);
		});
	});

	it("routes remote feed and pause through the shared tenant command path (M5.2)", () => {
		// Decision D1 grants god mode, but only through the one command module.
		// A parallel feed/schedule write here would bypass the §6 caps.
		expect(actions).toContain('from "@/lib/feed/commands"');
		expect(actions).toMatch(/createManualFeedRequest\(tx/);
		expect(actions).toMatch(/setSchedulePause\(tx/);
		expect(actions).not.toMatch(/feed-command|schedule-sync/);
		expect(actions).not.toMatch(/tx\.feedRequest\.(create|update)/);
	});

	it("keeps reason, step-up and one energy-device audit row on remote control", () => {
		const feed = exportedFunctionBlock(actions, "remoteFeedDevice", "remoteSetDevicePause");
		const pause = exportedFunctionBlock(actions, "remoteSetDevicePause", "orgIdForDevice");
		for (const block of [feed, pause]) {
			expect(block).toContain("withStepUp(");
			expect(block).toContain("auditDevice(");
			expect(block).toContain("await requirePlatformAdmin();");
			expect(block).toContain("requireReason(input.reason)");
		}
	});

	it("has no force flag on remote commands", () => {
		expect(actions).not.toMatch(/\bforce\s*:/);
	});
});

describe("print route gates", () => {
	it("gates the tenant sticker page on membership", () => {
		const layout = read("app/[locale]/(print)/admin/devices/labels/layout.tsx");
		expect(layout).toContain("await requireTenantAdmin();");
	});

	it("gates the platform sticker page on an active PlatformAdmin row", () => {
		const layout = read("app/[locale]/(print)/superadmin/devices/labels/layout.tsx");
		expect(layout).toContain("await requirePlatformAdmin();");
	});

	it("keeps the password-change check on the shared print shell", () => {
		const layout = read("app/[locale]/(print)/layout.tsx");
		expect(layout).toContain("await requirePasswordChanged();");
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

describe("password-change guard composition", () => {
	it("checks the password flag inside every shared action guard", () => {
		const tenantGuard = read("lib/auth/tenant-admin.ts");
		const platformGuard = read("lib/auth/require-platform-admin.ts");
		const session = read("lib/auth/session.ts");
		const permissions = read("lib/auth/permissions.ts");

		expect(tenantGuard).toContain("await assertPasswordChanged();");
		expect(platformGuard).toContain("await assertPasswordChanged();");
		expect(session).toMatch(/requireWriteAccess[\s\S]*await assertPasswordChanged\(\)/);
		expect(permissions).toMatch(/requirePermission[\s\S]*await assertPasswordChanged\(\)/);
	});
});
