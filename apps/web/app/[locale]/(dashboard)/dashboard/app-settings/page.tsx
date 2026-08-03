import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";

export default async function AppSettingsPage() {
	const locale = await getLocale();
	redirect({ href: "/dashboard/settings/hardware", locale });
}
