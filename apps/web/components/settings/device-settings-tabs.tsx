"use client";

import {
	dashboardButtonPrimary,
	dashboardButtonSecondary,
} from "@/components/dashboard/dashboard-classes";
import { Modal } from "@/components/harvest/modal";
import { useRouter } from "@/i18n/routing";
import {
	DEFAULT_DEVICE_SETTINGS_TAB,
	DEVICE_SETTINGS_TABS,
	type DeviceSettingsTab,
	deviceSettingsHref,
	tabForAnchor,
} from "@/lib/settings/device-settings-tabs";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { DeviceSwitcher, type DeviceSwitcherOption } from "./device-switcher";
import { type DirtyRegistry, SettingsPanelContext, UnsavedChangesContext } from "./unsaved-changes";

interface DeviceSettingsTabsProps {
	initialTab: DeviceSettingsTab;
	deviceId: string | null;
	devices: DeviceSwitcherOption[];
	panels: Record<DeviceSettingsTab, ReactNode>;
}

/**
 * The tabbed device settings page (issue #403).
 *
 * Every panel stays mounted and inactive ones are only `hidden`, so an edit
 * survives a tab switch. The tab is kept
 * in `?tab=` with `history.replaceState` (no server round trip); the device is
 * a real navigation because the server loads its data.
 */
export function DeviceSettingsTabs({
	initialTab,
	deviceId,
	devices,
	panels,
}: DeviceSettingsTabsProps) {
	const t = useTranslations("dashboard.appSettings.tabs");
	const router = useRouter();
	const baseId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef<Partial<Record<DeviceSettingsTab, HTMLButtonElement | null>>>({});
	const [activeTab, setActiveTab] = useState<DeviceSettingsTab>(initialTab);
	const [dirty, setDirty] = useState<Record<string, DeviceSettingsTab>>({});
	const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);

	const report = useCallback<DirtyRegistry>((key, tab, isDirty) => {
		setDirty((current) => {
			if (isDirty === (current[key] === tab)) return current;
			const next = { ...current };
			if (isDirty) next[key] = tab;
			else delete next[key];
			return next;
		});
	}, []);

	const dirtyTabs = useMemo(() => new Set(Object.values(dirty)), [dirty]);
	const hasUnsaved = dirtyTabs.size > 0;

	// A server navigation (device switch, pagination) brings a new initial tab.
	useEffect(() => {
		setActiveTab(initialTab);
	}, [initialTab]);

	const selectTab = useCallback((tab: DeviceSettingsTab) => {
		setActiveTab(tab);
		const url = new URL(window.location.href);
		if (tab === DEFAULT_DEVICE_SETTINGS_TAB) url.searchParams.delete("tab");
		else url.searchParams.set("tab", tab);
		url.hash = "";
		window.history.replaceState(window.history.state, "", url);
	}, []);

	// Links written before the tabs (`#daily-ceiling`) open the tab that now
	// holds the section, then scroll to it.
	useEffect(() => {
		const tab = tabForAnchor(window.location.hash);
		if (!tab) return;
		const anchor = window.location.hash.slice(1);
		setActiveTab(tab);
		// Next frame: the panel is only laid out once the hidden flag is gone.
		const frame = window.requestAnimationFrame(() => {
			document.getElementById(anchor)?.scrollIntoView({ block: "start" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, []);

	// Reload and closing the tab. In-app links have no App Router event to hook.
	useEffect(() => {
		if (!hasUnsaved) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [hasUnsaved]);

	const goToDevice = useCallback(
		(id: string) => {
			setPendingDeviceId(null);
			router.push(deviceSettingsHref({ deviceId: id, tab: activeTab }));
		},
		[router, activeTab],
	);

	const requestDevice = (id: string) => {
		if (id === deviceId) return;
		if (hasUnsaved) setPendingDeviceId(id);
		else goToDevice(id);
	};

	const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const last = DEVICE_SETTINGS_TABS.length - 1;
		let next: number | null = null;
		if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
		else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = last;
		if (next === null) return;
		event.preventDefault();
		const tab = DEVICE_SETTINGS_TABS[next];
		selectTab(tab);
		tabRefs.current[tab]?.focus();
	};

	return (
		<UnsavedChangesContext.Provider value={report}>
			<div ref={rootRef} className="space-y-6">
				{devices.length > 1 && deviceId && (
					<DeviceSwitcher options={devices} selectedId={deviceId} onSelect={requestDevice} />
				)}

				<div
					role="tablist"
					aria-label={t("label")}
					className="-mx-1 flex gap-1 overflow-x-auto border-b border-gray-200 px-1 [scrollbar-width:none] dark:border-gray-700"
				>
					{DEVICE_SETTINGS_TABS.map((tab, index) => {
						const selected = tab === activeTab;
						return (
							<button
								key={tab}
								ref={(node) => {
									tabRefs.current[tab] = node;
								}}
								type="button"
								role="tab"
								id={`${baseId}-tab-${tab}`}
								aria-selected={selected}
								aria-controls={`${baseId}-panel-${tab}`}
								tabIndex={selected ? 0 : -1}
								onClick={() => selectTab(tab)}
								onKeyDown={(event) => onTabKeyDown(event, index)}
								className={cn(
									"relative -mb-px flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-4 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2 dark:focus-visible:ring-[#5b9bd5]",
									selected
										? "border-[#E85A2A] text-[#0A3D62] dark:text-[#5b9bd5]"
										: "border-transparent text-[#3D5568] hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-200",
								)}
							>
								{t(tab)}
								{dirtyTabs.has(tab) && (
									<>
										<span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#E85A2A]" />
										<span className="sr-only">{t("unsaved")}</span>
									</>
								)}
							</button>
						);
					})}
				</div>

				{DEVICE_SETTINGS_TABS.map((tab) => (
					<div
						key={tab}
						role="tabpanel"
						id={`${baseId}-panel-${tab}`}
						aria-labelledby={`${baseId}-tab-${tab}`}
						data-settings-panel={tab}
						hidden={tab !== activeTab}
						className="space-y-6"
					>
						<SettingsPanelContext.Provider value={tab}>{panels[tab]}</SettingsPanelContext.Provider>
					</div>
				))}
			</div>

			<Modal
				open={pendingDeviceId !== null}
				title={t("unsavedTitle")}
				description={t("unsavedDesc")}
				onClose={() => setPendingDeviceId(null)}
				size="sm"
				footer={
					<div className="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							className={dashboardButtonSecondary}
							onClick={() => setPendingDeviceId(null)}
						>
							{t("keepEditing")}
						</button>
						<button
							type="button"
							className={dashboardButtonPrimary}
							onClick={() => pendingDeviceId && goToDevice(pendingDeviceId)}
						>
							{t("discardAndSwitch")}
						</button>
					</div>
				}
			>
				<p className="text-sm text-[#3D5568] dark:text-gray-300">
					{t("unsavedTabs", {
						tabs: DEVICE_SETTINGS_TABS.filter((tab) => dirtyTabs.has(tab))
							.map((tab) => t(tab))
							.join(", "),
					})}
				</p>
			</Modal>
		</UnsavedChangesContext.Provider>
	);
}

export type { DeviceSwitcherOption };
