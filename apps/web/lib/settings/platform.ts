import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * App-wide list page size (mission decision E1, issue #187).
 *
 * There is exactly one page size for every list in the product, edited by a
 * platform admin from the superadmin Settings page. Readers fall back to the
 * default when the row is missing, unreadable or outside the allowed range, so
 * a corrupt setting can never break a list.
 */
export const LIST_PAGE_SIZE_KEY = "list.pageSize";
export const LIST_PAGE_SIZE_DEFAULT = 20;
export const LIST_PAGE_SIZE_MIN = 5;
export const LIST_PAGE_SIZE_MAX = 100;

/** Coerce a stored JSON value to a valid page size, or the default. */
export function normalizeListPageSize(value: unknown): number {
	let candidate: unknown = value;
	// Be tolerant of an older shape that stored `{ value: 25 }` as the Json.
	if (typeof value === "object" && value !== null && "value" in value) {
		candidate = (value as { value: unknown }).value;
	}
	if (typeof candidate === "string" && candidate.trim() !== "") {
		candidate = Number(candidate);
	}
	if (typeof candidate !== "number" || !Number.isInteger(candidate)) {
		return LIST_PAGE_SIZE_DEFAULT;
	}
	if (candidate < LIST_PAGE_SIZE_MIN || candidate > LIST_PAGE_SIZE_MAX) {
		return LIST_PAGE_SIZE_DEFAULT;
	}
	return candidate;
}

/** True when `value` can be stored as the app-wide page size. */
function isValidListPageSize(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= LIST_PAGE_SIZE_MIN &&
		value <= LIST_PAGE_SIZE_MAX
	);
}

/**
 * Read the app-wide page size. Wrapped in React `cache` so a single request
 * reads the setting once even when several lists render together.
 */
export const getListPageSize = cache(async (): Promise<number> => {
	try {
		const row = await prisma.platformSetting.findUnique({
			where: { key: LIST_PAGE_SIZE_KEY },
			select: { value: true },
		});
		return normalizeListPageSize(row?.value);
	} catch {
		// A missing table/row or a transient read failure must not break a list.
		return LIST_PAGE_SIZE_DEFAULT;
	}
});
