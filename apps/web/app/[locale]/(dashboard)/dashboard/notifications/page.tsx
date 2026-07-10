import prisma from "@/lib/prisma";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";

export const revalidate = 0;

const tierConfig: Record<
	string,
	{ icon: typeof AlertCircle; color: string; bg: string; label: string }
> = {
	CRITICAL: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: "Critical" },
	WARNING: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", label: "Warning" },
	SUCCESS: { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", label: "Success" },
	INFO: { icon: Info, color: "text-blue-600", bg: "bg-blue-50", label: "Info" },
};

export default async function NotificationsPage() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found.</p>
			</div>
		);
	}

	const notifications = await prisma.notification.findMany({
		where: { pondId: pond.id },
		orderBy: { createdAt: "desc" },
		take: 100,
	});

	const formatDate = (d: Date) =>
		new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		}).format(d);

	return (
		<div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-500">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Bell size={28} />
					Notifications
				</h1>
				<p className="mt-2 text-gray-500">
					{notifications.length} alert{notifications.length !== 1 ? "s" : ""} for {pond.name}
				</p>
			</div>

			{notifications.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<Bell size={48} className="mb-4 opacity-30" />
					<p className="text-lg font-medium">All clear!</p>
					<p className="text-sm">No notifications yet.</p>
				</div>
			) : (
				<div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
					{notifications.map((n) => {
						const tier = tierConfig[n.tier] || tierConfig.INFO;
						const Icon = tier.icon;

						return (
							<div
								key={n.id}
								className={`p-4 sm:p-5 flex items-start gap-4 transition-colors ${n.read ? "bg-white" : "bg-blue-50/30"}`}
							>
								<div className={`shrink-0 mt-0.5 p-2 rounded-xl ${tier.bg} ${tier.color}`}>
									<Icon size={20} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<span
											className={`text-xs font-semibold uppercase tracking-wider ${tier.color}`}
										>
											{tier.label}
										</span>
										{!n.read && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
									</div>
									<p className="text-sm text-gray-800 leading-relaxed">{n.message}</p>
									<p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt)}</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
