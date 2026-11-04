import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
	upsert: vi.fn(),
	update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		errorEvent: {
			upsert: prismaMocks.upsert,
			update: prismaMocks.update,
		},
	},
}));

import { reportError } from "@/lib/observability";
import {
	ALERT_WEBHOOK_ENV,
	type AlertInput,
	type AlertPayload,
	DEFAULT_ALERT_COOLDOWN_MS,
	DEFAULT_RUNBOOK_URL,
	buildAlertPayload,
	resetAlertStateForTests,
	sendAlert,
	shouldPage,
	storageSeverity,
} from "@/lib/observability/alert";

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const WEBHOOK = "https://hooks.example.invalid/services/T000/B000/very-secret-path";

const ENV_KEYS = [
	ALERT_WEBHOOK_ENV,
	"ALERT_COOLDOWN_MS",
	"ALERT_TIMEOUT_MS",
	"ALERT_RUNBOOK_URL",
	"VERCEL_ENV",
] as const;

const originalEnv = new Map<string, string | undefined>();
const fetchMock = vi.fn();

function alertInput(overrides: Partial<AlertInput> = {}): AlertInput {
	return {
		severity: "CRITICAL",
		fingerprint: "fp-crop-watch",
		route: "cron/crop-watch",
		message: "crop reminders failed",
		now: NOW,
		...overrides,
	};
}

function sentPayload(index = 0): AlertPayload {
	const init = fetchMock.mock.calls[index][1] as RequestInit;
	return JSON.parse(String(init.body)) as AlertPayload;
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
	return spy.mock.calls
		.flat()
		.map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
		.join(" ");
}

beforeEach(() => {
	for (const key of ENV_KEYS) {
		originalEnv.set(key, process.env[key]);
		delete process.env[key];
	}
	resetAlertStateForTests();
	prismaMocks.upsert.mockReset().mockResolvedValue({});
	prismaMocks.update.mockReset().mockResolvedValue({});
	fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	resetAlertStateForTests();
});

describe("sendAlert", () => {
	it("does not call fetch and logs at most once per process when ALERT_WEBHOOK_URL is unset", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(sendAlert(alertInput())).resolves.toBe("disabled");
		await expect(sendAlert(alertInput({ fingerprint: "fp-2" }))).resolves.toBe("disabled");

		expect(fetchMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain(ALERT_WEBHOOK_ENV);
	});

	it("posts the provider-neutral payload once", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		process.env.VERCEL_ENV = "production";

		await expect(sendAlert(alertInput())).resolves.toBe("sent");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(WEBHOOK);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
		expect(init.signal).toBeInstanceOf(AbortSignal);

		const payload = sentPayload();
		expect(payload.text).toBe(
			"[OptiFeed][CRITICAL][production] cron/crop-watch: crop reminders failed",
		);
		expect(payload.content).toBe(payload.text);
		expect(payload.alert).toMatchObject({
			version: 1,
			severity: "CRITICAL",
			fingerprint: "fp-crop-watch",
			route: "cron/crop-watch",
			message: "crop reminders failed",
			context: null,
			service: "optifeed-web",
			environment: "production",
			timestamp: new Date(NOW).toISOString(),
			runbook: DEFAULT_RUNBOOK_URL,
		});
	});

	it("suppresses a second page for the same fingerprint inside the cooldown", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;

		await expect(sendAlert(alertInput())).resolves.toBe("sent");
		await expect(sendAlert(alertInput({ now: NOW + 1_000 }))).resolves.toBe("duplicate");
		await expect(sendAlert(alertInput({ now: NOW + 2_000 }))).resolves.toBe("duplicate");

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("pages again once the cooldown has elapsed", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;

		await expect(sendAlert(alertInput())).resolves.toBe("sent");
		await expect(sendAlert(alertInput({ now: NOW + DEFAULT_ALERT_COOLDOWN_MS }))).resolves.toBe(
			"sent",
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not dedupe different fingerprints", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;

		await expect(sendAlert(alertInput())).resolves.toBe("sent");
		await expect(sendAlert(alertInput({ fingerprint: "fp-other" }))).resolves.toBe("sent");

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("falls back to the default cooldown when the env value is not a number", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		process.env.ALERT_COOLDOWN_MS = "not-a-number";

		await expect(sendAlert(alertInput())).resolves.toBe("sent");
		await expect(sendAlert(alertInput({ now: NOW + 60_000 }))).resolves.toBe("duplicate");

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("clamps a too-small cooldown up to the one-minute floor", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		process.env.ALERT_COOLDOWN_MS = "1";

		await expect(sendAlert(alertInput())).resolves.toBe("sent");
		await expect(sendAlert(alertInput({ now: NOW + 59_999 }))).resolves.toBe("duplicate");
		await expect(sendAlert(alertInput({ now: NOW + 60_000 }))).resolves.toBe("sent");
	});

	it("does not throw when the webhook times out", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		process.env.ALERT_TIMEOUT_MS = "500";
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		fetchMock.mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);

		const startedAt = Date.now();
		await expect(sendAlert(alertInput())).resolves.toBe("failed");
		const elapsed = Date.now() - startedAt;

		expect(elapsed).toBeGreaterThanOrEqual(400);
		expect(elapsed).toBeLessThan(3_000);
		expect(loggedText(errorLog)).toContain("delivery failed");
		expect(loggedText(errorLog)).not.toContain(WEBHOOK);
	});

	it("does not throw or leak the URL when fetch rejects immediately", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${WEBHOOK}`));

		await expect(sendAlert(alertInput())).resolves.toBe("failed");

		expect(loggedText(errorLog)).toContain("delivery failed");
		expect(loggedText(errorLog)).not.toContain(WEBHOOK);
	});

	it("logs only the status for a non-2xx response", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		fetchMock.mockResolvedValue(new Response("provider echo", { status: 503 }));

		await expect(sendAlert(alertInput())).resolves.toBe("failed");
		expect(loggedText(errorLog)).toContain("503");
		expect(loggedText(errorLog)).not.toContain(WEBHOOK);
	});

	it("scrubs secrets, e-mail addresses and connection-string credentials", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

		await expect(
			sendAlert(
				alertInput({
					message:
						"connect failed postgresql://optifeed:hunter2@db.example.com:5432/postgres for juan@example.com and password=hunter2",
					context: { deviceToken: token, note: `Authorization: Bearer ${token}` },
				}),
			),
		).resolves.toBe("sent");

		const serialised = JSON.stringify(sentPayload());
		expect(serialised).not.toContain("hunter2");
		expect(serialised).not.toContain("juan@example.com");
		expect(serialised).not.toContain(token);
		expect(serialised).toContain("[redacted");
	});

	it("skips a severity that is not page-worthy without needing a webhook", async () => {
		await expect(sendAlert(alertInput({ severity: "ERROR" }))).resolves.toBe("skipped");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("derives a stable fingerprint when the caller supplies an empty one", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;

		await expect(sendAlert(alertInput({ fingerprint: "" }))).resolves.toBe("sent");

		const payload = sentPayload();
		expect(payload.alert.fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(payload.alert.fingerprint).toBe(
			buildAlertPayload(alertInput({ fingerprint: "" })).alert.fingerprint,
		);
	});

	it("keeps the cooldown map bounded under a fingerprint flood", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;

		for (let index = 0; index <= 500; index++) {
			await expect(
				sendAlert(alertInput({ fingerprint: `fp-flood-${index}`, now: NOW + index })),
			).resolves.toBe("sent");
		}

		expect(fetchMock).toHaveBeenCalledTimes(501);
	});

	it("never throws when payload construction itself fails", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(sendAlert(alertInput({ now: Number.NaN }))).resolves.toBe("failed");

		expect(fetchMock).not.toHaveBeenCalled();
		expect(loggedText(errorLog)).toContain("sender failed");
		expect(loggedText(errorLog)).not.toContain(WEBHOOK);
	});
});

describe("buildAlertPayload", () => {
	it("keeps text and content identical and carries the structured contract", () => {
		process.env.VERCEL_ENV = "preview";
		process.env.ALERT_RUNBOOK_URL = "https://example.invalid/runbook";

		const payload = buildAlertPayload(
			alertInput({ context: { cron: "crop-watch", state: "hung" } }),
		);

		expect(payload.content).toBe(payload.text);
		expect(payload.text).toContain("[OptiFeed][CRITICAL][preview]");
		expect(payload.alert.context).toEqual({ cron: "crop-watch", state: "hung" });
		expect(payload.alert.runbook).toBe("https://example.invalid/runbook");
	});

	it("truncates a pathological message", () => {
		const payload = buildAlertPayload(
			alertInput({ message: "x".repeat(5_000), fingerprint: "fp-long" }),
		);

		expect(payload.alert.message.length).toBeLessThanOrEqual(1_000);
		expect(payload.text.length).toBeLessThan(1_100);
	});
});

describe("severity mapping (#729)", () => {
	it("pages only CRITICAL and stores CRITICAL as ERROR without a migration", () => {
		expect(shouldPage("CRITICAL")).toBe(true);
		expect(shouldPage("ERROR")).toBe(false);
		expect(shouldPage("WARNING")).toBe(false);
		expect(shouldPage(undefined)).toBe(false);

		expect(storageSeverity("CRITICAL")).toBe("ERROR");
		expect(storageSeverity("WARNING")).toBe("WARNING");
		expect(storageSeverity(undefined)).toBe("ERROR");
	});

	it("forwards a CRITICAL report to the webhook and persists it as ERROR", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		vi.spyOn(console, "error").mockImplementation(() => {});

		reportError(new Error("crop reminders failed"), { route: "cron/crop-watch" }, "CRITICAL");

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(prismaMocks.upsert).toHaveBeenCalledTimes(1);
		expect(prismaMocks.upsert.mock.calls[0][0].create.severity).toBe("ERROR");
		expect(sentPayload().alert.severity).toBe("CRITICAL");
	});

	it("does not page for a default ERROR report", async () => {
		process.env[ALERT_WEBHOOK_ENV] = WEBHOOK;
		vi.spyOn(console, "error").mockImplementation(() => {});

		reportError(new Error("ingest transaction failed"), { route: "ingest" });

		await vi.waitFor(() => expect(prismaMocks.upsert).toHaveBeenCalledTimes(1));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
