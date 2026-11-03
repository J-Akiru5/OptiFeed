"use client";

import { useEffect } from "react";

/**
 * Warn before a reload or tab close while a form holds unsaved edits (#763).
 *
 * The App Router has no in-app navigation event to hook, so this covers the
 * browser's own leave paths — the same rule the device settings shell uses.
 * The form still shows its own inline "unsaved changes" note for in-app links.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
	useEffect(() => {
		if (!dirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [dirty]);
}
