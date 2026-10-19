import { describe, expect, it } from "vitest";
import config from "../../next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function globalHeaders(): Promise<{ key: string; value: string }[]> {
	const rules = (await config.headers?.()) as HeaderRule[] | undefined;
	return rules?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
}

function headerValue(headers: { key: string; value: string }[], key: string): string | undefined {
	return headers.find((header) => header.key === key)?.value;
}

describe("security headers (F-013)", () => {
	it("disables the legacy XSS auditor", async () => {
		expect(headerValue(await globalHeaders(), "X-XSS-Protection")).toBe("0");
	});

	it("does not advertise the Next.js version", () => {
		expect(config.poweredByHeader).toBe(false);
	});
});

describe("CSP (F-025)", () => {
	it("pins form submissions and <base> to the origin in the enforced policy", async () => {
		const csp = headerValue(await globalHeaders(), "Content-Security-Policy");
		expect(csp).toContain("form-action 'self'");
		expect(csp).toContain("base-uri 'self'");
	});

	it("ships a stricter Report-Only policy without 'unsafe-inline' scripts", async () => {
		const reportOnly = headerValue(await globalHeaders(), "Content-Security-Policy-Report-Only");
		expect(reportOnly).toBeTruthy();
		expect(reportOnly).toContain("script-src 'self'");
		expect(reportOnly).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(reportOnly).toContain("form-action 'self'");
		expect(reportOnly).toContain("base-uri 'self'");
	});
});
