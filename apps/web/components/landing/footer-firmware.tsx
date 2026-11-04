"use client";

import { useTranslations } from "next-intl";

/**
 * The landing footer's firmware line (#845).
 *
 * The number is the published channel version, read on the server by the page
 * from the signed firmware manifest; this component only renders it. When the
 * channel cannot be read the line is omitted rather than showing a stale
 * literal — the old copy said "Firmware v1.4.2" while the fleet was on 1.9.0.
 */
export function FooterFirmware({ version }: { version: string | null }) {
	if (!version) return null;

	const t = useTranslations("landing");
	return <p className="font-mono tracking-wide">{t("footerFirmware", { version })}</p>;
}
