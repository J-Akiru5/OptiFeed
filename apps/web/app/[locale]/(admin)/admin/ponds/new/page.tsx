import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CreatePondForm } from "@/components/admin/create-pond-form";
import { PondForm } from "@/components/admin/pond-form";
import { Link } from "@/i18n/routing";
import { getPondOwnerOptions } from "@/lib/actions/ponds";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { ORG_SETTINGS_DEFAULTS, getOrgSettings } from "@/lib/settings/org";
import { ArrowLeft, Droplets } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Create a pond for an existing farm owner (#202 / decision E22).
 *
 * The farmer-onboarding form is kept below (open when the organization has no
 * owners yet): a farmer with no pond still needs the one-screen
 * "account + first pond" path that the Users page links to.
 */
export default async function NewPondPage() {
	const [t, tCreate, owners, scope] = await Promise.all([
		getTranslations("dashboard.adminPondForm"),
		getTranslations("dashboard.adminCreatePond"),
		getPondOwnerOptions(),
		resolveOrgScope(),
	]);

	const orgId = scope.orgIds[0];
	const settings = orgId ? await getOrgSettings(orgId) : ORG_SETTINGS_DEFAULTS;

	return (
		<div className="space-y-6">
			<div>
				<Link
					href="/admin/ponds"
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:text-white dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="h-4 w-4" />
					{t("backToList")}
				</Link>
			</div>

			<AdminPageHeader icon={Droplets} title={t("createTitle")} description={t("createDesc")} />

			<PondForm
				mode="create"
				owners={owners}
				defaults={{
					name: "",
					ownerFarmId: owners[0]?.farmId ?? "",
					population: "",
					sampleIntervalDays: "14",
					feedingRatePct: String(settings.defaultFeedingRatePct),
					feedsPerDay: "3",
					scheduleStart: "06:00",
					scheduleEnd: "18:00",
					stockingDate: "",
				}}
			/>

			<details
				open={owners.length === 0}
				className={`${adminSurface} p-4 sm:p-6 [&_summary]:cursor-pointer`}
			>
				<summary className="text-base font-black text-[#0A3D62] dark:text-[#8fc0ea]">
					{tCreate("title")}
				</summary>
				<p className="mt-1 mb-4 text-xs text-[#3D5568] dark:text-gray-400">{tCreate("desc")}</p>
				<CreatePondForm defaultFeedingRatePct={settings.defaultFeedingRatePct} />
			</details>
		</div>
	);
}
