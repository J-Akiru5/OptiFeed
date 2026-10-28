import { ok } from "@/lib/api/envelope";
import { notFound, validationFailed } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { resolveMemberOrgScope, resolveOrgScope } from "@/lib/auth/org-scope";
import { withAuth } from "@/lib/auth/with-auth";
import {
	MAX_CALENDAR_RANGE_DAYS,
	loadCalendarEventSources,
	parseCalendarEventTypes,
} from "@/lib/calendar/event-sources";
import { addDays, daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = withApi(
	withAuth(async (request, { ownerId }) => {
		const url = new URL(request.url);
		const today = todayDateOnly();
		const from = url.searchParams.get("from") ?? addDays(today, -14);
		const to = url.searchParams.get("to") ?? addDays(today, 45);

		if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
			throw validationFailed("`from` and `to` must be valid YYYY-MM-DD dates.");
		}
		// `from` and `to` are inclusive date-only bounds. Counting only the
		// difference made a one-day range (the FullCalendar day view sends
		// from === to) look empty, and let a 401-day range through (#276).
		const span = daysBetween(from, to) + 1;
		if (span < 1 || span > MAX_CALENDAR_RANGE_DAYS) {
			throw validationFailed(`Choose a date range between 1 and ${MAX_CALENDAR_RANGE_DAYS} days.`);
		}

		const pondFilter = url.searchParams.get("pondId");
		const types = parseCalendarEventTypes(url.searchParams.get("types"));
		// `scope=org` is the tenant admin calendar: every pond in an
		// organization the caller administers, all writable.
		// `scope=member-org` is the farmer calendar (E25): every pond in the
		// caller's organization is visible, but writes stay on their own farm.
		// Both resolvers fail closed for callers without the membership.
		const scopeParam = url.searchParams.get("scope");
		const orgScope = scopeParam === "org" ? await resolveOrgScope() : null;
		const memberScope = scopeParam === "member-org" ? await resolveMemberOrgScope() : null;
		if (orgScope && orgScope.pondIds.length === 0) {
			throw notFound("No active ponds in your organization.");
		}
		const memberPondIds =
			memberScope && memberScope.pondIds.length > 0 ? memberScope.pondIds : null;

		const ponds = await prisma.pond.findMany({
			where: orgScope
				? { id: { in: orgScope.pondIds }, status: "ACTIVE" }
				: memberPondIds
					? { id: { in: memberPondIds }, status: "ACTIVE" }
					: { ownerId, status: "ACTIVE" },
			select: {
				id: true,
				name: true,
				sampleIntervalDays: true,
				createdAt: true,
				isFallow: true,
			},
			orderBy: { createdAt: "asc" },
			take: 100,
		});
		if (ponds.length === 0) throw notFound("No active pond.");

		// A member sees the whole organization but may only edit their own
		// farm's events. Omitting the set keeps every supplied pond writable
		// for the farmer's own view and the tenant admin.
		let editablePondIds: Set<string> | undefined;
		if (memberPondIds) {
			const ownPonds = await prisma.pond.findMany({
				where: { ownerId, status: "ACTIVE" },
				select: { id: true },
				orderBy: { createdAt: "asc" },
				take: 100,
			});
			editablePondIds = new Set(ownPonds.map((pond) => pond.id));
		}

		const selectedPonds =
			!pondFilter || pondFilter === "active"
				? [ponds[0]]
				: pondFilter === "all"
					? ponds
					: ponds.filter((pond) => pond.id === pondFilter);
		if (selectedPonds.length === 0) throw notFound("Pond not found.");

		const { events, truncated } = await loadCalendarEventSources({
			ponds: selectedPonds,
			from,
			to,
			today,
			types,
			includeFeeding: true,
			editablePondIds,
		});

		return ok({ events, truncated, from, to }, { headers: { "Cache-Control": "no-store" } });
	}),
	{ route: "GET /api/calendar/events", timeoutMs: 8_000, slowMs: 3_000, violationMs: 8_000 },
);
