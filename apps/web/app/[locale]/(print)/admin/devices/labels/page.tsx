import {
	DeviceSticker,
	type DeviceStickerStrings,
	STICKERS_PER_SHEET,
} from "@/components/admin/device-sticker";
import { PrintButton } from "@/components/admin/print-button";
import { Link } from "@/i18n/routing";
import { getDevicesForLabels } from "@/lib/actions/admin";
import {
	HARDWARE_RATING,
	type HardwareRating,
	maxPower,
	powerUnit,
} from "@/lib/constants/hardware-rating";
import { provisioningApSsid, wifiSetupPayload } from "@/lib/provisioning-ap";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

// `@page` is global to the document, so it is emitted by this page alone
// rather than from a stylesheet other routes could pick up.
const PRINT_CSS = "@page{size:A4;margin:8mm}";

function idsFrom(param: string | string[] | undefined): string[] {
	if (param === undefined) return [];
	return Array.isArray(param) ? param : [param];
}

export default async function DeviceLabelsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const { id } = await searchParams;
	const devices = await getDevicesForLabels(idsFrom(id));
	// Out-of-scope and unknown devices both come back empty: same answer.
	if (devices.length === 0) notFound();

	const t = await getTranslations("dashboard.adminDeviceLabels");
	// The sticker is a physical label and is always English, whatever locale
	// the admin browses in; only this page's own chrome is localized. Raw
	// messages: they carry `{type}` / `{ssid}` / `{address}` placeholders that
	// the sticker fills in itself per device.
	const tSticker = await getTranslations({
		locale: "en",
		namespace: "dashboard.adminDeviceLabels.sticker",
	});
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

	const sheets: (typeof devices)[] = [];
	for (let i = 0; i < devices.length; i += STICKERS_PER_SHEET) {
		sheets.push(devices.slice(i, i + STICKERS_PER_SHEET));
	}

	// Last-four collisions would give two units the same setup network name.
	const seen = new Map<string, string>();
	let duplicateSsid = false;
	for (const device of devices) {
		const ssid = provisioningApSsid(device.mac);
		const previous = seen.get(ssid);
		if (previous !== undefined && previous !== device.mac.toUpperCase()) duplicateSsid = true;
		seen.set(ssid, device.mac.toUpperCase());
	}

	const rating: HardwareRating = HARDWARE_RATING;
	const firstSsid = provisioningApSsid(devices[0].mac);

	return (
		<div className="p-4 md:p-8 print:p-0">
			<style>{PRINT_CSS}</style>

			<div className="print:hidden mx-auto mb-6 max-w-[200mm] space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<Link
							href="/admin/devices"
							className="text-sm font-bold text-[#3D5568] hover:text-[#0A3D62]"
						>
							← {t("back")}
						</Link>
						<h1 className="mt-1 text-2xl font-black text-[#0A3D62]">{t("title")}</h1>
						<p className="text-sm text-[#3D5568]">{t("count", { count: devices.length })}</p>
					</div>
					<PrintButton label={t("print")} />
				</div>

				<div className="rounded-xl border border-[#F5B87A] bg-[#FFF4E8] p-4 text-sm text-[#0F1B2D]">
					<p>
						<b className="text-[#8A4A00]">{t("verifyTitle")}</b>{" "}
						{t("verifyIntro", {
							volts: rating.inputVoltage,
							hz: rating.supplyType === "AC" ? rating.frequencyHz : 0,
							amps: rating.maxCurrentA,
						})}
					</p>
					<ul className="mt-2 list-disc space-y-1 pl-5">
						<li>{t("verifyReadLabels")}</li>
						<li>{t("verifyMeasure")}</li>
						<li>{t("verifyPower", { power: maxPower(), unit: powerUnit() })}</li>
					</ul>
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

			<div className="overflow-x-auto print:overflow-visible">
				<div className="mx-auto w-fit print:mx-0">
					{sheets.map((sheet) => (
						<div key={sheet.map((d) => d.id).join("|")} className="pk-page mb-6 print:mb-0">
							<div className="pk-sheet">
								{sheet.map((device) => (
									<DeviceSticker key={device.id} mac={device.mac} strings={strings} />
								))}
							</div>
						</div>
					))}
				</div>
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
