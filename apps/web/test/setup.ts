import { __resetAuthCacheForTests } from "@/lib/auth/session-cache";
import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

beforeEach(() => {
	// Module-level caches must not leak identities between tests.
	__resetAuthCacheForTests();
});
