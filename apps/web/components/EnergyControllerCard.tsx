"use client";

import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
import { cn } from "@/lib/utils";
import { Clock, Loader2, Utensils, Wifi, WifiOff } from "lucide-react";
import { useState, useTransition } from "react";

interface EnergyControllerCardProps {
	deviceId: string;
	label: string;
	mac: string;
	rtcOk: boolean;
	feederActive: boolean;
	gramsPerFeeding: number;
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
	rtcOk,
	feederActive,
	gramsPerFeeding,
	lastSeenAt,
}: EnergyControllerCardProps) {
	const [feedGrams, setFeedGrams] = useState(gramsPerFeeding);
	const [isPending, startTransition] = useTransition();
	const [feedSent, setFeedSent] = useState(false);

	const handleFeedNow = () => {
		setFeedSent(false);
		startTransition(async () => {
			const result = await requestFeedAction(deviceId, feedGrams);
			if (result.success) {
				setFeedSent(true);
				setTimeout(() => setFeedSent(false), 3000);
			}
		});
	};

	return (
		<div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100 transition-shadow hover:shadow-md">
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-3">
					<div className="h-11 w-11 rounded-xl bg-[var(--ofd-base)]/10 text-[var(--ofd-base)] flex items-center justify-center">
						<Utensils className="h-6 w-6" />
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
						feederActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
					)}
				>
					<span
						className={cn(
							"h-2 w-2 rounded-full",
							feederActive ? "bg-green-500 animate-pulse" : "bg-gray-400",
						)}
					/>
					{feederActive ? "Feeding..." : "Idle"}
				</span>
			</div>

			<div className="grid grid-cols-2 gap-3 mb-4">
				<div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3">
					{rtcOk ? (
						<Wifi className="h-4 w-4 text-green-500" />
					) : (
						<WifiOff className="h-4 w-4 text-red-500" />
					)}
					<div>
						<p className="text-xs text-gray-500 font-medium">RTC</p>
						<p className={cn("text-sm font-medium", rtcOk ? "text-green-600" : "text-red-600")}>
							{rtcOk ? "OK" : "Offline"}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3">
					<Clock className="h-4 w-4 text-gray-400" />
					<div>
						<p className="text-xs text-gray-500 font-medium">Last seen</p>
						<p className="text-sm text-gray-700">{formatLastSeen(lastSeenAt)}</p>
					</div>
				</div>
			</div>

			<div className="flex items-center justify-between gap-4 rounded-2xl bg-gray-50 p-4 mb-4">
				<div>
					<p className="text-xs text-gray-500 font-medium">MAC Address</p>
					<p className="text-sm font-mono text-gray-700">{mac}</p>
				</div>
				<div className="text-right">
					<p className="text-xs text-gray-500 font-medium">Default Feed</p>
					<p className="text-sm font-medium text-gray-700">{gramsPerFeeding}g</p>
				</div>
			</div>

			<div className="space-y-3">
				<div>
					<label htmlFor="feed-grams" className="block text-xs text-gray-500 font-medium mb-1">
						Feed Amount (grams)
					</label>
					<input
						id="feed-grams"
						type="number"
						min={1}
						max={500}
						value={feedGrams}
						onChange={(e) => setFeedGrams(Number(e.target.value))}
						className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ofd-base)]/30 focus:border-[var(--ofd-base)]"
					/>
				</div>

				<button
					type="button"
					onClick={handleFeedNow}
					disabled={isPending || feederActive || feedGrams <= 0}
					className={cn(
						"flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50",
						feedSent
							? "bg-green-500 hover:bg-green-600"
							: "bg-[var(--ofd-base)] hover:bg-[#1a4a6e]",
					)}
				>
					{isPending ? (
						<Loader2 className="h-5 w-5 animate-spin" />
					) : (
						<Utensils className="h-5 w-5" />
					)}
					<span>
						{feedSent
							? "Feed Request Sent!"
							: feederActive
								? "Feeding in Progress..."
								: `Feed Now (${feedGrams}g)`}
					</span>
				</button>
			</div>
		</div>
	);
}
