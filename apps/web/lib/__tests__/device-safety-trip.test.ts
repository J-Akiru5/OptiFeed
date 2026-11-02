import { describe, expect, it } from "vitest";

import {
	SAFETY_TRIP_EVENT,
	isSameSafetyTrip,
	safetyTripFromMetadata,
	safetyTripMetadata,
} from "@/lib/device-safety-trip";

/**
 * The safety-trip model (#455). The metadata is what ingest writes and what the
 * dedupe reads back, so a round-trip that loses or invents a field would either
 * store a lie or write the incident twice.
 */

const FULL_REPORT = {
	tripId: "trip-8f21",
	abnormalResets: 3,
	resetReasons: "brownout,panic",
	resetReason: "brownout",
	entry: "boot" as const,
	quietS: 0,
	uptimeS: 12,
	version: "1.8.1",
};

describe("safety trip metadata", () => {
	it("round-trips every field through a stored row", () => {
		expect(safetyTripFromMetadata(safetyTripMetadata(FULL_REPORT))).toEqual(FULL_REPORT);
	});

	it("names the row with a trip-scoped event id", () => {
		expect(safetyTripMetadata(FULL_REPORT)).toMatchObject({
			tripId: "trip-8f21",
			eventId: "trip-trip-8f21",
		});
	});

	it("omits absent optional fields instead of storing nulls", () => {
		const minimal = {
			tripId: "trip-a1",
			abnormalResets: null,
			resetReasons: null,
			resetReason: null,
			entry: null,
			quietS: null,
			uptimeS: null,
			version: null,
		};

		expect(safetyTripMetadata(minimal)).toEqual({ tripId: "trip-a1", eventId: "trip-trip-a1" });
		expect(safetyTripFromMetadata(safetyTripMetadata(minimal))).toEqual(minimal);
	});

	it("reads a row with absent optional fields back as empty, not broken", () => {
		expect(safetyTripFromMetadata({ tripId: "trip-b2" })).toEqual({
			tripId: "trip-b2",
			abnormalResets: null,
			resetReasons: null,
			resetReason: null,
			entry: null,
			quietS: null,
			uptimeS: null,
			version: null,
		});
	});

	it("rejects a row that cannot identify the trip", () => {
		expect(safetyTripFromMetadata(null)).toBeNull();
		expect(safetyTripFromMetadata(undefined)).toBeNull();
		expect(safetyTripFromMetadata({})).toBeNull();
		expect(safetyTripFromMetadata({ tripId: "   " })).toBeNull();
		expect(safetyTripFromMetadata("not-an-object")).toBeNull();
	});

	it("drops values the contract does not allow", () => {
		expect(
			safetyTripFromMetadata({
				tripId: "trip-c3",
				abnormalResets: 300,
				entry: "manual",
				quietS: -1,
				uptimeS: 1.5,
			}),
		).toEqual({
			tripId: "trip-c3",
			abnormalResets: null,
			resetReasons: null,
			resetReason: null,
			entry: null,
			quietS: null,
			uptimeS: null,
			version: null,
		});
	});
});

describe("isSameSafetyTrip", () => {
	it("matches the stored trip to a re-sent report", () => {
		expect(isSameSafetyTrip(safetyTripFromMetadata({ tripId: "trip-8f21" }), "trip-8f21")).toBe(
			true,
		);
	});

	it("treats a different trip id as a new incident", () => {
		expect(isSameSafetyTrip(safetyTripFromMetadata({ tripId: "trip-8f21" }), "trip-9a34")).toBe(
			false,
		);
	});

	it("writes the first trip when nothing is stored", () => {
		expect(isSameSafetyTrip(null, "trip-8f21")).toBe(false);
	});

	it("does not treat an unreadable row as the same trip", () => {
		expect(isSameSafetyTrip(safetyTripFromMetadata({ tripId: "" }), "")).toBe(false);
	});

	it("keeps the ingest event type stable", () => {
		expect(SAFETY_TRIP_EVENT).toBe("safety_trip");
	});
});
