"use client";

import {
	DIALOG_BACKDROP,
	DIALOG_CLOSE,
	DIALOG_DESCRIPTION,
	DIALOG_ICON_TILE,
	DIALOG_PANEL,
	DIALOG_TITLE,
} from "@/components/superadmin/dialog-theme";
import { FOCUS_RING } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import { type LucideIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Open dialogs, innermost last. Several console surfaces can stack (a row
 * action opens the step-up password dialog on top), so only the topmost dialog
 * answers Escape and owns the Tab loop; otherwise one keypress would close both.
 */
const openDialogs: symbol[] = [];

const SIZES = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-2xl",
} as const;

/**
 * One modal shell for the platform console: dimmed backdrop, centred panel,
 * initial focus, Escape to close, Tab kept inside the panel, and focus
 * returned to the control that opened it. Replaces the ad-hoc overlay markup
 * each console task used to carry.
 */
export function DialogShell({
	open,
	onClose,
	labelledBy,
	describedBy,
	size = "sm",
	children,
	pending = false,
}: {
	open: boolean;
	onClose: () => void;
	/** id of the element that names the dialog. */
	labelledBy: string;
	/** id of the element that describes it, when there is one. */
	describedBy?: string;
	size?: keyof typeof SIZES;
	children: ReactNode;
	/** Marks the panel busy while an action is in flight. */
	pending?: boolean;
}) {
	const panelRef = useRef<HTMLDialogElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const token = Symbol("dialog");
		openDialogs.push(token);
		const previous = document.activeElement as HTMLElement | null;

		const focusFirst = () => {
			const panel = panelRef.current;
			if (!panel) return;
			const target =
				panel.querySelector<HTMLElement>("[data-autofocus]") ??
				panel.querySelector<HTMLElement>(FOCUSABLE);
			target?.focus();
		};
		// After paint, so the panel's children exist and are visible.
		const timer = setTimeout(focusFirst, 0);

		const onKeyDown = (event: KeyboardEvent) => {
			if (openDialogs[openDialogs.length - 1] !== token) return;

			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;

			const panel = panelRef.current;
			if (!panel) return;
			const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (nodes.length === 0) {
				event.preventDefault();
				return;
			}
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("keydown", onKeyDown);
			const index = openDialogs.indexOf(token);
			if (index !== -1) openDialogs.splice(index, 1);
			previous?.focus?.();
		};
	}, [open]);

	if (!open) return null;

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4",
				DIALOG_BACKDROP,
			)}
		>
			<dialog
				ref={panelRef}
				open
				aria-modal="true"
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				aria-busy={pending || undefined}
				tabIndex={-1}
				className={cn(
					"relative m-0 w-full rounded-2xl border p-5 shadow-2xl",
					"max-h-[calc(100dvh-2rem)] overflow-y-auto",
					DIALOG_PANEL,
					FOCUS_RING,
					SIZES[size],
				)}
			>
				{children}
			</dialog>
		</div>
	);
}

/** Shared dialog header: icon tile, title, one-line explanation, close button. */
export function DialogHeader({
	titleId,
	descriptionId,
	title,
	description,
	icon: Icon,
	onClose,
	closeLabel,
	closeDisabled = false,
}: {
	titleId: string;
	descriptionId?: string;
	title: ReactNode;
	description?: ReactNode;
	icon?: LucideIcon;
	onClose?: () => void;
	/** Accessible name for the close control; required whenever onClose is set. */
	closeLabel?: string;
	closeDisabled?: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="flex items-start gap-2">
				{Icon && (
					<div
						className={cn(
							"mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
							DIALOG_ICON_TILE,
						)}
					>
						<Icon className="h-4 w-4" aria-hidden="true" />
					</div>
				)}
				<div className="min-w-0">
					<h2 id={titleId} className={cn("text-sm font-black", DIALOG_TITLE)}>
						{title}
					</h2>
					{description && (
						<p
							id={descriptionId}
							className={cn("mt-1 text-[11px] leading-snug", DIALOG_DESCRIPTION)}
						>
							{description}
						</p>
					)}
				</div>
			</div>
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					disabled={closeDisabled}
					aria-label={closeLabel}
					className={cn(
						"shrink-0 rounded-lg p-1 transition-colors disabled:opacity-50",
						DIALOG_CLOSE,
						FOCUS_RING,
					)}
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</button>
			)}
		</div>
	);
}
