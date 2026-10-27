import { Cpu, Droplets, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface AdminStatsCardsProps {
	userCount: number;
	pondCount: number;
	deviceCount: number;
	/** Translated card labels, supplied by the page. */
	labels: {
		users: string;
		ponds: string;
		devices: string;
	};
}

export function AdminStatsCards({
	userCount,
	pondCount,
	deviceCount,
	labels,
}: AdminStatsCardsProps) {
	const cards: { label: string; value: number; icon: LucideIcon; color: string }[] = [
		{
			label: labels.users,
			value: userCount,
			icon: Users,
			color: "bg-[#E85A2A]",
		},
		{
			label: labels.ponds,
			value: pondCount,
			icon: Droplets,
			color: "bg-[#0A3D62]",
		},
		{
			label: labels.devices,
			value: deviceCount,
			icon: Cpu,
			color: "bg-[#1E7B34]",
		},
	];

	return (
		<ul className="grid gap-4 sm:grid-cols-3">
			{cards.map((card) => (
				<li
					key={card.label}
					className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900"
				>
					<span
						aria-hidden="true"
						className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${card.color}`}
					>
						<card.icon className="h-6 w-6 text-white" />
					</span>
					<div className="min-w-0">
						<p className="text-3xl font-black text-[#0A3D62] tabular-nums dark:text-gray-100">
							{card.value}
						</p>
						<p className="truncate text-xs font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{card.label}
						</p>
					</div>
				</li>
			))}
		</ul>
	);
}
