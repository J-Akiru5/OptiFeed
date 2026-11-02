import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Simple mode must be reversible (#626). Choosing it on a capable device used
 * to strand the operator: the 3D scene unmounted and nothing rendered a way
 * back. The forced fallbacks (no WebGL, or a crashed scene) must stay silent,
 * because there is nothing to return to.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

// jsdom cannot mount three.js. The stub renders the one control that matters
// here: the viewer's own "Simple view" button.
vi.mock("@/components/feeder/feeder-viewer", () => ({
	FeederViewer: ({ onSimpleView }: { onSimpleView?: () => void }) => (
		<div data-testid="viewer-3d">
			<button type="button" onClick={onSimpleView}>
				Simple view
			</button>
		</div>
	),
}));

import { FeederViewerLazy } from "@/components/feeder/feeder-viewer-lazy";

class ImmediateIntersectionObserver {
	root = null;
	rootMargin = "";
	thresholds: number[] = [];
	private readonly callback: IntersectionObserverCallback;
	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}
	observe(target: Element) {
		this.callback(
			[{ isIntersecting: true, target } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const WEBGL2_STUB = {
	getExtension: () => null,
	getParameter: () => "",
} as unknown as WebGL2RenderingContext;

function renderViewer() {
	return render(
		<FeederViewerLazy
			deviceId="dev-1"
			label="CICT Feeder"
			initialStatus="idle"
			initialLevel={40}
			initialLastFedAt={null}
			initialWaterTempOk={true}
			initialRtcOk={true}
		/>,
	);
}

beforeEach(() => {
	vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => "visible",
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: false }) as unknown as Response),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("simple mode (#626)", () => {
	it("returns to the 3D scene from the simple view", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(WEBGL2_STUB);

		renderViewer();

		fireEvent.click(await screen.findByRole("button", { name: "Simple view" }));
		expect(screen.getByTestId("feeder-viewer-fallback")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Back to 3D view" }));
		expect(await screen.findByTestId("viewer-3d")).toBeInTheDocument();
	});

	it("does not offer the way back when the device cannot render 3D", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

		renderViewer();

		expect(await screen.findByTestId("feeder-viewer-fallback")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Back to 3D view" })).toBeNull();
	});
});
