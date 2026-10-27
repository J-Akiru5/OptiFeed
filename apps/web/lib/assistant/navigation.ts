import { createNamespaceTranslator } from "@/lib/chat/fallback";
import { HELP_SECTIONS } from "@/lib/help/guides";
import { type HelpSection, itemRoute } from "@/lib/help/types";
import type { AssistantRole } from "./types";

/**
 * "Take me to X" (issue #194, E11).
 *
 * The assistant may not invent a route: every destination is one of the help
 * centre's existing sections/controls, filtered by the same audience the help
 * sheet uses. The model picks an id; the server resolves the route and the
 * `data-help` anchor, so navigation can never reach a page the role cannot
 * open (or a selector the help engine would reject).
 *
 * The chat reuses `lib/help/reveal.ts` to open the page and ring the control.
 */

export interface AssistantNavigationEntry {
	id: string;
	label: string;
	route: string;
	target?: string;
	keywords: string[];
}

const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"your",
	"with",
	"this",
	"that",
	"page",
	"screen",
	"control",
	"button",
	"how",
	"where",
	"what",
]);

function words(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Curated intent words for the controls people ask for by name. The derived
 * words (label + anchor) are a good default, but anchors repeat words like
 * "calibration": the schedule's clock help also mentions it. These hints make
 * "take me to calibration" land on the calibration form, not the clock note.
 * Anything not listed keeps the derived words.
 */
const KEYWORD_HINTS: Record<string, string[]> = {
	"feed-now": ["feed now", "manual feed", "dispense now"],
	"next-feeding": ["next feeding", "feeding time", "schedule"],
	"schedule-editor": ["schedule", "feeding time", "meals per day"],
	"schedule-calibration": ["clock", "device time", "drift"],
	"calibration-form": ["calibration", "calibrate", "target check", "grams per second", "g/s"],
	"hopper-calibration": ["hopper", "capacity", "full", "empty"],
	"recalibration-interval": ["recalibration", "interval", "overdue"],
	"pond-settings-form": ["pond settings", "population", "area", "depth", "feeding rate"],
	"biomass-form": ["biomass", "log sample", "weigh", "sample"],
	"growth-charts": ["growth", "weight trend", "chart"],
	"growth-plan": ["growth plan", "target weight", "harvest target"],
	"harvest-calendar": ["calendar", "harvest", "events"],
	"harvest-add-event": ["add event", "add task", "new task"],
	"admin-invite-member": ["invite", "add member", "new member"],
	"admin-members-list": ["members", "permissions", "roles"],
	"superadmin-register-device": ["register device", "new device"],
	"superadmin-remote-feed": ["remote feed", "feed device"],
	"superadmin-ai-providers": ["ai provider", "model"],
	"superadmin-view-as": ["view as", "impersonate"],
};

function itemEntry(
	section: HelpSection,
	index: number,
	label: string,
): AssistantNavigationEntry | null {
	const item = section.items[index];
	if (!item?.target) return null;
	const route = itemRoute(section, item);
	if (!route) return null;
	return {
		id: `item:${section.id}:${index}`,
		label,
		route,
		target: item.target,
		keywords: [...new Set(KEYWORD_HINTS[item.target] ?? [...words(item.target), ...words(label)])],
	};
}

/** Every destination this role can reach, in help-sheet order. */
export function navigationEntries(
	audience: AssistantRole,
	locale: string,
): AssistantNavigationEntry[] {
	const t = createNamespaceTranslator(locale, "help");
	const entries: AssistantNavigationEntry[] = [];

	for (const section of HELP_SECTIONS) {
		if (!section.roles.includes(audience)) continue;
		const title = t(section.title);
		const route = section.routes[0];
		if (!route) continue;
		entries.push({
			id: `section:${section.id}`,
			label: title,
			route,
			keywords: [...new Set([...words(section.id), ...words(title)])],
		});
		section.items.forEach((item, index) => {
			if (!item.target) return;
			const entry = itemEntry(section, index, t(item.text));
			if (entry) entries.push(entry);
		});
	}

	return entries;
}

export function resolveNavigation(
	id: string,
	audience: AssistantRole,
	locale: string,
): AssistantNavigationEntry | null {
	return navigationEntries(audience, locale).find((entry) => entry.id === id) ?? null;
}

/**
 * Keyword fallback for when the model is unavailable, and a safety net when it
 * answers with prose instead of JSON. Only entries with a real word overlap are
 * considered, so "take me to calibration" never falls through to the dashboard.
 */
export function matchNavigation(
	message: string,
	audience: AssistantRole,
	locale: string,
): AssistantNavigationEntry | null {
	const haystack = ` ${words(message).join(" ")} `;
	let best: { entry: AssistantNavigationEntry; score: number } | null = null;

	for (const entry of navigationEntries(audience, locale)) {
		let score = 0;
		for (const keyword of entry.keywords) {
			if (keyword.length < 3) continue;
			if (haystack.includes(` ${keyword} `) || haystack.includes(` ${keyword}`)) {
				score += keyword.length >= 6 ? 3 : 2;
			}
		}
		// A target-specific entry beats its section when both match.
		if (entry.target) score += 1;
		if (!best || score > best.score) best = { entry, score };
	}

	return best && best.score >= 2 ? best.entry : null;
}
