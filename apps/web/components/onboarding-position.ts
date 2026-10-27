export type TourRect = {
	top: number;
	left: number;
	width: number;
	height: number;
};

export type TourSize = {
	width: number;
	height: number;
};

export type TourSide = "top" | "right" | "bottom" | "left";
export type TourAlign = "start" | "center" | "end";
export type TourPlacement = TourSide | "center";

export type TourPopoverPosition = {
	left: number;
	top: number;
	placement: TourPlacement;
	/** Distance along the popover edge where the arrow should sit. */
	arrowOffset: number;
};

export type TourPositionInput = {
	target: TourRect | null;
	popover: TourSize;
	viewport: TourSize;
	preferredSide?: TourSide;
	align?: TourAlign;
	gap?: number;
	margin?: number;
	avoid?: TourRect[];
};

const SIDE_ORDER: Record<TourSide, TourSide[]> = {
	bottom: ["bottom", "top", "right", "left"],
	top: ["top", "bottom", "left", "right"],
	left: ["left", "right", "top", "bottom"],
	right: ["right", "left", "bottom", "top"],
};

const ARROW_INSET = 16;

export function clamp(value: number, min: number, max: number): number {
	if (max < min) return min;
	return Math.min(Math.max(value, min), max);
}

function alignOffset(
	targetStart: number,
	targetSize: number,
	popoverSize: number,
	align: TourAlign,
): number {
	if (align === "start") return targetStart;
	if (align === "end") return targetStart + targetSize - popoverSize;
	return targetStart + (targetSize - popoverSize) / 2;
}

function overlaps(a: TourRect, b: TourRect, gap: number): boolean {
	return (
		a.left < b.left + b.width + gap &&
		a.left + a.width > b.left - gap &&
		a.top < b.top + b.height + gap &&
		a.top + a.height > b.top - gap
	);
}

function centeredRect(viewport: TourSize, popover: TourSize): TourRect {
	return {
		left: (viewport.width - popover.width) / 2,
		top: (viewport.height - popover.height) / 2,
		width: popover.width,
		height: popover.height,
	};
}

function fitsBeside(
	target: TourRect,
	side: TourSide,
	popover: TourSize,
	viewport: TourSize,
	gap: number,
	margin: number,
): boolean {
	switch (side) {
		case "top":
			return target.top - gap - popover.height >= margin;
		case "bottom":
			return target.top + target.height + gap + popover.height <= viewport.height - margin;
		case "left":
			return target.left - gap - popover.width >= margin;
		case "right":
			return target.left + target.width + gap + popover.width <= viewport.width - margin;
	}
}

function placeBeside(
	target: TourRect,
	side: TourSide,
	popover: TourSize,
	viewport: TourSize,
	align: TourAlign,
	gap: number,
	margin: number,
): TourRect {
	const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
	const maxTop = Math.max(margin, viewport.height - popover.height - margin);

	switch (side) {
		case "top":
			return {
				left: clamp(alignOffset(target.left, target.width, popover.width, align), margin, maxLeft),
				top: target.top - gap - popover.height,
				width: popover.width,
				height: popover.height,
			};
		case "bottom":
			return {
				left: clamp(alignOffset(target.left, target.width, popover.width, align), margin, maxLeft),
				top: target.top + target.height + gap,
				width: popover.width,
				height: popover.height,
			};
		case "left":
			return {
				left: target.left - gap - popover.width,
				top: clamp(alignOffset(target.top, target.height, popover.height, align), margin, maxTop),
				width: popover.width,
				height: popover.height,
			};
		case "right":
			return {
				left: target.left + target.width + gap,
				top: clamp(alignOffset(target.top, target.height, popover.height, align), margin, maxTop),
				width: popover.width,
				height: popover.height,
			};
	}
}

function clampToViewport(rect: TourRect, viewport: TourSize, margin: number): TourRect {
	const maxLeft = Math.max(margin, viewport.width - rect.width - margin);
	const maxTop = Math.max(margin, viewport.height - rect.height - margin);
	return {
		...rect,
		left: clamp(rect.left, margin, maxLeft),
		top: clamp(rect.top, margin, maxTop),
	};
}

/**
 * Keeps a centred popover clear of floating UI (the help/chat FAB cluster).
 * It prefers the smallest move: up first, then left, then gives up and leaves
 * the card centred so it is still readable.
 */
function avoidZones(rect: TourRect, avoid: TourRect[], margin: number): TourRect {
	let next = rect;
	for (const zone of avoid) {
		if (!overlaps(next, zone, margin)) continue;

		const above = zone.top - margin - next.height;
		if (above >= margin) {
			next = { ...next, top: above };
			continue;
		}

		const leftOf = zone.left - margin - next.width;
		if (leftOf >= margin) {
			next = { ...next, left: leftOf };
		}
	}
	return next;
}

function arrowOffsetFor(target: TourRect | null, rect: TourRect, placement: TourPlacement): number {
	if (!target || placement === "center") return 0;

	if (placement === "top" || placement === "bottom") {
		const centred = target.left + target.width / 2 - rect.left;
		return clamp(centred, ARROW_INSET, Math.max(ARROW_INSET, rect.width - ARROW_INSET));
	}

	const centred = target.top + target.height / 2 - rect.top;
	return clamp(centred, ARROW_INSET, Math.max(ARROW_INSET, rect.height - ARROW_INSET));
}

/**
 * Places the onboarding popover inside the viewport.
 *
 * - No target (the welcome step) is centred on both axes.
 * - An anchored step sits beside its target on the first side that fits.
 * - When no side fits, the popover is centred instead of being pinned to the
 *   bottom edge, and it is nudged clear of the FAB cluster.
 */
export function computeTourPopoverPosition({
	target,
	popover,
	viewport,
	preferredSide = "bottom",
	align = "center",
	gap = 12,
	margin = 12,
	avoid = [],
}: TourPositionInput): TourPopoverPosition {
	if (!target || target.width <= 0 || target.height <= 0) {
		const centred = avoidZones(centeredRect(viewport, popover), avoid, margin);
		const rect = clampToViewport(centred, viewport, 0);
		return { left: rect.left, top: rect.top, placement: "center", arrowOffset: 0 };
	}

	for (const side of SIDE_ORDER[preferredSide]) {
		if (!fitsBeside(target, side, popover, viewport, gap, margin)) continue;

		const rect = placeBeside(target, side, popover, viewport, align, gap, margin);
		if (avoid.some((zone) => overlaps(rect, zone, margin))) continue;

		return {
			left: rect.left,
			top: rect.top,
			placement: side,
			arrowOffset: arrowOffsetFor(target, rect, side),
		};
	}

	const centred = avoidZones(centeredRect(viewport, popover), avoid, margin);
	const rect = clampToViewport(centred, viewport, 0);
	return { left: rect.left, top: rect.top, placement: "center", arrowOffset: 0 };
}
