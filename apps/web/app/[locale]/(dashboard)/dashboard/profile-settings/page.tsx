import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";

export default async function ProfileSettingsPage() {
	const locale = await getLocale();
	redirect({ href: "/dashboard/settings/profile", locale });
}
