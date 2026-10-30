import type { PondSettingsDraft } from "./pond-input";

/**
 * The unsaved pond settings draft (#371).
 *
 * The form keeps its typed values in React state, but the reader often has to
 * leave the page to fix the conflicting device setting and come back. A
 * `sessionStorage` draft survives that trip (and a reload) without turning the
 * values into saved settings. Storage is best-effort: private mode, a full
 * quota or a corrupted value must never break the form, so every access is
 * wrapped and a malformed draft is ignored.
 */

const DRAFT_PREFIX = "optifeed:pond-settings-draft:";
const DRAFT_VERSION = 1;

export interface StoredPondDraft {
	version: number;
	values: PondSettingsDraft;
}

export function pondDraftKey(pondId: string): string {
	return `${DRAFT_PREFIX}${pondId}`;
}

function isDraft(value: unknown): value is StoredPondDraft {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (record.version !== DRAFT_VERSION) return false;
	const values = record.values;
	if (typeof values !== "object" || values === null) return false;
	const draft = values as Record<string, unknown>;
	return (
		typeof draft.feedingRate === "string" &&
		typeof draft.feedsPerDay === "string" &&
		typeof draft.sampleInterval === "string" &&
		typeof draft.population === "string" &&
		typeof draft.areaM2 === "string" &&
		typeof draft.averageDepthM === "string" &&
		typeof draft.feedPricePerKg === "string"
	);
}

/** The stored draft, or null when there is none or it cannot be trusted. */
export function readPondDraft(
	storage: Storage | undefined,
	pondId: string,
): PondSettingsDraft | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(pondDraftKey(pondId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isDraft(parsed) ? parsed.values : null;
	} catch {
		return null;
	}
}

/** Save a draft; a storage failure is silent by design. */
export function writePondDraft(
	storage: Storage | undefined,
	pondId: string,
	values: PondSettingsDraft,
): void {
	if (!storage) return;
	try {
		const stored: StoredPondDraft = { version: DRAFT_VERSION, values };
		storage.setItem(pondDraftKey(pondId), JSON.stringify(stored));
	} catch {
		// Best-effort only.
	}
}

/** Drop the draft after a successful save or when the reader discards it. */
export function clearPondDraft(storage: Storage | undefined, pondId: string): void {
	if (!storage) return;
	try {
		storage.removeItem(pondDraftKey(pondId));
	} catch {
		// Best-effort only.
	}
}

/** `window.sessionStorage`, or undefined during SSR / when access is denied. */
export function sessionStorageOrNull(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.sessionStorage;
	} catch {
		return undefined;
	}
}
