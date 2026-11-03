import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportIssueDialog, type ReportIssueLabels } from "@/components/public/report-issue-dialog";

const labels: ReportIssueLabels = {
	trigger: "Report an issue",
	title: "Report an issue",
	description: "Tell the team what went wrong. Reports go to the administrator.",
	close: "Close",
	category: "Category",
	categories: {
		bug: "Something is broken",
		accessibility: "Accessibility problem",
		content: "Wrong or missing content",
		other: "Something else",
	},
	message: "What happened?",
	messageHint: "At least 10 characters.",
	email: "Email",
	emailHint: "Only if you would like a reply.",
	optional: "optional",
	submit: "Send report",
	sending: "Sending…",
	retry: "Try again",
	success: "Thank you — your report was sent.",
	error: "The report could not be sent. Please try again.",
	rateLimited: "Too many reports from this connection. Please try again later.",
};

async function openDialog() {
	const user = userEvent.setup();
	render(<ReportIssueDialog labels={labels} />);
	const trigger = screen.getByRole("button", { name: labels.trigger });
	await user.click(trigger);
	return { user, trigger };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.documentElement.lang = "";
});

describe("ReportIssueDialog", () => {
	it("renders the footer trigger and all four category options", async () => {
		const user = userEvent.setup();
		render(<ReportIssueDialog labels={labels} />);

		const trigger = screen.getByRole("button", { name: labels.trigger });
		expect(trigger).toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		await user.click(trigger);

		expect(screen.getByRole("dialog", { name: labels.title })).toBeInTheDocument();
		const options = screen.getAllByRole("option");
		expect(options).toHaveLength(4);
		expect(options.map((option) => option.textContent)).toEqual([
			labels.categories.bug,
			labels.categories.accessibility,
			labels.categories.content,
			labels.categories.other,
		]);
	});

	it("moves focus into the dialog, closes on Escape and restores the trigger focus", async () => {
		const { user, trigger } = await openDialog();

		await waitFor(() => expect(screen.getByLabelText(labels.category)).toHaveFocus());

		await user.keyboard("{Escape}");

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it("posts the payload and shows the success label", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ status: 201 });
		vi.stubGlobal("fetch", fetchMock);
		document.documentElement.lang = "en";

		await openDialog();

		fireEvent.change(screen.getByLabelText(labels.category), { target: { value: "BUG" } });
		fireEvent.change(screen.getByLabelText(labels.message), {
			target: { value: "The footer link is broken" },
		});
		fireEvent.click(screen.getByRole("button", { name: labels.submit }));

		expect(await screen.findByText(labels.success)).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/reports");
		expect(init.method).toBe("POST");
		const payload = JSON.parse(String(init.body));
		expect(payload).toMatchObject({
			category: "BUG",
			message: "The footer link is broken",
			pagePath: window.location.pathname,
			locale: "en",
			website: "",
		});
		// A blank optional email is omitted rather than sent as an empty string.
		expect(payload).not.toHaveProperty("email");
	});

	it("shows the rate-limit label on 429", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ status: 429 });
		vi.stubGlobal("fetch", fetchMock);

		await openDialog();

		fireEvent.change(screen.getByLabelText(labels.message), {
			target: { value: "The footer link is broken" },
		});
		fireEvent.click(screen.getByRole("button", { name: labels.submit }));

		expect(await screen.findByRole("alert")).toHaveTextContent(labels.rateLimited);
	});
});

/**
 * #759 — disabling Escape, the backdrop and the close button while `sending`,
 * with an unbounded `fetch`, trapped the user in the dialog for as long as the
 * socket stayed open. A hung request must time out or be cancelable, and the
 * typed report must survive either path.
 */
describe("ReportIssueDialog request lifecycle", () => {
	const REPORT = "The schedule page freezes when I open it.";

	/** A request that never answers on its own, but rejects when aborted. */
	function hangingFetch() {
		return vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				}),
		);
	}

	function openAndSubmit() {
		fireEvent.click(screen.getByRole("button", { name: labels.trigger }));
		fireEvent.change(screen.getByLabelText(labels.message), { target: { value: REPORT } });
		fireEvent.click(screen.getByRole("button", { name: labels.submit }));
	}

	it("times out, says the report was not sent, and offers a retry", async () => {
		vi.useFakeTimers();
		try {
			vi.stubGlobal("fetch", hangingFetch());
			render(<ReportIssueDialog labels={labels} />);

			openAndSubmit();
			expect(screen.getByRole("button", { name: labels.sending })).toBeDisabled();

			await act(async () => {
				vi.advanceTimersByTime(15_000);
			});

			expect(screen.getByRole("alert")).toHaveTextContent(labels.error);
			expect(screen.getByRole("button", { name: labels.retry })).toBeEnabled();
			// The typed report is preserved for the retry.
			expect(screen.getByLabelText(labels.message)).toHaveValue(REPORT);
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes while sending, aborts the request and keeps the draft", async () => {
		const fetchMock = hangingFetch();
		vi.stubGlobal("fetch", fetchMock);
		render(<ReportIssueDialog labels={labels} />);

		openAndSubmit();
		fireEvent.click(screen.getByRole("button", { name: labels.close }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: labels.trigger }));
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByLabelText(labels.message)).toHaveValue(REPORT);
	});

	it("does not let an aborted request overwrite the dialog state", async () => {
		vi.stubGlobal("fetch", hangingFetch());
		render(<ReportIssueDialog labels={labels} />);

		openAndSubmit();
		fireEvent.click(screen.getByRole("button", { name: labels.close }));

		await act(async () => {
			await Promise.resolve();
		});

		// The rejection was ignored, so reopening starts idle rather than showing
		// the stale error of a report the user already dismissed.
		fireEvent.click(screen.getByRole("button", { name: labels.trigger }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
	});
});
