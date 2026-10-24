"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";

interface ModalProps {
	open: boolean;
	title: string;
	description?: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	size?: "sm" | "md" | "lg";
}

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
	open,
	title,
	description,
	onClose,
	children,
	footer,
	size = "md",
}: ModalProps) {
	const t = useTranslations("dashboard.harvest.details");
	const titleId = useId();
	const descriptionId = useId();
	const panelRef = useRef<HTMLDialogElement>(null);
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const previousOverflow = document.body.style.overflow;
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		document.body.style.overflow = "hidden";

		function getFocusable(): HTMLElement[] {
			return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;

			const focusable = getFocusable();
			if (focusable.length === 0) {
				event.preventDefault();
				panel?.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}

		const initial = getFocusable()[0];
		(initial ?? panel)?.focus();
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
			previouslyFocused?.focus();
		};
	}, [open]);

	if (!open) return null;

	const maxWidth = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl";

	return (
		<div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
			<button
				type="button"
				aria-label={t("close")}
				onClick={onClose}
				className="absolute inset-0 bg-gray-950/50 backdrop-blur-[2px]"
			/>
			<dialog
				ref={panelRef}
				open
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description ? descriptionId : undefined}
				tabIndex={-1}
				className={`relative m-0 flex max-h-[92dvh] w-full ${maxWidth} flex-col overflow-hidden rounded-t-3xl border border-gray-100 bg-white p-0 shadow-2xl outline-none dark:border-gray-700/60 dark:bg-gray-900 sm:rounded-3xl`}
			>
				<div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700/60">
					<div className="min-w-0">
						<h2
							id={titleId}
							className="break-words text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]"
						>
							{title}
						</h2>
						{description && (
							<p
								id={descriptionId}
								className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400"
							>
								{description}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("close")}
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
					{children}
				</div>
				{footer && (
					<div className="border-t border-gray-100 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-700/60 sm:pb-4">
						{footer}
					</div>
				)}
			</dialog>
		</div>
	);
}
