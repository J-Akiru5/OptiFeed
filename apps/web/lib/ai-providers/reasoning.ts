import type { ReasoningEffort } from "./types";

/**
 * Normalises a reasoning-effort setting. "none"/"off"/"disabled" disable the
 * reasoning parameter entirely; anything unrecognised falls back to "high",
 * which is the product default.
 */
export function parseReasoningEffort(raw: string | null | undefined): ReasoningEffort {
	const value = (raw ?? "").toLowerCase().trim();
	if (value === "none" || value === "off" || value === "disabled") return "none";
	if (value === "low") return "low";
	if (value === "medium") return "medium";
	return "high";
}
