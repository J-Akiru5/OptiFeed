import axe, { type AxeResults, type Result } from "axe-core";

/**
 * axe-core harness for the ISO 25010 usability gate (W9).
 *
 * The binding criterion is **zero serious/critical violations** on the key
 * surfaces. This helper runs the full default axe rule set — no rule is
 * disabled and no page is skipped — and fails on `serious` or `critical`
 * impacts only, because `moderate`/`minor` are advisory in the exit criterion.
 * Every violation at every impact is still listed in the failure message, so a
 * moderate regression is visible even when it does not block the gate.
 *
 * Two limits are honest rather than hidden:
 *
 * - **Colour contrast cannot be measured here.** jsdom has no layout engine or
 *   paint, so axe returns `color-contrast` as *incomplete* instead of pass or
 *   fail. It is not disabled: the rule still runs, and the surfaces that carry
 *   custom palettes are covered by explicit ratio assertions
 *   (`chat-theme-contrast.test.tsx`) and by the Lighthouse CI budgets owned by
 *   I-66. Do not read a green axe run as a contrast verdict.
 * - **Server pages are analysed as static markup.** `renderToStaticMarkup()`
 *   output is mounted into a real jsdom document so axe sees the same DOM a
 *   browser would parse, but effects and event handlers do not run. That is
 *   sufficient for structural rules (names, roles, labels, ids, landmarks);
 *   interaction and focus order are covered by `keyboard-navigation.test.tsx`.
 */

export type AxeViolation = Result;

/**
 * axe-core's published types describe the context argument as a selector string
 * or a `{ include, exclude }` object, but the runtime also accepts a DOM node.
 * The cast is confined to this one boundary so the result type is real.
 */
type RunAxe = (context: Element | Document) => Promise<AxeResults>;

const runAxe = axe.run as unknown as RunAxe;

/** The two impacts the usability exit criterion blocks on. */
function blocksTheGate(impact: AxeViolation["impact"]): boolean {
	return impact === "serious" || impact === "critical";
}

function targetsOf(violation: AxeViolation): string[] {
	return violation.nodes.map((node) => node.target.join(" "));
}

/** Human-readable dump used in failure messages; keeps every impact. */
export function formatViolations(violations: AxeViolation[]): string {
	if (violations.length === 0) return "none";
	return violations
		.map((violation) => {
			const nodes = targetsOf(violation)
				.map((target) => `      - ${target}`)
				.join("\n");
			return `  ${violation.id} [${violation.impact ?? "unknown"}] ${violation.help} (${violation.helpUrl})\n${nodes}`;
		})
		.join("\n");
}

function describeContext(target: Element | Document): string {
	if (!("tagName" in target)) return "the document";
	const tag = target.tagName.toLowerCase();
	const name = target.getAttribute("aria-label") ?? target.getAttribute("data-testid");
	return name ? `<${tag} ${name}>` : `<${tag}>`;
}

/**
 * Run axe over `target` and fail if anything serious or critical is reported.
 * Returns the full result set so a test can make additional assertions.
 */
export async function expectNoSeriousOrCriticalViolations(
	target: Element | Document = document.body,
): Promise<AxeResults> {
	const results = await runAxe(target);
	const blocking = results.violations.filter((violation) => blocksTheGate(violation.impact));

	if (blocking.length > 0) {
		throw new Error(
			`axe found ${blocking.length} serious/critical violation(s) in ${describeContext(target)}:\n` +
				`${formatViolations(blocking)}\n\nAll reported violations (any impact):\n` +
				`${formatViolations(results.violations)}`,
		);
	}

	return results;
}
