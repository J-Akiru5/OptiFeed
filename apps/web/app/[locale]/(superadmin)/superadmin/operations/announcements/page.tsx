import { AnnouncementComposer } from "@/components/superadmin/announcement-form";
import { OpsNav } from "@/components/superadmin/ops-nav";
import { Badge, Card, PageHeader, SectionTitle } from "@/components/superadmin/ui";
import { isAnnouncementActive } from "@/lib/announcement";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getStoredAnnouncement } from "@/lib/settings/announcement";
import { getTranslations } from "next-intl/server";

/**
 * Operations → announcements (E16.4, task I-15).
 *
 * Writes one platform-wide banner shown to every tenant user until its end
 * date. Publishing and clearing are audited platform actions; this page only
 * reads the stored value and renders the form.
 */
export default async function OperationsAnnouncementsPage() {
	await requirePlatformAdmin();

	const [current, t, tDates] = await Promise.all([
		getStoredAnnouncement(),
		getTranslations("superadmin.operations"),
		getTranslations("dates"),
	]);

	const active = current ? isAnnouncementActive(current) : false;
	const formatted = (iso: string) => formatDateTimeLocal(new Date(iso), tDates).full;

	return (
		<div className="space-y-6">
			<PageHeader title={t("announcements.title")} description={t("announcements.description")} />
			<OpsNav />

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
				<Card>
					<SectionTitle
						title={t("announcements.currentTitle")}
						description={t("announcements.currentDescription")}
						actions={
							current ? (
								<Badge tone={active ? "success" : "neutral"}>
									{active ? t("announcements.active") : t("announcements.expired")}
								</Badge>
							) : undefined
						}
					/>
					{current ? (
						<div className="space-y-3 p-5">
							<div>
								<p className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase">
									{t(`announcements.severity.${current.severity}`)}
								</p>
								<p className="font-black text-[#0A3D62]">{current.title}</p>
								<p className="mt-1 whitespace-pre-line text-sm text-[#3D5568]">{current.body}</p>
							</div>
							<dl className="grid gap-2 text-xs sm:grid-cols-2">
								<div>
									<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] uppercase">
										{t("announcements.publishedAt")}
									</dt>
									<dd className="font-bold text-[#0A3D62]">{formatted(current.publishedAt)}</dd>
								</div>
								<div>
									<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] uppercase">
										{t("announcements.endsAt")}
									</dt>
									<dd className="font-bold text-[#0A3D62]">
										{current.endsAt ? formatted(current.endsAt) : t("announcements.noEnd")}
									</dd>
								</div>
							</dl>
						</div>
					) : (
						<p className="p-5 text-sm text-[#3D5568]">{t("announcements.none")}</p>
					)}
				</Card>

				<Card>
					<SectionTitle
						title={t("announcements.composeTitle")}
						description={t("announcements.composeDescription")}
					/>
					<div className="p-5">
						<AnnouncementComposer current={current} />
					</div>
				</Card>
			</div>

			<Card className="p-5">
				<p className="text-xs text-[#3D5568]">{t("announcements.note")}</p>
			</Card>
		</div>
	);
}
