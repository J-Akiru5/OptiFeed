import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Self-service TOTP management (#719).
 *
 * Supabase Auth is mocked: these tests pin the *order* of operations that
 * matters for safety — a code is verified before a verified factor is removed,
 * and an unverified factor can be discarded without one — plus the reporting
 * timestamp the console's security band reads.
 */

const mocks = vi.hoisted(() => ({
	createClient: vi.fn(),
	updateMany: vi.fn(),
	reportError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/prisma", () => ({
	default: { platformAdmin: { updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/observability", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "user-1", supabaseId: "sb-1" })),
}));

import {
	beginTotpEnrollment,
	cancelTotpEnrollment,
	confirmTotpEnrollment,
	unenrollTotpFactor,
} from "@/lib/actions/mfa";

const FACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_FACTOR_ID = "223e4567-e89b-12d3-a456-426614174000";

function factor(overrides: Record<string, unknown> = {}) {
	return {
		id: FACTOR_ID,
		factor_type: "totp",
		status: "verified",
		created_at: "2026-11-04T00:00:00.000Z",
		updated_at: "2026-11-04T00:00:00.000Z",
		...overrides,
	};
}

function client(
	overrides: {
		list?: unknown;
		enroll?: unknown;
		verify?: unknown;
		unenroll?: unknown;
	} = {},
) {
	const mfa = {
		listFactors: vi.fn(async () => overrides.list ?? { data: { all: [] }, error: null }),
		enroll: vi.fn(async () => overrides.enroll),
		challengeAndVerify: vi.fn(async () => overrides.verify ?? { data: null, error: null }),
		unenroll: vi.fn(async () => overrides.unenroll ?? { data: {}, error: null }),
	};
	mocks.createClient.mockResolvedValue({ auth: { mfa } });
	return mfa;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("beginTotpEnrollment", () => {
	it("discards an abandoned pending factor before creating a new one", async () => {
		const mfa = client({
			list: { data: { all: [factor({ status: "unverified" })] }, error: null },
			enroll: {
				data: {
					id: FACTOR_ID,
					type: "totp",
					totp: { secret: "JBSWY3DPEHPK3PXP", qr_code: "<svg/>", uri: "otpauth://totp/x" },
				},
				error: null,
			},
		});

		const result = await beginTotpEnrollment();

		expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: FACTOR_ID });
		expect(mfa.enroll).toHaveBeenCalledWith({
			factorType: "totp",
			friendlyName: "OptiFeed authenticator",
			issuer: "OptiFeed",
		});
		expect(result).toEqual({
			enrollment: {
				factorId: FACTOR_ID,
				secret: "JBSWY3DPEHPK3PXP",
				qrCodeDataUrl: `data:image/svg+xml;utf-8,${encodeURIComponent("<svg/>")}`,
			},
		});
	});

	it("keeps an existing data: URL QR code untouched", async () => {
		client({
			enroll: {
				data: {
					id: FACTOR_ID,
					type: "totp",
					totp: {
						secret: "SECRET",
						qr_code: "data:image/svg+xml;utf-8,%3Csvg%2F%3E",
						uri: "otpauth://totp/x",
					},
				},
				error: null,
			},
		});

		const result = await beginTotpEnrollment();
		expect("enrollment" in result && result.enrollment.qrCodeDataUrl.startsWith("data:")).toBe(
			true,
		);
	});

	it("gives a second factor its own friendly name", async () => {
		const mfa = client({
			list: { data: { all: [factor({ friendly_name: "OptiFeed authenticator" })] }, error: null },
			enroll: {
				data: {
					id: OTHER_FACTOR_ID,
					type: "totp",
					totp: { secret: "SECRET", qr_code: "<svg/>", uri: "otpauth://totp/x" },
				},
				error: null,
			},
		});

		await beginTotpEnrollment();

		expect(mfa.enroll).toHaveBeenCalledWith(
			expect.objectContaining({ friendlyName: "OptiFeed authenticator 2" }),
		);
	});

	it("returns a service error when Supabase refuses the enrolment", async () => {
		client({ enroll: { data: null, error: new Error("too many factors") } });
		expect(await beginTotpEnrollment()).toEqual({ error: "service" });
	});
});

describe("confirmTotpEnrollment", () => {
	it("verifies the code and records the enrolment timestamp", async () => {
		const mfa = client({
			list: { data: { all: [factor({ status: "unverified" })] }, error: null },
		});

		const result = await confirmTotpEnrollment(FACTOR_ID, "123 456");

		expect(result).toEqual({ success: true });
		expect(mfa.challengeAndVerify).toHaveBeenCalledWith({
			factorId: FACTOR_ID,
			code: "123456",
		});
		expect(mocks.updateMany).toHaveBeenCalledWith({
			where: { userId: "user-1" },
			data: { mfaEnrolledAt: expect.any(Date) },
		});
	});

	it("rejects a malformed code before calling Supabase", async () => {
		const mfa = client();
		expect(await confirmTotpEnrollment(FACTOR_ID, "12")).toEqual({ error: "invalid" });
		expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
	});

	it("rejects a factor that does not belong to the caller", async () => {
		const mfa = client({
			list: { data: { all: [factor({ id: OTHER_FACTOR_ID, status: "unverified" })] }, error: null },
		});
		expect(await confirmTotpEnrollment(FACTOR_ID, "123456")).toEqual({ error: "not_found" });
		expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
	});

	it("does not record enrolment when the code is wrong", async () => {
		client({
			list: { data: { all: [factor({ status: "unverified" })] }, error: null },
			verify: { data: null, error: new Error("invalid code") },
		});
		expect(await confirmTotpEnrollment(FACTOR_ID, "123456")).toEqual({ error: "invalid" });
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});
});

describe("unenrollTotpFactor", () => {
	it("verifies a fresh code before removing the factor", async () => {
		const mfa = client({
			list: { data: { all: [factor()] }, error: null },
		});
		mfa.listFactors
			.mockResolvedValueOnce({ data: { all: [factor()] }, error: null })
			.mockResolvedValueOnce({ data: { all: [] }, error: null });

		const result = await unenrollTotpFactor(FACTOR_ID, "654321");

		expect(result).toEqual({ success: true });
		const verifyOrder = mfa.challengeAndVerify.mock.invocationCallOrder[0];
		const unenrollOrder = mfa.unenroll.mock.invocationCallOrder[0];
		expect(verifyOrder).toBeLessThan(unenrollOrder);
		expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: FACTOR_ID });
		// The last verified factor is gone, so the reporting flag clears.
		expect(mocks.updateMany).toHaveBeenCalledWith({
			where: { userId: "user-1" },
			data: { mfaEnrolledAt: null },
		});
	});

	it("keeps the flag when another verified factor remains", async () => {
		const mfa = client();
		mfa.listFactors
			.mockResolvedValueOnce({ data: { all: [factor()] }, error: null })
			.mockResolvedValueOnce({
				data: { all: [factor({ id: OTHER_FACTOR_ID })] },
				error: null,
			});

		expect(await unenrollTotpFactor(FACTOR_ID, "654321")).toEqual({ success: true });
		// The remaining factor keeps the original enrolment timestamp; removing a
		// second app is not a new enrolment.
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("never removes the factor when the fresh code fails", async () => {
		const mfa = client({
			list: { data: { all: [factor()] }, error: null },
			verify: { data: null, error: new Error("invalid code") },
		});

		expect(await unenrollTotpFactor(FACTOR_ID, "000000")).toEqual({ error: "invalid" });
		expect(mfa.unenroll).not.toHaveBeenCalled();
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("refuses to treat an unverified factor as a removable second factor", async () => {
		const mfa = client({
			list: { data: { all: [factor({ status: "unverified" })] }, error: null },
		});
		expect(await unenrollTotpFactor(FACTOR_ID, "654321")).toEqual({ error: "invalid" });
		expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
		expect(mfa.unenroll).not.toHaveBeenCalled();
	});
});

describe("cancelTotpEnrollment", () => {
	it("discards a pending factor without a code", async () => {
		const mfa = client({
			list: { data: { all: [factor({ status: "unverified" })] }, error: null },
		});
		expect(await cancelTotpEnrollment(FACTOR_ID)).toEqual({ success: true });
		expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: FACTOR_ID });
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("refuses to remove a verified factor this way", async () => {
		const mfa = client({ list: { data: { all: [factor()] }, error: null } });
		expect(await cancelTotpEnrollment(FACTOR_ID)).toEqual({ error: "invalid" });
		expect(mfa.unenroll).not.toHaveBeenCalled();
	});
});
