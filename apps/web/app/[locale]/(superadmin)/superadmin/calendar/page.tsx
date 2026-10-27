import { PlatformCalendar } from "@/components/superadmin/platform-calendar";
import { Badge, PageHeader } from "@/components/superadmin/ui";
import { listPlatformCalendarEvents } from "@/lib/calendar/platform-events";
import { CalendarDays, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

/**
 * Platform calendar across all tenants (E16.2).
 *
 * The page and its data are both gated: `listPlatformCalendarEvents` calls
 * `requirePlatformAdmin()` before any query, and the refresh endpoint checks
 * the same PlatformAdmin row. Everything shown is read-only.
 */
export default async function SuperadminCalendarPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const [t, data] = await Promise.all([
		getTranslations("superadmin.calendar"),
		listPlatformCalendarEvents(params),
	]);

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<CalendarDays aria-hidden="true" className="h-6 w-6 text-[#E85A2A]" />
						{t("title")}
					</span>
				}
				description={t("description")}
				actions={
					<Badge tone="neutral" icon={Lock}>
						{t("readOnly")}
					</Badge>
				}
			/>

			<PlatformCalendar initialData={data} />
		</div>
	);
}
