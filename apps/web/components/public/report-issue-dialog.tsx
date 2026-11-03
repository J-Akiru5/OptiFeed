"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Public "Report an issue" box (issue #487).
 *
 * The dialog is presentation only: every string arrives in `labels` from the
 * server component that owns translations, so this file imports no i18n
 * runtime and can be dropped into the landing footer as-is.
 *
 * It is also dependency-free by design (plain React + Tailwind): the landing
 * page is shared by signed-out visitors and must stay lightweight.
 */

export type ReportIssueLabels = {
	trigger: string;
	title: string;
	description: string;
	close: string;
	category: string;
	categories: { bug: string; accessibility: string; content: string; other: string };
	message: string;
	messageHint: string;
	email: string;
	emailHint: string;
	optional: string;
	submit: string;
	sending: string;
	cancel: string;
	retry: string;
	success: string;
	error: string;
	rateLimited: string;
};

export type ReportIssueDialogProps = {
	labels: ReportIssueLabels;
};

const CATEGORY_OPTIONS = [
	{ value: "BUG", key: "bug" },
	{ value: "ACCESSIBILITY", key: "accessibility" },
	{ value: "CONTENT", key: "content" },
	{ value: "OTHER", key: "other" },
] as const;

type SubmitStatus = "idle" | "sending" | "success" | "error" | "rateLimited";

/** A hung request must not trap the visitor in the dialog (#759). */
export const REPORT_REQUEST_TIMEOUT_MS = 15_000;

const focusRingOnDark =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A5C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#061B2B]";

const labelClass = "block text-[11px] font-semibold tracking-[0.14em] text-white/55 uppercase";
const fieldClass =
	"mt-1.5 w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-[14px] text-white placeholder:text-white/35 transition-colors focus:border-[#FF8A5C]/70 focus:outline-none";

export function ReportIssueDialog({ labels }: ReportIssueDialogProps) {
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<SubmitStatus>("idle");
	const [category, setCategory] = useState<string>("OTHER");
	const [message, setMessage] = useState("");
	const [email, setEmail] = useState("");
	const [website, setWebsite] = useState("");

	const titleId = useId();
	const descriptionId = useId();
	const messageHintId = useId();
	const emailHintId = useId();
	const honeypotId = useId();

	const triggerRef = useRef<HTMLButtonElement>(null);
	const firstFieldRef = useRef<HTMLSelectElement>(null);
	const successRef = useRef<HTMLOutputElement>(null);
	const requestRef = useRef<AbortController | null>(null);

	function cancelInFlight() {
		requestRef.current?.abort();
		requestRef.current = null;
	}

	// Escape always closes: a request that is still in flight is aborted and
	// the typed values stay in state for the next open.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			requestRef.current?.abort();
			requestRef.current = null;
			setOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);

	// Lock background scrolling, move focus into the dialog, and hand focus back
	// to whatever opened it when the dialog closes or unmounts.
	useEffect(() => {
		if (!open) return;
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		firstFieldRef.current?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			(previouslyFocused ?? triggerRef.current)?.focus();
		};
	}, [open]);

	// The form is replaced by a status panel on success; keep keyboard focus in
	// the dialog instead of letting it fall back to the document body.
	useEffect(() => {
		if (status === "success") successRef.current?.focus();
	}, [status]);

	function openDialog() {
		setStatus("idle");
		setOpen(true);
	}

	function closeDialog() {
		cancelInFlight();
		setOpen(false);
	}

	function cancelSending() {
		cancelInFlight();
		setStatus("idle");
		firstFieldRef.current?.focus();
	}

	function handleBackdropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
		// Only a press on the overlay itself closes; presses inside the panel do not.
		if (event.target === event.currentTarget) closeDialog();
	}

	// Keep Tab inside the dialog while it is open. The honeypot is excluded by
	// its -1 tab index.
	function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "Tab") return;
		const panel = event.currentTarget;
		const focusable = Array.from(
			panel.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"),
		).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (status === "sending") return;
		setStatus("sending");

		const controller = new AbortController();
		requestRef.current = controller;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, REPORT_REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch("/api/reports", {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal: controller.signal,
				body: JSON.stringify({
					category,
					message,
					email: email.trim() || undefined,
					pagePath: window.location.pathname,
					locale: document.documentElement.lang,
					website,
				}),
			});

			if (controller.signal.aborted) return;

			if (response.status === 201) {
				setStatus("success");
				setCategory("OTHER");
				setMessage("");
				setEmail("");
				setWebsite("");
				return;
			}

			setStatus(response.status === 429 ? "rateLimited" : "error");
		} catch {
			// A user cancel or a close already aborted the request; the dialog is
			// gone or back in edit mode, so there is no outcome to announce. A
			// timeout is different: keep the typed report and offer a retry.
			if (controller.signal.aborted && !timedOut) return;
			setStatus("error");
		} finally {
			clearTimeout(timeout);
			if (requestRef.current === controller) requestRef.current = null;
		}
	}

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={openDialog}
				className={cn(
					"rounded-md text-[11.5px] text-white/55 transition-colors hover:text-white",
					focusRingOnDark,
				)}
			>
				{labels.trigger}
			</button>

			{open ? (
				<div
					role="presentation"
					className="fixed inset-0 z-[70] flex items-end justify-center bg-[#03121D]/70 p-4 backdrop-blur-sm sm:items-center"
					onPointerDown={handleBackdropPointerDown}
				>
					{/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs
					imperative showModal() and its own top-layer/backdrop behaviour; this
					controlled panel keeps focus management, Escape and scroll lock in one
					place and stays testable in jsdom. */}
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby={titleId}
						aria-describedby={descriptionId}
						onKeyDown={handlePanelKeyDown}
						className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#082031] p-5 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] sm:p-6"
					>
						<button
							type="button"
							onClick={closeDialog}
							aria-label={labels.close}
							className={cn(
								"absolute top-3 right-3 rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white",
								focusRingOnDark,
							)}
						>
							<X className="size-4" aria-hidden="true" />
						</button>

						<h2 id={titleId} className="pr-8 text-lg font-semibold tracking-[-0.01em]">
							{labels.title}
						</h2>
						<p id={descriptionId} className="mt-2 text-[13px] leading-5 text-white/60">
							{labels.description}
						</p>

						{status === "success" ? (
							<div className="mt-5">
								<output
									ref={successRef}
									tabIndex={-1}
									className="block rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2.5 text-[13.5px] leading-5 text-emerald-100 focus:outline-none"
								>
									{labels.success}
								</output>
								<button
									type="button"
									onClick={closeDialog}
									className={cn(
										"mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-white/20 bg-white/[0.04] px-4 text-[13.5px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10",
										focusRingOnDark,
									)}
								>
									{labels.close}
								</button>
							</div>
						) : (
							<form onSubmit={handleSubmit} className="mt-5" aria-busy={status === "sending"}>
								<div>
									<label htmlFor="report-category" className={labelClass}>
										{labels.category}
									</label>
									<select
										ref={firstFieldRef}
										id="report-category"
										name="category"
										value={category}
										onChange={(event) => setCategory(event.target.value)}
										disabled={status === "sending"}
										className={cn(fieldClass, "appearance-none")}
									>
										{CATEGORY_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{labels.categories[option.key]}
											</option>
										))}
									</select>
								</div>

								<div className="mt-4">
									<div className="flex items-baseline justify-between gap-3">
										<label htmlFor="report-message" className={labelClass}>
											{labels.message}
										</label>
										<span className="text-[10.5px] tabular-nums text-white/35" aria-hidden="true">
											{message.length}/2000
										</span>
									</div>
									<textarea
										id="report-message"
										name="message"
										required
										minLength={10}
										maxLength={2000}
										rows={5}
										value={message}
										onChange={(event) => setMessage(event.target.value)}
										disabled={status === "sending"}
										aria-describedby={messageHintId}
										placeholder={labels.messageHint}
										className={cn(fieldClass, "resize-y")}
									/>
									<p id={messageHintId} className="mt-1.5 text-[11px] leading-4 text-white/40">
										{labels.messageHint}
									</p>
								</div>

								<div className="mt-4">
									<label htmlFor="report-email" className={labelClass}>
										{labels.email}{" "}
										<span className="font-normal tracking-normal normal-case text-white/35">
											({labels.optional})
										</span>
									</label>
									<input
										id="report-email"
										name="email"
										type="email"
										maxLength={200}
										autoComplete="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
										disabled={status === "sending"}
										aria-describedby={emailHintId}
										placeholder={labels.emailHint}
										className={fieldClass}
									/>
									<p id={emailHintId} className="mt-1.5 text-[11px] leading-4 text-white/40">
										{labels.emailHint}
									</p>
								</div>

								{/* Honeypot: visually hidden, ignored by the tab order, so a
								    non-empty value means a script filled the form. */}
								<div className="sr-only">
									<label htmlFor={honeypotId}>Website</label>
									<input
										id={honeypotId}
										name="website"
										type="text"
										tabIndex={-1}
										autoComplete="off"
										value={website}
										onChange={(event) => setWebsite(event.target.value)}
									/>
								</div>

								{status === "error" || status === "rateLimited" ? (
									<p
										role="alert"
										className="mt-4 rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-[12.5px] leading-5 text-red-100"
									>
										{status === "rateLimited" ? labels.rateLimited : labels.error}
									</p>
								) : null}

								<div className="mt-5 flex gap-2">
									{status === "sending" && (
										<button
											type="button"
											onClick={cancelSending}
											className={cn(
												"inline-flex h-11 items-center justify-center rounded-lg border border-white/20 bg-white/[0.04] px-4 text-[14px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10",
												focusRingOnDark,
											)}
										>
											{labels.cancel}
										</button>
									)}
									<button
										type="submit"
										disabled={status === "sending"}
										className={cn(
											"inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-[#E85A2A] px-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(232,90,42,0.7)] transition-colors hover:bg-[#D24E22] disabled:cursor-not-allowed disabled:opacity-60",
											focusRingOnDark,
										)}
									>
										{status === "sending"
											? labels.sending
											: status === "error" || status === "rateLimited"
												? labels.retry
												: labels.submit}
									</button>
								</div>
							</form>
						)}
					</div>
				</div>
			) : null}
		</>
	);
}
