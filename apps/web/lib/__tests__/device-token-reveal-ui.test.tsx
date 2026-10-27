import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/admin", () => ({ revealDeviceToken: vi.fn() }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => {
		const strings: Record<string, string> = {
			showToken: "Show token",
			hideToken: "Hide token",
			loading: "Loading.",
			copy: "Copy",
			copied: "Copied",
			copyFailed: "Copy failed",
			tokenColumn: "Device token",
			tokenWarning: "Device credential",
			tokenError: "Could not load the token. Try again.",
			tokenRateLimited: "Too many token reveals. Wait an hour, then try again.",
		};
		return strings[key] ?? key;
	},
}));

import { DeviceTokenReveal } from "@/components/admin/device-token-reveal";
import { revealDeviceToken } from "@/lib/actions/admin";

const mockReveal = vi.mocked(revealDeviceToken);

beforeEach(() => {
	mockReveal.mockReset();
});

describe("DeviceTokenReveal error messages", () => {
	it("shows the translated rate-limit message, not the raw server text", async () => {
		mockReveal.mockResolvedValue({
			success: false,
			error: "Too many token reveals. Try again in an hour.",
			code: "rate_limited",
		});

		render(<DeviceTokenReveal deviceId="dev-a1" deviceLabel="Feeder 1" />);
		fireEvent.click(screen.getByRole("button", { name: /Show token/ }));

		expect(
			await screen.findByText("Too many token reveals. Wait an hour, then try again."),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Too many token reveals. Try again in an hour."),
		).not.toBeInTheDocument();
	});

	it("still shows the server error for other failures", async () => {
		mockReveal.mockResolvedValue({
			success: false,
			error: "Device not found in your organization.",
		});

		render(<DeviceTokenReveal deviceId="dev-a1" deviceLabel="Feeder 1" />);
		fireEvent.click(screen.getByRole("button", { name: /Show token/ }));

		expect(await screen.findByText("Device not found in your organization.")).toBeInTheDocument();
	});

	it("shows the token on a successful reveal", async () => {
		mockReveal.mockResolvedValue({
			success: true,
			token: "tok_visible_once",
			mac: "A4:CF:12:7E:3B:09",
			label: "Feeder 1",
		});

		render(<DeviceTokenReveal deviceId="dev-a1" deviceLabel="Feeder 1" />);
		fireEvent.click(screen.getByRole("button", { name: /Show token/ }));

		expect(await screen.findByText("tok_visible_once")).toBeInTheDocument();
	});
});
