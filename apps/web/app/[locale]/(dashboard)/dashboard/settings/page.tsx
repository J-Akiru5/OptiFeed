import { FarmRenameForm } from "@/components/farm-rename-form";
import { Link } from "@/i18n/routing";
import { getFarmOverview } from "@/lib/actions/farm";
import { canWrite } from "@/lib/auth/session";
import { Cpu, Database, Droplets, Settings, Sprout, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
	const t = await getTranslations("dashboard.settings");
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
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Settings size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			{farm && (
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<Sprout size={20} />
							{t("farmCardTitle")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("farmCardDesc")}</p>
					</div>

					<div className="grid gap-6 md:grid-cols-2">
						<div className="space-y-2">
							<p className="text-sm font-medium text-gray-700">{t("farmIdLabel")}</p>
							<div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 font-mono text-gray-500">
								{farm.ownerId}
							</div>
							<FarmRenameForm initialName={farm.name} canWrite={writeAccess} />
						</div>

						<div className="space-y-2">
							<p className="text-sm font-medium text-gray-700">{t("pondsLabel")}</p>
							{farm.ponds.length === 0 ? (
								<p className="text-sm text-gray-500">{t("noPonds")}</p>
							) : (
								<ul className="space-y-2">
									{farm.ponds.map((pond) => (
										<li
											key={pond.id}
											className="flex items-center gap-2 rounded-lg border border-gray-100 bg-[#F4F7F6] px-4 py-2 text-sm font-medium text-gray-800"
										>
											<Droplets className="h-4 w-4 shrink-0 text-[#0A3D62]" aria-hidden />
											{pond.name}
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</section>
			)}

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{cards.map((card) => (
					<Link
						key={card.href}
						href={card.href}
						className="group flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					>
						<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] transition-colors group-hover:bg-[#0A3D62] group-hover:text-white">
							<card.icon className="h-6 w-6" />
						</div>
						<div className="flex-1">
							<h2 className="font-bold text-gray-800">{card.title}</h2>
							<p className="mt-1 text-sm text-gray-500">{card.desc}</p>
						</div>
						<svg
							className="h-5 w-5 text-[#3D5568] transition-transform group-hover:translate-x-1"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							role="img"
							aria-label="Navigate"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</Link>
				))}
			</div>
		</div>
	);
}
