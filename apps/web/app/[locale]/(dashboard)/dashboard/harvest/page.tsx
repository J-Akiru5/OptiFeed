import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";

export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Legacy `/dashboard/harvest` route (#248).
 *
 * Calendar and Harvest became one page at `/dashboard/calendar`, so every old
 * link, bookmark, notification and reminder still works: this page redirects to
 * the merged page in the active locale and keeps the query string (the calendar
 * stores its pond and type filters there).
 */
export default async function HarvestRedirectPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const [params, locale] = await Promise.all([searchParams, getLocale()]);
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (Array.isArray(value)) {
			for (const item of value) query.append(key, item);
		} else if (value !== undefined) {
			query.append(key, value);
		}
	}
	const suffix = query.toString();

	redirect({
		href: suffix ? `/dashboard/calendar?${suffix}` : "/dashboard/calendar",
		locale,
	});
}
