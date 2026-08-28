import { Cpu, Droplets, Users } from "lucide-react";

interface AdminStatsCardsProps {
	userCount: number;
	pondCount: number;
	deviceCount: number;
}

export function AdminStatsCards({ userCount, pondCount, deviceCount }: AdminStatsCardsProps) {
	const cards = [
		{
			label: "Users",
			value: userCount,
			icon: Users,
			color: "bg-[#E85A2A]",
		},
		{
			label: "Ponds",
			value: pondCount,
			icon: Droplets,
			color: "bg-[#0A3D62]",
		},
		{
			label: "Devices",
			value: deviceCount,
			icon: Cpu,
			color: "bg-[#1E7B34]",
		},
	];

	return (
		<div className="grid gap-4 md:grid-cols-3">
			{cards.map((card) => (
				<div
					key={card.label}
					className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex items-center gap-4"
				>
					<div
						className={`w-12 h-12 rounded-2xl ${card.color} flex items-center justify-center shrink-0`}
					>
						<card.icon className="w-6 h-6 text-white" />
					</div>
					<div>
						<p className="text-3xl font-black text-[#0A3D62]">{card.value}</p>
						<p className="text-xs font-black uppercase text-[#3D5568] tracking-wider">
							{card.label}
						</p>
					</div>
				</div>
			))}
		</div>
	);
}
