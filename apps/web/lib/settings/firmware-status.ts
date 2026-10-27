import { OTA_CHANNEL_PATH, readStableChannel } from "@/lib/firmware/ota";

/**
 * Read-only firmware/OTA status for the superadmin configuration centre.
 *
 * There is nothing to write here by design: releases are signed offline and
 * uploaded to the private `firmware` bucket. The console only reports whether
 * storage is configured, which version the stable channel currently offers, and
 * the maintenance window the firmware enforces.
 */

/** Mirrors `OTA_WINDOW_START_MINUTE` / `OTA_WINDOW_END_MINUTE` in firmware-main.ino. */
export const OTA_WINDOW = {
	start: "10:00",
	end: "15:00",
	startMinute: 10 * 60,
	endMinute: 15 * 60,
} as const;

export type FirmwareStatus = {
	/** Both Supabase values the server client needs are present. */
	storageConfigured: boolean;
	channelPath: string;
	/** Parsed channel version, or null when no valid release is offered. */
	channelVersion: string | null;
	/** True when a valid signed channel file was read. */
	channelAvailable: boolean;
	windowStart: string;
	windowEnd: string;
};

type Env = Record<string, string | undefined>;

function present(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

export async function getFirmwareStatus(env: Env = process.env): Promise<FirmwareStatus> {
	const storageConfigured =
		present(env.NEXT_PUBLIC_SUPABASE_URL) && present(env.SUPABASE_SERVICE_ROLE_KEY);

	const base: FirmwareStatus = {
		storageConfigured,
		channelPath: OTA_CHANNEL_PATH,
		channelVersion: null,
		channelAvailable: false,
		windowStart: OTA_WINDOW.start,
		windowEnd: OTA_WINDOW.end,
	};

	if (!storageConfigured) return base;

	try {
		const channel = await readStableChannel();
		if (!channel) return base;
		return {
			...base,
			channelVersion: channel.version,
			channelAvailable: true,
		};
	} catch {
		// A storage outage is "not readable", not a page error.
		return base;
	}
}
