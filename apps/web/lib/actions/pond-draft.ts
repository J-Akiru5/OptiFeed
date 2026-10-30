"use server";

import { getCurrentPondOwnerId, getCurrentUser, requireWriteAccess } from "@/lib/auth/session";
import { parsePondProfile } from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { pondDraftValuesEqual } from "@/lib/settings/pond-draft";
import { parsePondSettingsDraftPayload } from "@/lib/settings/pond-draft-schema";
import type { PondSettingsDraft } from "@/lib/settings/pond-input";
import type { InputJsonValue } from "@prisma/client/runtime/library";

/**
 * The database-backed pond settings draft (I-99).
 *
 * Before I-99 the form kept its unsaved values in `sessionStorage`, which dies
 * with the tab. These three actions give the draft a real home:
 *
 *  - `savePondSettingsDraft` upserts the typed values for the caller and the
 *    pond. It runs the same guard as saving pond settings (`requireWriteAccess`)
 *    and re-checks that the pond belongs to the caller's scope, so the browser
 *    can never write a draft into another tenant.
 *  - `loadPondSettingsDraft` returns the caller's draft only when it is newer
 *    than the saved pond settings and actually differs from them. A draft that
 *    has been overtaken by a save (or left behind after a successful one) is
 *    ignored rather than shown.
 *  - `discardPondSettingsDraft` deletes only the caller's own row.
 *
 * The row is keyed by `@@unique([pondId, userId])`: one member's draft can never
 * surface for another member of the same farm. `data` holds the form values
 * only — no token, password or secret is ever written here.
 *
 * `savePondSettingsDraft` is called from a debounced (~800 ms) client effect and
 * only while the form is dirty, so a typing burst costs one write, not one per
 * keystroke.
 */

export type PondSettingsDraftSaveResult =
	| { success: true; savedAt: string }
	| { success: false; error: string };

export type PondSettingsDraftLoadResult =
	| {
			success: true;
			draft: {
				values: PondSettingsDraft;
				updatedAt: string;
				deviceId: string | null;
			} | null;
	  }
	| { success: false; error: string };

export type PondSettingsDraftDiscardResult = { success: true } | { success: false; error: string };

const NOT_FOUND = "Pond not found";
const SAVE_FAILED = "Failed to save the draft";
const LOAD_FAILED = "Failed to load the draft";
const DISCARD_FAILED = "Failed to discard the draft";

interface DraftScope {
	userId: string;
	deviceId: string | null;
	pond: {
		id: string;
		createdAt: Date;
		feedingRatePct: number;
		feedsPerDay: number;
		sampleIntervalDays: number;
		population: number | null;
		notificationPrefs: unknown;
	};
}

/**
 * Resolve the caller and the pond inside the caller's scope.
 *
 * Mirrors the save path of `updatePondSettings`: the pond is looked up by
 * `{ id, ownerId }` with the owner id derived from the session, never from an
 * argument.
 */
async function resolveDraftScope(pondId: string): Promise<DraftScope | null> {
	const ownerId = await getCurrentPondOwnerId();
	const user = await getCurrentUser();
	if (!user) return null;

	const pond = await prisma.pond.findFirst({
		where: { id: pondId, ownerId },
		select: {
			id: true,
			createdAt: true,
			feedingRatePct: true,
			feedsPerDay: true,
			sampleIntervalDays: true,
			population: true,
			notificationPrefs: true,
		},
	});
	if (!pond) return null;

	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		select: { id: true },
	});

	return { userId: user.id, deviceId: device?.id ?? null, pond };
}

/**
 * When the pond's settings were last saved.
 *
 * `Pond` has no `updatedAt` column (and I-99 only authorises the new draft
 * table), so the timestamp is derived from the writes a save performs: the
 * `settings_changed` device event, the queued schedule command, and finally the
 * pond's own `createdAt` as the floor. Any of these newer than the draft means
 * the saved values win.
 */
async function pondSettingsSavedAt(scope: DraftScope): Promise<Date> {
	const [event, command] = await Promise.all([
		prisma.deviceStateEvent.findFirst({
			where: { eventType: "settings_changed", device: { pondId: scope.pond.id } },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true },
		}),
		prisma.scheduleCommand.findFirst({
			where: { pondId: scope.pond.id },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true },
		}),
	]);

	const candidates = [scope.pond.createdAt, event?.createdAt, command?.createdAt].filter(
		(value): value is Date => value instanceof Date,
	);
	return candidates.reduce(
		(newest, value) => (value > newest ? value : newest),
		scope.pond.createdAt,
	);
}

/** The values the form would start from today, in the draft's raw string form. */
async function savedDraftValues(scope: DraftScope): Promise<PondSettingsDraft> {
	const current = await resolveCurrentSchedule(scope.pond.id, scope.deviceId);
	const profile = parsePondProfile(scope.pond.notificationPrefs);

	return {
		feedingRate: (current?.feedingRatePct ?? scope.pond.feedingRatePct).toString(),
		feedsPerDay: (current?.feedsPerDay ?? scope.pond.feedsPerDay).toString(),
		sampleInterval: scope.pond.sampleIntervalDays.toString(),
		population: scope.pond.population?.toString() ?? "",
		areaM2: profile.areaM2?.toString() ?? "",
		averageDepthM: profile.averageDepthM?.toString() ?? "",
		feedPricePerKg: profile.feedPricePerKg?.toString() ?? "",
	};
}

/** Store the caller's typed values for one pond (one row per pond and user). */
export async function savePondSettingsDraft(
	pondId: string,
	values: unknown,
): Promise<PondSettingsDraftSaveResult> {
	try {
		await requireWriteAccess();

		const parsed = parsePondSettingsDraftPayload(values);
		if (!parsed.ok) {
			return {
				success: false,
				error:
					parsed.error === "draft_too_large"
						? "The draft is too large to keep"
						: "The draft has invalid values",
			};
		}

		const scope = await resolveDraftScope(pondId);
		if (!scope) return { success: false, error: NOT_FOUND };

		const saved = await prisma.pondSettingsDraft.upsert({
			where: { pondId_userId: { pondId, userId: scope.userId } },
			create: {
				pondId,
				userId: scope.userId,
				deviceId: scope.deviceId,
				data: parsed.values as unknown as InputJsonValue,
			},
			update: {
				deviceId: scope.deviceId,
				data: parsed.values as unknown as InputJsonValue,
			},
			select: { updatedAt: true },
		});

		return { success: true, savedAt: saved.updatedAt.toISOString() };
	} catch (error) {
		console.error("Failed to save the pond settings draft:", error);
		return { success: false, error: SAVE_FAILED };
	}
}

/**
 * Read back the caller's draft, if it is still the newest state of this pond.
 *
 * A draft is returned only when it is strictly newer than the pond's saved
 * settings *and* differs from them. A corrupted or oversized row is treated as
 * no draft: the reader then sees the saved values instead of a stray payload.
 */
export async function loadPondSettingsDraft(pondId: string): Promise<PondSettingsDraftLoadResult> {
	try {
		await requireWriteAccess();

		const scope = await resolveDraftScope(pondId);
		if (!scope) return { success: false, error: NOT_FOUND };

		const draft = await prisma.pondSettingsDraft.findUnique({
			where: { pondId_userId: { pondId, userId: scope.userId } },
			select: { data: true, updatedAt: true, deviceId: true },
		});
		if (!draft) return { success: true, draft: null };

		const parsed = parsePondSettingsDraftPayload(draft.data);
		if (!parsed.ok) return { success: true, draft: null };

		const savedAt = await pondSettingsSavedAt(scope);
		if (draft.updatedAt <= savedAt) return { success: true, draft: null };

		const savedValues = await savedDraftValues(scope);
		if (pondDraftValuesEqual(parsed.values, savedValues)) return { success: true, draft: null };

		return {
			success: true,
			draft: {
				values: parsed.values,
				updatedAt: draft.updatedAt.toISOString(),
				deviceId: draft.deviceId,
			},
		};
	} catch (error) {
		console.error("Failed to load the pond settings draft:", error);
		return { success: false, error: LOAD_FAILED };
	}
}

/** Drop the caller's own draft, after a successful save or on request. */
export async function discardPondSettingsDraft(
	pondId: string,
): Promise<PondSettingsDraftDiscardResult> {
	try {
		await requireWriteAccess();

		const scope = await resolveDraftScope(pondId);
		if (!scope) return { success: false, error: NOT_FOUND };

		await prisma.pondSettingsDraft.deleteMany({
			where: { pondId, userId: scope.userId },
		});

		return { success: true };
	} catch (error) {
		console.error("Failed to discard the pond settings draft:", error);
		return { success: false, error: DISCARD_FAILED };
	}
}
