"use server";

import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPermissions } from "@/lib/auth/permissions";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import { getTenantAdminState } from "@/lib/auth/tenant-admin";
import { getViewAsState } from "@/lib/auth/view-as";
import { isValidDateOnly } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";
import { pagesFor } from "@/lib/search/catalogue";
import type {
	GlobalSearchResult,
	SearchAudience,
	SearchRow,
	SearchShell,
} from "@/lib/search/types";
import type { Prisma } from "@prisma/client";

/**
 * Global search read path (#270).
 *
 * One guarded, bounded read behind the ⌘K / Ctrl+K palette. It searches only
 * what the caller can already read, using the app's existing scope helpers:
 *
 *   - farmer       → their own farm (`getCurrentPondOwnerIdSafe`, view-as aware)
 *   - tenant admin → the administered organizations (`resolveOrgScope`)
 *   - platform     → every tenant (`requirePlatformAdmin` gates the console;
 *                    the grant is re-checked here, never trusted from the UI)
 *
 * Entities are deliberately small and cheap to match:
 *   ponds (name), feeder devices (label / MAC), members (name / email),
 *   sampling batches (label / date), calendar items (title / date) and feed
 *   events (pond name / date). There is no full-text engine, no fuzzy index and
 *   no ranking table; each query is a bounded `contains` over a scoped id set.
 *
 * Device tokens, token hashes, passwords and invite tokens are never selected.
 * A failed read returns `unavailable` with no stack or query text, so the
 * dialog can say "Search is unavailable right now" without leaking internals.
 */

const MAX_QUERY_LENGTH = 64;
const MAX_ROWS_PER_GROUP = 5;
/** Fetch a little more than we show so prefix matches can win the sort. */
const FETCH_LIMIT = MAX_ROWS_PER_GROUP * 2;
/** Generated columns/code stay capped even when no filter applies (platform). */
const MAX_SCOPED_DEVICES = 200;
const MAX_RECORD_ROWS = 5;

type SearchContext = {
	audience: SearchAudience;
	/** `null` means "every tenant" (platform audience only). */
	pondIds: string[] | null;
	/** Organization members for the members group; empty for a farmer. */
	memberIds: string[] | null;
	permissions: Awaited<ReturnType<typeof getCurrentPermissions>>;
};

function normaliseQuery(query: unknown): string {
	return typeof query === "string" ? query.trim().slice(0, MAX_QUERY_LENGTH) : "";
}

function normaliseShell(shell: unknown): SearchShell {
	return shell === "admin" || shell === "platform" ? shell : "farmer";
}

/** `YYYY-MM-DD` in the farm's timezone, or null for free text. */
function parseSearchDay(query: string): { start: Date; end: Date } | null {
	if (!isValidDateOnly(query)) return null;
	const start = new Date(`${query}T00:00:00+08:00`);
	if (!Number.isFinite(start.getTime())) return null;
	return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Prefix hits first, then a stable alphabetical order; capped. */
function rank(rows: SearchRow[], query: string): SearchRow[] {
	const needle = query.toLowerCase();
	return [...rows]
		.sort((left, right) => {
			const leftPrefix = left.title.toLowerCase().startsWith(needle) ? 0 : 1;
			const rightPrefix = right.title.toLowerCase().startsWith(needle) ? 0 : 1;
			if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
			return left.title.localeCompare(right.title);
		})
		.slice(0, MAX_ROWS_PER_GROUP);
}

async function resolveContext(): Promise<SearchContext | null> {
	const user = await getCurrentUser();
	if (!user) return null;

	const [isPlatform, viewAs, tenantState, permissions] = await Promise.all([
		isCurrentPlatformAdmin(),
		getViewAsState(),
		getTenantAdminState(),
		getCurrentPermissions(),
	]);

	// A platform admin in view-as is reading a tenant through a read-only
	// window; the platform console is not part of that tenant, so the palette
	// behaves like the farmer's.
	const audience: SearchAudience = viewAs.active
		? "farmer"
		: isPlatform
			? "platform"
			: tenantState.isAdmin
				? "tenantAdmin"
				: "farmer";

	if (audience === "platform") {
		return { audience, pondIds: null, memberIds: null, permissions };
	}

	if (audience === "tenantAdmin") {
		const scope = await resolveOrgScope();
		return { audience, pondIds: scope.pondIds, memberIds: scope.memberUserIds, permissions };
	}

	// `getCurrentPondOwnerIdSafe` resolves to the viewed farm during view-as and
	// to the caller's own farm otherwise. No farm means no readable rows.
	const farmId = await getCurrentPondOwnerIdSafe();
	if (!farmId) {
		return { audience, pondIds: [], memberIds: [], permissions };
	}
	const ponds = await prisma.pond.findMany({
		where: { ownerId: farmId, status: "ACTIVE" },
		select: { id: true },
	});
	return { audience, pondIds: ponds.map((pond) => pond.id), memberIds: [], permissions };
}

function pondFilter(context: SearchContext): Prisma.PondWhereInput {
	return context.pondIds === null ? {} : { id: { in: context.pondIds } };
}

function pondScopedWhere(context: SearchContext): { pondId?: { in: string[] } } {
	return context.pondIds === null ? {} : { pondId: { in: context.pondIds } };
}

async function pondNames(ids: string[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Map();
	const rows = await prisma.pond.findMany({
		where: { id: { in: unique } },
		select: { id: true, name: true },
	});
	return new Map(rows.map((row) => [row.id, row.name]));
}

function recordHref(context: SearchContext, kind: "calendar" | "history"): string {
	if (context.audience === "platform") {
		return kind === "calendar" ? "/superadmin/calendar" : "/superadmin/operations";
	}
	if (context.audience === "tenantAdmin") {
		return kind === "calendar" ? "/admin/calendar" : "/admin/audit";
	}
	return kind === "calendar" ? "/dashboard/calendar" : "/dashboard/history";
}

async function searchData(context: SearchContext, query: string): Promise<SearchRow[]> {
	const like = { contains: query, mode: "insensitive" as const };
	const day = parseSearchDay(query);
	const canMatchDates = context.audience !== "platform";
	const rows: SearchRow[] = [];

	const [pondRows, deviceRows] = await Promise.all([
		prisma.pond.findMany({
			where: {
				...pondFilter(context),
				...(context.audience === "farmer" ? { status: "ACTIVE" as const } : {}),
				name: like,
			},
			select: { id: true, name: true, status: true },
			orderBy: { name: "asc" },
			take: FETCH_LIMIT,
		}),
		prisma.energyDevice.findMany({
			where: {
				...pondScopedWhere(context),
				OR: [{ label: like }, { mac: like }],
			},
			select: {
				id: true,
				label: true,
				mac: true,
				pondId: true,
				approvalStatus: true,
				pond: { select: { name: true } },
			},
			orderBy: { label: "asc" },
			take: FETCH_LIMIT,
		}),
	]);

	const pondResults: SearchRow[] = pondRows.map((pond) => ({
		id: `ponds:${pond.id}`,
		group: "ponds",
		title: pond.name,
		href:
			context.audience === "platform"
				? `/superadmin/ponds?q=${encodeURIComponent(pond.name)}`
				: context.audience === "tenantAdmin"
					? `/admin/ponds/${pond.id}`
					: "/dashboard",
		meta: pond.status === "ACTIVE" ? undefined : { status: "archived" },
		...(context.audience === "farmer" ? { switchPondId: pond.id } : {}),
	}));

	const deviceResults: SearchRow[] = deviceRows.map((device) => ({
		id: `devices:${device.id}`,
		group: "devices",
		title: device.label,
		href:
			context.audience === "platform"
				? `/superadmin/devices?q=${encodeURIComponent(device.mac)}`
				: context.audience === "tenantAdmin"
					? "/admin/devices"
					: "/dashboard/settings/hardware",
		meta: {
			mac: device.mac,
			...(device.pond ? { pondName: device.pond.name } : { status: "unassigned" as const }),
			...(device.approvalStatus === "PENDING" ? { status: "pending" as const } : {}),
		},
	}));

	rows.push(...rank(pondResults, query), ...rank(deviceResults, query));

	if (context.audience !== "farmer") {
		const memberRows = await prisma.user.findMany({
			where: {
				...(context.memberIds === null ? {} : { id: { in: context.memberIds } }),
				OR: [{ displayName: like }, { email: like }, { farmId: like }],
			},
			select: { id: true, displayName: true, email: true, farmId: true },
			orderBy: { displayName: "asc" },
			take: FETCH_LIMIT,
		});
		rows.push(
			...memberRows
				.map((member) => ({
					id: `members:${member.id}`,
					group: "members" as const,
					title: member.displayName || member.email,
					href:
						context.audience === "platform"
							? `/superadmin/users?q=${encodeURIComponent(member.email)}`
							: `/admin/settings/members/${member.id}/permissions`,
					meta: { email: member.email },
				}))
				.slice(0, MAX_ROWS_PER_GROUP),
		);
	}

	// ─── Records ─────────────────────────────────────────────────────────────
	// Three cheap, bounded sets: a sampling batch label, a calendar item title
	// and a feed event. A `YYYY-MM-DD` query additionally matches by day for a
	// tenant; platform-wide day scans are skipped because they cannot use the
	// per-device/per-pond indexes.
	const recordConditions = (dateField: "recordedAt" | "startsAt") =>
		canMatchDates && day ? [{ [dateField]: { gte: day.start, lt: day.end } }] : [];

	const [batchRows, eventRows] = await Promise.all([
		prisma.biomassLog.findMany({
			where: {
				...pondScopedWhere(context),
				batchLabel: { not: null },
				OR: [{ batchLabel: like }, ...recordConditions("recordedAt")],
			} as Prisma.BiomassLogWhereInput,
			select: { id: true, pondId: true, batchLabel: true, recordedAt: true },
			orderBy: { recordedAt: "desc" },
			take: FETCH_LIMIT,
		}),
		prisma.pondEvent.findMany({
			where: {
				...pondScopedWhere(context),
				OR: [{ title: like }, ...recordConditions("startsAt")],
			} as Prisma.PondEventWhereInput,
			select: { id: true, pondId: true, title: true, startsAt: true },
			orderBy: { startsAt: "desc" },
			take: FETCH_LIMIT,
		}),
	]);

	// A sampling batch is a label shared by many log rows; keep the newest row
	// per pond + label so one batch cannot fill the whole group.
	const seenBatches = new Set<string>();
	const batches = batchRows.filter((row) => {
		if (!row.batchLabel) return false;
		const key = `${row.pondId}:${row.batchLabel}`;
		if (seenBatches.has(key)) return false;
		seenBatches.add(key);
		return true;
	});

	// Feed events match a pond name, or a date for a scoped tenant. Resolve the
	// pond first so the feed query stays an indexed `deviceId in (...)` read and
	// never becomes a cross-tenant scan.
	const feedPonds = await prisma.pond.findMany({
		where: { ...pondFilter(context), name: like },
		select: { id: true },
		take: MAX_ROWS_PER_GROUP,
	});
	const pondsForFeed =
		day && canMatchDates
			? context.pondIds === null
				? feedPonds.map((pond) => pond.id)
				: context.pondIds
			: feedPonds.map((pond) => pond.id);

	const feedDevices =
		pondsForFeed.length === 0
			? []
			: await prisma.energyDevice.findMany({
					where: { pondId: { in: pondsForFeed.slice(0, MAX_SCOPED_DEVICES) } },
					select: { id: true, pondId: true },
				});
	const feedRows =
		feedDevices.length === 0
			? []
			: await prisma.feedEvent.findMany({
					where: {
						deviceId: { in: feedDevices.map((device) => device.id) },
						eventType: "feed_dispensed",
						...(day && canMatchDates ? { receivedAt: { gte: day.start, lt: day.end } } : {}),
					},
					select: { id: true, deviceId: true, receivedAt: true, grams: true },
					orderBy: { receivedAt: "desc" },
					take: MAX_RECORD_ROWS,
				});

	const recordPondIds = [
		...batches.map((row) => row.pondId),
		...eventRows.map((row) => row.pondId),
		...feedDevices.map((device) => device.pondId),
		...feedPonds.map((pond) => pond.id),
	].filter((id): id is string => Boolean(id));
	const names = await pondNames(recordPondIds);

	const recordRows: SearchRow[] = [
		...batches.map((batch) => ({
			id: `records:batch:${batch.id}`,
			group: "records" as const,
			title: batch.batchLabel ?? "",
			href:
				context.audience === "platform"
					? `/superadmin/ponds?q=${encodeURIComponent(names.get(batch.pondId) ?? "")}`
					: context.audience === "tenantAdmin"
						? `/admin/ponds/${batch.pondId}`
						: "/dashboard/log-sample",
			meta: {
				pondName: names.get(batch.pondId),
				date: batch.recordedAt.toISOString(),
			},
		})),
		...eventRows.map((event) => ({
			id: `records:event:${event.id}`,
			group: "records" as const,
			title: event.title,
			href: recordHref(context, "calendar"),
			meta: {
				pondName: names.get(event.pondId),
				date: event.startsAt.toISOString(),
			},
		})),
	];

	if (feedRows.length > 0) {
		const devicePond = new Map(feedDevices.map((device) => [device.id, device.pondId]));
		for (const event of feedRows) {
			const pondId = devicePond.get(event.deviceId);
			recordRows.push({
				id: `records:feed:${event.id}`,
				group: "records",
				title: "",
				titleKey: "search.records.feedEvent",
				href: recordHref(context, "history"),
				meta: {
					...(pondId ? { pondName: names.get(pondId) } : {}),
					date: event.receivedAt.toISOString(),
					...(event.grams === null ? {} : { grams: event.grams }),
				},
			});
		}
	}

	rows.push(
		...recordRows
			.sort((left, right) => (right.meta?.date ?? "").localeCompare(left.meta?.date ?? ""))
			.slice(0, MAX_RECORD_ROWS),
	);

	return rows;
}

/**
 * Search every page and record the caller may read.
 *
 * `query` is trimmed and capped; an empty query returns only the page
 * catalogue (the dialog shows its first entries as suggestions). `shell` is
 * re-validated and only affects ordering, never authorization.
 */
export async function globalSearch(input: {
	query?: string;
	shell?: SearchShell;
}): Promise<GlobalSearchResult> {
	try {
		const context = await resolveContext();
		if (!context) return { status: "unavailable", pages: [], rows: [] };

		const query = normaliseQuery(input.query);
		const shell = normaliseShell(input.shell);
		const pages = pagesFor(context.audience, context.permissions, shell);

		if (query.length === 0) {
			return { status: "ok", pages, rows: [] };
		}

		return { status: "ok", pages, rows: await searchData(context, query) };
	} catch {
		// Quiet by design: no stack, no query, no table name reaches the client.
		console.error("[search] global search failed");
		return { status: "unavailable", pages: [], rows: [] };
	}
}
