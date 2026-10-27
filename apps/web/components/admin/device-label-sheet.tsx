import type { DeviceStickerStrings } from "@/components/admin/device-sticker";
import { PrintButton } from "@/components/admin/print-button";
import { StickerPreview } from "@/components/admin/sticker-preview";
import { Link } from "@/i18n/routing";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getTenantAdminState } from "@/lib/auth/tenant-admin";
import { parseStickerRatingParams, resolveStickerRating } from "@/lib/constants/sticker-rating";
import { provisioningApSsid, wifiSetupPayload } from "@/lib/provisioning-ap";
import { getStickerRatingDefault } from "@/lib/settings/sticker-rating";
import { getTranslations } from "next-intl/server";

// `@page` is global to the document, so it is emitted by the print pages alone
// rather than from a stylesheet other routes could pick up.
const PRINT_CSS = "@page{size:A4;margin:8mm}";

type Props = {
	/** Display fields only. Callers select id/label/mac and never a credential. */
	devices: { id: string; mac: string }[];
	/** Where the "Back" link goes: the console the admin came from. */
	backHref: string;
	/** The labels route's search params; they carry the per-print rating. */
	searchParams: Record<string, string | string[] | undefined>;
};

/**
 * Printable A4 sheet of power-rating stickers, 2 × 4 per page, shared by the
 * tenant (Admin → Devices) and platform (Superadmin → Devices) print pages.
 * Each page does its own access check and data load before rendering this.
 *
 * The rating comes from the URL override, then the saved platform default,
 * then `lib/constants/hardware-rating.ts`. Saving a default is a platform
 * action; printing with an override needs only access to this page.
 */
export async function DeviceLabelSheet({ devices, backHref, searchParams }: Props) {
	const [t, tSticker, saved, canSaveDefault, tPlatform, tRoles] = await Promise.all([
		getTranslations("dashboard.adminDeviceLabels"),
		// The sticker is a physical label and is always English, whatever locale
		// the admin browses in; only this page's own chrome is localized. Raw
		// messages: they carry `{type}` / `{ssid}` / `{address}` placeholders that
		// the sticker fills in itself per device.
		getTranslations({
			locale: "en",
			namespace: "dashboard.adminDeviceLabels.sticker",
		}),
		getStickerRatingDefault(),
		isCurrentPlatformAdmin(),
		getTranslations("superadmin.common"),
		getTranslations("dashboard.adminMembers.role"),
	]);

	const strings: DeviceStickerStrings = {
		subtitle: tSticker.raw("subtitle"),
		tag: tSticker.raw("tag"),
		tagAc: tSticker.raw("tagAc"),
		sectionRating: tSticker.raw("sectionRating"),
		input: tSticker.raw("input"),
		current: tSticker.raw("current"),
		power: tSticker.raw("power"),
		max: tSticker.raw("max"),
		unitId: tSticker.raw("unitId"),
		stepScan: tSticker.raw("stepScan"),
		stepPortal: tSticker.raw("stepPortal"),
		stepSave: tSticker.raw("stepSave"),
		noteTitle: tSticker.raw("noteTitle"),
		noteBody: tSticker.raw("noteBody"),
		scan: tSticker.raw("scan"),
		qrLabel: tSticker.raw("qrLabel"),
		footerSupply: tSticker.raw("footerSupply"),
		footerUnplug: tSticker.raw("footerUnplug"),
		footerDry: tSticker.raw("footerDry"),
	};

	// Last-four collisions would give two units the same setup network name.
	const seen = new Map<string, string>();
	let duplicateSsid = false;
	for (const device of devices) {
		const ssid = provisioningApSsid(device.mac);
		const previous = seen.get(ssid);
		if (previous !== undefined && previous !== device.mac.toUpperCase()) duplicateSsid = true;
		seen.set(ssid, device.mac.toUpperCase());
	}

	const platformAdminRoleLabel = tPlatform("platformAdmin");
	let actorRoleLabel = platformAdminRoleLabel;
	if (!canSaveDefault) {
		const tenant = await getTenantAdminState();
		actorRoleLabel = tRoles(tenant.isOwner ? "OWNER" : "ADMIN");
	}

	const defaultRating = resolveStickerRating({ saved });
	const override = parseStickerRatingParams(searchParams);
	const initialRating = resolveStickerRating({ override, saved });

	const firstSsid = provisioningApSsid(devices[0]?.mac ?? "");

	return (
		<div className="p-4 md:p-8 print:p-0">
			<style>{PRINT_CSS}</style>

			<div className="print:hidden mx-auto mb-6 max-w-[200mm] space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<Link href={backHref} className="text-sm font-bold text-[#3D5568] hover:text-[#0A3D62]">
							← {t("back")}
						</Link>
						<h1 className="mt-1 text-2xl font-black text-[#0A3D62]">{t("title")}</h1>
						<p className="text-sm text-[#3D5568]">{t("count", { count: devices.length })}</p>
					</div>
					<PrintButton label={t("print")} />
				</div>

				{duplicateSsid && (
					<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A]">
						{t("dupWarning")}
					</p>
				)}

				<p className="text-sm text-[#3D5568]">
					{t("sizeNote")} <b>{t("scaleNote")}</b>
				</p>
			</div>

			<div className="mx-auto max-w-[200mm] print:max-w-none">
				<StickerPreview
					devices={devices}
					stickerStrings={strings}
					initialRating={initialRating}
					defaultRating={defaultRating}
					actorRoleLabel={actorRoleLabel}
					platformAdminRoleLabel={platformAdminRoleLabel}
					canSaveDefault={canSaveDefault}
					initialOverride={Object.keys(override).length > 0}
				/>
			</div>

			<div className="print:hidden mx-auto mt-6 max-w-[200mm] rounded-xl border border-gray-200 bg-white p-4 text-xs text-[#3D5568]">
				<p className="font-black text-[#0A3D62]">{t("qrTitle")}</p>
				<code className="mt-1 block break-all rounded bg-[#F1F5FB] px-1.5 py-1 font-mono">
					{wifiSetupPayload(firstSsid)}
				</code>
				<p className="mt-2">{t("qrBody", { ssid: firstSsid })}</p>
			</div>
		</div>
	);
}
