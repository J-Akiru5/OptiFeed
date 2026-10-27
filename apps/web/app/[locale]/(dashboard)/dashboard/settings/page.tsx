import {
	dashboardFocus,
	dashboardLabel,
	dashboardSurface,
} from "@/components/dashboard/dashboard-classes";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { FarmRenameForm } from "@/components/farm-rename-form";
import { Link } from "@/i18n/routing";
import { getFarmOverview } from "@/lib/actions/farm";
import { canWrite } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { Cpu, Database, Droplets, Settings, Sprout, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
	const [t, tCommon] = await Promise.all([
		getTranslations("dashboard.settings"),
		getTranslations("dashboard.common"),
	]);
	const farm = await getFarmOverview();
	const writeAccess = await canWrite();

	const cards = [
		{
			href: "/dashboard/settings/pond",
			title: t("pondCardTitle"),
			desc: t("pondCardDesc"),
			icon: Settings,
		},
		{
			href: "/dashboard/settings/hardware",
			title: t("hardwareCardTitle"),
			desc: t("hardwareCardDesc"),
			icon: Cpu,
		},
		{
			href: "/dashboard/settings/profile",
			title: t("profileCardTitle"),
			desc: t("profileCardDesc"),
			icon: User,
		},
		{
			href: "/dashboard/settings/data",
			title: t("dataCardTitle"),
			desc: t("dataCardDesc"),
			icon: Database,
		},
	];

	return (
		<div className="w-full space-y-6 pb-20">
			<DashboardPageHeader title={t("title")} description={t("desc")} icon={Settings} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			{farm ? (
				<DashboardSection title={t("farmCardTitle")} description={t("farmCardDesc")} icon={Sprout}>
					<div className="grid gap-6 md:grid-cols-2">
						<div className="min-w-0 space-y-2">
							<p className={dashboardLabel}>{t("farmIdLabel")}</p>
							<div className="break-all rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-2 font-mono text-sm text-[#3D5568] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
								{farm.ownerId}
							</div>
							<FarmRenameForm initialName={farm.name} canWrite={writeAccess} />
						</div>

						<div className="min-w-0 space-y-2">
							<p className={dashboardLabel}>{t("pondsLabel")}</p>
							{farm.ponds.length === 0 ? (
								<DashboardEmptyState
									icon={Droplets}
									title={t("noPonds")}
									description={t("noPondsHint")}
									className="px-4 py-8"
								/>
							) : (
								<ul className="space-y-2">
									{farm.ponds.map((pond) => (
										<li
											key={pond.id}
											className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-2 text-sm font-bold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
										>
											<Droplets
												aria-hidden="true"
												className="h-4 w-4 shrink-0 text-[#0A3D62] dark:text-[#5b9bd5]"
											/>
											{pond.name}
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</DashboardSection>
			) : (
				<DashboardEmptyState
					icon={Sprout}
					title={t("farmCardTitle")}
					description={t("errorLoadDesc")}
				/>
			)}

			<nav aria-label={t("cardsLabel")} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{cards.map((card) => (
					<Link
						key={card.href}
						href={card.href}
						aria-label={t("openCard", { title: card.title })}
						className={cn(
							dashboardSurface,
							dashboardFocus,
							"group flex min-h-11 flex-col gap-4 p-5 transition-colors hover:bg-[#F4F7F6] dark:hover:bg-gray-800",
						)}
					>
						<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] transition-colors group-hover:bg-[#0A3D62] group-hover:text-white dark:bg-white/5 dark:text-[#5b9bd5]">
							<card.icon aria-hidden="true" className="h-6 w-6" />
						</div>
						<div className="flex-1">
							<h2 className="font-black text-[#0A3D62] dark:text-[#5b9bd5]">{card.title}</h2>
							<p className="mt-1 text-sm text-[#3D5568] dark:text-gray-400">{card.desc}</p>
						</div>
						<svg
							aria-hidden="true"
							className="h-5 w-5 text-[#3D5568] transition-transform group-hover:translate-x-1 dark:text-gray-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</Link>
				))}
			</nav>
		</div>
	);
}
