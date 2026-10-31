import { __resetAuthCacheForTests } from "@/lib/auth/session-cache";
import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

// Provider base URLs are resolved before they are saved or called. A test must
// never depend on the network, so every name resolves to a documentation-range
// public address unless a test sets its own answer on this mock.
vi.mock("node:dns/promises", () => {
	const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
	return { lookup, default: { lookup } };
});

beforeEach(() => {
	// Module-level caches must not leak identities between tests.
	__resetAuthCacheForTests();
});
