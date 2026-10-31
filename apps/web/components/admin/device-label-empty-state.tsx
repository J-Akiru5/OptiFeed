import { adminButtonSecondary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { Link } from "@/i18n/routing";
import { Printer } from "lucide-react";
import { getTranslations } from "next-intl/server";

type Props = {
	/** Where the "Back" link goes: the console the admin came from. */
	backHref: string;
};

/**
 * Shown when there is nothing to print: a tenant (or the platform) with no
 * devices yet. The label route is a print destination, not a record page, so
 * an empty registry is an empty state rather than a 404.
 */
export async function DeviceLabelEmptyState({ backHref }: Props) {
	const t = await getTranslations("dashboard.adminDeviceLabels");

	return (
		<div className="p-4 md:p-8">
			<AdminEmptyState
				icon={Printer}
				title={t("emptyTitle")}
				description={t("emptyDesc")}
				action={
					<Link href={backHref} className={adminButtonSecondary}>
						{t("back")}
					</Link>
				}
			/>
		</div>
	);
}
