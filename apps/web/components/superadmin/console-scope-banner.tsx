"use client";

import { ScopeBanner } from "@/components/superadmin/scope-banner";
import { usePathname } from "@/i18n/routing";
import { consoleScopeCrumbs, pageOwnsScope } from "@/lib/superadmin-scope";
import { useTranslations } from "next-intl";

/**
 * The layout's scope banner. It names the global scope and the section from the
 * URL alone; a page that names a record (an organization) renders its own.
 */
export function ConsoleScopeBanner() {
	const t = useTranslations("superadmin.shell");
	const pathname = usePathname();

	if (pageOwnsScope(pathname)) return null;

	return (
		<ScopeBanner
			label={t("scope.label")}
			crumbs={consoleScopeCrumbs(pathname, {
				global: t("scope.global"),
				section: (key) => t(`nav.${key}`),
			})}
		/>
	);
}
