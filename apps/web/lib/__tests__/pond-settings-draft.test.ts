import {
	clearPondDraft,
	pondDraftKey,
	pondDraftValuesEqual,
	readPondDraft,
	writePondDraft,
} from "@/lib/settings/pond-draft";
import { describe, expect, it } from "vitest";

/**
 * The draft that keeps typed values across a trip to another settings page
 * (#371). Storage is best-effort: a broken value or a storage that throws must
 * never break the form, so both sides are tested.
 */

class MemoryStorage implements Storage {
	private readonly items = new Map<string, string>();
	get length() {
		return this.items.size;
	}
	clear() {
		this.items.clear();
	}
	getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	key(index: number) {
		return [...this.items.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.items.delete(key);
	}
	setItem(key: string, value: string) {
		this.items.set(key, value);
	}
}

const VALUES = {
	feedingRate: "2.5",
	feedsPerDay: "3",
	sampleInterval: "15",
	population: "525",
	areaM2: "150",
	averageDepthM: "1.5",
	feedPricePerKg: "36",
};

describe("pond settings draft", () => {
	it("round-trips the typed values", () => {
		const storage = new MemoryStorage();
		writePondDraft(storage, "pond-1", VALUES);

		expect(readPondDraft(storage, "pond-1")).toEqual(VALUES);
		expect(pondDraftKey("pond-1")).toBe("optifeed:pond-settings-draft:pond-1");
	});

	it("keeps each pond's draft separate", () => {
		const storage = new MemoryStorage();
		writePondDraft(storage, "pond-1", VALUES);
		writePondDraft(storage, "pond-2", { ...VALUES, population: "10" });

		expect(readPondDraft(storage, "pond-1")?.population).toBe("525");
		expect(readPondDraft(storage, "pond-2")?.population).toBe("10");
	});

	it("returns null for an unknown pond or no storage", () => {
		expect(readPondDraft(new MemoryStorage(), "missing")).toBeNull();
		expect(readPondDraft(undefined, "pond-1")).toBeNull();
	});

	it("ignores a corrupted or stale draft instead of throwing", () => {
		const storage = new MemoryStorage();
		storage.setItem(pondDraftKey("pond-1"), "{not json");
		expect(readPondDraft(storage, "pond-1")).toBeNull();

		storage.setItem(pondDraftKey("pond-1"), JSON.stringify({ version: 99, values: VALUES }));
		expect(readPondDraft(storage, "pond-1")).toBeNull();

		storage.setItem(
			pondDraftKey("pond-1"),
			JSON.stringify({ version: 1, values: { feedingRate: "1" } }),
		);
		expect(readPondDraft(storage, "pond-1")).toBeNull();
	});

	it("clears the draft after a successful save", () => {
		const storage = new MemoryStorage();
		writePondDraft(storage, "pond-1", VALUES);
		clearPondDraft(storage, "pond-1");

		expect(readPondDraft(storage, "pond-1")).toBeNull();
	});

	it("swallows a storage that throws (private mode, full quota)", () => {
		const broken: Storage = {
			length: 0,
			clear: () => undefined,
			getItem: () => {
				throw new Error("denied");
			},
			key: () => null,
			removeItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("quota");
			},
		};

		expect(() => writePondDraft(broken, "pond-1", VALUES)).not.toThrow();
		expect(readPondDraft(broken, "pond-1")).toBeNull();
		expect(() => clearPondDraft(broken, "pond-1")).not.toThrow();
	});
});

describe("pond draft comparison", () => {
	it("treats identical typed values as equal", () => {
		expect(pondDraftValuesEqual(VALUES, { ...VALUES })).toBe(true);
	});

	it("detects a difference in any field, including a cleared one", () => {
		expect(pondDraftValuesEqual(VALUES, { ...VALUES, feedsPerDay: "4" })).toBe(false);
		expect(pondDraftValuesEqual(VALUES, { ...VALUES, population: "" })).toBe(false);
		expect(pondDraftValuesEqual({ ...VALUES, population: "" }, VALUES)).toBe(false);
	});
});
