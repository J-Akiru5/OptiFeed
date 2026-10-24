"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

interface ModalProps {
	open: boolean;
	title: string;
	description?: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	size?: "sm" | "md" | "lg";
}

export function Modal({
	open,
	title,
	description,
	onClose,
	children,
	footer,
	size = "md",
}: ModalProps) {
	useEffect(() => {
		if (!open) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	const maxWidth = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl";

	return (
		<div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-gray-950/50 backdrop-blur-[2px]"
			/>
			{/* biome-ignore lint/a11y/useSemanticElements: styled modal panel inside a fixed overlay */}
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="harvest-modal-title"
				className={`relative flex max-h-[92vh] w-full ${maxWidth} flex-col overflow-hidden rounded-t-3xl border border-gray-100 bg-white shadow-2xl dark:border-gray-700/60 dark:bg-gray-900 sm:rounded-3xl`}
			>
				<div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700/60">
					<div>
						<h2
							id="harvest-modal-title"
							className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]"
						>
							{title}
						</h2>
						{description && (
							<p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
				{footer && (
					<div className="border-t border-gray-100 px-5 py-4 dark:border-gray-700/60">{footer}</div>
				)}
			</div>
		</div>
	);
}
