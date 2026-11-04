import { LandingPageContent } from "@/components/landing/landing-page-content";
import { getFirmwareStatus } from "@/lib/settings/firmware-status";

/**
 * The public landing page (#845).
 *
 * The page body is a client component; this server wrapper only supplies the
 * firmware line, which comes from the published channel (the signed manifest in
 * the private `firmware` bucket), the same source as the superadmin firmware
 * console. A short ISR window keeps the page static between releases.
 */
export const revalidate = 300;

export default async function LandingPage() {
	const status = await getFirmwareStatus();
	const firmwareVersion = status.channelAvailable ? status.channelVersion : null;

	return <LandingPageContent firmwareVersion={firmwareVersion} />;
}
