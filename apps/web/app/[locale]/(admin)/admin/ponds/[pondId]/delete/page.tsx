import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DeletePondForm } from "@/components/admin/delete-pond-form";
import { PondStatusToggle } from "@/components/admin/pond-status-toggle";
import { Link } from "@/i18n/routing";
import { getPondDeletionCheck } from "@/lib/actions/ponds";
import { hasPermission } from "@/lib/auth/permissions";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

const BLOCKER_KEYS = [
	"biomassLogs",
	"feedEvents",
	"cropCycles",
	"devices",
	"fcrReports",
	"scheduleCommands",
	"notifications",
	"pondEvents",
] as const;

/**
 * Dedicated pond-deletion page (#202 / decision E22).
 *
 * A pond with any history or hardware is never deleted: the page explains why
 * and points at Archive. An empty pond needs the typed name and a step-up.
 */
export default async function DeletePondPage({
	params,
}: {
	params: Promise<{ pondId: string }>;
}) {
	const { pondId } = await params;
	if (!(await hasPermission("manage_farms_ponds"))) notFound();
	const [check, t] = await Promise.all([
		getPondDeletionCheck(pondId),
		getTranslations("dashboard.adminPondDelete"),
	]);

	if (!check) notFound();

	const blockers = BLOCKER_KEYS.filter((key) => check.blockers[key] > 0);

	return (
		<div className="max-w-2xl space-y-6">
			<div>
				<Link
					href={`/admin/ponds/${check.pondId}`}
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:text-white dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="h-4 w-4" />
					{t("back")}
				</Link>
			</div>

			<AdminPageHeader
				icon={Trash2}
				title={t("title", { name: check.pondName })}
				description={t("desc")}
			/>

			<section className={`${adminSurface} space-y-4 p-4 sm:p-6`}>
				<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
					{t("warning")}
				</p>

				{check.canDelete ? (
					<DeletePondForm pondId={check.pondId} pondName={check.pondName} />
				) : (
					<div className="space-y-4">
						<div>
							<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
								{t("blockedTitle")}
							</h2>
							<p className="mt-1 text-sm text-[#3D5568] dark:text-gray-400">{t("blockedDesc")}</p>
						</div>
						<ul className="space-y-2">
							{blockers.map((key) => (
								<li
									key={key}
									className="flex items-center justify-between gap-3 rounded-xl bg-[#F4F7F6] px-3 py-2 text-xs dark:bg-gray-800"
								>
									<span className="font-bold text-[#0A3D62] dark:text-gray-100">
										{t(`blocked.${key}`)}
									</span>
									<span className="font-black tabular-nums text-[#3D5568] dark:text-gray-300">
										{check.blockers[key]}
									</span>
								</li>
							))}
						</ul>
						<div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
							<p className="text-xs font-bold text-[#3D5568] dark:text-gray-400">
								{check.status === "ARCHIVED" ? t("archivedInstead") : t("archiveInstead")}
							</p>
							<PondStatusToggle pondId={check.pondId} status={check.status} />
						</div>
					</div>
				)}
			</section>
		</div>
	);
}
