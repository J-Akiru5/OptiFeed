"use client";

import type { DeviceSettingsTab } from "@/lib/settings/device-settings-tabs";
import { createContext, useContext, useEffect } from "react";

export type DirtyRegistry = (key: string, tab: DeviceSettingsTab, dirty: boolean) => void;

export const UnsavedChangesContext = createContext<DirtyRegistry | null>(null);
export const SettingsPanelContext = createContext<DeviceSettingsTab | null>(null);

/**
 * Lets a settings form tell the device settings page it holds unsaved edits.
 *
 * The page marks the form's tab and warns before switching device or leaving.
 * Outside the page (the same forms render on the admin pond page) it does
 * nothing, so callers never need to know where they are mounted. Kept apart
 * from the tabs shell so the forms do not bundle it.
 */
export function useReportUnsavedChanges(key: string, dirty: boolean): void {
	const report = useContext(UnsavedChangesContext);
	const tab = useContext(SettingsPanelContext);
	useEffect(() => {
		if (!report || !tab) return;
		report(key, tab, dirty);
		return () => report(key, tab, false);
	}, [report, tab, key, dirty]);
}
