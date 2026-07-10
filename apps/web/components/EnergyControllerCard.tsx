"use client";

import { setRelayState as setRelayStateAction } from "@/lib/actions/energy";
import { cn } from "@/lib/utils";
import { Loader2, Power, Radio, RadioTower } from "lucide-react";
import { useState, useTransition } from "react";

interface EnergyControllerCardProps {
	deviceId: string;
	label: string;
	mac: string;
	initialRelayState: boolean;
	lastSeenAt: Date | null;
}

function formatLastSeen(lastSeenAt: Date | null): string {
	if (!lastSeenAt) return "Never";
	const seconds = Math.floor((Date.now() - lastSeenAt.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function EnergyControllerCard({
	deviceId,
	label,
	mac,
	initialRelayState,
	lastSeenAt,
}: EnergyControllerCardProps) {
	const [relayState, setRelayState] = useState(initialRelayState);
	const [isPending, startTransition] = useTransition();

	const handleToggle = () => {
		const next = !relayState;
		setRelayState(next);
		startTransition(async () => {
			await setRelayStateAction(deviceId, next);
		});
	};

	return (
		<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 transition-shadow hover:shadow-md">
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-3">
					<div className="h-11 w-11 rounded-xl bg-[var(--ofd-base)]/10 text-[var(--ofd-base)] flex items-center justify-center">
						<RadioTower className="h-6 w-6" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
							ESP32 Controller
						</p>
						<h3 className="text-lg font-bold text-[var(--ofd-base-deep)]">{label}</h3>
					</div>
				</div>
				<span
					className={cn(
						"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
						relayState ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
					)}
				>
					<span
						className={cn(
							"h-2 w-2 rounded-full",
							relayState ? "bg-green-500 animate-pulse" : "bg-gray-400",
						)}
					/>
					Relay {relayState ? "CLOSED" : "OPEN"}
				</span>
			</div>

			<div className="flex items-center justify-between gap-4 rounded-2xl bg-gray-50 p-4">
				<div className="flex items-center gap-3">
					<Radio className="h-5 w-5 text-gray-400" />
					<div>
						<p className="text-xs text-gray-500 font-medium">MAC</p>
						<p className="text-sm font-mono text-gray-700">{mac}</p>
					</div>
				</div>
				<div className="text-right">
					<p className="text-xs text-gray-500 font-medium">Last seen</p>
					<p className="text-sm text-gray-700">{formatLastSeen(lastSeenAt)}</p>
				</div>
			</div>

			<button
				type="button"
				onClick={handleToggle}
				disabled={isPending}
				className={cn(
					"mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50",
					relayState ? "bg-red-500 hover:bg-red-600" : "bg-[var(--ofd-base)] hover:bg-[#1a4a6e]",
				)}
			>
				{isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Power className="h-5 w-5" />}
				<span>{relayState ? "Open Relay (Stop)" : "Close Relay (Feed)"}</span>
			</button>
		</div>
	);
}
