"use client";

import { dashboardField, dashboardLabel } from "@/components/dashboard/dashboard-classes";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useId } from "react";

export interface DeviceSwitcherOption {
	id: string;
	label: string;
	pondName: string;
	state: "online" | "weak" | "offline";
}

interface DeviceSwitcherProps {
	/** Already limited to the caller's own ACTIVE ponds by the server. */
	options: DeviceSwitcherOption[];
	selectedId: string;
	onSelect: (id: string) => void;
}

const DOT: Record<DeviceSwitcherOption["state"], string> = {
	online: "bg-[#1E7B34]",
	weak: "bg-amber-500",
	offline: "bg-gray-400",
};

/**
 * Picks which feeder the settings page configures (issue #403).
 *
 * A native select grouped by pond: keyboard, screen reader and phone pickers
 * come for free, and the status is spelled out in each option because an
 * option cannot hold the coloured dot.
 */
export function DeviceSwitcher({ options, selectedId, onSelect }: DeviceSwitcherProps) {
	const t = useTranslations("dashboard.appSettings.deviceSwitcher");
	const id = useId();
	const selected = options.find((option) => option.id === selectedId);

	const groups = new Map<string, DeviceSwitcherOption[]>();
	for (const option of options) {
		const group = groups.get(option.pondName) ?? [];
		group.push(option);
		groups.set(option.pondName, group);
	}

	return (
		<div className="max-w-md space-y-1">
			<label htmlFor={id} className={dashboardLabel}>
				{t("label")}
			</label>
			<div className="relative">
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute left-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full",
						DOT[selected?.state ?? "offline"],
					)}
				/>
				<select
					id={id}
					value={selectedId}
					onChange={(event) => onSelect(event.target.value)}
					className={cn(dashboardField, "min-h-11 pl-10 font-bold")}
				>
					{[...groups.entries()].map(([pondName, devices]) => (
						<optgroup key={pondName} label={pondName || t("noPond")}>
							{devices.map((device) => (
								<option key={device.id} value={device.id}>
									{t("option", { label: device.label, status: t(`state.${device.state}`) })}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</div>
		</div>
	);
}
