import { LogoutButton } from "@/components/LogoutButton";
import { PondSettingsForm } from "@/components/PondSettingsForm";
import prisma from "@/lib/prisma";
import { LogOut, Settings, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
	const t = await getTranslations("dashboard.settings");
	// Fetch demo pond configuration
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		select: { id: true, feedingRatePct: true, feedsPerDay: true },
	});

	if (!pond) {
		return (
			<div className="p-6">
				<h1 className="text-3xl font-bold text-[var(--ofd-base)]">{t("title")}</h1>
				<p className="mt-2 text-red-500">{t("errorLoad")}</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Settings size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			<div className="space-y-8">
				{/* Pond Configuration Section */}
				<section>
					<PondSettingsForm pond={pond} />
				</section>

				{/* Account Section */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<User size={20} />
							{t("accountTitle")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("accountDesc")}</p>
					</div>

					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<div>
								<h3 className="font-medium text-gray-900">{t("signOutTitle")}</h3>
								<p className="text-sm text-gray-500">{t("signOutDesc")}</p>
							</div>
							<LogoutButton />
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
