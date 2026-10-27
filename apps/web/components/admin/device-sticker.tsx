import "./device-sticker.css";
import {
	HARDWARE_RATING,
	type HardwareRating,
	maxPower,
	powerUnit,
} from "@/lib/constants/hardware-rating";
import {
	QR_QUIET_ZONE,
	SETUP_PORTAL_ADDRESS,
	provisioningApSsid,
	qrSvgData,
	wifiSetupPayload,
} from "@/lib/provisioning-ap";

export type DeviceStickerStrings = {
	subtitle: string;
	/** Header tag for a DC supply; `{type}` is replaced with the supply type. */
	tag: string;
	/** Header tag for an AC supply. */
	tagAc: string;
	sectionRating: string;
	input: string;
	current: string;
	power: string;
	max: string;
	unitId: string;
	/** Contains `{ssid}`, which is shown in bold. */
	stepScan: string;
	/** Contains `{address}`, which is shown in bold. */
	stepPortal: string;
	stepSave: string;
	noteTitle: string;
	noteBody: string;
	scan: string;
	qrLabel: string;
	/** Footer; `{type}` is replaced with the supply type. */
	footerSupply: string;
	footerUnplug: string;
	footerDry: string;
};

type Props = {
	/** `EnergyDevice.mac` — shown as the Unit ID and used for the setup SSID. */
	mac: string;
	strings: DeviceStickerStrings;
};

const LOGO_MARK = "/pakaonai-logo-kit/svg/pakaonai-mark-color-light.svg";
const LOGO_WORDMARK = "/pakaonai-logo-kit/svg/pakaonai-wordmark-color.svg";

/** Stickers on one A4 sheet: 2 columns × 4 rows. */
export const STICKERS_PER_SHEET = 8;

function fmt(n: number): string {
	return (Math.round(n * 100) / 100).toString();
}

/** Render a translated sentence with one `{token}` shown in bold. */
function withBold(template: string, token: string, value: string) {
	const marker = `{${token}}`;
	const at = template.indexOf(marker);
	if (at === -1) return template;
	return (
		<>
			{template.slice(0, at)}
			<b>{value}</b>
			{template.slice(at + marker.length)}
		</>
	);
}

/**
 * One 95 × 66 mm power-rating / Wi-Fi setup sticker.
 *
 * Its inputs are the device MAC and display strings only. It never receives a
 * device token or any other credential, and the QR payload is derived from the
 * MAC alone.
 */
export function DeviceSticker({ mac, strings }: Props) {
	const ssid = provisioningApSsid(mac);
	const qr = qrSvgData(wifiSetupPayload(ssid));
	const rating: HardwareRating = HARDWARE_RATING;
	const { inputVoltage, supplyType, maxCurrentA } = rating;
	// "AC 60 Hz" for mains, plain "DC" otherwise.
	const supplyLine =
		rating.supplyType === "AC" ? `${supplyType} ${fmt(rating.frequencyHz)} Hz` : supplyType;

	return (
		<section className="pk-sticker" data-ssid={ssid}>
			<div className="pk-hd">
				<img className="pk-mark" alt="" src={LOGO_MARK} />
				<div className="pk-wm">
					<img alt="PakaonAI" src={LOGO_WORDMARK} />
					<span className="pk-sub">{strings.subtitle}</span>
				</div>
				<span className="pk-tag">
					{supplyType === "AC" ? strings.tagAc : strings.tag.replace("{type}", supplyType)}
				</span>
			</div>
			<div className="pk-body">
				<div className="pk-left">
					<div className="pk-sec">{strings.sectionRating}</div>
					<div className="pk-rate">
						<div className="pk-cell">
							<span className="pk-k">{strings.input}</span>
							<b>
								{fmt(inputVoltage)}
								<span className="pk-bu"> V</span>
							</b>
							<span className="pk-u">{supplyLine}</span>
						</div>
						<div className="pk-cell">
							<span className="pk-k">{strings.current}</span>
							<b>
								{fmt(maxCurrentA)}
								<span className="pk-bu"> A</span>
							</b>
							<span className="pk-u">{strings.max}</span>
						</div>
						<div className="pk-cell">
							<span className="pk-k">{strings.power}</span>
							<b>
								{fmt(maxPower())}
								<span className="pk-bu"> {powerUnit()}</span>
							</b>
							<span className="pk-u">{strings.max}</span>
						</div>
					</div>
					<div className="pk-idrow">
						<span>{strings.unitId}</span>
						<code>{mac.trim().toUpperCase()}</code>
					</div>
					<ol className="pk-steps">
						<li>{withBold(strings.stepScan, "ssid", ssid)}</li>
						<li>{withBold(strings.stepPortal, "address", SETUP_PORTAL_ADDRESS)}</li>
						<li>{strings.stepSave}</li>
					</ol>
					<div className="pk-note">
						<b>{strings.noteTitle}</b> {strings.noteBody}
					</div>
				</div>
				<div className="pk-right">
					<div className="pk-qrbox">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox={qr.viewBox}
							role="img"
							aria-label={strings.qrLabel}
						>
							<rect
								x={-QR_QUIET_ZONE}
								y={-QR_QUIET_ZONE}
								width={qr.extent}
								height={qr.extent}
								fill="#fff"
							/>
							<path d={qr.path} fill="#000" />
						</svg>
					</div>
					<div className="pk-scan">{strings.scan}</div>
					<div className="pk-ssid">{ssid}</div>
				</div>
			</div>
			<div className="pk-ft">
				<span>{strings.footerSupply.replace("{type}", supplyType)}</span>
				<i>•</i>
				<span>{strings.footerUnplug}</span>
				<i>•</i>
				<span>{strings.footerDry}</span>
			</div>
		</section>
	);
}
