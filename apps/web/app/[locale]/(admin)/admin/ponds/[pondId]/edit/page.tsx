import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PondForm } from "@/components/admin/pond-form";
import { Link } from "@/i18n/routing";
import { getPondDetail, getPondOwnerOptions } from "@/lib/actions/ponds";
import { hasPermission } from "@/lib/auth/permissions";
import { ArrowLeft, Pencil } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

function formatTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
		2,
		"0",
	)}`;
}

/**
 * Edit every editable pond field (#202 / decision E22).
 *
 * Same action and validation as create; changing the owner is a within-org move
 * that the action re-checks against the caller's scope.
 */
export default async function EditPondPage({
	params,
}: {
	params: Promise<{ pondId: string }>;
}) {
	const { pondId } = await params;
	if (!(await hasPermission("manage_farms_ponds"))) notFound();
	const [detail, owners, t] = await Promise.all([
		getPondDetail(pondId),
		getPondOwnerOptions(),
		getTranslations("dashboard.adminPondForm"),
	]);

	if (!detail) notFound();
	const { pond } = detail;

	return (
		<div className="space-y-6">
			<div>
				<Link
					href={`/admin/ponds/${pond.id}`}
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:text-white dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="h-4 w-4" />
					{t("backToPond")}
				</Link>
			</div>

			<AdminPageHeader icon={Pencil} title={t("editTitle")} description={t("editDesc")} />

			<div className={`${adminSurface} p-4 text-xs text-[#3D5568] sm:p-6 dark:text-gray-400`}>
				<p className="font-mono">{t("editingPond", { name: pond.name })}</p>
			</div>

			<PondForm
				mode="edit"
				pondId={pond.id}
				owners={owners}
				defaults={{
					name: pond.name,
					ownerFarmId: pond.ownerId,
					population: pond.population?.toString() ?? "",
					sampleIntervalDays: pond.sampleIntervalDays.toString(),
					feedingRatePct: pond.feedingRatePct.toString(),
					feedsPerDay: pond.feedsPerDay.toString(),
					scheduleStart: formatTime(pond.scheduleStart),
					scheduleEnd: formatTime(pond.scheduleEnd),
					stockingDate: "",
				}}
			/>
		</div>
	);
}
